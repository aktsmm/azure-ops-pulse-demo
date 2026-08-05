import type { NetworkMetricCoverage } from "../src/data/contracts";

export interface MetricDefinition {
  name?: { value?: string | null } | null;
}

export interface MetricValue {
  timeseries?: unknown[] | null;
}

export type MetricProbeOutcome =
  | { kind: "collected"; series: number }
  | { kind: "notApplicable" }
  | { kind: "failed" };

const UNSUPPORTED_NAMESPACE_PATTERNS = [
  "is not a supported platform metric namespace",
  "no metric definitions",
  "metricnamespace is not supported"
];

/**
 * Azure Monitor has no platform metrics for several resource types (Network Watcher is the classic
 * example, and it answers with "is not a supported platform metric namespace"). Treating that as a
 * collection failure makes a healthy subscription look broken, so the two cases are reported
 * separately. The diagnostic text is only classified locally and never reaches the snapshot.
 */
export function isUnsupportedMetricNamespaceError(message: string): boolean {
  const normalized = message.toLowerCase();
  return UNSUPPORTED_NAMESPACE_PATTERNS.some((pattern) => normalized.includes(pattern));
}

export function metricNamesFromDefinitions(
  definitions: readonly MetricDefinition[],
  limit = 3
): string[] {
  return definitions
    .map((definition) => definition.name?.value)
    .filter((name): name is string => typeof name === "string" && name.length > 0)
    .slice(0, limit);
}

export function countMetricSeries(values: readonly MetricValue[]): number {
  return values.reduce((count, metric) => count + (metric.timeseries?.length ?? 0), 0);
}

export function summarizeMetricCoverage(
  outcomes: readonly MetricProbeOutcome[],
  inventoryTotal: number
): NetworkMetricCoverage {
  const coverage: NetworkMetricCoverage = {
    inventoryTotal,
    sampledResources: outcomes.length,
    metricCapableResources: 0,
    metricSeries: 0,
    notApplicableResources: 0,
    failedResources: 0
  };
  for (const outcome of outcomes) {
    if (outcome.kind === "collected") {
      coverage.metricCapableResources += 1;
      coverage.metricSeries += outcome.series;
    } else if (outcome.kind === "notApplicable") {
      coverage.notApplicableResources += 1;
    } else {
      coverage.failedResources += 1;
    }
  }
  return coverage;
}

export function networkMetricMessage(coverage: NetworkMetricCoverage): string {
  const parts = [
    `Network inventory covers ${coverage.inventoryTotal} resources`,
    `${coverage.sampledResources} were sampled for Azure Monitor metrics`,
    `${coverage.metricCapableResources} exposed ${coverage.metricSeries} metric series`,
    `${coverage.notApplicableResources} have no platform metrics`,
    `${coverage.failedResources} could not be read`
  ];
  return `${parts.join("; ")}. Flow telemetry was not collected.`;
}
