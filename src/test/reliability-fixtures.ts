import baseSnapshot from "../../public/data/snapshot.json";
import type {
  NetworkMetricCoverage,
  PublicSnapshotV1,
  ResourceHealthStatus,
  ResourceItem
} from "../data/contracts";
import {
  resourceHealthReport,
  summarizeReliabilityCoverage,
  supportsResourceHealth
} from "../lib/resource-health";

/**
 * The published snapshot is rewritten by every scheduled collection, so its numbers are evidence of
 * one moment in Azure rather than a contract. Tests that assert on a *specific* reliability state
 * must therefore build that state here; only invariants that hold for any collection may read the
 * published file directly.
 */
export const publishedSnapshot = baseSnapshot as unknown as PublicSnapshotV1;

const SUPPORTED_TYPE = "microsoft.storage/storageaccounts";
const NOT_APPLICABLE_TYPE = "microsoft.logic/workflows";
const NETWORK_SUPPORTED_TYPE = "microsoft.network/loadbalancers";
const NETWORK_NOT_APPLICABLE_TYPE = "microsoft.network/networkinterfaces";
const NETWORK_TYPE_PREFIX = "microsoft.network/";

/** Kept in step with `defenderMetricLabels` in scripts/public-schema.ts. */
const DEFENDER_METRIC_LABELS = new Set(["Defender recommendations", "Open alerts"]);

/**
 * A fixture that contradicts the real support list would test a state the collector can never
 * produce, so the type choices above are pinned to the same source of truth the collector uses.
 */
for (const [type, expected] of [
  [SUPPORTED_TYPE, true],
  [NOT_APPLICABLE_TYPE, false],
  [NETWORK_SUPPORTED_TYPE, true],
  [NETWORK_NOT_APPLICABLE_TYPE, false]
] as const) {
  if (supportsResourceHealth(type) !== expected) {
    throw new Error(
      `Fixture type ${type} is no longer ${expected ? "supported" : "unsupported"} by Resource Health`
    );
  }
}

/** The published contract pseudonymises identifiers, so fixtures must use the same shapes. */
function hex8(index: number): string {
  return (index + 0x10000000).toString(16).slice(-8);
}

function resourceItem(
  index: number,
  type: string,
  status: ResourceHealthStatus,
  region: string
): ResourceItem {
  return {
    id: `res-${hex8(index)}`,
    name: `fixture-${index}`,
    resourceGroup: "rg-fixture",
    type,
    region,
    status,
    owner: `identity-${hex8(index)}`,
    tags: {},
    change: "Collected from Azure Resource Graph"
  };
}

export interface ReliabilityFixtureOptions {
  /** Resources of a type Azure Resource Health evaluates. */
  supported: number;
  /** How many of those supported resources came back with a real availability state. */
  evaluated: number;
  degraded?: number;
  unavailable?: number;
  /** Resources of a type Resource Health never evaluates. */
  notApplicable?: number;
  /** Network resources of a type Resource Health never evaluates. */
  networkNotApplicable?: number;
  /** Network resources of a supported type, counted towards `supported`. */
  networkSupported?: number;
  /** How many `networkSupported` resources returned a state; defaults to all of them. */
  networkEvaluated?: number;
  /**
   * Azure Monitor probe result. Defaults to a coverage object consistent with the network
   * inventory, which is what the collector always publishes once the network query succeeded.
   * Pass `null` only to reproduce legacy snapshots taken before metric coverage existed.
   */
  metricCoverage?: NetworkMetricCoverage | null;
}

function requireCount(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer, received ${value}`);
  }
  return value;
}

function countBy<T>(items: T[], key: (item: T) => string): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const label = key(item);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count }));
}

/**
 * Builds a snapshot whose reliability coverage, inventory and Resource Health source status are
 * mutually consistent, so a test asserts the UI contract rather than the latest collection result.
 * Coverage and source status are derived with the same functions the collector runs, so a fixture
 * cannot drift into a state production could never publish.
 */
export function reliabilityFixture(options: ReliabilityFixtureOptions): PublicSnapshotV1 {
  const supported = requireCount(options.supported, "supported");
  const evaluated = requireCount(options.evaluated, "evaluated");
  const degraded = requireCount(options.degraded ?? 0, "degraded");
  const unavailable = requireCount(options.unavailable ?? 0, "unavailable");
  const notApplicable = requireCount(options.notApplicable ?? 0, "notApplicable");
  const networkNotApplicable = requireCount(
    options.networkNotApplicable ?? 0,
    "networkNotApplicable"
  );
  const networkSupported = requireCount(options.networkSupported ?? 0, "networkSupported");
  const networkEvaluated = requireCount(
    options.networkEvaluated ?? networkSupported,
    "networkEvaluated"
  );

  if (evaluated > supported) {
    throw new Error("Evaluated resources cannot exceed the supported ones");
  }
  if (networkEvaluated > networkSupported) {
    throw new Error("Evaluated network resources cannot exceed the supported ones");
  }
  const healthy = evaluated - degraded - unavailable;
  if (healthy < 0) throw new Error("Degraded and unavailable cannot exceed the evaluated count");

  const resources: ResourceItem[] = [];
  const push = (count: number, type: string, status: ResourceHealthStatus, region: string) => {
    for (let index = 0; index < count; index += 1) {
      resources.push(resourceItem(resources.length, type, status, region));
    }
  };
  push(healthy, SUPPORTED_TYPE, "Healthy", "japaneast");
  push(degraded, SUPPORTED_TYPE, "Degraded", "japaneast");
  push(unavailable, SUPPORTED_TYPE, "Unavailable", "japanwest");
  // Unevaluated resources get their own region so tests can prove that a region with no evaluated
  // resource is still listed rather than hidden.
  push(supported - evaluated, SUPPORTED_TYPE, "Unknown", "koreacentral");
  push(networkEvaluated, NETWORK_SUPPORTED_TYPE, "Healthy", "japaneast");
  push(networkSupported - networkEvaluated, NETWORK_SUPPORTED_TYPE, "Unknown", "koreacentral");
  push(notApplicable, NOT_APPLICABLE_TYPE, "NotApplicable", "japaneast");
  push(networkNotApplicable, NETWORK_NOT_APPLICABLE_TYPE, "NotApplicable", "japaneast");

  const snapshot = structuredClone(publishedSnapshot);
  snapshot.inventory.total = resources.length;
  snapshot.inventory.resources = resources;
  snapshot.inventory.byType = countBy(resources, (resource) => resource.type);
  snapshot.inventory.byRegion = countBy(resources, (resource) => resource.region);

  // Derived with the collector's own helpers so fixture and production arithmetic cannot diverge.
  const coverage = summarizeReliabilityCoverage(resources);
  snapshot.reliability.coverage = coverage;
  snapshot.overview.postureScore = coverage.evaluatedResources
    ? Math.round((coverage.healthyResources / coverage.evaluatedResources) * 100)
    : null;

  const report = resourceHealthReport(coverage);
  const resourceHealth = snapshot.sources.find((source) => source.source === "Resource Health");
  if (resourceHealth) {
    resourceHealth.availability = report.availability;
    resourceHealth.message = report.message;
  }

  const networkResources = resources.filter((resource) =>
    resource.type.startsWith(NETWORK_TYPE_PREFIX)
  );
  snapshot.network.inventory.total = networkResources.length;
  snapshot.network.inventory.byType = countBy(networkResources, (resource) => resource.type);
  snapshot.network.inventory.byRegion = countBy(networkResources, (resource) => resource.region);
  snapshot.network.metricCoverage =
    options.metricCoverage === undefined
      ? defaultMetricCoverage(networkResources.length)
      : options.metricCoverage;

  return snapshot;
}

/** Mirrors the collector, which samples the inventory and never reports more than it probed. */
function defaultMetricCoverage(inventoryTotal: number): NetworkMetricCoverage | null {
  if (inventoryTotal === 0) return null;
  const sampled = Math.min(inventoryTotal, 20);
  const capable = Math.min(sampled, 1);
  return {
    inventoryTotal,
    sampledResources: sampled,
    metricCapableResources: capable,
    metricSeries: capable,
    notApplicableResources: sampled - capable,
    failedResources: 0
  };
}

/**
 * Turns a fixture into the "Defender plans are off" shape. The published contract forbids exposing
 * aggregate security values while the source is unavailable, so the source, the security block and
 * the Defender-derived overview metrics all have to be cleared together.
 */
export function withDefenderUnavailable(snapshot: PublicSnapshotV1): PublicSnapshotV1 {
  const next = structuredClone(snapshot);
  const defender = next.sources.find((source) => source.source === "Defender for Cloud");
  if (defender) {
    defender.availability = "unavailable";
    defender.message = "No Defender for Cloud plan is enabled, so no security posture was collected.";
  }
  next.security = { secureScore: null, activeAlerts: null, recommendations: [], compliance: [] };
  next.overview.metrics = next.overview.metrics.filter(
    (metric) => !DEFENDER_METRIC_LABELS.has(metric.label)
  );
  return next;
}

export const fixtureTypes = {
  supported: SUPPORTED_TYPE,
  notApplicable: NOT_APPLICABLE_TYPE,
  networkSupported: NETWORK_SUPPORTED_TYPE,
  network: NETWORK_NOT_APPLICABLE_TYPE
} as const;
