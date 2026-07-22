export type CostTrend = "unavailable" | "increased" | "decreased" | "unchanged";

export function classifyCostTrend(deltaPercent: number | null): CostTrend {
  if (deltaPercent === null) return "unavailable";
  if (deltaPercent > 0) return "increased";
  if (deltaPercent < 0) return "decreased";
  return "unchanged";
}
