/**
 * Azure CLI (`az monitor activity-log list`) serializes `category` and `level` as
 * `{ value, localizedValue }` objects, not plain strings. Interpolating that object
 * directly into a template literal produces the literal text "[object Object]" in
 * published activity titles. These helpers normalize both shapes safely.
 */
export function fieldLabel(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.localizedValue === "string" && record.localizedValue.trim().length > 0) {
      return record.localizedValue;
    }
    if (typeof record.value === "string" && record.value.trim().length > 0) {
      return record.value;
    }
  }
  return undefined;
}

export function activityEventTitle(category: unknown): string {
  return `${fieldLabel(category) ?? "Azure"} のアクティビティを検出`;
}

export function activityEventSeverity(level: unknown): "warning" | "info" {
  return fieldLabel(level) === "Error" ? "warning" : "info";
}
