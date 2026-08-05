import { describe, expect, it } from "vitest";
import type { AiInsight } from "../src/data/contracts";
import {
  applyDeterministicInsightPeriods,
  snapshotInsightPeriod,
  validateInsightPeriods
} from "./insight-period";
import { validateJapaneseInsights } from "./japanese-insights-validator";
import { findUiLanguageLeaks } from "./ui-language-audit";
import { insightSchema } from "./public-schema";
import { buildDemoSnapshot } from "./build-demo-snapshot";

/**
 * Every expectation derives its subject from the implementation or from a locally built snapshot.
 * Nothing here is pinned to a value in `public/data/snapshot.json`, so a collection that changes the
 * published data cannot turn this suite red on its own.
 */
const COLLECTED_AT = "2026-08-05T18:56:06.000Z";

function insightWithPeriod(period: string): AiInsight {
  return {
    id: "insight-a3c1f2e4",
    severity: "warning",
    title: "コストの前期比増加を確認",
    observation: "公開スナップショットのコスト増減率が、前回の比較対象より大きくなっています。",
    impact: "この傾向が続くと、次回の比較でコストの増加幅がさらに広がるおそれがあります。",
    numericEvidence: [{ label: "コストの増減率", value: "76.7%", source: "cost.deltaPercent" }],
    recommendedAction: "コスト ページで増加の内訳を人が確認することを推奨します。",
    confidence: 0.85,
    period,
    route: "/cost"
  };
}

function snapshotWithPeriods(generatedAt: string, ...periods: string[]) {
  return { generatedAt, aiInsights: periods.map((period) => insightWithPeriod(period)) };
}

/**
 * The wordings the analysis actually produced, taken from published history and from the run that
 * failed. They are inputs the pipeline must absorb, not values it is expected to keep.
 */
const MODEL_AUTHORED_PERIODS = [
  "2026-08-05", // run 31037073625: the bare date that failed the Japanese audit
  "2026年8月5日 収集分", // its own retry: still no kana, so still a failure
  "Last 30 days",
  "Rolling 30 days",
  "Current vs prior comparable period",
  "現在のスナップショット（2026-08-03T01:38:41.345Z）",
  "現在の課金スナップショット（比較期間データなし）"
];

describe("deterministic AI insight period", () => {
  it("is decided by the collection time alone, not by the insight", () => {
    const morning = snapshotInsightPeriod("2026-08-05T00:00:00.000Z");
    const evening = snapshotInsightPeriod("2026-08-05T23:59:59.000Z");
    const nextDay = snapshotInsightPeriod("2026-08-06T00:00:00.000Z");

    expect(evening).toBe(morning);
    expect(nextDay).not.toBe(morning);
    expect(morning).toContain("2026-08-05");
    expect(nextDay).toContain("2026-08-06");
  });

  it("refuses to invent a period when the collection time is unreadable", () => {
    expect(() => snapshotInsightPeriod("not a timestamp")).toThrow(/unreadable collection time/);
  });

  it("produces a value the prose, schema and rendered-language gates all accept", () => {
    const insight = insightWithPeriod(snapshotInsightPeriod(COLLECTED_AT));

    expect(() => validateJapaneseInsights([insight])).not.toThrow();
    expect(insightSchema.parse(insight).period).toBe(insight.period);

    const snapshot = buildDemoSnapshot(COLLECTED_AT);
    expect(
      findUiLanguageLeaks({ ...snapshot, aiInsights: [insight] }).map((leak) => leak.path)
    ).toEqual([]);
  });
});

describe("normalizing the period out of the analysis output", () => {
  it.each(MODEL_AUTHORED_PERIODS)("replaces the model-authored period %j", (authored) => {
    const snapshot = snapshotWithPeriods(COLLECTED_AT, authored);

    expect(applyDeterministicInsightPeriods(snapshot)).toBe(1);
    expect(snapshot.aiInsights[0]!.period).toBe(snapshotInsightPeriod(COLLECTED_AT));
  });

  it("fills in a period the analysis left out entirely", () => {
    const withoutPeriod: Partial<AiInsight> = insightWithPeriod("unused");
    delete withoutPeriod.period;
    const snapshot = { generatedAt: COLLECTED_AT, aiInsights: [withoutPeriod] };

    expect(applyDeterministicInsightPeriods(snapshot)).toBe(1);
    expect(snapshot.aiInsights[0]).toMatchObject({ period: snapshotInsightPeriod(COLLECTED_AT) });
  });

  it("leaves the rest of the insight untouched", () => {
    const snapshot = snapshotWithPeriods(COLLECTED_AT, "Last 30 days");
    const before = insightWithPeriod("Last 30 days");

    applyDeterministicInsightPeriods(snapshot);

    expect({ ...snapshot.aiInsights[0], period: before.period }).toEqual(before);
  });

  it("is idempotent, so the trusted pass agrees with the pass the analysis ran", () => {
    const snapshot = snapshotWithPeriods(COLLECTED_AT, "2026-08-05");

    expect(applyDeterministicInsightPeriods(snapshot)).toBe(1);
    expect(applyDeterministicInsightPeriods(snapshot)).toBe(0);
  });

  it("rejects an output it cannot derive a period for instead of guessing one", () => {
    expect(() => applyDeterministicInsightPeriods({ aiInsights: [] })).toThrow(
      /collection time that determines the insight period/
    );
    expect(() => applyDeterministicInsightPeriods({ generatedAt: COLLECTED_AT })).toThrow(
      /aiInsights array/
    );
    expect(() =>
      applyDeterministicInsightPeriods({ generatedAt: COLLECTED_AT, aiInsights: ["nope"] })
    ).toThrow(/aiInsights\.0 must be an insight object/);
  });
});

describe("rejecting a candidate whose period did not come from the snapshot", () => {
  it.each(MODEL_AUTHORED_PERIODS)("fails publication on the model-authored period %j", (authored) => {
    expect(() => validateInsightPeriods(snapshotWithPeriods(COLLECTED_AT, authored))).toThrow(
      /field period is/
    );
  });

  it("names the insight and the value it must carry", () => {
    expect(() => validateInsightPeriods(snapshotWithPeriods(COLLECTED_AT, "2026-08-05"))).toThrow(
      new RegExp(`insight-a3c1f2e4.*${snapshotInsightPeriod(COLLECTED_AT)}`, "su")
    );
  });

  it("fails a period that is right for a different collection", () => {
    const stale = snapshotInsightPeriod("2026-08-04T18:56:06.000Z");

    expect(() => validateInsightPeriods(snapshotWithPeriods(COLLECTED_AT, stale))).toThrow(
      /field period is/
    );
  });

  it("accepts the normalized output at any collection time", () => {
    for (const generatedAt of [COLLECTED_AT, "2026-01-01T00:00:00.000Z", new Date().toISOString()]) {
      const snapshot = snapshotWithPeriods(generatedAt, "Last 30 days", "2026-08-05", "現在");
      applyDeterministicInsightPeriods(snapshot);

      expect(() => validateInsightPeriods(snapshot)).not.toThrow();
    }
  });

  it("passes for a snapshot that published no insights at all", () => {
    expect(() => validateInsightPeriods({ generatedAt: COLLECTED_AT, aiInsights: [] })).not.toThrow();
  });
});

describe("the DEMO snapshot uses the same derivation as the published one", () => {
  it("labels every demo insight with the derived period", () => {
    for (const generatedAt of ["2026-08-05T13:00:00.000Z", "2027-02-28T03:04:05.000Z"]) {
      const snapshot = buildDemoSnapshot(generatedAt);

      expect(snapshot.aiInsights.length).toBeGreaterThan(0);
      expect(new Set(snapshot.aiInsights.map((insight) => insight.period))).toEqual(
        new Set([snapshotInsightPeriod(generatedAt)])
      );
      expect(() => validateInsightPeriods(snapshot)).not.toThrow();
    }
  });
});
