import { describe, expect, it } from "vitest";
import { snapshotFixture } from "../test/snapshot-fixtures";
import { MAX_ARCHIVED_ANALYSIS_BYTES, readArchivedAnalysis } from "./archived-analysis";

const archive = snapshotFixture();
const current = { ...archive, generatedAt: "2026-09-11T04:17:04.906Z", aiInsights: [] };
const response = (value: unknown) => new Response(JSON.stringify(value));

describe("Bounded complete previous analysis", () => {
  it("retains original evidence and collection timestamp without merging current fields", async () => {
    const result = await readArchivedAnalysis(response(archive), current, async () => true);
    expect(result).toEqual(archive);
    expect(result.generatedAt).not.toBe(current.generatedAt);
    expect(current.aiInsights).toEqual([]);
  });
  it("requires a trusted binding even when both legacy scope masks match", async () => {
    await expect(readArchivedAnalysis(response(archive), current)).rejects.toThrow();
  });
  it.each(["subscriptionId", "tenantId"] as const)("rejects a different known %s even if a verifier approves", async (field) => {
    const otherScope = {
      ...archive, scope: { ...archive.scope, [field]: "12345678-****-****-****-****87654321" }
    };
    expect(otherScope.scope[field]).not.toBe(current.scope[field]);
    await expect(readArchivedAnalysis(response(otherScope), current, async () => true))
      .rejects.toThrow("Incompatible analysis archive");
  });
  it("requires verified binding for anonymization migration without rewriting the archive", async () => {
    const migrated = { ...current, scope: { displayName: "Azure subscription", subscriptionId: "subscription-anonymous", tenantId: "tenant-anonymous" } };
    await expect(readArchivedAnalysis(response(archive), migrated)).rejects.toThrow();
    expect(await readArchivedAnalysis(response(archive), migrated, async () => true)).toEqual(archive);
    await expect(readArchivedAnalysis(response(archive), migrated, async () => false)).rejects.toThrow();
    const otherScope = { ...archive, scope: { ...archive.scope, subscriptionId: "12345678-****-****-****-****87654321" } };
    await expect(readArchivedAnalysis(response(otherScope), migrated)).rejects.toThrow();
    const anonymousArchive = { ...archive, scope: migrated.scope };
    await expect(readArchivedAnalysis(response(anonymousArchive), migrated)).rejects.toThrow();
    await expect(readArchivedAnalysis(response(archive), {
      ...migrated, scope: { ...migrated.scope, tenantId: "other-anonymous" }
    })).rejects.toThrow();
  });
  it.each([
    { ...archive, aiInsights: [] },
    { ...archive, generatedAt: "2026-09-12T00:00:00Z" },
    { ...archive, schemaVersion: "0.0.0" },
    { ...archive, mode: "DEMO" },
    { ...archive, scope: { ...archive.scope, subscriptionId: "00000000-0000-0000-0000-000000000000" } },
    { ...archive, advisor: undefined }
  ])("rejects empty, newer, incompatible or incomplete archives", async (invalid) => {
    await expect(readArchivedAnalysis(response(invalid), current, async () => true)).rejects.toThrow();
  });
  it("rejects both declared and actually streamed oversize data", async () => {
    await expect(readArchivedAnalysis(new Response("{}", {
      headers: { "content-length": String(MAX_ARCHIVED_ANALYSIS_BYTES + 1) }
    }), current)).rejects.toThrow();
    await expect(readArchivedAnalysis(new Response(" ".repeat(MAX_ARCHIVED_ANALYSIS_BYTES + 1)), current)).rejects.toThrow();
  });
  it("rejects malformed JSON and mismatched numerical evidence", async () => {
    await expect(readArchivedAnalysis(new Response("{"), current)).rejects.toThrow();
    const invalid = structuredClone(archive);
    invalid.aiInsights[0]!.numericEvidence[0]!.value = "99999";
    await expect(readArchivedAnalysis(response(invalid), current, async () => true)).rejects.toThrow("Archive scalar evidence mismatch");
  });
  it.each([
    { ...archive, cost: { ...archive.cost, categories: [null] } },
    { ...archive, inventory: { ...archive.inventory, resources: [{ id: "missing-fields" }] } },
    { ...archive, aiInsights: [{ ...archive.aiInsights[0]!, numericEvidence: [] }] },
    { ...archive, aiInsights: [{ ...archive.aiInsights[0]!, route: "https://invalid.example" }] },
    { ...archive, aiInsights: [archive.aiInsights[0], archive.aiInsights[0]] }
  ])("rejects malformed renderable fields rather than breaking an archived detail route", async (invalid) => {
    await expect(readArchivedAnalysis(response(invalid), current)).rejects.toThrow();
  });
});
