import { describe, expect, it } from "vitest";
import { buildDemoSnapshot } from "./build-demo-snapshot";
import { createDemoRawSnapshot } from "./demo-data";
import { validateNumericEvidence } from "./evidence-validator";
import { validateJapaneseInsights } from "./japanese-insights-validator";
import { validatePublicJsonSchema } from "./json-schema-validator";
import { publicSnapshotSchema } from "./public-schema";
import { findUiLanguageLeaks } from "./ui-language-audit";
import { withDefenderUnavailable } from "../src/test/reliability-fixtures";

/**
 * `public/data/snapshot.json` is published from the AZURE collector, so CI never used to look at the
 * DEMO artifact. That let the DEMO fixture drift out of the Japanese-prose contract until
 * `npm run generate:demo && npm run validate:data` failed, which nobody ran. These tests put the
 * generated DEMO snapshot through the same validators the published file has to pass.
 *
 * The assertions describe properties, never literal fixture values: a test pinned to today's demo
 * strings would fail on every fixture edit without saying anything about the contract.
 */
describe("DEMO snapshot generation", () => {
  const snapshot = buildDemoSnapshot("2026-08-05T13:00:00.000Z");

  it("satisfies the published JSON Schema", () => {
    expect(() => validatePublicJsonSchema(snapshot)).not.toThrow();
  });

  it("satisfies the runtime schema", () => {
    expect(() => publicSnapshotSchema.parse(snapshot)).not.toThrow();
  });

  it("cites numeric evidence that resolves to the values it claims", () => {
    expect(() => validateNumericEvidence(publicSnapshotSchema.parse(snapshot))).not.toThrow();
  });

  it("publishes AI insights as Japanese prose", () => {
    expect(() => validateJapaneseInsights(snapshot.aiInsights)).not.toThrow();
  });

  it("renders no English prose anywhere the dashboard shows it", () => {
    expect(findUiLanguageLeaks(snapshot).map((leak) => `${leak.path}: ${leak.rendered}`)).toEqual(
      []
    );
  });

  it("publishes activity timestamps the timeline can order", () => {
    const timestamps = snapshot.overview.eventTimeline.map((event) => Date.parse(event.timestamp));
    const generatedAt = Date.parse(snapshot.generatedAt);

    expect(timestamps.every((value) => Number.isFinite(value))).toBe(true);
    // A frozen relative label such as "18 min ago" survives any ordering assertion while drifting
    // further from the truth on every run, so the fixture has to publish real instants.
    expect(timestamps.every((value) => value <= generatedAt)).toBe(true);
    expect([...timestamps].sort((a, b) => b - a)).toEqual(timestamps);
  });

  it("keeps reliability coverage consistent with the published inventory", () => {
    const { coverage } = snapshot.reliability;
    expect(coverage.totalResources).toBe(snapshot.inventory.total);
    expect(coverage.supportedResources + coverage.notApplicableResources).toBe(
      coverage.totalResources
    );
    expect(coverage.evaluatedResources + coverage.unevaluatedResources).toBe(
      coverage.supportedResources
    );
  });

  /**
   * `freshness` is measured against the wall clock by the sanitizer, so it is the one field a fixed
   * generation time cannot pin. Comparing whole snapshots would therefore have passed for the wrong
   * reason — two builds in the same minute agree — and only failed when a run straddled a minute
   * boundary. Excluding it makes the remaining equality a real determinism assertion.
   */
  it("is deterministic for a fixed generation time, apart from wall-clock freshness", () => {
    const stable = { ...snapshot, freshness: null };
    const rebuilt = { ...buildDemoSnapshot("2026-08-05T13:00:00.000Z"), freshness: null };

    expect(rebuilt).toEqual(stable);
    expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(stable));
  });

  /**
   * DEMO used to word this aggregate its own way. The "unavailable Defender must not expose
   * aggregates" rule recognises a Defender-derived metric only by its label, so a private wording
   * made DEMO invisible to the rule that AZURE is held to. Stripping Defender from the generated
   * snapshot has to leave something the schema accepts, and has to actually remove a metric — if the
   * label drifts again the strip finds nothing and the schema rejects what survives.
   */
  it("labels its Defender aggregate with the shared contract the strip recognises", () => {
    const parsed = publicSnapshotSchema.parse(snapshot);
    const stripped = withDefenderUnavailable(parsed);

    expect(stripped.overview.metrics.length).toBeLessThan(parsed.overview.metrics.length);
    expect(() => publicSnapshotSchema.parse(stripped)).not.toThrow();
  });

  /**
   * Callers edit the raw snapshot in place to describe a scenario ("nothing is evaluated"), so the
   * builder cannot hand out the module-level fixtures it also derives the overview from: the first
   * caller's edit would otherwise change what every later caller receives, and the derived headline
   * numbers along with it.
   */
  it("returns a raw snapshot no earlier caller can have edited", () => {
    const first = createDemoRawSnapshot();
    const pristineStatuses = first.resources.map((resource) => resource.status);
    for (const resource of first.resources) {
      resource.status = "Unknown";
    }
    first.costCategories.splice(0, first.costCategories.length);
    first.security.recommendations.splice(0, first.security.recommendations.length);

    const second = createDemoRawSnapshot();

    expect(second.resources.map((resource) => resource.status)).toEqual(pristineStatuses);
    expect(second.costCategories.length).toBeGreaterThan(0);
    expect(second.security.recommendations.length).toBeGreaterThan(0);
    // The overview is derived from the same fixtures, so a shared array also corrupts the headline.
    expect(Number.isFinite(second.postureScore)).toBe(true);
  });
});
