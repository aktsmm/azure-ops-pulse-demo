import type { PublicSnapshotV1 } from "../data/contracts";
import { isArchiveViewData } from "./archive-view-shape";

export const MAX_ARCHIVED_ANALYSIS_BYTES = 1_048_576;

function numericTokens(value: string | number): string[] {
  return (String(value).match(/[+-]?\d[\d,]*(?:\.\d+)?/g) ?? []).map((token) => {
    const compact = token.replaceAll(",", "");
    const [integer = "", fraction = ""] = compact.replace(/^[+-]/, "").split(".");
    const canonical = `${integer.replace(/^0+(?=\d)/, "")}${fraction.replace(/0+$/, "") ? `.${fraction.replace(/0+$/, "")}` : ""}`;
    return compact.startsWith("-") && !/^0(?:\.0+)?$/.test(canonical) ? `-${canonical}` : canonical;
  });
}

function hasMatchingScalars(snapshot: PublicSnapshotV1): boolean {
  return snapshot.aiInsights.every((insight) => insight.numericEvidence.every((evidence) => {
    let value: unknown = snapshot;
    for (const segment of evidence.source.split(".")) {
      if (!value || typeof value !== "object" || !Object.prototype.hasOwnProperty.call(value, segment)) return false;
      value = (value as Record<string, unknown>)[segment];
    }
    if (typeof value !== "number" && typeof value !== "string") return false;
    const expected = numericTokens(value);
    const reported = numericTokens(evidence.value);
    return expected.length > 0 && expected.length === reported.length && expected.every((token, index) => token === reported[index]);
  }));
}

export type ArchiveScopeVerifier = (archive: PublicSnapshotV1, current: PublicSnapshotV1) => Promise<boolean>;

async function compatibleScope(archive: PublicSnapshotV1, current: PublicSnapshotV1, verifyBinding?: ArchiveScopeVerifier): Promise<boolean> {
  if ((["subscriptionId", "tenantId"] as const).some((field) => {
    const anonymous = field === "subscriptionId" ? "subscription-anonymous" : "tenant-anonymous";
    return archive.scope[field] !== anonymous && current.scope[field] !== anonymous &&
      archive.scope[field] !== current.scope[field];
  })) return false;
  return verifyBinding ? verifyBinding(archive, current) : false;
}

export async function readBoundedResponse(response: Response, maxBytes: number): Promise<string> {
  const declaredBytes = Number(response.headers.get("content-length"));
  if (declaredBytes > maxBytes) {
    await response.body?.cancel();
    throw new Error("Invalid archive size");
  }
  if (!response.body) throw new Error("Missing archive body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new Error("Archive size exceeded");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return text;
}

export async function readArchivedAnalysis(response: Response, current: PublicSnapshotV1, verifyBinding?: ArchiveScopeVerifier): Promise<PublicSnapshotV1> {
  const archive: unknown = JSON.parse(await readBoundedResponse(response, MAX_ARCHIVED_ANALYSIS_BYTES));
  if (!isArchiveViewData(archive)) throw new Error("Unsupported archive shape");
  if (archive.mode !== "AZURE" || current.mode !== "AZURE" ||
      archive.schemaVersion !== current.schemaVersion || !archive.aiInsights.length ||
      !Number.isFinite(Date.parse(current.generatedAt)) ||
      Date.parse(archive.generatedAt) > Date.parse(current.generatedAt) ||
      !await compatibleScope(archive, current, verifyBinding)) throw new Error("Incompatible analysis archive");
  // This display guard checks scalar consistency; independent publication review remains upstream.
  if (!hasMatchingScalars(archive)) throw new Error("Archive scalar evidence mismatch");
  return archive;
}
