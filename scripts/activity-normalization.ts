export type AzureActivityLabel =
  | string
  | {
      value?: unknown;
      localizedValue?: unknown;
    }
  | null;

export interface AzureActivityEvent {
  category?: AzureActivityLabel;
  operationName?: AzureActivityLabel;
  level?: string;
  eventTimestamp?: string;
}

const SENSITIVE_TOKEN =
  /\b(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:\d{1,3}\.){3}\d{1,3})\b/i;

function readLabel(label: AzureActivityLabel | undefined): string | null {
  if (typeof label === "string") return label;
  if (!label || typeof label !== "object" || Array.isArray(label)) return null;
  if (typeof label.localizedValue === "string") return label.localizedValue;
  if (typeof label.value === "string") return label.value;
  return null;
}

export function normalizeActivityOperationLabel(event: AzureActivityEvent): string {
  const candidate = readLabel(event.operationName) ?? readLabel(event.category);
  if (!candidate) return "Azure 操作";
  const normalized = [...candidate]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? " " : character;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || normalized === "[object Object]" || SENSITIVE_TOKEN.test(normalized)) {
    return "Azure 操作";
  }
  return normalized.slice(0, 96);
}
