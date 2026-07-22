import { describe, expect, it } from "vitest";
import { describeCostDelta } from "./cost-delta";

describe("cost delta presentation", () => {
  it.each([
    [12.5, { label: "Increased", direction: "up" }],
    [-4.2, { label: "Decreased", direction: "down" }],
    [0, { label: "Unchanged", direction: "flat" }]
  ] as const)("describes %s without mislabeling zero", (deltaPercent, expected) => {
    expect(describeCostDelta(deltaPercent)).toEqual(expected);
  });
});
