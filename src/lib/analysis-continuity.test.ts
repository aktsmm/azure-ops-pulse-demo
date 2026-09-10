import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { snapshotFixture } from "../test/snapshot-fixtures";
import type { PublicSnapshotV1 } from "../data/contracts";
import { canonicalJson, analysisEvidence, scopedAnalysisEvidence } from "../../scripts/analysis-continuity-contract";
import { analysisDigest, canonicalAnalysisJson, fetchAnalysisContinuity, MAX_CONTINUITY_BYTES, verifyAnalysisContinuity } from "./analysis-continuity";

const archive = snapshotFixture();
const current: PublicSnapshotV1 = {
  ...archive, aiInsights: [], generatedAt: "2026-09-11T00:00:00Z",
  scope: { displayName: "Azure subscription", subscriptionId: "subscription-anonymous", tenantId: "tenant-anonymous" }
};
async function bindingFor(past = archive, present = current) {
  return {
    kind: "azure-ops-pulse-analysis-continuity", version: 1,
    archiveSha256: await analysisDigest(past),
    currentEvidenceSha256: createHash("sha256").update(canonicalJson(scopedAnalysisEvidence(present, "a".repeat(64)))).digest("hex"),
    sourceScopeSha256: "a".repeat(64)
  };
}
beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => vi.unstubAllGlobals());

describe("Browser verification of publisher-owned continuity", () => {
  it("uses the producer's canonical JSON semantics, preserving every array and evidence value", () => {
    for (const value of [archive, analysisEvidence(current), { z: [2, 1], a: { y: null, x: "日本語" } }]) {
      expect(canonicalAnalysisJson(value)).toBe(canonicalJson(value));
    }
  });
  it("accepts a matching publisher binding, including formatting-only changes, without mutating data", async () => {
    const binding = await bindingFor();
    const before = JSON.stringify(archive);
    const reordered = Object.fromEntries(Object.entries(archive).reverse()) as PublicSnapshotV1;
    expect(await verifyAnalysisContinuity(reordered, current, binding)).toBe(true);
    expect(JSON.stringify(archive)).toBe(before);
    expect(await verifyAnalysisContinuity(archive, { ...current, aiInsights: archive.aiInsights }, binding)).toBe(true);
  });
  it("rejects unbound anonymous transitions and other known scopes", async () => {
    await expect(verifyAnalysisContinuity(archive, current)).rejects.toThrow();
    await expect(verifyAnalysisContinuity({ ...archive, scope: current.scope }, current)).rejects.toThrow();
    await expect(verifyAnalysisContinuity(archive, { ...current, scope: archive.scope })).rejects.toThrow();
  });
  it.each(["subscriptionId", "tenantId"] as const)("rejects a different known %s even with both hashes rebound", async (field) => {
    const changed = {
      ...archive, scope: { ...archive.scope, [field]: "12345678-****-****-****-****87654321" }
    };
    const present = { ...current, scope: archive.scope };
    const originalBinding = await bindingFor();
    const rebound = await bindingFor(changed, present);
    expect(changed.scope[field]).not.toBe(present.scope[field]);
    expect(rebound.archiveSha256).not.toBe(originalBinding.archiveSha256);
    expect(rebound.currentEvidenceSha256).not.toBe(originalBinding.currentEvidenceSha256);
    await expect(verifyAnalysisContinuity(changed, present, rebound)).rejects.toThrow("Analysis scopes differ");
  });
  it("rejects a different archive, changed evidence, null hash and malformed bindings", async () => {
    const binding = await bindingFor();
    const changedArchive = structuredClone(archive);
    changedArchive.aiInsights[0]!.title += "変更";
    await expect(verifyAnalysisContinuity(changedArchive, current, binding)).rejects.toThrow();
    await expect(verifyAnalysisContinuity(archive, { ...current, generatedAt: "2026-09-12T00:00:00Z" }, binding)).rejects.toThrow();
    for (const invalid of [
      null, [], { ...binding, archiveSha256: null }, { ...binding, version: 2 },
      { ...binding, sourceScopeSha256: "bad" }, { ...binding, sourceScopeSha256: "b".repeat(64) },
      { ...binding, unexpected: true }
    ]) await expect(verifyAnalysisContinuity(archive, current, invalid)).rejects.toThrow();
  });
  it("rejects stale bindings even when public legacy scopes still match", async () => {
    const changed = { ...current, scope: archive.scope };
    expect(changed.scope).not.toEqual(current.scope);
    await expect(verifyAnalysisContinuity(archive, changed, await bindingFor())).rejects.toThrow("Continuity content mismatch");
  });
  it("loads only the fixed same-origin binding URL with bounded responses and no-cache", async () => {
    const binding = await bindingFor();
    const mock = vi.fn().mockResolvedValue(new Response(JSON.stringify(binding)));
    vi.stubGlobal("fetch", mock);
    const signal = new AbortController().signal;
    expect(await fetchAnalysisContinuity(archive, current, signal)).toBe(true);
    expect(mock).toHaveBeenCalledWith(`${import.meta.env.BASE_URL}data/analysis-continuity.json`, { signal, cache: "no-cache" });
    for (const response of [
      new Response("", { status: 404 }), new Response("", { status: 500 }), new Response("{"),
      new Response(" ".repeat(MAX_CONTINUITY_BYTES + 1)),
      new Response("{}", { headers: { "content-length": String(MAX_CONTINUITY_BYTES + 1) } })
    ]) {
      mock.mockResolvedValueOnce(response);
      await expect(fetchAnalysisContinuity(archive, current, signal)).rejects.toThrow();
    }
  });
});
