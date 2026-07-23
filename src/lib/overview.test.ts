import { describe, expect, it } from "vitest";
import { createDemoRawSnapshot } from "../../scripts/demo-data";
import { sanitizeSnapshot } from "./sanitize";
import {
  buildActionQueue,
  resourceStatusCoverage,
  sourceCoverageSummary
} from "./overview";

describe("grounded overview derivations", () => {
  it("builds one action item per AI insight, using its own recommendation and route", () => {
    const snapshot = sanitizeSnapshot(createDemoRawSnapshot());
    const queue = buildActionQueue(snapshot);
    const insightIds = new Set(snapshot.aiInsights.map((insight) => `insight-${insight.id}`));
    const queueInsightItems = queue.filter((item) => insightIds.has(item.id));
    expect(queueInsightItems).toHaveLength(snapshot.aiInsights.length);
    for (const insight of snapshot.aiInsights) {
      const item = queue.find((entry) => entry.id === `insight-${insight.id}`);
      expect(item?.detail).toBe(insight.recommendedAction);
      expect(item?.route).toBe(insight.route);
    }
  });

  it("flags a large cost delta only when it is at or above the 20% threshold", () => {
    const raw = createDemoRawSnapshot();
    raw.exactCostJpy = 200_000;
    raw.exactPreviousCostJpy = 100_000; // +100%
    const snapshot = sanitizeSnapshot(raw);
    const queue = buildActionQueue(snapshot);
    expect(queue.some((item) => item.id === "cost-delta")).toBe(true);

    const rawSmall = createDemoRawSnapshot();
    rawSmall.exactCostJpy = 105_000;
    rawSmall.exactPreviousCostJpy = 100_000; // +5%
    const smallSnapshot = sanitizeSnapshot(rawSmall);
    const smallQueue = buildActionQueue(smallSnapshot);
    expect(smallQueue.some((item) => item.id === "cost-delta")).toBe(false);
  });

  it("surfaces every non-available source as its own action item without inventing severity", () => {
    const raw = createDemoRawSnapshot();
    raw.sources = [
      { source: "Defender for Cloud", availability: "partial", message: "Partial only." },
      { source: "Network inventory", availability: "unavailable", message: "No access." }
    ];
    const snapshot = sanitizeSnapshot(raw);
    const queue = buildActionQueue(snapshot);
    expect(queue.some((item) => item.id === "source-Defender for Cloud")).toBe(true);
    expect(queue.some((item) => item.id === "source-Network inventory")).toBe(true);
  });

  it("adds a single grounded action when regions have no health coverage, and none when all regions are known", () => {
    const raw = createDemoRawSnapshot();
    raw.regionalHealth = [{ region: "Japan East", score: 0, status: "info", coverage: "unknown" }];
    const snapshot = sanitizeSnapshot(raw);
    const queue = buildActionQueue(snapshot);
    expect(queue.filter((item) => item.id === "regions-unknown-coverage")).toHaveLength(1);

    const knownRaw = createDemoRawSnapshot();
    const knownSnapshot = sanitizeSnapshot(knownRaw);
    const knownQueue = buildActionQueue(knownSnapshot);
    expect(knownQueue.some((item) => item.id === "regions-unknown-coverage")).toBe(false);
  });

  it("sorts the action queue by severity, most severe first", () => {
    const snapshot = sanitizeSnapshot(createDemoRawSnapshot());
    const queue = buildActionQueue(snapshot);
    const ranks = { critical: 0, warning: 1, info: 2 } as const;
    for (let index = 1; index < queue.length; index += 1) {
      expect(ranks[queue[index - 1]!.severity]).toBeLessThanOrEqual(ranks[queue[index]!.severity]);
    }
  });

  it("summarizes source coverage counts without altering the underlying data", () => {
    const snapshot = sanitizeSnapshot(createDemoRawSnapshot());
    const summary = sourceCoverageSummary(snapshot.sources);
    expect(summary.total).toBe(snapshot.sources.length);
    expect(summary.available + summary.partial + summary.unavailable).toBe(summary.total);
  });

  it("counts resource status coverage and never merges Unknown into an unhealthy bucket", () => {
    const snapshot = sanitizeSnapshot(createDemoRawSnapshot());
    const coverage = resourceStatusCoverage(snapshot.inventory.resources);
    expect(coverage.total).toBe(snapshot.inventory.resources.length);
    expect(coverage.healthy + coverage.degraded + coverage.unavailable + coverage.unknown).toBe(
      coverage.total
    );
  });
});
