import { describe, expect, it } from "vitest";
import { JPY_DISCLOSURE_FLOOR } from "../src/lib/jpy-disclosure";
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
      costResponse([100_000, 90_000, 80_000, 70_000, 60_000, 50_000, 40_000, 30_000, 20_000, 10_000]),
      costResponse([50_000, 90_000, 80_000, 70_000, 60_000, 50_000, 40_000, 30_000, 20_000, 10_000])
    );

    expect(result.currentTotalJpy).toBe(550_000);
    expect(result.categories).toHaveLength(8);
    expect(result.categories[0]).toEqual({
      name: "Service 1",
      amountJpy: 100_000,
      deltaPercent: 100
    });
  });

  it("marks prior values unavailable instead of copying the current total", () => {
    const result = transformComparableCost(costResponse([125_000]), null);

    expect(result.currentTotalJpy).toBe(125_000);
    expect(result.previousTotalJpy).toBeNull();
    expect(result.categories[0]?.deltaPercent).toBeNull();
  });

  it("keeps current cost visibly available when comparison coverage is partial", () => {
    expect(costCoverageLabel("available")).toBe("収集済み");
    expect(costCoverageLabel("partial")).toBe("一部収集");
    expect(costCoverageLabel("unavailable")).toBe("利用不可");
  });

  it("preserves signed credits in the all-row total and ranks by contribution magnitude", () => {
    const result = transformComparableCost(
      costResponse([100_000, -150_000, 40_000]),
      costResponse([80_000, -100_000, 20_000])
    );

    expect(result.currentTotalJpy).toBe(-10_000);
    expect(result.categories.map(({ amountJpy }) => amountJpy)).toEqual([
      -150_000, 100_000, 40_000
    ]);
    expect(result.categories[0]?.deltaPercent).toBe(50);
  });

  it("withholds the change when the prior amount is below the yen disclosure floor", () => {
    // The shape that produced "+38,537.8%" in production: a service billed a rounding error last
    // period and a still-withheld amount this period.
    const result = transformComparableCost(costResponse([386]), costResponse([1]));

    expect(result.categories[0]?.amountJpy).toBe(386);
    expect(result.categories[0]?.deltaPercent).toBeNull();
  });

  it("withholds the change when the current amount is below the yen disclosure floor", () => {
    const result = transformComparableCost(
      costResponse([JPY_DISCLOSURE_FLOOR - 1]),
      costResponse([50_000])
    );

    expect(result.categories[0]?.deltaPercent).toBeNull();
  });

  it("publishes the change as soon as both amounts reach the disclosure floor", () => {
    const belowFloor = transformComparableCost(
      costResponse([2 * JPY_DISCLOSURE_FLOOR]),
      costResponse([JPY_DISCLOSURE_FLOOR - 1])
    );
    const atFloor = transformComparableCost(
      costResponse([2 * JPY_DISCLOSURE_FLOOR]),
      costResponse([JPY_DISCLOSURE_FLOOR])
    );

    expect(belowFloor.categories[0]?.deltaPercent).toBeNull();
    expect(atFloor.categories[0]?.deltaPercent).toBe(100);
  });

  it("still refuses to compare a credit against a charge", () => {
    const result = transformComparableCost(costResponse([-50_000]), costResponse([50_000]));

    expect(result.categories[0]?.deltaPercent).toBeNull();
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
