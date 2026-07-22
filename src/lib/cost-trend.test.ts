import { describe, expect, it } from "vitest";
import { classifyCostTrend } from "./cost-trend";

describe("cost trend classification", () => {
  it.each([
    [null, "unavailable"],
    [12.5, "increased"],
    [-4, "decreased"],
    [0, "unchanged"]
  ] as const)("classifies %s as %s", (deltaPercent, expected) => {
    expect(classifyCostTrend(deltaPercent)).toBe(expected);
  });
});
