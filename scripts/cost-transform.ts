import { isComparableJpyChange } from "../src/lib/jpy-disclosure";
import { CollectionError } from "./collection-diagnostics";

export interface CostQueryProperties {
  rows?: unknown[][];
  columns?: Array<{ name?: string }>;
  nextLink?: string | null;
}

export type CostPeriodOutcome = "empty" | "unsupported-columns" | "currency-mismatch" | "invalid-rows" | "ok";

interface ParsedCostPeriod {
  currencyVerifiedJpy: boolean;
  totalJpy: number | null;
  rowCount: number;
  outcome: CostPeriodOutcome;
  categories: Array<{ name: string; amountJpy: number }>;
}

export interface ComparableCostResult {
  categoryMagnitudeJpy: number;
  currentTotalJpy: number | null;
  previousTotalJpy: number | null;
  categories: Array<{ name: string; amountJpy: number; deltaPercent: number | null }>;
  currentCurrencyVerifiedJpy: boolean;
  previousCurrencyVerifiedJpy: boolean;
  currentOutcome: CostPeriodOutcome;
  previousOutcome: CostPeriodOutcome;
  currentRowCount: number;
  previousRowCount: number;
}

/**
 * The Cost Management query API pages results through `properties.nextLink`. Reading only the first
 * page silently under-reports the period total, so every page is merged before parsing.
 */
export function mergeCostPages(
  pages: ReadonlyArray<CostQueryProperties | null>
): CostQueryProperties | null {
  const present = pages.filter((page): page is CostQueryProperties => page !== null);
  if (!present.length) return null;
  if (present.some((page) => page.columns !== undefined &&
      (!Array.isArray(page.columns) || page.columns.some((column) => !column || typeof column.name !== "string")))) {
    throw new CollectionError("invalid-response");
  }
  const columns = present.find((page) => (page.columns ?? []).length > 0)?.columns ?? [];
  const signature = JSON.stringify(columns.map((column) => column.name?.toLowerCase()));
  if (present.some((page) => page.columns?.length &&
      JSON.stringify(page.columns.map((column) => column.name?.toLowerCase())) !== signature)) {
    throw new CollectionError("invalid-response");
  }
  return {
    columns,
    rows: present.flatMap((page) => page.rows ?? [])
  };
}

export function comparableCostPeriods(currentEnd: Date, days = 30) {
  const current = {
    start: new Date(currentEnd),
    end: new Date(currentEnd)
  };
  current.start.setUTCDate(current.start.getUTCDate() - days);

  const previous = {
    start: new Date(current.start.getTime() - 1),
    end: new Date(current.start.getTime() - 1)
  };
  previous.start.setUTCDate(previous.start.getUTCDate() - days);

  return { current, previous };
}

export function costCoverageLabel(
  availability: "available" | "partial" | "unavailable"
): "収集済み" | "一部収集" | "利用不可" {
  if (availability === "available") return "収集済み";
  if (availability === "partial") return "一部収集";
  return "利用不可";
}

/**
 * A period-over-period change is only published while both amounts reach the yen disclosure floor.
 * Below it the public snapshot withholds the figure itself, so the percentage divides by something
 * the reader cannot see: a real collection reported `+38,537.8%` for a service published as
 * 約¥1千未満 in both periods, which reads as an incident rather than a few hundred yen of new spend.
 */
function percentageChange(current: number, previous: number | undefined): number | null {
  if (!isComparableJpyChange(current, previous)) return null;
  if (Math.sign(current) !== Math.sign(previous as number)) return null;
  return Number((((Math.abs(current) - Math.abs(previous as number)) / Math.abs(previous as number)) * 100).toFixed(1));
}

export function parseCostPeriod(properties: CostQueryProperties | null): ParsedCostPeriod {
  if (!properties) {
    return {
      currencyVerifiedJpy: false,
      totalJpy: null,
      rowCount: 0,
      outcome: "empty",
      categories: []
    };
  }

  if (!Array.isArray(properties.rows) || !Array.isArray(properties.columns) ||
      properties.rows.some((row) => !Array.isArray(row)) ||
      properties.columns.some((column) => !column || typeof column.name !== "string")) {
    return { currencyVerifiedJpy: false, totalJpy: null, rowCount: 0, outcome: "invalid-rows", categories: [] };
  }

  const rows = properties.rows ?? [];
  const columns = (properties.columns ?? []).map((column) => column.name?.toLowerCase() ?? "");
  const costIndex = ["cost", "pretaxcost", "totalcost"]
    .map((name) => columns.indexOf(name))
    .find((index) => index >= 0);
  const serviceIndex = columns.indexOf("servicename");
  const currencyIndex = columns.indexOf("currency");
  const currencies = new Set(
    rows
      .map((row) => (currencyIndex >= 0 ? String(row[currencyIndex] ?? "").toUpperCase() : ""))
      .filter(Boolean)
  );
  const currencyVerifiedJpy = currencies.size === 1 && currencies.has("JPY") &&
    rows.every((row) => typeof row[currencyIndex] === "string" &&
      String(row[currencyIndex]).toUpperCase() === "JPY");

  if (rows.length === 0) {
    return {
      currencyVerifiedJpy: false,
      totalJpy: null,
      rowCount: 0,
      outcome: "empty",
      categories: []
    };
  }
  if (costIndex === undefined) {
    return {
      currencyVerifiedJpy,
      totalJpy: null,
      rowCount: rows.length,
      outcome: "unsupported-columns",
      categories: []
    };
  }
  if (!currencyVerifiedJpy) {
    return {
      currencyVerifiedJpy,
      totalJpy: null,
      rowCount: rows.length,
      outcome: "currency-mismatch",
      categories: []
    };
  }

  const categoryTotals = new Map<string, number>();
  let totalJpy = 0;
  for (const row of rows) {
    const amount = Number(row[costIndex]);
    if ((typeof row[costIndex] !== "number" && typeof row[costIndex] !== "string") ||
        String(row[costIndex]).trim() === "" || !Number.isFinite(amount) ||
        !Number.isFinite(totalJpy + amount)) {
      return { currencyVerifiedJpy, totalJpy: null, rowCount: rows.length, outcome: "invalid-rows", categories: [] };
    }
    totalJpy += amount;
    const name = String(serviceIndex >= 0 ? row[serviceIndex] ?? "Other" : "Other");
    categoryTotals.set(name, (categoryTotals.get(name) ?? 0) + amount);
  }

  return {
    currencyVerifiedJpy,
    totalJpy,
    rowCount: rows.length,
    outcome: "ok",
    categories: [...categoryTotals].map(([name, amountJpy]) => ({ name, amountJpy }))
  };
}

export function transformComparableCost(
  currentProperties: CostQueryProperties | null,
  previousProperties: CostQueryProperties | null,
  categoryLimit = 8
): ComparableCostResult {
  const current = parseCostPeriod(currentProperties);
  const previous = parseCostPeriod(previousProperties);
  const previousByCategory = new Map(
    previous.categories.map((category) => [category.name, category.amountJpy])
  );

  return {
    categoryMagnitudeJpy: current.categories.reduce((sum, category) => sum + Math.abs(category.amountJpy), 0),
    currentTotalJpy: current.totalJpy,
    previousTotalJpy: previous.totalJpy,
    currentCurrencyVerifiedJpy: current.currencyVerifiedJpy,
    previousCurrencyVerifiedJpy: previous.currencyVerifiedJpy,
    currentOutcome: current.outcome,
    previousOutcome: previous.outcome,
    currentRowCount: current.rowCount,
    previousRowCount: previous.rowCount,
    categories: current.categories
      .sort((left, right) => Math.abs(right.amountJpy) - Math.abs(left.amountJpy))
      .slice(0, categoryLimit)
      .map((category) => ({
        ...category,
        deltaPercent: percentageChange(category.amountJpy, previousByCategory.get(category.name))
      }))
  };
}

export function costPeriodMessage(outcome: CostPeriodOutcome, rowCount: number): string {
  if (outcome === "empty") return "Cost Management returned no usage records for the period.";
  if (outcome === "unsupported-columns") {
    return `Cost Management returned ${rowCount} records without a recognizable cost column.`;
  }
  if (outcome === "currency-mismatch") {
    return `Cost Management returned ${rowCount} records with currency other than JPY or missing currency; no unverified conversion was published.`;
  }
  if (outcome === "invalid-rows") return "Cost Management returned an invalid amount schema; no incomplete total was published.";
  return `Cost Management returned ${rowCount} rounded JPY records.`;
}
