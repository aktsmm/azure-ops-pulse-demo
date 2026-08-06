import type { ServiceHealthSummary, SourceStatus } from "../src/data/contracts";
import {
  SERVICE_HEALTH_EVENT_TYPE_LABELS,
  localizeServiceHealthEventType
} from "./service-health-event-types";

export interface ServiceHealthEventRecord {
  properties?: {
    EventType?: string | null;
    Status?: string | null;
    EventLevel?: string | null;
    // Resource Graph returns PascalCase keys, but the underlying REST models use camelCase.
    eventType?: string | null;
    status?: string | null;
    eventLevel?: string | null;
  } | null;
}

/**
 * Returns the classification as the service spelled it, untranslated on purpose.
 * `aggregateServiceHealthCategories` is the single place the mapping is applied, so there is exactly
 * one site to audit and no second call that could mask a regression at the first. A missing value
 * becomes the empty string and reaches the same fallback as an unrecognised one, which is why the
 * collector no longer needs to invent an `"Unclassified"` of its own.
 */
function readEventType(event: ServiceHealthEventRecord): string {
  const value = event.properties?.EventType ?? event.properties?.eventType;
  return typeof value === "string" ? value : "";
}

/**
 * Ties are broken by the canonical label order rather than by collating the labels, so the result
 * does not depend on the host's ICU data. A label outside that order cannot occur —
 * `localizeServiceHealthEventType` is total — but is sorted last rather than silently sharing an
 * index with everything else, which would make the order depend on insertion.
 */
function categoryRank(label: string): number {
  const index = SERVICE_HEALTH_EVENT_TYPE_LABELS.indexOf(label);
  return index === -1 ? SERVICE_HEALTH_EVENT_TYPE_LABELS.length : index;
}

/**
 * Localises, merges and orders category counts.
 *
 * The collector feeds it one entry per event and `scripts/normalize-service-health-categories.ts`
 * feeds it the already-aggregated counts of a published snapshot. Sharing this function is what
 * makes the migration reproduce a collection rather than approximate one: counting `n` events of a
 * type and adding `n` in one step reach the same map, and the same merge and the same order follow.
 * Merging matters because the mapping is many-to-one — `RCA` and `PostIncidentReview` are one
 * classification, and any unrecognised member joins the fallback.
 */
export function aggregateServiceHealthCategories(
  entries: Iterable<readonly [string, number]>
): ServiceHealthSummary["categories"] {
  const counts = new Map<string, number>();
  for (const [eventType, count] of entries) {
    const label = localizeServiceHealthEventType(eventType);
    counts.set(label, (counts.get(label) ?? 0) + count);
  }

  return [...counts]
    .sort((left, right) => right[1] - left[1] || categoryRank(left[0]) - categoryRank(right[0]))
    .map(([label, count]) => ({ label, count }));
}

function readStatus(event: ServiceHealthEventRecord): "Active" | "Resolved" | "Unknown" {
  const value = (event.properties?.Status ?? event.properties?.status ?? "").toString().trim();
  if (value.toLowerCase() === "active") return "Active";
  if (value.toLowerCase() === "resolved") return "Resolved";
  return "Unknown";
}

/**
 * Aggregates Service Health events into counts only. Titles, tracking IDs, and impacted resources
 * stay out of the public snapshot. Availability is decided by the collector so the summary can
 * never disagree with the reported source status.
 */
export function summarizeServiceHealth(
  events: readonly ServiceHealthEventRecord[] | null,
  status: SourceStatus
): ServiceHealthSummary {
  if (events === null || status.availability === "unavailable") {
    return {
      availability: "unavailable",
      message: status.message,
      activeEvents: null,
      resolvedEvents: null,
      categories: []
    };
  }
  if (events.length === 0) {
    return {
      availability: status.availability,
      message: status.message,
      activeEvents: 0,
      resolvedEvents: 0,
      categories: []
    };
  }

  let activeEvents = 0;
  let resolvedEvents = 0;
  const entries: Array<readonly [string, number]> = [];
  for (const event of events) {
    const eventStatus = readStatus(event);
    if (eventStatus === "Active") activeEvents += 1;
    if (eventStatus === "Resolved") resolvedEvents += 1;
    entries.push([readEventType(event), 1]);
  }

  return {
    availability: status.availability,
    message: `Service Health reported ${events.length} events in aggregate (${activeEvents} active, ${resolvedEvents} resolved).`,
    activeEvents,
    resolvedEvents,
    categories: aggregateServiceHealthCategories(entries)
  };
}
