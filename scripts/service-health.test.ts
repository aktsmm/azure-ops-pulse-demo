import { describe, expect, it } from "vitest";
import type { SourceStatus } from "../src/data/contracts";
import { summarizeServiceHealth } from "./service-health";

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
      { label: "ServiceIssue", count: 2 },
      { label: "HealthAdvisory", count: 1 }
    ]);
  });

  it("also accepts camelCase REST-shaped rows", () => {
    const summary = summarizeServiceHealth(
      [{ properties: { eventType: "PlannedMaintenance", status: "Active" } }],
      available
    );

    expect(summary.activeEvents).toBe(1);
    expect(summary.categories).toEqual([{ label: "PlannedMaintenance", count: 1 }]);
  });

  it("classifies rows with no usable status without inflating active or resolved counts", () => {
    const summary = summarizeServiceHealth([{ properties: {} }], available);

    expect(summary.activeEvents).toBe(0);
    expect(summary.resolvedEvents).toBe(0);
    expect(summary.categories).toEqual([{ label: "Unclassified", count: 1 }]);
  });

  it("never publishes counts when the collector reported the source unavailable", () => {
    const summary = summarizeServiceHealth(
      [{ properties: { EventType: "ServiceIssue", Status: "Active" } }],
      unavailable
    );

    expect(summary.activeEvents).toBeNull();
    expect(summary.categories).toEqual([]);
  });
});
