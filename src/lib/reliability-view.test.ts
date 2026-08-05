import { describe, expect, it } from "vitest";
import snapshot from "../../public/data/snapshot.json";
import type { ReliabilityCoverage, ResourceHealthStatus } from "../data/contracts";
import {
  blindSpotSummary,
  confirmedFailures,
  coverageSegments,
  summarizeCoverageByRegion,
  summarizeCoverageByType,
  supportedSharePercent
} from "./reliability-view";

const publishedResources = snapshot.inventory.resources as Array<{
  type: string;
  region: string;
  status: ResourceHealthStatus;
}>;
const publishedCoverage = snapshot.reliability.coverage as ReliabilityCoverage;

function coverageOf(overrides: Partial<ReliabilityCoverage>): ReliabilityCoverage {
  return {
    totalResources: 0,
    supportedResources: 0,
    notApplicableResources: 0,
    evaluatedResources: 0,
    unevaluatedResources: 0,
    healthyResources: 0,
    degradedResources: 0,
    unavailableResources: 0,
    supportedCoveragePercent: null,
    ...overrides
  };
}

const mixedResources: Array<{ type: string; region: string; status: ResourceHealthStatus }> = [
  { type: "microsoft.storage/storageaccounts", region: "japaneast", status: "Healthy" },
  { type: "microsoft.storage/storageaccounts", region: "japaneast", status: "Degraded" },
  { type: "microsoft.storage/storageaccounts", region: "japanwest", status: "Unknown" },
  { type: "microsoft.search/searchservices", region: "japaneast", status: "Unavailable" },
  { type: "microsoft.logic/workflows", region: "japaneast", status: "NotApplicable" },
  { type: "microsoft.logic/workflows", region: "japanwest", status: "NotApplicable" },
  { type: "microsoft.web/connections", region: "japanwest", status: "NotApplicable" }
];

describe("summarizeCoverageByType", () => {
  it("keeps the per-type totals consistent with reliability.coverage", () => {
    const rows = summarizeCoverageByType(publishedResources);
    const total = rows.reduce((sum, row) => sum + row.total, 0);
    const notApplicable = rows
      .filter((row) => !row.supported)
      .reduce((sum, row) => sum + row.total, 0);
    const supported = rows.filter((row) => row.supported).reduce((sum, row) => sum + row.total, 0);
    const evaluated = rows.reduce((sum, row) => sum + row.evaluated, 0);
    const unevaluated = rows.reduce((sum, row) => sum + row.unevaluated, 0);

    expect(total).toBe(publishedCoverage.totalResources);
    expect(notApplicable).toBe(publishedCoverage.notApplicableResources);
    expect(supported).toBe(publishedCoverage.supportedResources);
    expect(evaluated).toBe(publishedCoverage.evaluatedResources);
    expect(unevaluated).toBe(publishedCoverage.unevaluatedResources);
  });

  it("lists supported types before the not-applicable ones", () => {
    const rows = summarizeCoverageByType(mixedResources);
    const supportedFlags = rows.map((row) => row.supported);

    expect(supportedFlags).toEqual([...supportedFlags].sort((a, b) => Number(b) - Number(a)));
    expect(rows[0]?.type).toBe("microsoft.storage/storageaccounts");
    expect(rows[0]).toMatchObject({
      total: 3,
      supported: true,
      healthy: 1,
      degraded: 1,
      unevaluated: 1,
      evaluated: 2
    });
  });

  it("never counts NotApplicable resources as evaluated or unevaluated", () => {
    const rows = summarizeCoverageByType(mixedResources);
    const workflows = rows.find((row) => row.type === "microsoft.logic/workflows");

    expect(workflows).toMatchObject({
      total: 2,
      supported: false,
      evaluated: 0,
      unevaluated: 0
    });
  });
});

describe("summarizeCoverageByRegion", () => {
  it("splits every published resource into supported or not applicable", () => {
    const rows = summarizeCoverageByRegion(publishedResources);
    const total = rows.reduce((sum, row) => sum + row.total, 0);
    const supported = rows.reduce((sum, row) => sum + row.supported, 0);
    const notApplicable = rows.reduce((sum, row) => sum + row.notApplicable, 0);

    expect(total).toBe(publishedCoverage.totalResources);
    expect(supported).toBe(publishedCoverage.supportedResources);
    expect(notApplicable).toBe(publishedCoverage.notApplicableResources);
    expect(rows.every((row) => row.supported + row.notApplicable === row.total)).toBe(true);
  });

  it("orders regions by supported footprint first", () => {
    const rows = summarizeCoverageByRegion(mixedResources);

    expect(rows.map((row) => row.region)).toEqual(["japaneast", "japanwest"]);
    expect(rows[0]).toMatchObject({ total: 4, supported: 3, notApplicable: 1, evaluated: 3 });
    expect(rows[1]).toMatchObject({ total: 3, supported: 1, notApplicable: 2, evaluated: 0 });
  });

  it("falls back to an unknown bucket when the region is blank", () => {
    const rows = summarizeCoverageByRegion([
      { type: "microsoft.storage/storageaccounts", region: "  ", status: "Healthy" }
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.region).toBe("unknown");
  });
});

describe("coverageSegments", () => {
  it("adds up to the total inventory and drops empty buckets", () => {
    const segments = coverageSegments(publishedCoverage);
    const sum = segments.reduce((total, segment) => total + segment.count, 0);

    expect(sum).toBe(publishedCoverage.totalResources);
    expect(segments.every((segment) => segment.count > 0)).toBe(true);
  });

  it("marks not-applicable resources as informational, never as a failure", () => {
    const segments = coverageSegments(
      coverageOf({ totalResources: 3, notApplicableResources: 3, supportedResources: 0 })
    );

    expect(segments).toEqual([
      { key: "notApplicable", label: "対象外", count: 3, severity: "info" }
    ]);
  });
});

describe("blindSpotSummary", () => {
  it("counts only the types Resource Health never evaluates", () => {
    const summary = blindSpotSummary(summarizeCoverageByType(publishedResources));

    expect(summary.resources).toBe(publishedCoverage.notApplicableResources);
    expect(summary.types).toBeGreaterThan(0);
    expect(summary.topTypes.every((row) => !row.supported)).toBe(true);
  });

  it("caps the highlighted types at the requested count", () => {
    const summary = blindSpotSummary(summarizeCoverageByType(publishedResources), 3);

    expect(summary.topTypes).toHaveLength(3);
  });
});

describe("supportedSharePercent", () => {
  it("uses the whole inventory as the denominator", () => {
    expect(supportedSharePercent(coverageOf({ totalResources: 62, supportedResources: 14 }))).toBe(
      23
    );
  });

  it("returns null instead of dividing by zero", () => {
    expect(supportedSharePercent(coverageOf({ totalResources: 0 }))).toBeNull();
  });
});

describe("confirmedFailures", () => {
  it("returns null while nothing has been evaluated so zero is never implied", () => {
    expect(confirmedFailures(publishedCoverage)).toBeNull();
    expect(
      confirmedFailures(coverageOf({ supportedResources: 14, unevaluatedResources: 14 }))
    ).toBeNull();
  });

  it("counts degraded and unavailable resources once evaluation happened", () => {
    expect(
      confirmedFailures(
        coverageOf({
          supportedResources: 10,
          evaluatedResources: 10,
          healthyResources: 7,
          degradedResources: 2,
          unavailableResources: 1
        })
      )
    ).toBe(3);
  });

  it("reports zero failures only when resources were actually evaluated", () => {
    expect(
      confirmedFailures(
        coverageOf({ supportedResources: 4, evaluatedResources: 4, healthyResources: 4 })
      )
    ).toBe(0);
  });
});
