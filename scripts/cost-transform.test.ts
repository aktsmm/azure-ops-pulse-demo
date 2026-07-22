import { describe, expect, it } from "vitest";
import {
  costCoverageLabel,
  transformComparableCost,
  type CostQueryProperties
} from "./cost-transform";

function costResponse(amounts: number[]): CostQueryProperties {
  return {
    columns: [{ name: "Cost" }, { name: "ServiceName" }, { name: "Currency" }],
    rows: amounts.map((amount, index) => [amount, `Service ${index + 1}`, "JPY"])
  };
}

describe("Cost Management transform", () => {
  it("sums every row before limiting display categories", () => {
    const result = transformComparableCost(
      costResponse([100, 90, 80, 70, 60, 50, 40, 30, 20, 10]),
      costResponse([50, 90, 80, 70, 60, 50, 40, 30, 20, 10])
    );

    expect(result.currentTotalJpy).toBe(550);
    expect(result.categories).toHaveLength(8);
    expect(result.categories[0]).toEqual({
      name: "Service 1",
      amountJpy: 100,
      deltaPercent: 100
    });
  });

  it("marks prior values unavailable instead of copying the current total", () => {
    const result = transformComparableCost(costResponse([125]), null);

    expect(result.currentTotalJpy).toBe(125);
    expect(result.previousTotalJpy).toBeNull();
    expect(result.categories[0]?.deltaPercent).toBeNull();
  });

  it("keeps current cost visibly available when comparison coverage is partial", () => {
    expect(costCoverageLabel("available")).toBe("Available");
    expect(costCoverageLabel("partial")).toBe("Partial");
    expect(costCoverageLabel("unavailable")).toBe("Unavailable");
  });

  it("preserves signed credits in the all-row total and ranks by contribution magnitude", () => {
    const result = transformComparableCost(costResponse([100, -150, 40]), costResponse([80, -100, 20]));

    expect(result.currentTotalJpy).toBe(-10);
    expect(result.categories.map(({ amountJpy }) => amountJpy)).toEqual([-150, 100, 40]);
    expect(result.categories[0]?.deltaPercent).toBe(50);
  });
});
