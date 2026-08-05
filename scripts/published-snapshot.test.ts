import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEMO_OUTPUT_PATH,
  PUBLISHED_SNAPSHOT_PATH,
  buildDemoSnapshot,
  resolveDemoOutputPath
} from "./build-demo-snapshot";
import { isPreLocalisationSnapshot } from "./published-language-exemption";
import { findUiLanguageLeaks, validateUiLanguage } from "./ui-language-audit";
import { publicSnapshotSchema } from "./public-schema";

/**
 * `public/data/snapshot.json` is what GitHub Pages serves as the site's real data, and nothing else
 * stops synthetic data from reaching it: a DEMO snapshot satisfies every validator, and the Pages
 * job only checks that the file exists before `vite build` copies `public/` into `dist/`. So a
 * forgotten `--preview` run would have published the demo fixture as production until the next
 * scheduled collection overwrote it, with CI green the whole way.
 *
 * The assertion is on `mode`, which the collector writes as a literal, so a successful collection
 * never changes it. Pinning published values instead would fail on every real collection, which is
 * the failure mode PR #21 had to remove.
 */
describe("published snapshot", () => {
  it("is collected from Azure rather than generated from the demo fixture", () => {
    const published = JSON.parse(readFileSync(PUBLISHED_SNAPSHOT_PATH, "utf8")) as {
      mode?: unknown;
    };

    expect(published.mode).toBe("AZURE");
  });

  it("is not where a DEMO run writes by default", () => {
    expect(resolveDemoOutputPath({})).toBe(DEMO_OUTPUT_PATH);
    expect(resolveDemoOutputPath({})).not.toBe(PUBLISHED_SNAPSHOT_PATH);
  });

  it("is reachable only when the caller asks for it by name", () => {
    expect(resolveDemoOutputPath({}, ["--preview"])).toBe(PUBLISHED_SNAPSHOT_PATH);
    expect(resolveDemoOutputPath({ OUTPUT_PATH: "/tmp/demo.json" })).toBe("/tmp/demo.json");
    // An explicit destination stays explicit even next to the flag, so a script cannot acquire the
    // published path by accident.
    expect(resolveDemoOutputPath({ OUTPUT_PATH: "/tmp/demo.json" }, ["--preview"])).toBe(
      "/tmp/demo.json"
    );
  });

  it("keeps the default destination out of version control", () => {
    const ignored = readFileSync(".gitignore", "utf8")
      .split(/\r?\n/u)
      .map((line) => line.trim());

    expect(ignored).toContain(`${DEMO_OUTPUT_PATH.split("/")[0]}/`);
  });
});

/**
 * The published file still holds English the collector no longer writes, and this branch may not
 * edit it: the correction is the collector, and it lands when the next run publishes. So exactly one
 * artifact is exempt from the language audit. These assertions are about how the exemption behaves,
 * not about which file matches it today — asserting that the published file is exempt would fail the
 * moment a collection succeeded, which is the shape PR #21 removed.
 */
describe("pre-localisation language exemption", () => {
  const published = JSON.parse(readFileSync(PUBLISHED_SNAPSHOT_PATH, "utf8")) as Record<
    string,
    unknown
  >;

  it("does not exempt a snapshot whose content differs by even one field", () => {
    expect(
      isPreLocalisationSnapshot({ ...published, generatedAt: "2026-01-01T00:00:00.000Z" })
    ).toBe(false);
  });

  /**
   * A hand edit is the case the exemption must never shelter: correcting the published file in place
   * is what this branch was told not to do, so doing it has to cost the exemption rather than hide
   * behind it.
   */
  it("does not exempt a snapshot that has been edited by hand", () => {
    const resources = published.inventory as { resources: Array<Record<string, unknown>> };
    const [first, ...rest] = resources.resources;
    expect(first).toBeDefined();
    expect(
      isPreLocalisationSnapshot({
        ...published,
        inventory: {
          ...resources,
          resources: [{ ...first, change: "手で日本語に書き換えた値" }, ...rest]
        }
      })
    ).toBe(false);
  });

  it("does not exempt the demo fixture", () => {
    expect(isPreLocalisationSnapshot(buildDemoSnapshot("2026-08-05T13:00:00.000Z"))).toBe(false);
  });

  /**
   * The AI workflow rewrites `aiInsights` in place and validates with `--insights-only`. If those
   * fields counted towards the exemption, the first insights refresh would cancel it and fail that
   * workflow on collector fields it did not write. Insight prose keeps its own, stricter check.
   */
  it("survives an insights refresh so the AI workflow is not blocked by collector fields", () => {
    const refreshed = {
      ...published,
      aiInsights: [{ id: "insight-refreshed", title: "新しい分析結果" }]
    };

    expect(isPreLocalisationSnapshot(refreshed)).toBe(
      isPreLocalisationSnapshot(published)
    );
  });

  /**
   * Without this the whole block passes if `isPreLocalisationSnapshot` simply always returns false:
   * every other case here asserts `false`. Rather than pin the digest — which PR #21 showed breaks
   * on the next real collection — the exemption is tied to the reason it exists. While the published
   * file still holds collector English it must be exempt; once a collection replaces that text the
   * exemption must be gone, and this file's remaining assertions become the whole contract.
   */
  it("exempts the published file for exactly as long as it still holds pre-localisation text", () => {
    const parsed = publicSnapshotSchema.parse(published);
    const collectorLeaks = findUiLanguageLeaks(parsed).filter(
      (leak) => !leak.path.startsWith("aiInsights")
    );

    expect(isPreLocalisationSnapshot(published)).toBe(collectorLeaks.length > 0);
  });

  /**
   * The digest is taken with `aiInsights` removed, so an insight published tomorrow was never part
   * of what the exemption froze. Excusing the whole audit on a match would have excused it anyway,
   * which is why `validate-public-data.ts` narrows to that subtree instead of skipping.
   */
  it("still audits aiInsights on an exempt snapshot", () => {
    const parsed = publicSnapshotSchema.parse(published);
    const [insight, ...rest] = parsed.aiInsights;
    expect(insight).toBeDefined();
    const auditOnly = /^aiInsights\b/u;

    expect(() => validateUiLanguage(parsed, { auditOnly })).not.toThrow();
    expect(() =>
      validateUiLanguage(
        {
          ...parsed,
          aiInsights: [{ ...insight!, observation: "Compute spend increased again" }, ...rest]
        },
        { auditOnly }
      )
    ).toThrow(/aiInsights\[0\]\.observation/u);
  });

  /**
   * The exemption covers the language audit and nothing else, so an exempt file is still held to the
   * schema, the evidence rules and the Japanese-insight rule.
   */
  it("is narrow enough that only the language audit can be affected", () => {
    const source = readFileSync("scripts/validate-public-data.ts", "utf8");
    const guarded = source
      .split(/\r?\n/u)
      .filter((line) => line.includes("isPreLocalisationSnapshot"));

    expect(guarded).toHaveLength(2);
    expect(source).toMatch(/validateNumericEvidence\(parsed\);/u);
    expect(source).toMatch(/validateJapaneseInsights\(parsed\.aiInsights\);/u);
    expect(source).toMatch(/validatePublicJsonSchema\(candidate\);/u);
  });
});
