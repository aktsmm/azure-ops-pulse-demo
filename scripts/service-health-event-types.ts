/**
 * Japanese labels for the Service Health `EventType` classification.
 *
 * `EventType` is an Azure enumeration, and the collector used to publish it verbatim. That made one
 * string legal as a field and fatal as a quotation: `ui-language-audit.ts` exempted
 * `reliability.serviceHealth.categories[].label` by name, so `"ServiceIssue"` passed there, reached
 * the Japanese page through `<strong>{category.label}</strong>`, and then failed the audit the
 * moment an insight quoted the label the reader had just been shown. Three collections in a row
 * published a dashboard with no `aiInsights` because of it.
 *
 * Translating at the collector removes the asymmetry rather than widening the exemption: the value
 * in the file is the value on the page is the value an insight may quote, and all three are
 * Japanese. `scripts/activity-normalization.ts` does the same for Activity Log operation names.
 *
 * The second reason is that the exemption's allowlist was not the enumeration. It listed
 * `ServiceIssue|HealthAdvisory|PlannedMaintenance|SecurityAdvisory|RCA` while the service also
 * returns `Billing` and `EmergingIssues`, and `readEventType` invented `"Unclassified"` for a blank
 * one — so a single billing notification would have failed `validate:data` and stopped the whole
 * snapshot, not just the insights. A total function with a Japanese fallback cannot have that gap.
 *
 * Sources:
 *
 * - `EventType` members and their Japanese glosses:
 *   https://learn.microsoft.com/ja-jp/azure/service-health/azure-resource-graph-overview#service-health
 * - The names the Japanese Azure portal uses for the same five event kinds, preferred wherever the
 *   portal has one, because they are what a reader recognises on screen:
 *   https://learn.microsoft.com/ja-jp/azure/service-health/service-health-portal-update
 * - The wire enumeration is open (`type EventTypeValues = string`) and still contains `RCA`, which
 *   is why `RCA` is mapped rather than dropped and why an unknown member must stay expected:
 *   https://learn.microsoft.com/en-us/javascript/api/@azure/arm-resourcehealth/knowneventtypevalues?view=azure-node-latest
 */

interface ServiceHealthEventTypeMapping {
  /** Wire values Azure may return for this classification. */
  readonly eventTypes: readonly string[];
  readonly label: string;
}

/**
 * `RCA` and `Post Incident Review` are the same classification under two names. The REST SDK's
 * `KnownEventTypeValues` still ships `RCA` and has no `PostIncidentReview` member, so `RCA` is what
 * the service returns today and dropping it would send a real event to the fallback. The Resource
 * Graph reference documents the classification under the newer name, so both spellings are mapped
 * onto the one Japanese label and their counts merge.
 */
const SERVICE_HEALTH_EVENT_TYPE_MAPPINGS: readonly ServiceHealthEventTypeMapping[] = [
  { eventTypes: ["ServiceIssue"], label: "サービスの問題" },
  { eventTypes: ["PlannedMaintenance"], label: "計画メンテナンス" },
  { eventTypes: ["HealthAdvisory"], label: "正常性アドバイザリ" },
  { eventTypes: ["SecurityAdvisory"], label: "セキュリティ アドバイザリ" },
  { eventTypes: ["Billing"], label: "課金の更新" },
  { eventTypes: ["EmergingIssues"], label: "新たな問題" },
  {
    eventTypes: ["RCA", "PostIncidentReview", "Post Incident Review", "PIR"],
    label: "事後インシデント レビュー"
  }
];

/**
 * Where a blank or unrecognised `EventType` lands. It replaces the English `"Unclassified"` the
 * collector used to invent, and it is deliberately not a passthrough: `EventTypeValues` is an open
 * enumeration, so a member added after this file was written must still reach the page in Japanese.
 * The count is still published, so an unfamiliar classification is visible rather than dropped.
 *
 * The wording follows `src/lib/display-formatters.ts`, which already renders the sanitizer's
 * `"Unclassified service endpoint"` as `"分類できないエンドポイント"`.
 */
export const UNKNOWN_SERVICE_HEALTH_EVENT_TYPE_LABEL = "分類できないイベント";

/**
 * Every label this module can produce, in the order the collector breaks count ties on. The order is
 * this list rather than a collation of the strings: `localeCompare` on Japanese depends on the ICU
 * data the host happens to ship, and a migration that has to reproduce a collection byte for byte
 * cannot depend on that.
 */
export const SERVICE_HEALTH_EVENT_TYPE_LABELS: readonly string[] = [
  ...SERVICE_HEALTH_EVENT_TYPE_MAPPINGS.map((mapping) => mapping.label),
  UNKNOWN_SERVICE_HEALTH_EVENT_TYPE_LABEL
];

function lookupKey(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Both the wire values and the labels themselves resolve to a label.
 *
 * Accepting a label as input is what makes this function idempotent, and idempotence is what lets
 * `scripts/normalize-service-health-categories.ts` run over an already-migrated snapshot without
 * sending every Japanese label it finds to the fallback. It also means the collector and the
 * migration agree on any input either can see.
 */
const LABELS_BY_KEY = new Map<string, string>(
  SERVICE_HEALTH_EVENT_TYPE_MAPPINGS.flatMap((mapping) =>
    [...mapping.eventTypes, mapping.label].map(
      (value) => [lookupKey(value), mapping.label] as const
    )
  )
);
LABELS_BY_KEY.set(
  lookupKey(UNKNOWN_SERVICE_HEALTH_EVENT_TYPE_LABEL),
  UNKNOWN_SERVICE_HEALTH_EVENT_TYPE_LABEL
);

/**
 * Total by construction: every input, including a missing one, produces a Japanese label. Nothing
 * here can return its argument, so no Azure spelling can reach the page by passing through.
 */
export function localizeServiceHealthEventType(eventType: unknown): string {
  if (typeof eventType !== "string") return UNKNOWN_SERVICE_HEALTH_EVENT_TYPE_LABEL;
  return LABELS_BY_KEY.get(lookupKey(eventType)) ?? UNKNOWN_SERVICE_HEALTH_EVENT_TYPE_LABEL;
}
