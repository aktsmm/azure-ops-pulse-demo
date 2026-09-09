import type { AdvisorSummary } from "../src/data/contracts";
import { CollectionError } from "./collection-diagnostics";

// https://learn.microsoft.com/ja-jp/azure/governance/resource-graph/samples/samples-by-category
export const ADVISOR_QUERY = `AdvisorResources
| where type =~ 'microsoft.advisor/recommendations'
| summarize count=count() by category=tostring(properties.category), impact=tostring(properties.impact)`;

export interface AdvisorRow { category?: unknown; impact?: unknown; count?: unknown }

export function summarizeAdvisor(rows: readonly AdvisorRow[]): AdvisorSummary {
  const categories = ["Cost", "HighAvailability", "Performance", "Security", "OperationalExcellence"] as const;
  const impacts = ["High", "Medium", "Low"] as const;
  const groups = new Map<string, AdvisorSummary["recommendations"][number]>();
  let unknown = false;
  for (const row of rows) {
    if (!row || !Number.isSafeInteger(row.count) || Number(row.count) < 0) {
      throw new CollectionError("invalid-response");
    }
    const category = categories.find((value) => value.toLowerCase() === String(row.category).toLowerCase()) ?? "Other";
    const impact = impacts.find((value) => value.toLowerCase() === String(row.impact).toLowerCase()) ?? "Unknown";
    unknown ||= category === "Other" || impact === "Unknown";
    const key = `${category}:${impact}`;
    const count = (groups.get(key)?.count ?? 0) + Number(row.count);
    if (!Number.isSafeInteger(count)) throw new CollectionError("invalid-response");
    if (count > 0) groups.set(key, { category, impact, count });
  }
  return {
    availability: unknown ? "partial" : "available",
    message: unknown
      ? "Advisor の分類を一部判別できなかったため、その他・不明に集約しました。"
      : rows.length
        ? "Advisor の推奨事項をカテゴリと影響度で集計しました。タイトル・対象名は公開しません。"
        : "Advisor の読み取りは成功しましたが、対象スコープで推奨事項は返されませんでした。",
    recommendations: [...groups.values()].sort((a, b) => `${a.category}:${a.impact}`.localeCompare(`${b.category}:${b.impact}`))
  };
}
