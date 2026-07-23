import type { Availability, Severity } from "../data/contracts";

export type ResourceStatus = "Healthy" | "Degraded" | "Unavailable" | "Unknown";
export type NetworkFlowStatus = "Allowed" | "Degraded" | "Blocked";
export type RecommendationStatus = "Open" | "In progress" | "Resolved";
export type DashboardMode = "DEMO" | "AZURE";

/** Common display formatter: internal contract enums stay in English; only the label shown to users is Japanese. */
export function severityLabelJa(severity: Severity): string {
  switch (severity) {
    case "critical":
      return "重大";
    case "warning":
      return "警告";
    case "healthy":
      return "正常";
    default:
      return "情報";
  }
}

export function resourceStatusLabelJa(status: ResourceStatus): string {
  switch (status) {
    case "Healthy":
      return "正常";
    case "Degraded":
      return "低下";
    case "Unavailable":
      return "取得不可";
    default:
      return "不明";
  }
}

/**
 * Unknown means "no confirmed health signal was collected", not "unhealthy".
 * It must render as informational, never as a critical/error state.
 */
export function resourceStatusSeverity(status: ResourceStatus): Severity {
  switch (status) {
    case "Healthy":
      return "healthy";
    case "Degraded":
      return "warning";
    case "Unavailable":
      return "critical";
    default:
      return "info";
  }
}

export function availabilityLabelJa(availability: Availability): string {
  switch (availability) {
    case "available":
      return "利用可能";
    case "partial":
      return "部分的に利用可能";
    default:
      return "利用不可";
  }
}

export function networkFlowStatusLabelJa(status: NetworkFlowStatus): string {
  switch (status) {
    case "Allowed":
      return "許可";
    case "Degraded":
      return "低下";
    default:
      return "遮断";
  }
}

export function networkFlowStatusSeverity(status: NetworkFlowStatus): Severity {
  switch (status) {
    case "Allowed":
      return "healthy";
    case "Degraded":
      return "warning";
    default:
      return "critical";
  }
}

export function recommendationStatusLabelJa(status: RecommendationStatus): string {
  switch (status) {
    case "Open":
      return "未対応";
    case "In progress":
      return "対応中";
    default:
      return "解決済み";
  }
}

export function modeLabelJa(mode: DashboardMode): string {
  return mode === "DEMO" ? "デモ" : "Azure";
}

const dateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short"
});

export function formatDateTimeJa(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "不明";
  return dateTimeFormatter.format(date);
}

export function formatAgeJa(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return "不明";
  if (minutes < 1) return "1分未満前";
  if (minutes < 60) return `${Math.round(minutes)}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  const days = Math.floor(hours / 24);
  return `${days}日前`;
}

/** Azure region codes (e.g. "japaneast") are literal product identifiers and stay in English; only the "no region recorded" sentinel gets a Japanese label. */
export function regionLabelJa(region: string): string {
  return region === "Unknown" ? "不明" : region;
}

export function formatPercentDeltaJa(deltaPercent: number): string {
  const sign = deltaPercent > 0 ? "+" : "";
  return `前期比 ${sign}${deltaPercent}%`;
}

export function costDeltaLabelJa(label: "Increased" | "Decreased" | "Unchanged"): string {
  switch (label) {
    case "Increased":
      return "増加";
    case "Decreased":
      return "減少";
    default:
      return "変化なし";
  }
}
