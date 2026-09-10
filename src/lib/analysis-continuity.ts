import type { PublicSnapshotV1 } from "../data/contracts";
import { readBoundedResponse } from "./archived-analysis";

export const MAX_CONTINUITY_BYTES = 2048;

export function canonicalAnalysisJson(value: unknown): string {
  function ordered(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(ordered);
    if (item !== null && typeof item === "object") {
      const record = item as Record<string, unknown>;
      return Object.fromEntries(Object.keys(record).sort()
        .filter((key) => record[key] !== undefined).map((key) => [key, ordered(record[key])]));
    }
    if (item === null || typeof item === "string" || typeof item === "boolean" ||
      (typeof item === "number" && Number.isFinite(item))) return item;
    throw new Error("Invalid continuity JSON");
  }
  return JSON.stringify(ordered(value));
}

export async function analysisDigest(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalAnalysisJson(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyAnalysisContinuity(
  archive: PublicSnapshotV1, current: PublicSnapshotV1, binding?: unknown
): Promise<boolean> {
  const fields = ["subscriptionId", "tenantId"] as const;
  if (fields.some((field) => {
    const anonymous = field === "subscriptionId" ? "subscription-anonymous" : "tenant-anonymous";
    return archive.scope[field] !== anonymous && current.scope[field] !== anonymous &&
      archive.scope[field] !== current.scope[field];
  })) throw new Error("Analysis scopes differ");
  if (binding === undefined) throw new Error("Missing trusted continuity binding");
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) throw new Error("Invalid continuity binding");
  const record = binding as Record<string, unknown>;
  const keys = ["kind", "version", "archiveSha256", "currentEvidenceSha256", "sourceScopeSha256"];
  const hash = (value: unknown) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
  if (Object.keys(record).length !== keys.length || !keys.every((key) => Object.hasOwn(record, key)) ||
    record.kind !== "azure-ops-pulse-analysis-continuity" || record.version !== 1 ||
    !(record.archiveSha256 === null || hash(record.archiveSha256)) ||
    !hash(record.currentEvidenceSha256) || !hash(record.sourceScopeSha256)) throw new Error("Invalid continuity binding");
  // The same-origin publisher attests source lineage; browsers verify both complete content bindings.
  const [archiveHash, currentHash] = await Promise.all([
    analysisDigest(archive),
    analysisDigest({ sourceScopeSha256: record.sourceScopeSha256, evidence: { ...current, aiInsights: [] } })
  ]);
  if (record.archiveSha256 !== archiveHash || record.currentEvidenceSha256 !== currentHash) {
    throw new Error("Continuity content mismatch");
  }
  return true;
}

export async function fetchAnalysisContinuity(
  archive: PublicSnapshotV1, current: PublicSnapshotV1, signal: AbortSignal
): Promise<boolean> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/analysis-continuity.json`, { signal, cache: "no-cache" });
  if (response.status === 404) return verifyAnalysisContinuity(archive, current);
  if (!response.ok) throw new Error("Continuity binding unavailable");
  const binding: unknown = JSON.parse(await readBoundedResponse(response, MAX_CONTINUITY_BYTES));
  return verifyAnalysisContinuity(archive, current, binding);
}
