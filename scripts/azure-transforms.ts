export interface CostQueryProperties {
  rows?: unknown[][];
  columns?: Array<{ name?: string }>;
}

export interface CostPeriodSummary {
  totalJpy: number;
  services: Map<string, number>;
}

export interface CostTransform {
  current: CostPeriodSummary | null;
  previous: CostPeriodSummary | null;
  categories: Array<{ name: string; amountJpy: number; deltaPercent: number | null }>;
}

export function comparableCostPeriods(end: Date, days = 30) {
  const currentEnd = new Date(end);
  const currentStart = new Date(currentEnd);
  currentStart.setUTCDate(currentStart.getUTCDate() - days);
  const previousEnd = new Date(currentStart.getTime() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setUTCDate(previousStart.getUTCDate() - days);
  return {
    current: { start: currentStart, end: currentEnd },
    previous: { start: previousStart, end: previousEnd }
  };
}

export function summarizeCostPeriod(
  properties: CostQueryProperties | null | undefined
): CostPeriodSummary | null {
  const rows = properties?.rows ?? [];
  const columns = (properties?.columns ?? []).map((column) => column.name?.toLowerCase() ?? "");
  const costIndex = columns.indexOf("cost");
  const serviceIndex = columns.indexOf("servicename");
  const currencyIndex = columns.indexOf("currency");
  if (!rows.length || costIndex < 0 || currencyIndex < 0) return null;

  const currencies = new Set(
    rows.map((row) => String(row[currencyIndex] ?? "").toUpperCase()).filter(Boolean)
  );
  if (currencies.size !== 1 || !currencies.has("JPY")) return null;

  const services = new Map<string, number>();
  for (const row of rows) {
    const amount = Number(row[costIndex]);
    if (!Number.isFinite(amount)) return null;
    const service = String(serviceIndex >= 0 ? row[serviceIndex] ?? "Other" : "Other");
    services.set(service, (services.get(service) ?? 0) + amount);
  }

  return {
    totalJpy: [...services.values()].reduce((sum, amount) => sum + amount, 0),
    services
  };
}

function changePercent(current: number, previous: number | undefined): number | null {
  if (previous === undefined || previous <= 0) return null;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

export function transformCostPeriods(
  currentProperties: CostQueryProperties | null | undefined,
  previousProperties: CostQueryProperties | null | undefined,
  categoryLimit = 8
): CostTransform {
  const current = summarizeCostPeriod(currentProperties);
  const previous = summarizeCostPeriod(previousProperties);
  const categories = current
    ? [...current.services.entries()]
        .map(([name, amountJpy]) => ({
          name,
          amountJpy,
          deltaPercent: changePercent(amountJpy, previous?.services.get(name))
        }))
        .sort((left, right) => right.amountJpy - left.amountJpy)
        .slice(0, categoryLimit)
    : [];
  return { current, previous, categories };
}
