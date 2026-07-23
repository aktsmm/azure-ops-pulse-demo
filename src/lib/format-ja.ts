import type { Availability, ResourceItem, Severity } from "../data/contracts";

/**
 * Japanese display formatters for the dashboard UI.
 *
 * The public data contract (src/data/contracts.ts) and its enums stay in English so the schema,
 * evidence validator, and collector pipeline remain stable. These functions are the only place
 * that maps those internal contract values to Japanese labels for rendering.
 */

const SEVERITY_LABEL_JA: Record<Severity, string> = {
  critical: "重大",
  warning: "警告",
  healthy: "正常",
  info: "情報"
};

export function severityLabelJa(severity: Severity): string {
  return SEVERITY_LABEL_JA[severity];
}

const RESOURCE_STATUS_LABEL_JA: Record<ResourceItem["status"], string> = {
  Healthy: "正常",
  Degraded: "劣化",
  Unavailable: "利用不可",
  Unknown: "不明"
};

export function resourceStatusLabelJa(status: ResourceItem["status"]): string {
  return RESOURCE_STATUS_LABEL_JA[status];
}

/** Maps a resource status to the severity token used for badge/dot styling. "Unknown" is
 * deliberately "info", never "warning" — the health signal is absent, not unhealthy. */
export function resourceStatusSeverity(status: ResourceItem["status"]): Severity {
  if (status === "Healthy") return "healthy";
  if (status === "Degraded") return "warning";
  if (status === "Unavailable") return "critical";
  return "info";
}

const AVAILABILITY_LABEL_JA: Record<Availability, string> = {
  available: "利用可能",
  partial: "一部利用可能",
  unavailable: "利用不可"
};

export function availabilityLabelJa(availability: Availability): string {
  return AVAILABILITY_LABEL_JA[availability];
}

const FLOW_STATUS_LABEL_JA: Record<"Allowed" | "Degraded" | "Blocked", string> = {
  Allowed: "許可",
  Degraded: "劣化",
  Blocked: "遮断"
};

export function flowStatusLabelJa(status: "Allowed" | "Degraded" | "Blocked"): string {
  return FLOW_STATUS_LABEL_JA[status];
}

const RECOMMENDATION_STATUS_LABEL_JA: Record<"Open" | "In progress" | "Resolved", string> = {
  Open: "未対応",
  "In progress": "対応中",
  Resolved: "解決済み"
};

export function recommendationStatusLabelJa(status: "Open" | "In progress" | "Resolved"): string {
  return RECOMMENDATION_STATUS_LABEL_JA[status];
}

export function modeLabelJa(mode: "DEMO" | "AZURE"): string {
  return mode === "DEMO" ? "デモデータ" : "実データ";
}

export function freshnessLabelJa(state: "fresh" | "stale"): string {
  return state === "fresh" ? "最新" : "更新が必要";
}

const dateTimeFormatterJa = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short"
});

/** Renders an ISO timestamp using the ja-JP locale. Returns a neutral placeholder for
 * anything that is not a valid date instead of throwing or showing "Invalid Date". */
export function formatDateTimeJa(iso: string | null | undefined): string {
  if (!iso) return "不明";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return dateTimeFormatterJa.format(date);
}

const numberFormatterJa = new Intl.NumberFormat("ja-JP");

export function formatNumberJa(value: number): string {
  return numberFormatterJa.format(value);
}

/** Renders an age in minutes as a Japanese relative-time phrase (分前 / 時間前 / 日前). */
export function formatRelativeAgeJa(ageMinutes: number): string {
  if (!Number.isFinite(ageMinutes) || ageMinutes < 0) return "不明";
  if (ageMinutes < 1) return "1分未満前";
  if (ageMinutes < 60) return `${Math.round(ageMinutes)}分前`;
  const hours = ageMinutes / 60;
  if (hours < 24) return `${Math.round(hours)}時間前`;
  return `${Math.round(hours / 24)}日前`;
}

export function formatPercentJa(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return "不明";
  const rounded = Number(value.toFixed(digits));
  return `${rounded}%`;
}

export function formatSignedPercentJa(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return "不明";
  const rounded = Number(value.toFixed(digits));
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

/** Describes a percentage change without asserting whether increase/decrease is good or bad —
 * callers decide severity from their own grounded thresholds. */
export function costMovementJa(deltaPercent: number | null): {
  label: string;
  direction: "up" | "down" | "flat";
} {
  if (deltaPercent === null) return { label: "比較対象期間なし", direction: "flat" };
  if (deltaPercent > 0) return { label: "増加", direction: "up" };
  if (deltaPercent < 0) return { label: "減少", direction: "down" };
  return { label: "変化なし", direction: "flat" };
}

export function directionAriaJa(direction: "up" | "down" | "flat"): string {
  if (direction === "up") return "上昇";
  if (direction === "down") return "下降";
  return "変化なし";
}
