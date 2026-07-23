import type {
  Availability,
  ResourceItem,
  Severity,
  SourceStatus
} from "../data/contracts";

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

export function resourceStatusLabel(status: ResourceItem["status"]): string {
  if (status === "Healthy") return "正常";
  if (status === "Degraded") return "低下";
  if (status === "Unavailable") return "利用不可";
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

export function formatEventTimestamp(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "current snapshot") return "現在のスナップショット";
  if (normalized === "current collection window") return "現在の収集期間";
  if (normalized === "recent") return "最近";
  if (normalized === "yesterday") return "昨日";
  const minutes = normalized.match(/^(\d+)\s+min(?:ute)?s?\s+ago$/);
  if (minutes) return `${minutes[1]} 分前`;
  const hours = normalized.match(/^(\d+)\s+h(?:ou)?r?s?\s+ago$/);
  if (hours) return `${hours[1]} 時間前`;
  return formatDateTimeJa(value);
}

export function formatCostDelta(deltaPercent: number | null): string {
  if (deltaPercent === null) return "比較可能な前期間データなし";
  if (deltaPercent === 0) return "前期間比 0%";
  return `前期間比 ${deltaPercent > 0 ? "+" : ""}${numberFormatter.format(deltaPercent)}%`;
}

export function summarizeResourceHealth(resources: ResourceItem[]) {
  const summary = {
    total: resources.length,
    healthy: 0,
    degraded: 0,
    unavailable: 0,
    unknown: 0,
    evaluated: 0,
    coveragePercent: 0
  };
  for (const resource of resources) {
    if (resource.status === "Healthy") summary.healthy += 1;
    else if (resource.status === "Degraded") summary.degraded += 1;
    else if (resource.status === "Unavailable") summary.unavailable += 1;
    else summary.unknown += 1;
  }
  summary.evaluated = summary.healthy + summary.degraded + summary.unavailable;
  summary.coveragePercent = summary.total
    ? Math.round((summary.evaluated / summary.total) * 100)
    : 0;
  return summary;
}

export function formatActivityTitle(title: string): string {
  if (title.includes("[object Object]")) return "Azure 操作を検出";
  const exact: Record<string, string> = {
    "Azure collection completed": "Azure データ収集が完了",
    "Service Health event observed": "Service Health イベントを検出",
    "Compute cost variance detected": "Compute コストの変動を検出",
    "Security recommendation resolved": "セキュリティ推奨事項が解決",
    "Application latency threshold crossed": "アプリケーション遅延がしきい値を超過",
    "Inventory change observed": "インベントリ変更を検出"
  };
  if (exact[title]) return exact[title];
  const activity = title.match(/^(.+)\s+activity observed$/i);
  if (activity?.[1]) return `${activity[1]} のアクティビティを検出`;
  return title;
}

export function formatActivityDetail(detail: string): string {
  const collection = detail.match(
    /^(\d+) resources sanitized; (\d+) optional sources unavailable\.$/
  );
  if (collection) {
    return `${collection[1]} 件のリソースをサニタイズし、利用不可の任意ソースは ${collection[2]} 件でした。`;
  }
  const exact: Record<string, string> = {
    "Actor, resource, and operation details were removed before publication.":
      "公開前に実行者とリソースの詳細を削除しています。",
    "Service-level status is shown without affected subscription or resource details.":
      "影響を受けたサブスクリプションやリソースの詳細を除き、サービス単位の状態のみを表示します。",
    "Normalized spend moved 11.4% above its trailing baseline.":
      "正規化済み支出が直近の基準値を 11.4% 上回りました。",
    "Aggregate affected-resource count decreased from 5 to 2.":
      "影響を受けたリソースの集計件数が 5 件から 2 件に減少しました。",
    "P95 exceeded the service target in 3 of 12 intervals.":
      "12 区間中 3 区間で P95 がサービス目標を超えました。",
    "Two sanitized resources were added to the monitored estate.":
      "サニタイズ済みリソース 2 件が監視対象に追加されました。"
  };
  return exact[detail] ?? detail;
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
        "Resource Health を収集しました。状態が未評価のリソースは正常・異常のどちらにも数えません。",
      unavailable: "Resource Health を収集できないため、リソース状態は評価していません。"
    },
    "Service Health": {
      available: "Service Health イベントを集計形式で収集しました。",
      unavailable: "Service Health イベントを収集できませんでした。"
    },
    "Activity Log": {
      available: "実行者と対象リソースの詳細を除外して Activity Log を収集しました。",
      unavailable: "Activity Log を収集できませんでした。"
    },
    "Defender for Cloud": {
      available: "Defender for Cloud の集計シグナルを収集しました。",
      partial: "Defender for Cloud の一部の集計シグナルを収集しました。",
      unavailable: "Defender for Cloud データを収集できませんでした。"
    },
    "Network inventory and metrics": {
      available: "ネットワーク インベントリと対応メトリックを収集しました。",
      partial:
        "ネットワーク インベントリは収集済みです。フロー テレメトリは未収集で、接続状態は評価していません。",
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
