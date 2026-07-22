import { describe, expect, it } from "vitest";
import { createDemoRawSnapshot } from "./demo-data";
import { sanitizeSnapshot } from "../src/lib/sanitize";
import { normalizedNumericTokens, validateNumericEvidence } from "./public-data-validation";

describe("numeric evidence validation", () => {
  it("normalizes signs, grouping separators, and insignificant zeroes", () => {
    expect(normalizedNumericTokens("+1,024.00 and -0.50")).toEqual(["1024", "-0.5"]);
  });

  it("rejects an invented extra number even when another number matches", () => {
    const snapshot = sanitizeSnapshot(createDemoRawSnapshot());
    snapshot.aiInsights[0]!.numericEvidence[2] = {
      label: "Unsupported compound claim",
      value: "87% and 42 exposed assets",
      source: "cost.budgetUsedPercent"
    };

    expect(() => validateNumericEvidence(snapshot)).toThrow(/87% and 42 exposed assets/);
  });

  it("accepts evidence when every normalized number is present in the source scalar", () => {
    const snapshot = sanitizeSnapshot(createDemoRawSnapshot());
    expect(() => validateNumericEvidence(snapshot)).not.toThrow();
  });
});
