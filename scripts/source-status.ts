import type { Availability, SourceStatus } from "../src/data/contracts";

export interface CollectedSource<T> {
  value: T | null;
  status: SourceStatus;
}

export interface CollectionReport {
  availability: Availability;
  message: string;
}

/**
 * Collects an optional source and lets the caller decide how a successful call maps to an
 * availability. A call that succeeds but returns nothing must never be reported as "available";
 * the public snapshot would then claim data was collected while every derived value stays empty.
 */
export function collectSource<T>(
  source: string,
  operation: () => T,
  report: (value: T) => CollectionReport,
  unavailableMessage: string
): CollectedSource<T> {
  let value: T;
  try {
    value = operation();
  } catch {
    return {
      value: null,
      status: { source, availability: "unavailable", message: unavailableMessage }
    };
  }
  const { availability, message } = report(value);
  return {
    value: availability === "unavailable" ? null : value,
    status: { source, availability, message }
  };
}

/**
 * Standard report for sources whose usefulness is decided purely by the number of records.
 * Zero records never maps to `available`: either nothing could be derived (`unavailable`) or the
 * emptiness itself is the published answer (`partial`), and the message says so explicitly.
 */
export function countReport(
  count: number,
  messages: {
    collected: (count: number) => string;
    empty: string;
    emptyAvailability?: Extract<Availability, "partial" | "unavailable">;
  }
): CollectionReport {
  if (count <= 0) {
    return { availability: messages.emptyAvailability ?? "unavailable", message: messages.empty };
  }
  return { availability: "available", message: messages.collected(count) };
}

export function isPublishable(status: SourceStatus | undefined): boolean {
  return status?.availability === "available" || status?.availability === "partial";
}
