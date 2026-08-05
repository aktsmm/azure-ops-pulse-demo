import type {
  Availability,
  PublicSnapshotV1,
  ResourceItem,
  Severity,
  SourceStatus
} from "../data/contracts";
import { isWithheldJpyAmount } from "./jpy-disclosure";

const dateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Tokyo"
});

const numberFormatter = new Intl.NumberFormat("ja-JP");

export function severityLabel(severity: Severity): string {
  if (severity === "critical") return "重大";
  if (severity === "warning") return "要確認";
  if (severity === "healthy") return "正常";
  return "情報";
}

export function availabilityLabel(availability: Availability): string {
  if (availability === "available") return "収集済み";
  if (availability === "partial") return "一部収集";
  return "利用不可";
}

export function availabilitySeverity(availability: Availability): Severity {
  if (availability === "available") return "healthy";
  if (availability === "partial") return "warning";
  return "info";
}

/**
 * Shows a value only when its source actually published data. `partial` counts as published, since
 * it means some records were collected; only `unavailable` (or a missing source) blanks the value.
 */
export function metricWhenSourcePublished<T>(
  source: SourceStatus | undefined,
  value: T | null
): T | null {
  return source !== undefined && source.availability !== "unavailable" ? value : null;
}

export function resourceStatusLabel(status: ResourceItem["status"]): string {
  if (status === "Healthy") return "正常";
  if (status === "Degraded") return "低下";
  if (status === "Unavailable") return "利用不可";
  if (status === "NotApplicable") return "対象外";
  return "未評価";
}

export function resourceStatusSeverity(status: ResourceItem["status"]): Severity {
  if (status === "Healthy") return "healthy";
  if (status === "Degraded") return "warning";
  if (status === "Unavailable") return "critical";
  return "info";
}

export function recommendationStatusLabel(status: "Open" | "In progress" | "Resolved"): string {
  if (status === "Open") return "未対応";
  if (status === "In progress") return "対応中";
  return "解決済み";
}

export function flowStatusLabel(status: "Allowed" | "Degraded" | "Blocked"): string {
  if (status === "Allowed") return "許可";
  if (status === "Degraded") return "低下";
  return "ブロック";
}

export function flowStatusSeverity(status: "Allowed" | "Degraded" | "Blocked"): Severity {
  if (status === "Allowed") return "healthy";
  if (status === "Degraded") return "warning";
  return "critical";
}

export function modeLabel(mode: "DEMO" | "AZURE"): string {
  return mode === "DEMO" ? "デモ" : "Azure";
}

export function routeLabel(route: string): string {
  const labels: Record<string, string> = {
    "/overview": "概要",
    "/cost": "コスト",
    "/resources": "リソース",
    "/reliability": "信頼性",
    "/security": "セキュリティ",
    "/network": "ネットワーク",
    "/ai-insights": "AI 分析"
  };
  return labels[route] ?? "関連画面";
}

export function formatDateTimeJa(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateTimeFormatter.format(date);
}

export function formatSnapshotAge(generatedAt: string, now = Date.now()): string {
  const generated = new Date(generatedAt).getTime();
  if (!Number.isFinite(generated)) return "更新時刻不明";
  const minutes = Math.max(0, Math.floor((now - generated) / 60_000));
  if (minutes < 1) return "たった今";
  if (minutes < 60) return `${numberFormatter.format(minutes)} 分前`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return remainingMinutes
      ? `${numberFormatter.format(hours)} 時間 ${numberFormatter.format(remainingMinutes)} 分前`
      : `${numberFormatter.format(hours)} 時間前`;
  }
  return `${numberFormatter.format(Math.floor(hours / 24))} 日前`;
}

/**
 * Event timestamps used to pass through an exact-match table that turned collector strings such as
 * "Current snapshot" into Japanese. That made the screen read Japanese while the published file
 * stayed English, so the language audit saw nothing wrong — the same failure this repository removed
 * from the activity titles. The collector now emits Japanese labels, and an unparseable value is
 * shown verbatim so a regression is visible instead of being translated away.
 */
export function formatEventTimestamp(value: string): string {
  return formatDateTimeJa(value);
}

export function formatCostDelta(deltaPercent: number | null): string {
  if (deltaPercent === null) return "比較可能な前期間データなし";
  if (deltaPercent === 0) return "前期間比 0%";
  return `前期間比 ${deltaPercent > 0 ? "+" : ""}${numberFormatter.format(deltaPercent)}%`;
}

/**
 * The change the dashboard is allowed to show for the portfolio total. The browser fetches
 * `snapshot.json` at runtime without revalidating it, so a file published before the disclosure
 * floor existed could still carry a percentage measured against a withheld amount.
 */
export function publishedCostDeltaPercent(cost: PublicSnapshotV1["cost"]): number | null {
  if (isWithheldJpyAmount(cost.current.approximateAmount)) return null;
  if (isWithheldJpyAmount(cost.previous.approximateAmount)) return null;
  return cost.deltaPercent;
}

/**
 * Resources whose type Azure Resource Health never evaluates are counted separately and excluded
 * from the coverage denominator, so 0% coverage always means a genuine collection gap.
 *
 * The dashboard reads `reliability.coverage` from the snapshot instead of re-counting the
 * inventory; this helper stays available for tooling that only has a resource list.
 */
export function summarizeResourceHealth(resources: ResourceItem[]) {
  const summary = {
    total: resources.length,
    healthy: 0,
    degraded: 0,
    unavailable: 0,
    unknown: 0,
    notApplicable: 0,
    supported: 0,
    evaluated: 0,
    coveragePercent: 0
  };
  for (const resource of resources) {
    if (resource.status === "Healthy") summary.healthy += 1;
    else if (resource.status === "Degraded") summary.degraded += 1;
    else if (resource.status === "Unavailable") summary.unavailable += 1;
    else if (resource.status === "NotApplicable") summary.notApplicable += 1;
    else summary.unknown += 1;
  }
  summary.supported = summary.total - summary.notApplicable;
  summary.evaluated = summary.healthy + summary.degraded + summary.unavailable;
  summary.coveragePercent = summary.supported
    ? Math.round((summary.evaluated / summary.supported) * 100)
    : 0;
  return summary;
}

/**
 * The collector always writes Japanese activity copy (`normalizeActivityOperationLabel` falls back
 * to a Japanese label rather than passing an Azure operation name through), and the DEMO fixture now
 * does too. An earlier English lookup table translated activity titles and details for display, and
 * that shim is exactly why the DEMO fixture could publish English event copy unnoticed: readers saw
 * Japanese while the snapshot said otherwise, so the published-language audit had nothing to find.
 * The only transform left guards against an Azure payload whose operation name serialized as an
 * object, which would otherwise render as `[object Object]`.
 */
export function formatActivityTitle(title: string): string {
  if (title.includes("[object Object]")) return "Azure 操作を検出";
  return title;
}

/**
 * Source identifiers are stable English keys in the snapshot (the AI evidence validator matches on
 * them), so only the descriptive ones are translated for display. Azure product names stay as-is.
 */
export function formatSourceName(source: string): string {
  const names: Record<string, string> = {
    "Network inventory and metrics": "ネットワーク インベントリとメトリック",
    "Cost Management prior period": "Cost Management（前期間）"
  };
  return names[source] ?? source;
}

/**
 * `classifyEndpoint` in `src/lib/sanitize.ts` replaces every flow hostname with one of a closed set
 * of labels, so the destination the snapshot carries is an identifier rather than collector prose.
 * Mapping it here is the same treatment `formatSourceName` gives the source keys: the stored value
 * stays the sanitizer's, and the page reads Japanese. An unmapped value is returned unchanged so
 * the rendered-language audit reports it instead of the page inventing a translation.
 */
export function formatEndpointLabel(destination: string): string {
  const names: Record<string, string> = {
    "Azure Storage endpoint": "Azure Storage のエンドポイント",
    "Azure Front Door endpoint": "Azure Front Door のエンドポイント",
    "Azure SQL endpoint": "Azure SQL のエンドポイント",
    "Microsoft service endpoint": "Microsoft サービスのエンドポイント",
    "External service endpoint": "外部サービスのエンドポイント",
    "Unclassified service endpoint": "分類できないエンドポイント"
  };
  return names[destination] ?? destination;
}

export function formatSourceMessage(source: SourceStatus): string {
  const messages: Record<string, Partial<Record<Availability, string>>> = {
    "Azure Resource Graph": {
      available: "読み取り専用のインベントリ収集が完了しました。",
      unavailable: "Azure Resource Graph のインベントリを収集できませんでした。"
    },
    "Cost Management": {
      available: "現在期間と比較可能な前期間の概算 JPY データを収集しました。",
      partial: "現在期間の概算 JPY データのみを収集しました。",
      unavailable: "Cost Management データを収集できませんでした。"
    },
    "Resource Health": {
      available:
        "Resource Health が対応リソースをすべて評価しました。対象外の種別は正常・異常のどちらにも数えません。",
      partial:
        "Resource Health は対応リソースの一部のみ評価できました。対象外と未評価は区別して表示します。",
      unavailable: "Resource Health を収集できないため、リソース状態は評価していません。"
    },
    "Service Health": {
      available: "Service Health イベントを集計形式で収集しました。",
      partial: "Service Health は収集できましたが、対象期間のイベントは 0 件でした。",
      unavailable: "Service Health イベントを収集できませんでした。"
    },
    "Activity Log": {
      available: "実行者と対象リソースの詳細を除外して Activity Log を収集しました。",
      partial: "Activity Log は収集できましたが、直近 7 日間のイベントは 0 件でした。",
      unavailable: "Activity Log を収集できませんでした。"
    },
    "Cost Management prior period": {
      available: "比較可能な前期間の概算 JPY データを収集しました。",
      unavailable: "比較可能な前期間の Cost Management データを収集できませんでした。"
    },
    "Defender for Cloud": {
      available: "Defender for Cloud の集計シグナルを収集しました。",
      partial: "Defender for Cloud の一部の集計シグナルを収集しました。",
      unavailable: "Defender for Cloud データを収集できませんでした。"
    },
    "Network inventory and metrics": {
      available: "ネットワーク インベントリと対応メトリックを収集しました。",
      partial:
        "ネットワーク インベントリは収集済みです。未収集の項目はページ内で個別に明示します。",
      unavailable: "ネットワーク インベントリとメトリックを収集できませんでした。"
    }
  };
  return (
    messages[source.source]?.[source.availability] ??
    (source.availability === "available"
      ? "このソースの公開可能なデータを収集しました。"
      : source.availability === "partial"
        ? "このソースは一部の公開可能なデータのみ収集できました。"
        : "このソースのデータは利用できません。")
  );
}
