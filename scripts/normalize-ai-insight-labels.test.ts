import { describe, expect, it } from "vitest";
import { normalizeAiInsightEvidenceLabels } from "./normalize-ai-insight-labels";

function snapshotWithLabel(label: string) {
  return {
    aiInsights: [
      {
        title: "テスト",
        numericEvidence: [
          {
            label,
            value: "7",
            source: "network.inventory.total"
          }
        ]
      }
    ]
  };
}

describe("AI insight evidence label normalization", () => {
  it("replaces English-only evidence labels without changing the value or source", () => {
    const snapshot = snapshotWithLabel("Network resources");

    expect(normalizeAiInsightEvidenceLabels(snapshot)).toBe(1);
    expect(snapshot.aiInsights[0]!.numericEvidence[0]).toEqual({
      label: "公開スナップショットの指標",
      value: "7",
      source: "network.inventory.total"
    });
  });

  it("preserves labels that already contain Japanese kana", () => {
    const snapshot = snapshotWithLabel("Network Watcher リソース数");

    expect(normalizeAiInsightEvidenceLabels(snapshot)).toBe(0);
    expect(snapshot.aiInsights[0]!.numericEvidence[0]!.label).toBe(
      "Network Watcher リソース数"
    );
  });

  it("rejects malformed AI insight evidence before publication", () => {
    expect(() => normalizeAiInsightEvidenceLabels({ aiInsights: [{}] })).toThrow(
      "numericEvidence array"
    );
  });
});
