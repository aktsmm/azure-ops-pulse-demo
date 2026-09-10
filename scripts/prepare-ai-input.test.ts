import { describe, expect, it } from "vitest";
import { buildDemoSnapshot } from "./build-demo-snapshot";
import { prepareAiInput } from "./prepare-ai-input";

describe("unbiased AI input", () => {
  it("removes previous analysis without altering any observed data or the original", () => {
    const snapshot = buildDemoSnapshot();
    expect(snapshot.aiInsights.length).toBeGreaterThan(0);
    const before = structuredClone(snapshot);
    const prepared = prepareAiInput(snapshot);
    expect(prepared.aiInsights).toEqual([]);
    expect(prepared).toEqual({ ...snapshot, aiInsights: [] });
    expect(snapshot).toEqual(before);
  });

  it("accepts already empty input and rejects malformed input", () => {
    expect(prepareAiInput({ aiInsights: [], cost: { deltaPercent: 1 } }).aiInsights).toEqual([]);
    for (const candidate of [null, [], {}, { aiInsights: null }]) {
      expect(() => prepareAiInput(candidate)).toThrow("AI input must be");
    }
  });
});
