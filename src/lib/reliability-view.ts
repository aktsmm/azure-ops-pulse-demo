import type { ReliabilityCoverage, ResourceHealthStatus, Severity } from "../data/contracts";

/**
 * Resource Health coverage of a single Azure resource type.
 *
 * `supported` is derived from the published statuses instead of the static support list so the
 * rows can never disagree with `reliability.coverage`: the collector already classified every
 * resource, and `NotApplicable` is the only status that means "Azure never evaluates this type".
 */
export interface ResourceTypeCoverageRow {
  type: string;
  total: number;
  supported: boolean;
  evaluated: number;
  healthy: number;
  degraded: number;
  unavailable: number;
  unevaluated: number;
}

export interface RegionCoverageRow {
  region: string;
  total: number;
  supported: number;
  evaluated: number;
  healthy: number;
  degraded: number;
  unavailable: number;
  notApplicable: number;
}

export interface CoverageSegment {
  key: "healthy" | "degraded" | "unavailable" | "unevaluated" | "notApplicable";
  label: string;
  count: number;
  severity: Severity;
}

export interface BlindSpotSummary {
  resources: number;
  types: number;
  topTypes: ResourceTypeCoverageRow[];
}

interface CountableResource {
  type: string;
  region?: string;
  status: ResourceHealthStatus;
}

function emptyTypeRow(type: string): ResourceTypeCoverageRow {
  return {
    type,
    total: 0,
    supported: false,
    evaluated: 0,
    healthy: 0,
    degraded: 0,
    unavailable: 0,
    unevaluated: 0
  };
}

function emptyRegionRow(region: string): RegionCoverageRow {
  return {
    region,
    total: 0,
    supported: 0,
    evaluated: 0,
    healthy: 0,
    degraded: 0,
    unavailable: 0,
    notApplicable: 0
  };
}

/**
 * Groups the published inventory by Azure resource type and separates the types Resource Health
 * evaluates from the ones it never evaluates. Supported types come first so the monitored estate
 * is read before the blind spots.
 */
export function summarizeCoverageByType(
  resources: readonly CountableResource[]
): ResourceTypeCoverageRow[] {
  const rows = new Map<string, ResourceTypeCoverageRow>();
  for (const resource of resources) {
    const row = rows.get(resource.type) ?? emptyTypeRow(resource.type);
    row.total += 1;
    if (resource.status === "NotApplicable") {
      rows.set(resource.type, row);
      continue;
    }
    row.supported = true;
    if (resource.status === "Healthy") row.healthy += 1;
    else if (resource.status === "Degraded") row.degraded += 1;
    else if (resource.status === "Unavailable") row.unavailable += 1;
    else row.unevaluated += 1;
    row.evaluated = row.healthy + row.degraded + row.unavailable;
    rows.set(resource.type, row);
  }
  return [...rows.values()].sort((a, b) => {
    if (a.supported !== b.supported) return a.supported ? -1 : 1;
    if (b.total !== a.total) return b.total - a.total;
    return a.type.localeCompare(b.type);
  });
}

/** Regions ordered by how much of the estate they hold, so the largest footprint is read first. */
export function summarizeCoverageByRegion(
  resources: readonly CountableResource[]
): RegionCoverageRow[] {
  const rows = new Map<string, RegionCoverageRow>();
  for (const resource of resources) {
    const region = resource.region?.trim() || "unknown";
    const row = rows.get(region) ?? emptyRegionRow(region);
    row.total += 1;
    if (resource.status === "NotApplicable") {
      row.notApplicable += 1;
    } else {
      row.supported += 1;
      if (resource.status === "Healthy") row.healthy += 1;
      else if (resource.status === "Degraded") row.degraded += 1;
      else if (resource.status === "Unavailable") row.unavailable += 1;
    }
    row.evaluated = row.healthy + row.degraded + row.unavailable;
    rows.set(region, row);
  }
  return [...rows.values()].sort((a, b) => {
    if (b.supported !== a.supported) return b.supported - a.supported;
    if (b.total !== a.total) return b.total - a.total;
    return a.region.localeCompare(b.region);
  });
}

/**
 * Breaks the whole inventory into the five published Resource Health outcomes. Zero-count segments
 * are dropped so an empty state is never drawn as a segment of a bar.
 */
export function coverageSegments(coverage: ReliabilityCoverage): CoverageSegment[] {
  const segments: CoverageSegment[] = [
    { key: "healthy", label: "正常", count: coverage.healthyResources, severity: "healthy" },
    { key: "degraded", label: "低下", count: coverage.degradedResources, severity: "warning" },
    {
      key: "unavailable",
      label: "利用不可",
      count: coverage.unavailableResources,
      severity: "critical"
    },
    {
      key: "unevaluated",
      label: "未評価",
      count: coverage.unevaluatedResources,
      severity: "warning"
    },
    {
      key: "notApplicable",
      label: "対象外",
      count: coverage.notApplicableResources,
      severity: "info"
    }
  ];
  return segments.filter((segment) => segment.count > 0);
}

/** Resource types that Azure Resource Health never evaluates: the monitoring blind spots. */
export function blindSpotSummary(
  rows: readonly ResourceTypeCoverageRow[],
  topCount = 5
): BlindSpotSummary {
  const blindSpots = rows.filter((row) => !row.supported);
  return {
    resources: blindSpots.reduce((total, row) => total + row.total, 0),
    types: blindSpots.length,
    topTypes: blindSpots.slice(0, topCount)
  };
}

/** Share of the estate that Azure Resource Health is able to evaluate at all. */
export function supportedSharePercent(coverage: ReliabilityCoverage): number | null {
  if (coverage.totalResources <= 0) return null;
  return Math.round((coverage.supportedResources / coverage.totalResources) * 100);
}

/**
 * Confirmed failures are only meaningful once at least one supported resource was evaluated;
 * before that the correct answer is "not judged yet", never zero.
 */
export function confirmedFailures(coverage: ReliabilityCoverage): number | null {
  if (coverage.evaluatedResources <= 0) return null;
  return coverage.degradedResources + coverage.unavailableResources;
}
