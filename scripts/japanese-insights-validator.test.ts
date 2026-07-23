import { describe, expect, it } from "vitest";
import type { AiInsight } from "../src/data/contracts";
import { validateJapaneseInsights } from "./japanese-insights-validator";

function japaneseInsight(): AiInsight {
  return {
    id: "insight-1234abcd",
    severity: "info",
    title: "Network Watcher の収集範囲を確認",
    observation:
      "現在のスナップショットでは、Network Watcher の公開済み集計値を確認できます。",
    impact:
      "未収集のテレメトリがあるため、このデータだけで接続状態を判断することはできません。",
    numericEvidence: [
      {
        label: "Network Watcher リソース数",
        value: "7",
        source: "network.inventory.total"
      }
    ],
    recommendedAction:
      "Network Watcher の設定を非公開の管理画面で確認し、収集範囲を人が確認してください。",
    confidence: 0.8,
    period: "現在のスナップショット",
    route: "/network"
  };
}

describe("Japanese AI insight validation", () => {
  it("accepts Japanese prose containing allowlisted product and technical names", () => {
    expect(() => validateJapaneseInsights([japaneseInsight()])).not.toThrow();
  });

  it.each([
    ["title", (insight: AiInsight) => (insight.title = "Network telemetry is unavailable")],
    [
      "observation",
      (insight: AiInsight) =>
        (insight.observation = "The current snapshot contains seven network resources.")
    ],
    [
      "impact",
      (insight: AiInsight) =>
        (insight.impact = "Missing telemetry can prevent detection of connection issues.")
    ],
    [
      "recommendedAction",
      (insight: AiInsight) =>
        (insight.recommendedAction = "Review Network Watcher settings before the next collection.")
    ],
    ["period", (insight: AiInsight) => (insight.period = "Current snapshot")],
    [
      "numericEvidence.0.label",
      (insight: AiInsight) => (insight.numericEvidence[0]!.label = "Network Watcher resources")
    ]
  ])("rejects English-only %s", (field, mutate) => {
    const insight = japaneseInsight();
    mutate(insight);
    expect(() => validateJapaneseInsights([insight])).toThrow(new RegExp(field.replace(".", "\\.")));
  });

  it("rejects English prose disguised with a single Japanese particle", () => {
    const insight = japaneseInsight();
    insight.title = "Network telemetry は unavailable";

    expect(() => validateJapaneseInsights([insight])).toThrow(/title/);
  });
});
