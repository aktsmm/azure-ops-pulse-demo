import { describe, expect, it } from "vitest";
import { createDemoRawSnapshot } from "../../scripts/demo-data";
import { sanitizeSnapshot } from "./sanitize";
import { buildActionQueue } from "./action-queue";

describe("evidence-based action queue", () => {
  it("returns no items when the snapshot shows no concrete problem signal", () => {
    const raw = createDemoRawSnapshot();
    raw.security.recommendations = raw.security.recommendations.filter(
      (item) => item.status === "Resolved"
    );
    raw.resources = raw.resources.map((resource) => ({ ...resource, status: "Healthy" }));
    raw.exactCostJpy = 100;
    raw.exactPreviousCostJpy = 100;
    raw.networkTelemetry.flows = raw.networkTelemetry.flows.filter(
      (flow) => flow.status === "Allowed"
    );
    raw.aiInsights = [];
    raw.sources = raw.sources.map((source) => ({ ...source, availability: "available" }));

    const snapshot = sanitizeSnapshot(raw);
    expect(buildActionQueue(snapshot)).toEqual([]);
  });

  it("never treats Unknown resource health as an actionable problem", () => {
    const raw = createDemoRawSnapshot();
    raw.resources = raw.resources.map((resource) => ({ ...resource, status: "Unknown" }));
    raw.security.recommendations = [];
    raw.exactCostJpy = 100;
    raw.exactPreviousCostJpy = 100;
    raw.networkTelemetry.availability = "unavailable";
    raw.networkTelemetry.flows = [];
    raw.aiInsights = [];
    raw.sources = raw.sources.map((source) => ({ ...source, availability: "available" }));

    const snapshot = sanitizeSnapshot(raw);
    const items = buildActionQueue(snapshot);
    expect(items.some((item) => item.id === "inventory-degraded")).toBe(false);
  });

  it("surfaces unavailable sources with a route matching the affected page", () => {
    const raw = createDemoRawSnapshot();
    raw.sources = raw.sources.map((source) =>
      source.source === "Defender for Cloud"
        ? { ...source, availability: "unavailable" as const, message: "Defender is unavailable." }
        : source
    );
    const snapshot = sanitizeSnapshot(raw);
    const items = buildActionQueue(snapshot);
    const item = items.find((entry) => entry.id === "source-Defender for Cloud");
    expect(item).toBeDefined();
    expect(item?.route).toBe("/security");
    expect(item?.detail).toBe("Defender is unavailable.");
  });

  it("routes a Japanese-language network source name to the network page", () => {
    const raw = createDemoRawSnapshot();
    raw.sources = raw.sources.map((source) =>
      source.source === "ネットワークインベントリ"
        ? { ...source, availability: "unavailable" as const }
        : source
    );
    const snapshot = sanitizeSnapshot(raw);
    const item = buildActionQueue(snapshot).find(
      (entry) => entry.id === "source-ネットワークインベントリ"
    );
    expect(item).toBeDefined();
    expect(item?.route).toBe("/network");
  });

  it("routes an unavailable Azure Resource Graph source to the resources page", () => {
    const raw = createDemoRawSnapshot();
    raw.sources = raw.sources.map((source) =>
      source.source === "Azure Resource Graph"
        ? { ...source, availability: "unavailable" as const }
        : source
    );
    const snapshot = sanitizeSnapshot(raw);
    const item = buildActionQueue(snapshot).find(
      (entry) => entry.id === "source-Azure Resource Graph"
    );
    expect(item).toBeDefined();
    expect(item?.route).toBe("/resources");
  });

  it("flags degraded and unavailable resources with counts in the title", () => {
    const raw = createDemoRawSnapshot();
    raw.resources[0]!.status = "Unavailable";
    raw.resources[1]!.status = "Degraded";
    const snapshot = sanitizeSnapshot(raw);
    const item = buildActionQueue(snapshot).find((entry) => entry.id === "inventory-degraded");
    expect(item?.severity).toBe("critical");
    expect(item?.title).toContain("利用不可 1 件");
    expect(item?.title).toContain("劣化");
    expect(item?.route).toBe("/resources");
  });

  it("flags open security recommendations and raises severity for critical items", () => {
    const raw = createDemoRawSnapshot();
    const snapshot = sanitizeSnapshot(raw);
    const item = buildActionQueue(snapshot).find((entry) => entry.id === "security-recommendations");
    expect(item?.severity).toBe("critical");
    expect(item?.route).toBe("/security");
  });

  it("flags a large cost increase above the threshold with the exact percentage", () => {
    const raw = createDemoRawSnapshot();
    raw.exactCostJpy = 200;
    raw.exactPreviousCostJpy = 100;
    const snapshot = sanitizeSnapshot(raw);
    const item = buildActionQueue(snapshot).find((entry) => entry.id === "cost-delta");
    expect(item).toBeDefined();
    expect(item?.title).toContain("+100%");
    expect(item?.route).toBe("/cost");
  });

  it("does not flag a small cost movement", () => {
    const raw = createDemoRawSnapshot();
    raw.exactCostJpy = 105;
    raw.exactPreviousCostJpy = 100;
    raw.security.recommendations = [];
    const snapshot = sanitizeSnapshot(raw);
    expect(buildActionQueue(snapshot).some((entry) => entry.id === "cost-delta")).toBe(false);
  });

  it("surfaces critical AI insights directly using the insight's own route", () => {
    const raw = createDemoRawSnapshot();
    const snapshot = sanitizeSnapshot(raw);
    const criticalInsight = raw.aiInsights.find((insight) => insight.severity === "critical")!;
    const item = buildActionQueue(snapshot).find(
      (entry) => entry.title === criticalInsight.title
    );
    expect(item).toBeDefined();
    expect(item?.route).toBe(criticalInsight.route);
  });

  it("sorts critical items before warning items and caps the result at the limit", () => {
    const raw = createDemoRawSnapshot();
    raw.resources[0]!.status = "Unavailable";
    raw.exactCostJpy = 300;
    raw.exactPreviousCostJpy = 100;
    const snapshot = sanitizeSnapshot(raw);
    const items = buildActionQueue(snapshot, 2);
    expect(items.length).toBeLessThanOrEqual(2);
    expect(items[0]!.severity).toBe("critical");
  });
});
