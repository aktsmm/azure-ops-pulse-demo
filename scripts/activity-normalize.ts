/**
 * Normalizes Azure Activity Log `category` values for privacy-safe, human-readable event titles.
 *
 * `az monitor activity-log list` returns `category` as an Azure LocalizableValue object
 * (`{ value: string; localizedValue: string }`), not a plain string. Interpolating that object
 * directly into a template string (`${event.category}`) previously produced the literal text
 * "[object Object] activity observed" in the published snapshot. This module extracts the
 * canonical string safely and maps it to a small, closed, privacy-safe Japanese label set —
 * no actor, resource, or operation-level detail is ever included.
 */

export type ActivityLogCategory =
  | "Administrative"
  | "Alert"
  | "Autoscale"
  | "Policy"
  | "Recommendation"
  | "ResourceHealth"
  | "Security"
  | "ServiceHealth"
  | "Unknown";

const KNOWN_CATEGORIES: readonly ActivityLogCategory[] = [
  "Administrative",
  "Alert",
  "Autoscale",
  "Policy",
  "Recommendation",
  "ResourceHealth",
  "Security",
  "ServiceHealth"
];

interface LocalizableValueLike {
  value?: unknown;
  localizedValue?: unknown;
}

function extractCategoryText(category: unknown): string {
  if (typeof category === "string") return category;
  if (category !== null && typeof category === "object") {
    const candidate = category as LocalizableValueLike;
    const value = candidate.value ?? candidate.localizedValue;
    if (typeof value === "string") return value;
  }
  return "";
}

/** Extracts a known Activity Log category from a raw Azure CLI value, which may be a plain
 * string or a LocalizableValue object. Never returns the object itself or a stringified object;
 * unrecognized input becomes "Unknown" rather than being guessed at. */
export function normalizeActivityCategory(category: unknown): ActivityLogCategory {
  const text = extractCategoryText(category).trim();
  const match = KNOWN_CATEGORIES.find(
    (candidate) => candidate.toLowerCase() === text.toLowerCase()
  );
  return match ?? "Unknown";
}

const ACTIVITY_CATEGORY_LABEL_JA: Record<ActivityLogCategory, string> = {
  Administrative: "管理操作",
  Alert: "アラート",
  Autoscale: "自動スケール",
  Policy: "ポリシー",
  Recommendation: "推奨事項",
  ResourceHealth: "リソースの状態",
  Security: "セキュリティ",
  ServiceHealth: "サービスの状態",
  Unknown: "Azure"
};

/** Builds the Japanese, privacy-safe activity title for the overview event timeline. Never
 * includes the raw category object, actor, resource, or operation name. */
export function activityTitleJa(category: unknown): string {
  const label = ACTIVITY_CATEGORY_LABEL_JA[normalizeActivityCategory(category)];
  return `${label}のアクティビティを検知`;
}
