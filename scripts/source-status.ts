import type { Availability, SourceReason, SourceStatus } from "../src/data/contracts";
import { collectionFailureReason } from "./collection-diagnostics";

export interface CollectedSource<T> {
  value: T | null;
  status: SourceStatus;
}

export interface CollectionReport {
  availability: Availability;
  message: string;
  reason?: SourceReason;
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
  unavailableMessage: string | ((error: unknown) => string)
): CollectedSource<T> {
  let value: T;
  try {
    value = operation();
  } catch (error) {
    return {
      value: null,
      status: {
        source,
        availability: "unavailable",
        reason: collectionFailureReason(error),
        message: typeof unavailableMessage === "function" ? unavailableMessage(error) : unavailableMessage
      }
    };
  }
  const { availability, message, reason } = report(value);
  return {
    value: availability === "unavailable" ? null : value,
    status: { source, availability, message, ...(reason ? { reason } : {}) }
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
    return { availability: messages.emptyAvailability ?? "unavailable", message: messages.empty, reason: "empty" };
  }
  return { availability: "available", message: messages.collected(count) };
}

export function isPublishable(status: SourceStatus | undefined): boolean {
  return status?.availability === "available" || status?.availability === "partial";
}

export async function collectSourceAsync<T>(
  source: string,
  operation: () => Promise<T>,
  report: (value: T) => CollectionReport,
  unavailableMessage: string | ((error: unknown) => string)
): Promise<CollectedSource<T>> {
  let value: T;
  try {
    value = await operation();
  } catch (error) {
    return collectSource(source, () => { throw error; }, report, unavailableMessage);
  }
  return collectSource(source, () => value, report, unavailableMessage);
}
