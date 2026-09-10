import { z } from "zod";
import type { PublicSnapshotV1 } from "../src/data/contracts";

export const ANALYSIS_CONTINUITY_PATH = "public/data/analysis-continuity.json";
export const MAX_CONTINUITY_BYTES = 2048;
const sha256 = z.string().regex(/^[0-9a-f]{64}$/u);
export const analysisContinuitySchema = z.object({
  kind: z.literal("azure-ops-pulse-analysis-continuity"),
  version: z.literal(1),
  archiveSha256: sha256.nullable(),
  currentEvidenceSha256: sha256,
  sourceScopeSha256: sha256
}).strict();
export type AnalysisContinuityBinding = z.infer<typeof analysisContinuitySchema>;

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => ordered(item));
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => [key, ordered(record[key])]));
  }
  if (value === null || typeof value === "string" || typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))) return value;
  throw new Error("Continuity hashes require JSON values");
}

/** Key order and checkout line endings cannot change a binding; array order and every value do. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(ordered(value));
}

export function analysisEvidence(snapshot: PublicSnapshotV1): PublicSnapshotV1 {
  return { ...snapshot, aiInsights: [] };
}

export function scopedAnalysisEvidence(snapshot: PublicSnapshotV1, sourceScopeSha256: string) {
  return { sourceScopeSha256, evidence: analysisEvidence(snapshot) };
}

export async function sha256Text(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function hasKnownScopeMismatch(archive: PublicSnapshotV1, current: PublicSnapshotV1): boolean {
  return (["subscriptionId", "tenantId"] as const).some((field) => {
    const anonymous = field === "subscriptionId" ? "subscription-anonymous" : "tenant-anonymous";
    return archive.scope[field] !== anonymous && current.scope[field] !== anonymous &&
      archive.scope[field] !== current.scope[field];
  });
}

export async function verifyAnalysisContinuity(
  archive: PublicSnapshotV1,
  current: PublicSnapshotV1,
  binding?: unknown,
  digestText: (text: string) => Promise<string> = sha256Text
): Promise<void> {
  if (hasKnownScopeMismatch(archive, current)) throw new Error("Analysis scopes differ");
  if (binding === undefined) {
    throw new Error("Missing trusted analysis continuity binding");
  }
  const parsed = analysisContinuitySchema.parse(binding);
  const [archiveHash, currentHash] = await Promise.all([
    digestText(canonicalJson(archive)),
    digestText(canonicalJson(scopedAnalysisEvidence(current, parsed.sourceScopeSha256)))
  ]);
  if (parsed.archiveSha256 !== archiveHash || parsed.currentEvidenceSha256 !== currentHash) {
    throw new Error("Analysis continuity binding does not match archive and current evidence");
  }
}
