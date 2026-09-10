import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDemoSnapshot } from "./build-demo-snapshot";
import { prepareAiInput } from "./prepare-ai-input";
import { LAST_ANALYSIS_PATH, MAX_ANALYSIS_BYTES, retainLastAnalysis, selectLastAnalysis, validateRetainedAnalysis } from "./retain-last-analysis";

function published(at = "2026-09-08T21:00:00.000Z") {
  const snapshot = buildDemoSnapshot(at);
  snapshot.mode = "AZURE";
  return snapshot;
}

describe("bounded whole-snapshot analysis retention", () => {
  it("preserves old evidence and time exactly while new collection has zero current insights", () => {
    const old = published();
    const bytes = JSON.stringify(old, null, 2) + "\n";
    const collected = published("2026-09-10T21:00:00.000Z");
    collected.aiInsights = [];
    collected.cost.deltaPercent = 7.5;
    const current = JSON.stringify(collected);
    const retained = selectLastAnalysis(current, selectLastAnalysis(bytes, undefined));
    expect(retained).toBe(bytes);
    expect(JSON.parse(retained!)).toEqual(old);
    expect(JSON.parse(current)).toEqual(collected);
    expect(prepareAiInput(old).aiInsights).toEqual([]);
  });

  it("refreshes only from a nonempty published analysis, never clearing it on a zero-insight result", () => {
    const old = JSON.stringify(published());
    const newer = published("2026-09-10T21:00:00.000Z");
    const accepted = JSON.stringify(newer);
    expect(selectLastAnalysis(accepted, old)).toBe(accepted);
    newer.aiInsights = [];
    expect(selectLastAnalysis(JSON.stringify(newer), old)).toBe(old);
  });

  it("accepts missing prior files and empty current collection without fabricating an archive", () => {
    const empty = published();
    empty.aiInsights = [];
    expect(selectLastAnalysis(undefined, undefined)).toBeUndefined();
    expect(selectLastAnalysis(JSON.stringify(empty), undefined)).toBeUndefined();
    const prior = JSON.stringify(published());
    expect(selectLastAnalysis(undefined, prior)).toBe(prior);
    expect(() => selectLastAnalysis(prior, JSON.stringify(empty))).toThrow("at least one");
  });

  it("fails visibly for malformed, incompatible, oversized, recursive or private archives", () => {
    const valid = JSON.stringify(published());
    expect(() => selectLastAnalysis(valid, "{")).toThrow();
    expect(() => selectLastAnalysis(valid, JSON.stringify({ ...published(), schemaVersion: "obsolete" }))).toThrow();
    expect(() => selectLastAnalysis(valid, " ".repeat(MAX_ANALYSIS_BYTES + 1))).toThrow("size limit");
    expect(() => selectLastAnalysis(valid, JSON.stringify({ ...published(), lastAnalysis: published() }))).toThrow();
    const secret = published();
    secret.aiInsights[0]!.observation += " operator@example.com";
    expect(() => validateRetainedAnalysis(JSON.stringify(secret))).toThrow();
  });

  it("rejects stale analysis spliced into a different collection and non-Azure fixtures", () => {
    const old = published();
    const newCollection = published("2026-09-10T21:00:00.000Z");
    newCollection.aiInsights = old.aiInsights;
    expect(() => validateRetainedAnalysis(JSON.stringify(newCollection))).toThrow();
    expect(() => validateRetainedAnalysis(JSON.stringify(buildDemoSnapshot()))).toThrow("AZURE");
    expect(() => selectLastAnalysis(JSON.stringify(old), JSON.stringify(published("2026-09-11T21:00:00.000Z")))).toThrow("newer");
  });

  it("retains before collection replacement and only refreshes after all publication gates", () => {
    const collect = readFileSync(".github/workflows/collect-azure.yml", "utf8");
    const publish = readFileSync(".github/workflows/publish-ai-insights.yml", "utf8");
    const publication = publish.slice(publish.indexOf("name: Publish validated AI insights to main"));
    const collectionCommand = "npx tsx scripts/bind-analysis-continuity.ts collection .candidate/snapshot.json";
    const publicationCommand = "npx tsx scripts/bind-analysis-continuity.ts reviewed .candidate/snapshot.json";
    const replace = "cp .candidate/snapshot.json public/data/snapshot.json";
    expect(collect.indexOf(collectionCommand)).toBeGreaterThan(collect.indexOf("Refresh main and repeat candidate validation"));
    expect(collect.indexOf(collectionCommand)).toBeLessThan(collect.indexOf(replace));
    expect(publication.indexOf(publicationCommand)).toBeGreaterThan(publication.indexOf("npx tsx scripts/validate-semantic-review.ts"));
    expect(publication.indexOf(publicationCommand)).toBeLessThan(publication.indexOf(replace));
    for (const workflow of [collect, publication]) {
      expect(workflow).toContain("npx tsx scripts/privacy-scan.ts public/data");
      expect(workflow).toContain("git add public/data/last-analysis.json");
      expect(workflow).toContain("git diff --cached --quiet -- public/data/snapshot.json public/data/last-analysis.json public/data/analysis-continuity.json");
      expect(workflow).toContain("git add public/data/snapshot.json public/data/analysis-continuity.json");
    }
    const author = readFileSync(".github/workflows/ai-insights.md", "utf8");
    expect(author).not.toContain("retain-last-analysis.ts");
    expect(author).not.toContain("bind-analysis-continuity.ts");
  });

  it("validates any shipped archive in CI, including schema, evidence and structured privacy", () => {
    if (existsSync(LAST_ANALYSIS_PATH)) {
      expect(validateRetainedAnalysis(readFileSync(LAST_ANALYSIS_PATH, "utf8")).aiInsights.length).toBeGreaterThan(0);
    }
  });

  it("can seed from the deployed pre-collection snapshot under the current schema without rewriting it", async () => {
    const deployedPath = "public/data/snapshot.json";
    const bytes = readFileSync(deployedPath, "utf8");
    const deployed = validateRetainedAnalysis(bytes);
    mkdirSync(".candidate", { recursive: true });
    const directory = mkdtempSync(join(".candidate", "retention-deployed-test-"));
    const archivePath = join(directory, "public", "data", "last-analysis.json");
    try {
      expect(await retainLastAnalysis(deployedPath, archivePath)).toBe(deployed.aiInsights.length > 0);
      if (deployed.aiInsights.length > 0) {
        expect(readFileSync(archivePath, "utf8")).toBe(bytes);
      } else {
        expect(existsSync(archivePath)).toBe(false);
      }
      expect(readFileSync(deployedPath, "utf8")).toBe(bytes);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("persists exact bytes in one separate file and fails without overwriting invalid archives", async () => {
    mkdirSync(".candidate", { recursive: true });
    const directory = mkdtempSync(join(".candidate", "retention-test-"));
    const currentPath = join(directory, "snapshot.json");
    const archivePath = join(directory, "last-analysis.json");
    const bytes = JSON.stringify(published(), null, 2) + "\n";
    try {
      expect(await retainLastAnalysis(currentPath, archivePath)).toBe(false);
      expect(existsSync(archivePath)).toBe(false);
      writeFileSync(currentPath, bytes);
      expect(await retainLastAnalysis(currentPath, archivePath)).toBe(true);
      expect(readFileSync(archivePath, "utf8")).toBe(bytes);
      const collected = published("2026-09-10T21:00:00.000Z");
      collected.aiInsights = [];
      writeFileSync(currentPath, JSON.stringify(collected));
      expect(await retainLastAnalysis(currentPath, archivePath)).toBe(false);
      expect(readFileSync(archivePath, "utf8")).toBe(bytes);
      await expect(retainLastAnalysis(currentPath, currentPath)).rejects.toThrow("separate files");
      writeFileSync(archivePath, "{");
      await expect(retainLastAnalysis(currentPath, archivePath)).rejects.toThrow();
      expect(readFileSync(archivePath, "utf8")).toBe("{");
      expect(JSON.parse(readFileSync(currentPath, "utf8")).aiInsights).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
