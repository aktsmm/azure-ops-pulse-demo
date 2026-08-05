import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEFENDER_AGGREGATE_METRIC_LABELS,
  findUiLanguageLeaks,
  validateUiLanguage
} from "./ui-language-audit";
import { formatActivityTitle, formatEndpointLabel, formatSourceMessage } from "../src/lib/display-formatters";
import { buildDemoSnapshot } from "./build-demo-snapshot";
import { createDemoRawSnapshot } from "./demo-data";
import { sanitizeSnapshot } from "../src/lib/sanitize";
import { withheldRecommendationTitle } from "../src/lib/defender-recommendations";
import type { PublicSnapshotV1 } from "../src/data/contracts";

const demo = () => buildDemoSnapshot("2026-08-05T13:00:00.000Z");

function withFirstResourceChange(change: string): PublicSnapshotV1 {
  const snapshot = demo();
  const [first, ...rest] = snapshot.inventory.resources;
  if (!first) throw new Error("demo fixture must publish at least one resource");
  return {
    ...snapshot,
    inventory: { ...snapshot.inventory, resources: [{ ...first, change }, ...rest] }
  };
}

function withFirstMetricChange(change: string): PublicSnapshotV1 {
  const snapshot = demo();
  const [first, ...rest] = snapshot.overview.metrics;
  if (!first) throw new Error("demo fixture must publish at least one metric");
  return {
    ...snapshot,
    overview: { ...snapshot.overview, metrics: [{ ...first, change }, ...rest] }
  };
}

describe("UI language audit", () => {
  it("accepts a snapshot whose rendered prose is Japanese", () => {
    expect(findUiLanguageLeaks(demo())).toEqual([]);
  });

  it("reports English prose that the dashboard renders verbatim", () => {
    const leaks = findUiLanguageLeaks(
      withFirstResourceChange("Collected from Azure Resource Graph")
    );
    expect(leaks).toHaveLength(1);
    expect(leaks[0]?.path).toBe("inventory.resources[0].change");
  });

  /**
   * A prefix-anchored allowlist entry for the product name "Resource Health" previously swallowed
   * whole English sentences that merely started with it, which is how the resource drawer kept
   * showing English while the audit reported a clean run.
   */
  it("does not treat an English sentence as a product name because of its first words", () => {
    expect(
      findUiLanguageLeaks(
        withFirstResourceChange("Resource Health has not reported a recent availability state")
      )
    ).toHaveLength(1);
  });

  /**
   * Requiring the field to contain no Japanese at all would let a single Japanese word disguise an
   * otherwise untranslated sentence.
   */
  it("still reports English phrases that are prefixed with a Japanese word", () => {
    const leaks = findUiLanguageLeaks(
      withFirstResourceChange("注意: Collected from Azure Resource Graph")
    );
    expect(leaks).toHaveLength(1);
    expect(leaks[0]?.residue).toContain("Collected from");
  });

  /**
   * The Defender aggregate labels are the audit's only whole-field English exemption on a reader
   * facing label, and the justification is that the sanitizer recognises them by exact string: a
   * translated label would leave the strip searching for text nobody writes, so an unavailable
   * Defender source would start publishing aggregates again with nothing to say so. That reasoning
   * is only sound while the sanitizer really does strip them, so the exemption is derived from
   * `sanitizeSnapshot` here rather than trusted from a comment. A label that leaves the strip
   * contract fails this test instead of quietly keeping a licence to be English.
   */
  it("exempts only the metric labels the sanitizer strips when Defender is unavailable", () => {
    const control = {
      label: "収集した独自の指標",
      value: "3",
      change: "前回から +1",
      direction: "up" as const,
      severity: "warning" as const,
      points: [1, 2, 3]
    };
    const raw = createDemoRawSnapshot("2026-08-05T13:00:00.000Z");
    const published = sanitizeSnapshot({
      ...raw,
      sources: raw.sources.map((source) =>
        source.source === "Defender for Cloud"
          ? { ...source, availability: "unavailable" as const }
          : source
      ),
      metrics: [
        ...raw.metrics,
        control,
        ...DEFENDER_AGGREGATE_METRIC_LABELS.map((label) => ({ ...control, label }))
      ]
    });

    const survived = published.overview.metrics.map((metric) => metric.label);
    // Asserting what remains as well as what went keeps this from passing because the unavailable
    // source stripped every metric: the exemption has to name exactly the labels the sanitizer
    // removes, no more.
    expect(survived).toContain(control.label);
    for (const label of DEFENDER_AGGREGATE_METRIC_LABELS) {
      expect(survived).not.toContain(label);
    }
    expect(
      raw.metrics
        .map((metric) => metric.label)
        .filter(
          (label) =>
            !DEFENDER_AGGREGATE_METRIC_LABELS.includes(label) && !survived.includes(label)
        )
    ).toEqual([]);
  });

  /**
   * The exemption is scoped to the labels themselves. An English sentence parked on the same field
   * is still prose a reader has to understand, and used to pass while the allowance was written as a
   * shape rather than a list.
   */
  it("does not extend the Defender label exemption to other English metric labels", () => {
    const snapshot = demo();
    const [first, ...rest] = snapshot.overview.metrics;
    if (!first) throw new Error("demo fixture must publish at least one metric");
    const leaks = findUiLanguageLeaks({
      ...snapshot,
      overview: {
        ...snapshot.overview,
        metrics: [{ ...first, label: "Open recommendations from Defender" }, ...rest]
      }
    });
    expect(leaks).toHaveLength(1);
    expect(leaks[0]?.path).toBe("overview.metrics[0].label");
  });

  /**
   * A cost category name is allowed everywhere the snapshot writes prose, so a category worded as a
   * sentence used to certify that sentence on any other field. Both halves are checked here: the
   * category no longer lends its words out, and it is reported on its own path as well.
   */
  it("does not let a cost category worded as a sentence certify the same words elsewhere", () => {
    const snapshot = demo();
    const [firstCategory, ...restCategories] = snapshot.cost.categories;
    const [firstResource, ...restResources] = snapshot.inventory.resources;
    if (!firstCategory) throw new Error("demo fixture must publish at least one cost category");
    if (!firstResource) throw new Error("demo fixture must publish at least one resource");
    const sentence = "No material change";

    const paths = findUiLanguageLeaks({
      ...snapshot,
      cost: {
        ...snapshot.cost,
        categories: [{ ...firstCategory, name: sentence }, ...restCategories]
      },
      inventory: {
        ...snapshot.inventory,
        resources: [{ ...firstResource, change: sentence }, ...restResources]
      }
    }).map((leak) => leak.path);

    expect(paths).toContain("inventory.resources[0].change");
    expect(paths).toContain("cost.categories[0].name");
  });

  /**
   * The names Cost Management actually returns have to keep passing, or the audit reports every
   * real category and is switched off. The trailing " credit" is not restated from memory: the
   * sanitizer is asked to publish a negative category and the audit judges whatever it wrote.
   */
  it("accepts the category names Cost Management and the sanitizer produce", () => {
    const raw = createDemoRawSnapshot("2026-08-05T13:00:00.000Z");
    const [firstRawCategory] = raw.costCategories;
    if (!firstRawCategory) throw new Error("demo fixture must publish at least one cost category");
    const published = sanitizeSnapshot({
      ...raw,
      costCategories: [
        { name: "Virtual Machines", amountJpy: 120_000, deltaPercent: null },
        { name: "Azure Database for PostgreSQL", amountJpy: 90_000, deltaPercent: null },
        { name: "Other", amountJpy: 40_000, deltaPercent: null },
        { name: firstRawCategory.name, amountJpy: -50_000, deltaPercent: null }
      ]
    });

    const names = published.cost.categories.map((category) => category.name);
    expect(names.some((name) => name.endsWith(" credit"))).toBe(true);
    expect(
      findUiLanguageLeaks(published)
        .map((leak) => leak.path)
        .filter((path) => path.startsWith("cost.categories"))
    ).toEqual([]);
  });


  it("reports English data even when a formatter renders it as Japanese", () => {
    const snapshot = demo();
    const [first, ...rest] = snapshot.overview.eventTimeline;
    if (!first) throw new Error("demo fixture must publish an event");
    const stored = "[object Object] Collection completed successfully";
    expect(formatActivityTitle(stored)).not.toContain("Collection completed");

    const leaks = findUiLanguageLeaks({
      ...snapshot,
      overview: {
        ...snapshot.overview,
        eventTimeline: [{ ...first, title: stored }, ...rest]
      }
    });

    expect(leaks).toHaveLength(1);
    expect(leaks[0]?.path).toBe("overview.eventTimeline[0].title");
    expect(leaks[0]?.origin).toBe("stored");
  });

  /**
   * Timestamps carried collector labels such as "Current snapshot" that only looked Japanese because
   * the formatter translated them. The formatter no longer does, and this keeps the stored label
   * itself in scope so reintroducing that table cannot make the audit quiet again.
   */
  it("reports an English collection label stored as an event timestamp", () => {
    const snapshot = demo();
    const [first, ...rest] = snapshot.overview.eventTimeline;
    if (!first) throw new Error("demo fixture must publish an event");

    const leaks = findUiLanguageLeaks({
      ...snapshot,
      overview: {
        ...snapshot.overview,
        eventTimeline: [{ ...first, timestamp: "Current collection window" }, ...rest]
      }
    });

    expect(leaks.map((leak) => leak.path)).toContain("overview.eventTimeline[0].timestamp");
  });

  /**
   * Source keys are the join keys the AI evidence validator matches on, so they stay English in the
   * file and are declared as mapped identifiers. The exemption is only as good as the mapping: a key
   * `formatSourceName` does not know still has to be reported rather than reaching the page.
   */
  it("exempts mapped source keys but not an unmapped English one", () => {
    const snapshot = demo();
    const [first, ...rest] = snapshot.sources;
    if (!first) throw new Error("demo fixture must publish a source");
    expect(findUiLanguageLeaks(snapshot)).toHaveLength(0);

    const leaks = findUiLanguageLeaks({
      ...snapshot,
      sources: [{ ...first, source: "Some unmapped collector" }, ...rest]
    });

    expect(leaks.map((leak) => leak.path)).toContain("sources[0].source");
  });

  /**
   * Forgiving a *single* English word inside Japanese text was the audit's blind spot: a
   * half-translated status line is exactly the mixed copy this check exists to find. Identifiers
   * the snapshot publishes about itself stay allowed, so the rule stays strict without flagging
   * region ids, resource types or the dashboard's own routes.
   */
  it("reports a single English word mixed into Japanese prose", () => {
    for (const value of [
      "状態: Unavailable",
      "状態: Failed",
      "状態: Microsoft failed",
      "成功/failed checks"
    ]) {
      expect(findUiLanguageLeaks(withFirstResourceChange(value))).toHaveLength(1);
    }
  });

  it("allows identifiers the same snapshot publishes elsewhere", () => {
    const snapshot = demo();
    const [firstResource, ...restResources] = snapshot.inventory.resources;
    if (!firstResource) throw new Error("demo fixture must publish at least one resource");
    const declaring: PublicSnapshotV1 = {
      ...snapshot,
      inventory: {
        ...snapshot.inventory,
        byType: [...snapshot.inventory.byType, { label: "microsoft.logic/workflows", count: 1 }],
        byRegion: [...snapshot.inventory.byRegion, { label: "japaneast", count: 1 }],
        resources: [
          { ...firstResource, change: "microsoft.logic/workflows を japaneast に配置" },
          ...restResources
        ]
      }
    };

    expect(findUiLanguageLeaks(declaring)).toEqual([]);
    expect(findUiLanguageLeaks(withFirstResourceChange("Compute の構成を更新"))).toEqual([]);
    expect(findUiLanguageLeaks(withFirstResourceChange("/reliability で確認"))).toEqual([]);
  });

  /**
   * The allowance is derived from the snapshot, not from a shape. A term this snapshot never
   * declares is untranslated copy even when another snapshot would publish it as an identifier —
   * a generic "strip anything after a slash" rule also swallowed ordinary prose.
   */
  it("does not allow an identifier the snapshot never publishes", () => {
    const snapshot = demo();
    const [first, ...rest] = snapshot.inventory.resources;
    if (!first) throw new Error("demo fixture must publish at least one resource");
    const mutated: PublicSnapshotV1 = {
      ...snapshot,
      cost: { ...snapshot.cost, categories: [] },
      inventory: {
        ...snapshot.inventory,
        resources: [{ ...first, change: "Compute の構成を更新" }, ...rest]
      }
    };

    expect(findUiLanguageLeaks(mutated).map((leak) => leak.path)).toContain(
      "inventory.resources[0].change"
    );
    expect(findUiLanguageLeaks(withFirstResourceChange("microsoft.logic/workflows を配置"))).not.toEqual(
      []
    );
  });

  it("allows product names that make up the whole value", () => {
    expect(findUiLanguageLeaks(withFirstResourceChange("Azure Resource Graph"))).toEqual([]);
    expect(findUiLanguageLeaks(withFirstResourceChange("Azure Resource Graph から収集"))).toEqual(
      []
    );
  });

  /**
   * The allowances are per field. A shared list previously accepted an English `change` value
   * because some unrelated field was allowed to carry that enumeration member or unit.
   */
  it("does not let one field borrow another field's allowance", () => {
    expect(findUiLanguageLeaks(withFirstResourceChange("ServiceIssue"))).toHaveLength(1);
    expect(findUiLanguageLeaks(withFirstResourceChange("168 ms"))).toHaveLength(1);
    expect(findUiLanguageLeaks(withFirstMetricChange("168 ms"))).toEqual([]);
  });

  /**
   * The collector writes the compliance framework label itself, so it is reader-facing copy. It is
   * empty today because Defender is unavailable, which is exactly why it needs a guard now.
   */
  it("audits the compliance framework label while allowing standard identifiers", () => {
    const snapshot = demo();
    const withFramework = (framework: string): PublicSnapshotV1 => ({
      ...snapshot,
      security: { ...snapshot.security, compliance: [{ framework, score: 80 }] }
    });

    for (const framework of ["ISO 27001", "PCI DSS", "NIST SP 800-53 R5", "CIS 1.4.0"]) {
      expect(findUiLanguageLeaks(withFramework(framework))).toEqual([]);
    }
    expect(findUiLanguageLeaks(withFramework("規制コンプライアンスの集計"))).toEqual([]);

    // Uppercasing English prose used to satisfy a "standard-looking" shape check.
    expect(findUiLanguageLeaks(withFramework("Regulatory compliance aggregate"))).toHaveLength(1);
    expect(findUiLanguageLeaks(withFramework("REGULATORY COMPLIANCE AGGREGATE"))).toHaveLength(1);
    expect(findUiLanguageLeaks(withFramework("ISO is not configured"))).toHaveLength(1);
  });

  it("audits the flow destination as the network page renders it", () => {
    const snapshot = demo();
    const [first, ...rest] = snapshot.network.telemetry.flows;
    if (!first) throw new Error("demo fixture must publish at least one flow");
    const withDestination = (destination: string): PublicSnapshotV1 => ({
      ...snapshot,
      network: {
        ...snapshot.network,
        telemetry: {
          ...snapshot.network.telemetry,
          flows: [{ ...first, destination }, ...rest]
        }
      }
    });

    // The sanitizer's own labels are English in storage and Japanese on screen.
    for (const label of [
      "Azure Storage endpoint",
      "Azure Front Door endpoint",
      "Azure SQL endpoint",
      "Microsoft service endpoint",
      "External service endpoint",
      "Unclassified service endpoint"
    ]) {
      expect(findUiLanguageLeaks(withDestination(label))).toEqual([]);
      expect(formatEndpointLabel(label)).not.toBe(label);
    }

    // A label the formatter does not know reaches the page verbatim, so it is reported rather than
    // silently rendered in English.
    const leaks = findUiLanguageLeaks(withDestination("Storage account endpoint"));
    expect(leaks).toHaveLength(1);
    expect(leaks[0]?.path).toBe("network.telemetry.flows[0].destination");
  });

  it("throws with the offending path so a failing pipeline names the field", () => {
    expect(() => validateUiLanguage(withFirstResourceChange("No material change"))).toThrow(
      /inventory\.resources\[0\]\.change/u
    );
  });

  it("passes a snapshot that only contains Japanese prose", () => {
    expect(() => validateUiLanguage(withFirstResourceChange("特筆すべき変更なし"))).not.toThrow();
  });

  /**
   * Identifiers used to be removed as bare substrings, so an English word that merely started with
   * one was cut down below the reporting length: "Compute" reduced "Computed" to "d" and the field
   * read as clean. Removal is now anchored to word boundaries.
   */
  it("does not shrink an English word that starts with a published identifier", () => {
    const leaks = findUiLanguageLeaks(withFirstResourceChange("Computed"));

    expect(leaks).toHaveLength(1);
    expect(leaks[0]?.residue).toBe("Computed");
  });

  it("still removes a published identifier that stands as a whole word", () => {
    expect(findUiLanguageLeaks(withFirstResourceChange("Compute の構成を更新"))).toEqual([]);
  });

  /**
   * The evidence value is printed next to its Japanese label, so it is reader-facing prose whenever
   * it is not simply a measurement.
   */
  it("reports an evidence value worded as an English sentence", () => {
    const snapshot = demo();
    const [first, ...rest] = snapshot.aiInsights;
    if (!first) throw new Error("demo fixture must publish at least one insight");
    const [evidence, ...restEvidence] = first.numericEvidence;
    if (!evidence) throw new Error("demo insight must cite at least one evidence row");
    const worded = {
      ...snapshot,
      aiInsights: [
        {
          ...first,
          numericEvidence: [{ ...evidence, value: "1 unavailable resources" }, ...restEvidence]
        },
        ...rest
      ]
    };

    const leaks = findUiLanguageLeaks(worded);
    expect(leaks.map((leak) => leak.path)).toContain("aiInsights[0].numericEvidence[0].value");
  });

  /**
   * DEMO exists to preview what AZURE publishes, so the audit has to judge both the same way. A rule
   * that fired in one mode only would make the preview diverge from the page it stands in for, which
   * is exactly how the mode-conditional Defender rule that used to live here was wrong.
   */
  it("judges a snapshot the same way in either mode", () => {
    const snapshot = withFirstResourceChange("Collected from Azure Resource Graph");

    expect(findUiLanguageLeaks({ ...snapshot, mode: "AZURE" })).toEqual(
      findUiLanguageLeaks({ ...snapshot, mode: "DEMO" })
    );
    expect(findUiLanguageLeaks({ ...snapshot, mode: "AZURE" })).toHaveLength(1);
  });

  /**
   * Assessment titles were exempt while an AZURE snapshot published the `displayName` Defender
   * returns and DEMO had to mirror it. `summarizeAssessments` now discards every Azure-authored
   * title and publishes `Defender の推奨事項（タイトル非公開） #N`, so no mode has a reason to carry
   * English here and both are held to the same rule. The withheld title has to pass, because the
   * audit would otherwise force the collector to choose between this rule and the privacy one.
   */
  it("audits Defender assessment titles in both modes", () => {
    const snapshot = demo();
    const [first, ...rest] = snapshot.security.recommendations;
    if (!first) throw new Error("demo fixture must publish at least one recommendation");
    const withTitle = (title: string): PublicSnapshotV1 => ({
      ...snapshot,
      security: { ...snapshot.security, recommendations: [{ ...first, title }, ...rest] }
    });

    expect(findUiLanguageLeaks(withTitle(withheldRecommendationTitle(1)))).toEqual([]);

    for (const mode of ["AZURE", "DEMO"] as const) {
      const leaks = findUiLanguageLeaks({
        ...withTitle("Apply system updates to protected resources"),
        mode
      });
      expect(leaks).toHaveLength(1);
      expect(leaks[0]?.path).toBe("security.recommendations[0].title");
    }
  });
});

/**
 * The audit skips the collector's `message` fields because the dashboard never shows them: source
 * copy is chosen from the closed (source, availability) pair. That exclusion is only sound while it
 * stays true, so these tests fail the moment the stored English becomes reader-facing.
 */
describe("non-rendered collection diagnostics", () => {
  const sentinel = "Resource Health evaluated 13 of 19 supported resources";

  it("renders source copy from the availability pair rather than the stored message", () => {
    const rendered = formatSourceMessage({
      source: "Resource Health",
      availability: "partial",
      message: sentinel
    });

    expect(rendered).not.toContain(sentinel);
    expect(rendered).toMatch(/[ぁ-ゟ゠-ヿ一-龯]/u);
  });

  it("falls back to Japanese copy for a source the dashboard does not know", () => {
    const rendered = formatSourceMessage({
      source: "Some future collector",
      availability: "unavailable",
      message: sentinel
    });

    expect(rendered).not.toContain(sentinel);
    expect(rendered).toMatch(/[ぁ-ゟ゠-ヿ一-龯]/u);
  });

  it("keeps the remaining diagnostic messages out of the rendered tree", () => {
    const app = readFileSync("src/App.tsx", "utf8");

    // A negative assertion on source cannot pass because of a commented-out line: commenting the
    // render out is exactly what would make the exclusion valid again.
    expect(app).not.toContain("serviceHealth.message");
    expect(app).not.toContain("telemetry.message");
    expect(app).not.toContain("source.message");
  });
});
