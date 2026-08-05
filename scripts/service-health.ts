import type { ServiceHealthSummary, SourceStatus } from "../src/data/contracts";

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

function readEventType(event: ServiceHealthEventRecord): string {
  const value = event.properties?.EventType ?? event.properties?.eventType;
  return typeof value === "string" && value.trim() ? value.trim() : "Unclassified";
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
  const categories = new Map<string, number>();
  for (const event of events) {
    const eventStatus = readStatus(event);
    if (eventStatus === "Active") activeEvents += 1;
    if (eventStatus === "Resolved") resolvedEvents += 1;
    const label = readEventType(event);
    categories.set(label, (categories.get(label) ?? 0) + 1);
  }

  return {
    availability: status.availability,
    message: `Service Health reported ${events.length} events in aggregate (${activeEvents} active, ${resolvedEvents} resolved).`,
    activeEvents,
    resolvedEvents,
    categories: [...categories]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([label, count]) => ({ label, count }))
  };
}
