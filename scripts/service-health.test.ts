import { describe, expect, it } from "vitest";
import type { SourceStatus } from "../src/data/contracts";
import { aggregateServiceHealthCategories, summarizeServiceHealth } from "./service-health";
import {
  SERVICE_HEALTH_EVENT_TYPE_LABELS,
  UNKNOWN_SERVICE_HEALTH_EVENT_TYPE_LABEL,
  localizeServiceHealthEventType
} from "./service-health-event-types";

const available: SourceStatus = {
  source: "Service Health",
  availability: "available",
  message: "Service Health returned 3 events in aggregate."
};
const partial: SourceStatus = {
  source: "Service Health",
  availability: "partial",
  message: "Service Health returned 0 events for the collected window."
};
const unavailable: SourceStatus = {
  source: "Service Health",
  availability: "unavailable",
  message: "Service Health events are unavailable."
};

describe("summarizeServiceHealth", () => {
  it("publishes null counts when the source is unavailable", () => {
    expect(summarizeServiceHealth(null, unavailable)).toEqual({
      availability: "unavailable",
      message: unavailable.message,
      activeEvents: null,
      resolvedEvents: null,
      categories: []
    });
  });

  it("publishes explicit zeros when the query worked but found no events", () => {
    expect(summarizeServiceHealth([], partial)).toEqual({
      availability: "partial",
      message: partial.message,
      activeEvents: 0,
      resolvedEvents: 0,
      categories: []
    });
  });

  it("aggregates PascalCase Resource Graph rows into counts only", () => {
    const summary = summarizeServiceHealth(
      [
        { properties: { EventType: "ServiceIssue", Status: "Resolved" } },
        { properties: { EventType: "ServiceIssue", Status: "Resolved" } },
        { properties: { EventType: "HealthAdvisory", Status: "Active" } }
      ],
      available
    );

    expect(summary.activeEvents).toBe(1);
    expect(summary.resolvedEvents).toBe(2);
    expect(summary.categories).toEqual([
      { label: localizeServiceHealthEventType("ServiceIssue"), count: 2 },
      { label: localizeServiceHealthEventType("HealthAdvisory"), count: 1 }
    ]);
  });

  it("also accepts camelCase REST-shaped rows", () => {
    const summary = summarizeServiceHealth(
      [{ properties: { eventType: "PlannedMaintenance", status: "Active" } }],
      available
    );

    expect(summary.activeEvents).toBe(1);
    expect(summary.categories).toEqual([
      { label: localizeServiceHealthEventType("PlannedMaintenance"), count: 1 }
    ]);
  });

  it("classifies rows with no usable status without inflating active or resolved counts", () => {
    const summary = summarizeServiceHealth([{ properties: {} }], available);

    expect(summary.activeEvents).toBe(0);
    expect(summary.resolvedEvents).toBe(0);
    expect(summary.categories).toEqual([
      { label: UNKNOWN_SERVICE_HEALTH_EVENT_TYPE_LABEL, count: 1 }
    ]);
  });

  it("never publishes counts when the collector reported the source unavailable", () => {
    const summary = summarizeServiceHealth(
      [{ properties: { EventType: "ServiceIssue", Status: "Active" } }],
      unavailable
    );

    expect(summary.activeEvents).toBeNull();
    expect(summary.categories).toEqual([]);
  });

  /**
   * The reason the collector translates at all: the page prints `category.label` verbatim, and an
   * insight that quotes what the reader saw has to pass the same language audit. Asserting on the
   * shape of every label rather than on specific translations means the guard survives a change to
   * the wording, and it covers members this file does not enumerate.
   */
  it("publishes no Latin-script label for any event type, known or not", () => {
    const summary = summarizeServiceHealth(
      [
        { properties: { EventType: "ServiceIssue", Status: "Active" } },
        { properties: { EventType: "Billing", Status: "Active" } },
        { properties: { EventType: "EmergingIssues", Status: "Active" } },
        { properties: { EventType: "SecurityAdvisory", Status: "Active" } },
        { properties: { EventType: "RCA", Status: "Resolved" } },
        // A member added to the open enumeration after this file was written.
        { properties: { EventType: "SomeFutureEventType", Status: "Active" } },
        { properties: { EventType: "   ", Status: "Active" } },
        { properties: { EventType: null, Status: "Active" } }
      ],
      available
    );

    expect(summary.categories.length).toBeGreaterThan(0);
    for (const category of summary.categories) {
      expect(category.label).not.toMatch(/[A-Za-z]/u);
      expect(SERVICE_HEALTH_EVENT_TYPE_LABELS).toContain(category.label);
    }
  });

  /**
   * `RCA` and `Post Incident Review` are one classification under two names, so their counts have to
   * land on one row. A mapping that kept them apart would publish the same thing twice.
   */
  it("merges event types that share a classification", () => {
    const summary = summarizeServiceHealth(
      [
        { properties: { EventType: "RCA", Status: "Resolved" } },
        { properties: { EventType: "PostIncidentReview", Status: "Resolved" } },
        { properties: { EventType: "Post Incident Review", Status: "Resolved" } }
      ],
      available
    );

    expect(summary.categories).toEqual([
      { label: localizeServiceHealthEventType("RCA"), count: 3 }
    ]);
  });

  /**
   * The migration has to reproduce a future collection byte for byte, so the order of equal counts
   * cannot depend on input order or on the host's collation data.
   */
  it("orders ties the same way regardless of the order events arrive in", () => {
    const forward = summarizeServiceHealth(
      [
        { properties: { EventType: "HealthAdvisory", Status: "Active" } },
        { properties: { EventType: "ServiceIssue", Status: "Active" } },
        { properties: { EventType: "Billing", Status: "Active" } }
      ],
      available
    );
    const reversed = summarizeServiceHealth(
      [
        { properties: { EventType: "Billing", Status: "Active" } },
        { properties: { EventType: "ServiceIssue", Status: "Active" } },
        { properties: { EventType: "HealthAdvisory", Status: "Active" } }
      ],
      available
    );

    expect(reversed.categories).toEqual(forward.categories);
    const ranks = forward.categories.map((category) =>
      SERVICE_HEALTH_EVENT_TYPE_LABELS.indexOf(category.label)
    );
    expect(ranks).toEqual([...ranks].sort((left, right) => left - right));
  });
});

describe("localizeServiceHealthEventType", () => {
  /**
   * The exemption this change removed was an allowlist that had drifted from the enumeration it was
   * supposed to mirror: `Billing` and `EmergingIssues` were never on it, so one billing notification
   * would have failed `validate:data` and stopped the whole snapshot, not just the insights. This
   * fixture is Azure's documented member list, not a value read from published data, and it is what
   * stops the mapping drifting the same way:
   * https://learn.microsoft.com/azure/governance/resource-graph/reference/supported-tables-resources
   */
  const DOCUMENTED_EVENT_TYPES = [
    "ServiceIssue",
    "PlannedMaintenance",
    "HealthAdvisory",
    "Billing",
    "SecurityAdvisory",
    "EmergingIssues",
    "RCA"
  ] as const;

  it.each(DOCUMENTED_EVENT_TYPES)("translates %s rather than falling back", (eventType) => {
    const label = localizeServiceHealthEventType(eventType);

    expect(label).not.toBe(UNKNOWN_SERVICE_HEALTH_EVENT_TYPE_LABEL);
    expect(label).not.toMatch(/[A-Za-z]/u);
  });

  it("gives every documented member a label, and the fallback to nothing else", () => {
    const labels = DOCUMENTED_EVENT_TYPES.map((eventType) =>
      localizeServiceHealthEventType(eventType)
    );

    expect(new Set(labels).size).toBe(SERVICE_HEALTH_EVENT_TYPE_LABELS.length - 1);
  });

  it("falls back rather than returning its argument", () => {
    expect(localizeServiceHealthEventType("SomeFutureEventType")).toBe(
      UNKNOWN_SERVICE_HEALTH_EVENT_TYPE_LABEL
    );
    expect(localizeServiceHealthEventType("")).toBe(UNKNOWN_SERVICE_HEALTH_EVENT_TYPE_LABEL);
    expect(localizeServiceHealthEventType(undefined)).toBe(
      UNKNOWN_SERVICE_HEALTH_EVENT_TYPE_LABEL
    );
    expect(localizeServiceHealthEventType(42)).toBe(UNKNOWN_SERVICE_HEALTH_EVENT_TYPE_LABEL);
  });

  /** What makes the migration safe to re-run. */
  it("maps each label it can produce to itself", () => {
    for (const label of SERVICE_HEALTH_EVENT_TYPE_LABELS) {
      expect(localizeServiceHealthEventType(label)).toBe(label);
    }
  });
});

describe("aggregateServiceHealthCategories", () => {
  /**
   * This is the property the migration relies on. `scripts/normalize-service-health-categories.ts`
   * hands the function one pre-aggregated `(label, n)` pair where a collection hands it `n` separate
   * `(eventType, 1)` pairs. If those two ever produced different output, a migrated snapshot would
   * differ from the next real collection.
   */
  it("gives the same result for per-event and pre-aggregated input", () => {
    const perEvent = aggregateServiceHealthCategories([
      ["ServiceIssue", 1],
      ["ServiceIssue", 1],
      ["ServiceIssue", 1],
      ["HealthAdvisory", 1],
      ["Billing", 1]
    ]);
    const preAggregated = aggregateServiceHealthCategories([
      ["ServiceIssue", 3],
      ["HealthAdvisory", 1],
      ["Billing", 1]
    ]);

    expect(preAggregated).toEqual(perEvent);
  });

  /**
   * Idempotence is what lets the migration run over an already-migrated file. It holds because the
   * mapping accepts its own output, so a Japanese label does not fall through to the fallback.
   */
  it("is idempotent over its own output", () => {
    const once = aggregateServiceHealthCategories([
      ["ServiceIssue", 3],
      ["SomeFutureEventType", 1],
      ["", 1]
    ]);
    const twice = aggregateServiceHealthCategories(
      once.map((category) => [category.label, category.count] as const)
    );

    expect(twice).toEqual(once);
  });
});
