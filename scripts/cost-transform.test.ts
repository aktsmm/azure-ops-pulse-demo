import { describe, expect, it } from "vitest";
import {
  comparableCostPeriods,
  costCoverageLabel,
  costPeriodMessage,
  mergeCostPages,
  parseCostPeriod,
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
  it("creates equal, non-overlapping current and prior periods", () => {
    const periods = comparableCostPeriods(new Date("2026-07-23T00:00:00.000Z"));

    expect(periods.previous.end.getTime()).toBeLessThan(periods.current.start.getTime());
    expect(periods.current.end.getTime() - periods.current.start.getTime()).toBe(
      periods.previous.end.getTime() - periods.previous.start.getTime()
    );
  });

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

  it("merges every paged response so the total is not silently truncated", () => {
    const first: CostQueryProperties = {
      ...costResponse([100]),
      nextLink: "https://management.azure.com/next"
    };
    const second: CostQueryProperties = { columns: [], rows: [[50, "Service 2", "JPY"]] };

    const merged = mergeCostPages([first, second]);

    expect(merged?.rows).toHaveLength(2);
    expect(merged?.columns).toEqual(first.columns);
    expect(parseCostPeriod(merged).totalJpy).toBe(150);
  });

  it("returns null when no page carried any content", () => {
    expect(mergeCostPages([])).toBeNull();
    expect(mergeCostPages([null, null])).toBeNull();
  });

  it("distinguishes an empty answer from a broken response and a foreign currency", () => {
    expect(parseCostPeriod(null).outcome).toBe("empty");
    expect(parseCostPeriod({ columns: [{ name: "Cost" }], rows: [] }).outcome).toBe("empty");
    expect(
      parseCostPeriod({ columns: [{ name: "Quantity" }], rows: [[1]] }).outcome
    ).toBe("unsupported-columns");
    expect(
      parseCostPeriod({
        columns: [{ name: "Cost" }, { name: "ServiceName" }, { name: "Currency" }],
        rows: [[10, "Service 1", "USD"]]
      }).outcome
    ).toBe("currency-mismatch");
    expect(parseCostPeriod(costResponse([10])).outcome).toBe("ok");
  });

  it("reports the record count so a zero-record period is not described as collected", () => {
    expect(costPeriodMessage("empty", 0)).toContain("no usage records");
    expect(costPeriodMessage("unsupported-columns", 3)).toContain("3 records");
    expect(costPeriodMessage("currency-mismatch", 2)).toContain("other than JPY");
    expect(costPeriodMessage("ok", 5)).toContain("5 rounded JPY records");
  });
});


describe("Cost Management source honesty", () => {
  it("reports a JPY-verified period with unreadable columns as having no total", () => {
    const result = parseCostPeriod({
      columns: [{ name: "UnexpectedAggregate" }, { name: "Currency" }],
      rows: [[1234, "JPY"]]
    });

    expect(result.currencyVerifiedJpy).toBe(true);
    expect(result.totalJpy).toBeNull();
    expect(result.outcome).toBe("unsupported-columns");
    expect(costPeriodMessage(result.outcome, result.rowCount)).toMatch(/1 records/);
  });
});
