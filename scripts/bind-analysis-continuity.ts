import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { PublicSnapshotV1 } from "../src/data/contracts";
import {
  ANALYSIS_CONTINUITY_PATH, MAX_CONTINUITY_BYTES, analysisContinuitySchema,
  analysisEvidence, canonicalJson, hasKnownScopeMismatch, scopedAnalysisEvidence, type AnalysisContinuityBinding
} from "./analysis-continuity-contract";
import { LAST_ANALYSIS_PATH, MAX_ANALYSIS_BYTES, validateRetainedAnalysis } from "./retain-last-analysis";
import { scanJson } from "./privacy-rules";

// Explicit migration grant for df41093's published evidence. The full source digest was verified
// against the unique enabled Azure account matching BOTH legacy fingerprints; raw IDs were not saved.
export const LEGACY_CONTINUITY_GRANT = {
  evidenceSha256: "d41f7c698f528aec76500026bc2f6bdf16fbb3ff2d230e73bcb2a79ba59c0a78",
  sourceScopeSha256: "5f46d706c3911beabbd701afe58b6057b573fa2e6b3c8ace6bb9d5a5387c919c"
} as const;

export function snapshotHash(snapshot: unknown): string {
  return createHash("sha256").update(canonicalJson(snapshot), "utf8").digest("hex");
}

export function sourceScopeHash(scope: { subscriptionId?: string; tenantId?: string }): string {
  const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
  const subscriptionId = scope.subscriptionId?.trim().toLowerCase() ?? "";
  const tenantId = scope.tenantId?.trim().toLowerCase() ?? "";
  if (!guid.test(subscriptionId) || !guid.test(tenantId)) {
    throw new Error("Configured full tenant and subscription IDs are required for source continuity");
  }
  return snapshotHash({ subscriptionId, tenantId });
}

function bindingFor(
  current: PublicSnapshotV1, archive: PublicSnapshotV1 | undefined, sourceScopeSha256: string
): AnalysisContinuityBinding {
  if (archive && (hasKnownScopeMismatch(archive, current) ||
      Date.parse(archive.generatedAt) > Date.parse(current.generatedAt))) {
    throw new Error("Retained analysis is from an incompatible scope or newer collection");
  }
  return analysisContinuitySchema.parse({
    kind: "azure-ops-pulse-analysis-continuity", version: 1,
    archiveSha256: archive ? snapshotHash(archive) : null,
    currentEvidenceSha256: snapshotHash(scopedAnalysisEvidence(current, sourceScopeSha256)), sourceScopeSha256
  });
}

export function validateStoredContinuity(
  binding: unknown, current: PublicSnapshotV1 | undefined, archive: PublicSnapshotV1 | undefined
): AnalysisContinuityBinding {
  const parsed = analysisContinuitySchema.parse(binding);
  if (!current) throw new Error("Continuity binding has no published baseline");
  const expected = bindingFor(current, archive, parsed.sourceScopeSha256);
  if (canonicalJson(parsed) !== canonicalJson(expected)) {
    throw new Error("Stored continuity binding does not match published evidence and archive");
  }
  return parsed;
}

function legacySource(
  archive: PublicSnapshotV1 | undefined,
  grant: { evidenceSha256: string; sourceScopeSha256: string }
): string {
  if (!archive || snapshotHash(analysisEvidence(archive)) !== grant.evidenceSha256) {
    throw new Error("Missing trusted scope lineage; this is not the approved legacy migration");
  }
  return grant.sourceScopeSha256;
}

export interface ContinuityState {
  published?: string;
  archive?: string;
  binding?: unknown;
}
export interface ContinuityUpdate {
  archive?: string;
  binding: AnalysisContinuityBinding;
}

function parsedState(state: ContinuityState) {
  // Each distinct document passes every gate once per operation, including identical current/archive.
  const validated = new Map<string, PublicSnapshotV1>();
  const parse = (text: string) => {
    let snapshot = validated.get(text);
    if (!snapshot) {
      snapshot = validateRetainedAnalysis(text);
      validated.set(text, snapshot);
    }
    return snapshot;
  };
  const published = state.published === undefined ? undefined : parse(state.published);
  const archive = state.archive === undefined ? undefined : parse(state.archive);
  if (archive && !archive.aiInsights.length) throw new Error("Retained analysis must be nonempty");
  if (published && archive && Date.parse(archive.generatedAt) > Date.parse(published.generatedAt)) {
    throw new Error("Retained analysis cannot be newer than the published snapshot");
  }
  const binding = state.binding === undefined ? undefined : validateStoredContinuity(state.binding, published, archive);
  const hasCurrentAnalysis = Boolean(published?.aiInsights.length);
  return {
    published, binding, parse,
    retained: hasCurrentAnalysis ? published : archive,
    retainedText: hasCurrentAnalysis ? state.published : state.archive
  };
}

export function planCollectionContinuity(
  state: ContinuityState,
  collectedText: string,
  source: { subscriptionId?: string; tenantId?: string },
  grant: { evidenceSha256: string; sourceScopeSha256: string } = LEGACY_CONTINUITY_GRANT
): ContinuityUpdate {
  const previous = parsedState(state);
  const collected = previous.parse(collectedText);
  if (collected.aiInsights.length) throw new Error("A collection candidate must not inherit AI insights");
  const { retainedText: archiveText, retained: archive } = previous;
  const sourceDigest = sourceScopeHash(source);
  const expectedSource = previous.binding?.sourceScopeSha256 ?? (archive ? legacySource(archive, grant) : sourceDigest);
  if (sourceDigest !== expectedSource) {
    throw new Error("Actual collection scope differs from the authorized retained-analysis source");
  }
  return { archive: archiveText, binding: bindingFor(collected, archive, sourceDigest) };
}

export function planReviewedContinuity(
  state: ContinuityState,
  reviewedText: string,
  grant: { evidenceSha256: string; sourceScopeSha256: string } = LEGACY_CONTINUITY_GRANT
): ContinuityUpdate {
  const previous = parsedState(state);
  const reviewed = previous.parse(reviewedText);
  if (!previous.published ||
      snapshotHash(analysisEvidence(previous.published)) !== snapshotHash(analysisEvidence(reviewed))) {
    throw new Error("Reviewed analysis changed its published evidence baseline");
  }
  const { retainedText: priorText, retained: prior } = previous;
  const source = previous.binding?.sourceScopeSha256 ?? legacySource(prior, grant);
  const archiveText = reviewed.aiInsights.length ? reviewedText : priorText;
  const archive = reviewed.aiInsights.length ? reviewed : prior;
  return { archive: archiveText, binding: bindingFor(reviewed, archive, source) };
}

export function planLegacySeed(
  state: ContinuityState,
  grant: { evidenceSha256: string; sourceScopeSha256: string } = LEGACY_CONTINUITY_GRANT
): ContinuityUpdate {
  const previous = parsedState(state);
  if (!previous.published) throw new Error("Missing legacy published snapshot");
  const { retainedText: archiveText, retained: archive } = previous;
  const source = previous.binding?.sourceScopeSha256 ?? legacySource(archive, grant);
  if (snapshotHash(analysisEvidence(previous.published)) !== grant.evidenceSha256) {
    throw new Error("Legacy seed does not match approved published evidence");
  }
  return { archive: archiveText, binding: bindingFor(previous.published, archive, source) };
}

async function readOptional(path: string, maxBytes: number): Promise<string | undefined> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) throw new Error("Invalid continuity file");
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function updateContinuityFiles(
  mode: "collection" | "reviewed" | "seed",
  candidatePath?: string,
  paths = {
    published: "public/data/snapshot.json", archive: LAST_ANALYSIS_PATH, binding: ANALYSIS_CONTINUITY_PATH
  }
): Promise<void> {
  if (new Set(Object.values(paths).map((path) => resolve(path))).size !== 3) {
    throw new Error("Published snapshot, retained analysis and continuity binding must be separate files");
  }
  const [published, archive, bindingText] = await Promise.all([
    readOptional(paths.published, MAX_ANALYSIS_BYTES),
    readOptional(paths.archive, MAX_ANALYSIS_BYTES),
    readOptional(paths.binding, MAX_CONTINUITY_BYTES)
  ]);
  const state = { published, archive, binding: bindingText === undefined ? undefined : JSON.parse(bindingText) as unknown };
  let update: ContinuityUpdate;
  if (mode === "seed") update = planLegacySeed(state);
  else {
    const candidate = candidatePath ? await readOptional(candidatePath, MAX_ANALYSIS_BYTES) : undefined;
    if (candidate === undefined) throw new Error("Missing validated candidate for continuity binding");
    update = mode === "collection"
      ? planCollectionContinuity(state, candidate, {
          subscriptionId: process.env.AZURE_SUBSCRIPTION_ID, tenantId: process.env.AZURE_TENANT_ID
        })
      : planReviewedContinuity(state, candidate);
  }
  const output = `${JSON.stringify(update.binding, null, 2)}\n`;
  if (Buffer.byteLength(output) > MAX_CONTINUITY_BYTES || scanJson(output).length) {
    throw new Error("Continuity binding failed size or typed privacy validation");
  }
  if (update.archive !== undefined && update.archive !== archive) {
    await mkdir(dirname(paths.archive), { recursive: true });
    await writeFile(paths.archive, update.archive, "utf8");
  }
  await mkdir(dirname(paths.binding), { recursive: true });
  await writeFile(paths.binding, output, "utf8");
}

if (process.argv[1] && /bind-analysis-continuity\.[cm]?[jt]s$/u.test(process.argv[1])) {
  const mode = process.argv[2];
  if (!["collection", "reviewed", "seed"].includes(mode ?? "")) throw new Error("Invalid continuity binding mode");
  await updateContinuityFiles(mode as "collection" | "reviewed" | "seed", process.argv[3]);
  console.log("Validated and bound retained analysis to its current evidence and authorized source.");
}
