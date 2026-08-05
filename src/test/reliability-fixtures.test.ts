import { describe, expect, it } from "vitest";
import { publicSnapshotSchema } from "../../scripts/public-schema";
import {
  publishedSnapshot,
  reliabilityFixture,
  withDefenderUnavailable
} from "./reliability-fixtures";

/**
 * A fixture that violates the published contract would let a UI test pass on data Azure Ops Pulse
 * can never publish, which is the same class of bug this suite exists to catch. Every shape the UI
 * tests render is therefore parsed with the runtime schema first.
 */
describe("reliability fixtures", () => {
  const collectorShapes = {
    "nothing evaluated yet": reliabilityFixture({
      supported: 14,
      evaluated: 0,
      notApplicable: 48
    }),
    "partially evaluated with failures": reliabilityFixture({
      supported: 14,
      evaluated: 10,
      degraded: 2,
      notApplicable: 48
    }),
    "fully evaluated": reliabilityFixture({ supported: 4, evaluated: 4 }),
    "network resources awaiting a state": reliabilityFixture({
      supported: 4,
      evaluated: 4,
      networkSupported: 3,
      networkEvaluated: 1,
      networkNotApplicable: 6
    }),
    "network metrics collected": reliabilityFixture({
      supported: 4,
      evaluated: 4,
      networkNotApplicable: 10,
      metricCoverage: {
        inventoryTotal: 10,
        sampledResources: 10,
        metricCapableResources: 3,
        metricSeries: 5,
        notApplicableResources: 7,
        failedResources: 0
      }
    })
  };

  for (const [name, snapshot] of Object.entries(collectorShapes)) {
    it(`publishes a contract-valid snapshot for ${name}`, () => {
      expect(() => publicSnapshotSchema.parse(snapshot)).not.toThrow();
    });
  }

  it("publishes a contract-valid snapshot for legacy data without metric coverage", () => {
    // Snapshots taken before metric coverage existed still render through the UI fallback, so the
    // shape stays covered even though the current collector can no longer produce it.
    const legacy = reliabilityFixture({
      supported: 4,
      evaluated: 4,
      networkNotApplicable: 6,
      metricCoverage: null
    });
    expect(legacy.network.inventory.total).toBeGreaterThan(0);
    expect(legacy.network.metricCoverage).toBeNull();
    expect(() => publicSnapshotSchema.parse(legacy)).not.toThrow();
  });

  it("derives the Resource Health source status the collector would report", () => {
    const none = reliabilityFixture({ supported: 5, evaluated: 0 });
    const some = reliabilityFixture({ supported: 5, evaluated: 3 });
    const all = reliabilityFixture({ supported: 5, evaluated: 5 });
    const statusOf = (snapshot: typeof none) =>
      snapshot.sources.find((source) => source.source === "Resource Health")?.availability;

    expect(statusOf(none)).toBe("unavailable");
    expect(statusOf(some)).toBe("partial");
    expect(statusOf(all)).toBe("available");
  });

  it("counts supported network resources towards coverage rather than 対象外", () => {
    const snapshot = reliabilityFixture({
      supported: 2,
      evaluated: 2,
      networkSupported: 3,
      networkEvaluated: 1,
      networkNotApplicable: 4
    });
    const coverage = snapshot.reliability.coverage;

    expect(coverage.supportedResources).toBe(5);
    expect(coverage.evaluatedResources).toBe(3);
    expect(coverage.unevaluatedResources).toBe(2);
    expect(coverage.notApplicableResources).toBe(4);
    expect(snapshot.network.inventory.total).toBe(7);
  });

  it("keeps the coverage arithmetic consistent with the inventory it builds", () => {
    const snapshot = reliabilityFixture({
      supported: 9,
      evaluated: 5,
      degraded: 1,
      unavailable: 1,
      notApplicable: 3,
      networkNotApplicable: 2
    });
    const coverage = snapshot.reliability.coverage;
    const counted = (status: string) =>
      snapshot.inventory.resources.filter((resource) => resource.status === status).length;

    expect(coverage.totalResources).toBe(snapshot.inventory.total);
    expect(coverage.totalResources).toBe(snapshot.inventory.resources.length);
    expect(coverage.supportedResources).toBe(
      coverage.evaluatedResources + coverage.unevaluatedResources
    );
    expect(coverage.evaluatedResources).toBe(
      coverage.healthyResources + coverage.degradedResources + coverage.unavailableResources
    );
    expect(counted("Healthy")).toBe(coverage.healthyResources);
    expect(counted("Degraded")).toBe(coverage.degradedResources);
    expect(counted("Unavailable")).toBe(coverage.unavailableResources);
    expect(counted("Unknown")).toBe(coverage.unevaluatedResources);
    expect(counted("NotApplicable")).toBe(coverage.notApplicableResources);
  });

  it("refuses to build states Azure could never report", () => {
    expect(() => reliabilityFixture({ supported: 2, evaluated: 3 })).toThrow(
      /cannot exceed the supported/
    );
    expect(() => reliabilityFixture({ supported: 4, evaluated: 1, degraded: 2 })).toThrow(
      /cannot exceed the evaluated/
    );
    expect(() =>
      reliabilityFixture({ supported: 2, evaluated: 1, networkSupported: 1, networkEvaluated: 2 })
    ).toThrow(/network resources cannot exceed/);
  });

  it("refuses counts that are not whole resources", () => {
    expect(() => reliabilityFixture({ supported: -1, evaluated: 0 })).toThrow(
      /non-negative integer/
    );
    expect(() => reliabilityFixture({ supported: 2.5, evaluated: 1 })).toThrow(
      /non-negative integer/
    );
    expect(() => reliabilityFixture({ supported: Number.NaN, evaluated: 0 })).toThrow(
      /non-negative integer/
    );
    expect(() =>
      reliabilityFixture({ supported: 1, evaluated: 1, notApplicable: Number.POSITIVE_INFINITY })
    ).toThrow(/non-negative integer/);
  });

  it("still parses the snapshot that is actually published", () => {
    expect(() => publicSnapshotSchema.parse(publishedSnapshot)).not.toThrow();
  });

  it("clears every Defender-derived value together so the contract stays satisfiable", () => {
    const snapshot = withDefenderUnavailable(reliabilityFixture({ supported: 4, evaluated: 4 }));

    expect(
      snapshot.sources.find((source) => source.source === "Defender for Cloud")?.availability
    ).toBe("unavailable");
    expect(snapshot.security.secureScore).toBeNull();
    expect(snapshot.security.recommendations).toHaveLength(0);
    expect(
      snapshot.overview.metrics.some((metric) =>
        ["Defender recommendations", "Open alerts"].includes(metric.label)
      )
    ).toBe(false);
    expect(() => publicSnapshotSchema.parse(snapshot)).not.toThrow();
  });
});
