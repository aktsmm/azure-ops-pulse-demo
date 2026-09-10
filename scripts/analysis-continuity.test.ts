// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { maskGuid } from "../src/lib/sanitize";
import { buildDemoSnapshot } from "./build-demo-snapshot";
import {
  ANALYSIS_CONTINUITY_PATH, analysisEvidence, canonicalJson, verifyAnalysisContinuity
} from "./analysis-continuity-contract";
import {
  planCollectionContinuity, planLegacySeed, planReviewedContinuity,
  snapshotHash, sourceScopeHash, updateContinuityFiles, validateStoredContinuity
} from "./bind-analysis-continuity";

vi.setConfig({ testTimeout: 30_000 });

const source = {
  subscriptionId: "11111111-1111-4111-8111-111111111111",
  tenantId: "22222222-2222-4222-8222-222222222222"
};
const differentSource = { ...source, subscriptionId: "11111111-9999-4999-8999-111111111111" };
const digest = async (text: string) => createHash("sha256").update(text).digest("hex");

function snapshot(at = "2026-09-08T21:00:00.000Z", anonymous = false, insights = true) {
  const result = buildDemoSnapshot(at);
  result.mode = "AZURE";
  result.scope.subscriptionId = anonymous ? "subscription-anonymous" : maskGuid(source.subscriptionId);
  result.scope.tenantId = anonymous ? "tenant-anonymous" : maskGuid(source.tenantId);
  if (!insights) result.aiInsights = [];
  return result;
}

function fixture() {
  const old = snapshot();
  const oldText = `${JSON.stringify(old, null, 2)}\n`;
  const current = snapshot("2026-09-10T21:00:00.000Z", true, false);
  const currentText = JSON.stringify(current);
  const grant = { evidenceSha256: snapshotHash(analysisEvidence(old)), sourceScopeSha256: sourceScopeHash(source) };
  return { old, oldText, current, currentText, grant };
}

describe("trusted analysis continuity binding", () => {
  it("authorizes old masked to anonymous collection without rewriting old evidence or using labels as proof", async () => {
    const { old, oldText, current, currentText, grant } = fixture();
    const update = planCollectionContinuity({ published: oldText, archive: oldText }, currentText, source, grant);
    expect(update.archive).toBe(oldText);
    expect(JSON.parse(currentText).aiInsights).toEqual([]);
    await expect(verifyAnalysisContinuity(old, current, update.binding, digest)).resolves.toBeUndefined();
    await expect(verifyAnalysisContinuity(old, current, undefined, digest)).rejects.toThrow("Missing trusted");
    expect(snapshotHash(old)).toBe(update.binding.archiveSha256);
  });

  describe("bounded trusted continuity publication files", () => {
    const directories: string[] = [];
    afterEach(async () => {
      vi.unstubAllEnvs();
      await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
    });

    async function files() {
      const directory = join(".candidate", `continuity-test-${randomUUID()}`);
      directories.push(directory);
      await mkdir(directory, { recursive: true });
      const paths = {
        published: join(directory, "snapshot.json"),
        archive: join(directory, "last-analysis.json"),
        binding: join(directory, "analysis-continuity.json")
      };
      const candidate = join(directory, "candidate.json");
      const data = fixture();
      const initial = planLegacySeed({ published: data.oldText, archive: data.oldText }, data.grant);
      await Promise.all([
        writeFile(paths.published, data.oldText),
        writeFile(paths.archive, data.oldText),
        writeFile(paths.binding, JSON.stringify(initial.binding)),
        writeFile(candidate, data.currentText)
      ]);
      vi.stubEnv("AZURE_SUBSCRIPTION_ID", source.subscriptionId);
      vi.stubEnv("AZURE_TENANT_ID", source.tenantId);
      return { ...data, paths, candidate, initial };
    }

    it("preserves old bytes during collection/zero review and binds a reviewed replacement without touching current", async () => {
      const { oldText, old, currentText, current, paths, candidate } = await files();
      await updateContinuityFiles("collection", candidate, paths);
      expect(await readFile(paths.published, "utf8")).toBe(oldText);
      expect(await readFile(paths.archive, "utf8")).toBe(oldText);
      await writeFile(paths.published, currentText);
      expect(() => validateStoredContinuity(JSON.parse(readFileSync(paths.binding, "utf8")), current, old)).not.toThrow();
      await updateContinuityFiles("reviewed", candidate, paths);
      expect(await readFile(paths.archive, "utf8")).toBe(oldText);
      const reviewed = snapshot(current.generatedAt, true);
      const reviewedText = `${JSON.stringify(reviewed, null, 2)}\n`;
      await writeFile(candidate, reviewedText);
      await updateContinuityFiles("reviewed", candidate, paths);
      expect(await readFile(paths.published, "utf8")).toBe(currentText);
      expect(await readFile(paths.archive, "utf8")).toBe(reviewedText);
      await writeFile(paths.published, reviewedText);
      expect(() => validateStoredContinuity(JSON.parse(readFileSync(paths.binding, "utf8")), reviewed, reviewed)).not.toThrow();
    });

    it("fails closed without changing any file on malformed, stale or oversized binding", async () => {
      const { oldText, initial, paths, candidate } = await files();
      for (const invalid of [
        "{broken",
        JSON.stringify({ ...initial.binding, archiveSha256: "0".repeat(64) }),
        `${JSON.stringify(initial.binding)}${" ".repeat(2048)}`
      ]) {
        await writeFile(paths.binding, invalid);
        await expect(updateContinuityFiles("collection", candidate, paths)).rejects.toThrow();
        expect(await readFile(paths.published, "utf8")).toBe(oldText);
        expect(await readFile(paths.archive, "utf8")).toBe(oldText);
        expect(await readFile(paths.binding, "utf8")).toBe(invalid);
      }
    });

    it("rejects output aliases instead of overwriting the current snapshot", async () => {
      const { paths, candidate, oldText } = await files();
      await expect(updateContinuityFiles("collection", candidate, { ...paths, archive: paths.published }))
        .rejects.toThrow("separate files");
      expect(await readFile(paths.published, "utf8")).toBe(oldText);
    });
  });

  it("does not accept equal anonymous labels without an exact publisher binding", async () => {
    const old = snapshot("2026-09-08T21:00:00.000Z", true);
    const current = snapshot("2026-09-10T21:00:00.000Z", true, false);
    await expect(verifyAnalysisContinuity(old, current, undefined, digest)).rejects.toThrow("Missing trusted");
    const legacy = snapshot();
    await expect(verifyAnalysisContinuity(legacy, { ...legacy, aiInsights: [] }, undefined, digest))
      .rejects.toThrow("Missing trusted");
  });

  it("rejects different actual scopes even when every displayed legacy fingerprint is identical", () => {
    const { oldText, currentText, grant } = fixture();
    expect(maskGuid(source.subscriptionId)).toBe(maskGuid(differentSource.subscriptionId));
    expect(sourceScopeHash(source)).not.toBe(sourceScopeHash(differentSource));
    expect(() => planCollectionContinuity({ published: oldText, archive: oldText }, currentText, differentSource, grant))
      .toThrow("Actual collection scope differs");
    const first = planCollectionContinuity({ published: oldText, archive: oldText }, currentText, source, grant);
    const next = JSON.stringify(snapshot("2026-09-12T21:00:00.000Z", true, false));
    expect(() => planCollectionContinuity({
      published: currentText, archive: first.archive, binding: first.binding
    }, next, differentSource, grant)).toThrow("Actual collection scope differs");
  });

  it("rejects a known different displayed scope even if someone supplies matching content hashes", async () => {
    const { old, oldText, current, currentText, grant } = fixture();
    const update = planCollectionContinuity({ published: oldText, archive: oldText }, currentText, source, grant);
    const different = snapshot("2026-09-10T21:00:00.000Z", false, false);
    different.scope.subscriptionId = maskGuid("33333333-3333-4333-8333-333333333333");
    await expect(verifyAnalysisContinuity(old, different, update.binding, digest)).rejects.toThrow("scopes differ");
    expect(() => planCollectionContinuity({ published: oldText, archive: oldText }, JSON.stringify(different), source, grant))
      .toThrow("incompatible scope");
    expect(current.scope.subscriptionId).toBe("subscription-anonymous");
  });

  it("rejects archive, current, scope-digest and metadata tampering or stale bindings", async () => {
    const { old, oldText, current, currentText, grant } = fixture();
    const update = planCollectionContinuity({ published: oldText, archive: oldText }, currentText, source, grant);
    const changedArchive = structuredClone(old);
    changedArchive.aiInsights[0]!.title += "変更";
    const changedCurrent = structuredClone(current);
    changedCurrent.cost.deltaPercent = 99;
    const staleCurrent = { ...current, generatedAt: "2026-09-12T21:00:00.000Z" };
    for (const [archive, published, binding] of [
      [changedArchive, current, update.binding],
      [old, changedCurrent, update.binding],
      [old, staleCurrent, update.binding],
      [old, current, { ...update.binding, sourceScopeSha256: sourceScopeHash(differentSource) }],
      [old, current, { ...update.binding, archiveSha256: null }],
      [old, current, { ...update.binding, extra: "untrusted" }]
    ] as const) {
      await expect(verifyAnalysisContinuity(archive, published, binding, digest)).rejects.toThrow();
    }
    expect(() => planCollectionContinuity({
      published: JSON.stringify(staleCurrent), archive: oldText, binding: update.binding
    }, JSON.stringify(staleCurrent), source, grant)).toThrow("Stored continuity binding");
  });

  it("does not bootstrap arbitrary legacy or anonymous analysis without a pinned migration grant", () => {
    const { oldText, currentText } = fixture();
    expect(() => planCollectionContinuity({ published: oldText, archive: oldText }, currentText, source))
      .toThrow("approved legacy migration");
    const anonymous = JSON.stringify(snapshot("2026-09-08T21:00:00.000Z", true));
    expect(() => planCollectionContinuity({ published: anonymous, archive: anonymous }, currentText, source))
      .toThrow("approved legacy migration");
    expect(() => sourceScopeHash({ subscriptionId: "subscription-anonymous", tenantId: "tenant-anonymous" }))
      .toThrow("Configured full");
  });

  it("keeps a valid zero-result review separate and refreshes only a reviewed matching baseline", async () => {
    const { old, oldText, current, currentText, grant } = fixture();
    const collected = planCollectionContinuity({ published: oldText, archive: oldText }, currentText, source, grant);
    const state = { published: currentText, archive: collected.archive, binding: collected.binding };
    const empty = planReviewedContinuity(state, currentText, grant);
    expect(empty.archive).toBe(oldText);
    await expect(verifyAnalysisContinuity(old, current, empty.binding, digest)).resolves.toBeUndefined();
    const reviewed = snapshot("2026-09-10T21:00:00.000Z", true);
    const reviewedText = JSON.stringify(reviewed);
    const published = planReviewedContinuity(state, reviewedText, grant);
    expect(published.archive).toBe(reviewedText);
    await expect(verifyAnalysisContinuity(reviewed, reviewed, published.binding, digest)).resolves.toBeUndefined();
    reviewed.cost.deltaPercent = 99;
    expect(() => planReviewedContinuity(state, JSON.stringify(reviewed), grant)).toThrow();
  });

  it("records fresh scope with a null archive, not fictional previous analysis", async () => {
    const { current, currentText, grant, old } = fixture();
    const update = planCollectionContinuity({}, currentText, source, grant);
    expect(update.archive).toBeUndefined();
    expect(update.binding.archiveSha256).toBeNull();
    expect(() => validateStoredContinuity(update.binding, current, undefined)).not.toThrow();
    await expect(verifyAnalysisContinuity(old, current, update.binding, digest)).rejects.toThrow();
  });

  it("normalizes JSON key order and line endings but preserves every non-AI current value", () => {
    const { old, oldText, grant } = fixture();
    const update = planLegacySeed({ published: oldText, archive: oldText }, grant);
    const reordered = Object.fromEntries(Object.entries(old).reverse());
    expect(snapshotHash(reordered)).toBe(snapshotHash(old));
    expect(snapshotHash(JSON.parse(oldText.replaceAll("\n", "\r\n")))).toBe(snapshotHash(old));
    expect(canonicalJson(analysisEvidence({ ...old, aiInsights: [] }))).toBe(canonicalJson(analysisEvidence(old)));
    expect(() => validateStoredContinuity(update.binding, old, old)).not.toThrow();
  });

  it("validates any shipped binding against the exact shipped pair in CI", () => {
    if (!existsSync("public/data/last-analysis.json") && !existsSync(ANALYSIS_CONTINUITY_PATH)) return;
    expect(existsSync(ANALYSIS_CONTINUITY_PATH)).toBe(true);
    const current = JSON.parse(readFileSync("public/data/snapshot.json", "utf8"));
    const archive = existsSync("public/data/last-analysis.json")
      ? JSON.parse(readFileSync("public/data/last-analysis.json", "utf8")) : undefined;
    const binding = JSON.parse(readFileSync(ANALYSIS_CONTINUITY_PATH, "utf8"));
    expect(() => validateStoredContinuity(binding, current, archive)).not.toThrow();
  });
});
