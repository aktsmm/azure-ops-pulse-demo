import { describe, expect, it } from "vitest";
import {
  comparableCostPeriods,
  transformCostPeriods,
  type CostQueryProperties
} from "./azure-transforms";

function period(amounts: number[]): CostQueryProperties {
  return {
    columns: [{ name: "Cost" }, { name: "ServiceName" }, { name: "Currency" }],
    rows: amounts.map((amount, index) => [amount, `Service ${index + 1}`, "JPY"])
  };
}

describe("Azure cost transforms", () => {
  it("creates disjoint current and prior comparable periods", () => {
    const periods = comparableCostPeriods(new Date("2026-07-23T00:00:00.000Z"));

    expect(periods.previous.end.getTime()).toBeLessThan(periods.current.start.getTime());
    expect(periods.current.end.getTime() - periods.current.start.getTime()).toBe(
      periods.previous.end.getTime() - periods.previous.start.getTime()
    );
  });

  it("sums every current row before limiting displayed categories", () => {
    const transformed = transformCostPeriods(period([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), period([1, 1]));

    expect(transformed.current?.totalJpy).toBe(55);
    expect(transformed.categories).toHaveLength(8);
    expect(transformed.categories.map((category) => category.amountJpy)).toEqual([
      10, 9, 8, 7, 6, 5, 4, 3
    ]);
  });

  it("uses a separately supplied comparable period for totals and service deltas", () => {
    const transformed = transformCostPeriods(period([120, 50]), period([100, 50]));

    expect(transformed.previous?.totalJpy).toBe(150);
    expect(transformed.categories).toEqual([
      { name: "Service 1", amountJpy: 120, deltaPercent: 20 },
      { name: "Service 2", amountJpy: 50, deltaPercent: 0 }
    ]);
  });

  it("marks unsupported currencies and missing prior periods unavailable", () => {
    const usd = period([100]);
    usd.rows![0]![2] = "USD";
    const transformed = transformCostPeriods(usd, null);

    expect(transformed.current).toBeNull();
    expect(transformed.previous).toBeNull();
    expect(transformed.categories).toEqual([]);
  });
});
