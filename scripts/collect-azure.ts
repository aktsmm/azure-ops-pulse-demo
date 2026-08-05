import { execFileSync } from "node:child_process";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AiInsight, RawResource, RawSnapshot, SourceStatus } from "../src/data/contracts";
import { sanitizeSnapshot } from "../src/lib/sanitize";
import {
  summarizeAssessments,
  type DefenderAssessmentRow
} from "../src/lib/defender-recommendations";
import {
  classifyResourceHealth,
  indexAvailabilityStatuses,
  resourceHealthReport,
  summarizeReliabilityCoverage,
  unlistedEvaluatedTypes,
  type AvailabilityStatusRecord
} from "../src/lib/resource-health";
import { uncollectedIncidentMetric } from "./reliability-metrics";
import {
  comparableCostPeriods,
  costCoverageLabel,
  costPeriodMessage,
  mergeCostPages,
  transformComparableCost,
  type CostQueryProperties
} from "./cost-transform";
import {
  normalizeActivityOperationLabel,
  type AzureActivityEvent
} from "./activity-normalization";
import { summarizeServiceHealth, type ServiceHealthEventRecord } from "./service-health";
import {
  countMetricSeries,
  isUnsupportedMetricNamespaceError,
  metricNamesFromDefinitions,
  networkMetricMessage,
  summarizeMetricCoverage,
  type MetricDefinition,
  type MetricProbeOutcome,
  type MetricValue
} from "./azure-metrics";
import { collectSource, countReport } from "./source-status";
import { publicSnapshotSchema } from "./public-schema";

interface GraphResponse<T> {
  data?: T[];
  count?: number;
  totalRecords?: number;
  total_records?: number;
  skipToken?: string;
  skip_token?: string;
}

class AzureCliError extends Error {
  readonly unsupportedMetricNamespace: boolean;

  constructor(operation: string, diagnostic: string) {
    // Diagnostics are classified locally and never included in the message that can reach output.
    super(`Azure CLI ${operation} failed; response content was intentionally suppressed`);
    this.name = "AzureCliError";
    this.unsupportedMetricNamespace = isUnsupportedMetricNamespaceError(diagnostic);
  }
}

function readAzOutput(args: string[]): string {
  const operation = args.slice(0, 2).join(" ");
  try {
    return execFileSync("az", [...args, "--output", "json", "--only-show-errors"], {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    const diagnostic =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr?: unknown }).stderr ?? "")
        : "";
    throw new AzureCliError(operation, diagnostic);
  }
}

function runAzJson<T>(args: string[]): T {
  const operation = args.slice(0, 2).join(" ");
  const output = readAzOutput(args);
  try {
    return JSON.parse(output) as T;
  } catch {
    throw new AzureCliError(operation, "response was not valid JSON");
  }
}

/**
 * `az rest` prints nothing for a 204 No Content response. That is a successful call that simply has
 * no records, so it must not be reported the same way as a failed call.
 */
function runAzJsonAllowingEmpty<T>(args: string[]): T | null {
  const operation = args.slice(0, 2).join(" ");
  const output = readAzOutput(args);
  if (!output.trim()) return null;
  try {
    return JSON.parse(output) as T;
  } catch {
    throw new AzureCliError(operation, "response was not valid JSON");
  }
}

function graphQuery<T>(subscriptionId: string, query: string): T[] {
  const rows: T[] = [];
  let skipToken: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const args = [
      "graph",
      "query",
      "--subscriptions",
      subscriptionId,
      "--first",
      "1000",
      "--graph-query",
      query
    ];
    if (skipToken) args.push("--skip-token", skipToken);
    const response = runAzJson<GraphResponse<T>>(args);
    rows.push(...(response.data ?? []));
    const nextToken = response.skipToken ?? response.skip_token;
    const totalRecords = response.totalRecords ?? response.total_records;
    if (!nextToken) {
      if (typeof totalRecords === "number" && rows.length < totalRecords) {
        throw new Error("Azure Resource Graph pagination ended before all records were collected");
      }
      return rows;
    }
    if (nextToken === skipToken) {
      throw new Error("Azure Resource Graph returned a repeated pagination token");
    }
    skipToken = nextToken;
  }
  throw new Error("Azure Resource Graph exceeded the 100-page safety limit");
}

function percent(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function optionalNumber(value: unknown): number | null {
  const number = Number(value);
  return value !== null && value !== undefined && Number.isFinite(number) ? number : null;
}

const COST_API_VERSION = "2025-03-01";

/**
 * Cost Management query results are paged through `properties.nextLink`.
 * https://learn.microsoft.com/rest/api/cost-management/query/usage
 */
function queryCostPeriod(
  subscriptionId: string,
  start: Date,
  end: Date
): CostQueryProperties | null {
  const body = JSON.stringify({
    type: "ActualCost",
    timeframe: "Custom",
    timePeriod: { from: start.toISOString(), to: end.toISOString() },
    dataset: {
      granularity: "None",
      aggregation: { totalCost: { name: "Cost", function: "Sum" } },
      grouping: [{ type: "Dimension", name: "ServiceName" }]
    }
  });
  const pages: CostQueryProperties[] = [];
  let url = `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.CostManagement/query?api-version=${COST_API_VERSION}`;
  for (let page = 0; page < 50; page += 1) {
    const result = runAzJsonAllowingEmpty<{ properties?: CostQueryProperties }>([
      "rest",
      "--method",
      "post",
      "--url",
      url,
      "--body",
      body
    ]);
    const properties = result?.properties;
    if (!properties) break;
    pages.push(properties);
    const nextLink = properties.nextLink;
    if (!nextLink || nextLink === url) break;
    url = nextLink;
  }
  return mergeCostPages(pages);
}

const RESOURCE_HEALTH_API_VERSION = "2025-05-01";

/**
 * Azure Resource Graph's `HealthResources` table only carries availability for a narrow set of
 * compute types, so the Resource Health data plane is used instead. It covers every resource type
 * listed at https://learn.microsoft.com/azure/service-health/resource-health-checks-resource-types
 * https://learn.microsoft.com/rest/api/resourcehealth/availability-statuses/list-by-subscription-id
 */
function queryAvailabilityStatuses(subscriptionId: string): AvailabilityStatusRecord[] {
  const records: AvailabilityStatusRecord[] = [];
  let url = `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.ResourceHealth/availabilityStatuses?api-version=${RESOURCE_HEALTH_API_VERSION}`;
  const seen = new Set<string>();
  for (let page = 0; page < 200; page += 1) {
    if (seen.has(url)) {
      throw new Error("Resource Health pagination returned a repeated link");
    }
    seen.add(url);
    const response = runAzJsonAllowingEmpty<{
      value?: AvailabilityStatusRecord[];
      nextLink?: string | null;
    }>(["rest", "--method", "get", "--url", url]);
    if (!response) break;
    records.push(...(response.value ?? []));
    if (!response.nextLink) return records;
    url = response.nextLink;
  }
  throw new Error("Resource Health exceeded the pagination safety limit");
}

const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
if (!subscriptionId) throw new Error("AZURE_SUBSCRIPTION_ID is required");

const output = resolve(process.env.OUTPUT_PATH ?? ".candidate/snapshot.json");
const account = runAzJson<{ tenantId: string }>([
  "account",
  "show",
  "--subscription",
  subscriptionId
]);

const rawResources = graphQuery<{
  id: string;
  name: string;
  resourceGroup: string;
  type: string;
  location?: string | null;
  tags?: Record<string, unknown> | null;
}>(
  subscriptionId,
  "Resources | project id, name, resourceGroup, type, location, tags | order by type asc"
);
if (!rawResources.length) {
  throw new Error("Azure Resource Graph returned no resources; last-known-good data was preserved");
}

const health = collectSource(
  "Resource Health",
  () => queryAvailabilityStatuses(subscriptionId),
  (records) => ({
    availability: records.length ? "available" : "unavailable",
    message: records.length
      ? `Resource Health returned ${records.length} availability statuses.`
      : "Resource Health returned no availability statuses for this subscription."
  }),
  "Resource Health is unavailable or the current role cannot read it."
);

/**
 * Service Health events live in the `ServiceHealthResources` table, not `HealthResources`.
 * https://learn.microsoft.com/azure/service-health/resource-graph-samples
 */
const serviceHealth = collectSource(
  "Service Health",
  () =>
    graphQuery<ServiceHealthEventRecord>(
      subscriptionId,
      "ServiceHealthResources | where type =~ 'microsoft.resourcehealth/events' | project properties"
    ),
  (events) =>
    countReport(events.length, {
      collected: (count) => `Service Health returned ${count} events in aggregate.`,
      empty: "Service Health returned 0 events for the collected window.",
      emptyAvailability: "partial"
    }),
  "Service Health events are unavailable or the current role cannot read them."
);

const activity = collectSource(
  "Activity Log",
  () =>
    runAzJson<AzureActivityEvent[]>([
      "monitor",
      "activity-log",
      "list",
      "--subscription",
      subscriptionId,
      "--offset",
      "7d",
      "--max-events",
      "100"
    ]),
  (events) =>
    countReport(events.length, {
      collected: (count) =>
        `${count} recent Activity Log events were collected without actor or resource detail.`,
      empty: "Activity Log returned 0 events for the last 7 days.",
      emptyAvailability: "partial"
    }),
  "Activity Log is unavailable or the current role cannot read it."
);

const security = collectSource(
  "Defender for Cloud",
  () => {
    const assessments = graphQuery<DefenderAssessmentRow>(
      subscriptionId,
      "SecurityResources | where type =~ 'microsoft.security/assessments' | project properties"
    );
    const subassessmentCount = graphQuery<{ count_: number }>(
      subscriptionId,
      "SecurityResources | where type contains 'subassessments' | summarize count_ = count()"
    )[0]?.count_;
    // Secure score is published per subscription; averaging control percentages is not the score.
    // https://learn.microsoft.com/azure/defender-for-cloud/resource-graph-samples
    const scores = graphQuery<{ percentageRatio?: number }>(
      subscriptionId,
      "SecurityResources | where type =~ 'microsoft.security/securescores' | project percentageRatio=todouble(properties.score.percentage)"
    );
    const alertCount = graphQuery<{ count_: number }>(
      subscriptionId,
      "SecurityResources | where type =~ 'microsoft.security/locations/alerts' | where properties.Status =~ 'Active' | summarize count_ = count()"
    )[0]?.count_;
    const regulatoryCount = graphQuery<{ count_: number }>(
      subscriptionId,
      "SecurityResources | where type contains 'regulatorycompliance' | summarize count_ = count()"
    )[0]?.count_;
    return {
      assessments,
      subassessmentCount: optionalNumber(subassessmentCount),
      scores,
      alertCount: optionalNumber(alertCount),
      regulatoryCount: optionalNumber(regulatoryCount)
    };
  },
  (value) => {
    if (!value.scores.length && !value.assessments.length) {
      return {
        availability: "unavailable",
        message:
          "Defender for Cloud returned no secure score and no assessments; Defender plans are likely disabled for this subscription."
      };
    }
    if (!value.scores.length) {
      return {
        availability: "partial",
        message: `Defender for Cloud returned ${value.assessments.length} assessments but no secure score.`
      };
    }
    if (!value.assessments.length) {
      return {
        availability: "partial",
        message: "Defender for Cloud returned a secure score but no assessments."
      };
    }
    return {
      availability: "available",
      message: `Defender for Cloud returned a secure score and ${value.assessments.length} assessments in aggregate.`
    };
  },
  "Defender data is unavailable; plans may be disabled or permissions may be insufficient."
);

const costPeriods = comparableCostPeriods(new Date());

const currentCost = collectSource(
  "Cost Management",
  () => queryCostPeriod(subscriptionId, costPeriods.current.start, costPeriods.current.end),
  (properties) => ({
    availability: properties ? "available" : "unavailable",
    message: properties
      ? "Current Cost Management period was collected."
      : "Cost Management returned no content for the current period."
  }),
  "Current Cost Management period is unavailable; billing scope or role access may be required."
);
const previousCost = collectSource(
  "Cost Management prior period",
  () => queryCostPeriod(subscriptionId, costPeriods.previous.start, costPeriods.previous.end),
  (properties) => ({
    availability: properties ? "available" : "unavailable",
    message: properties
      ? "Prior comparable Cost Management period was collected."
      : "Cost Management returned no content for the prior comparable period."
  }),
  "Prior comparable Cost Management period is unavailable."
);

/**
 * Several resource types (Network Watcher among them) have no Azure Monitor platform metric
 * namespace at all. Probing the metric definitions first keeps "not applicable" separate from
 * "could not be read".
 */
function probeMetrics(resourceId: string): MetricProbeOutcome {
  let definitions: MetricDefinition[];
  try {
    definitions = runAzJson<MetricDefinition[]>([
      "monitor",
      "metrics",
      "list-definitions",
      "--resource",
      resourceId
    ]);
  } catch (error) {
    if (error instanceof AzureCliError && error.unsupportedMetricNamespace) {
      return { kind: "notApplicable" };
    }
    return { kind: "failed" };
  }
  const metricNames = metricNamesFromDefinitions(definitions);
  if (!metricNames.length) return { kind: "notApplicable" };
  try {
    const metrics = runAzJson<{ value?: MetricValue[] }>([
      "monitor",
      "metrics",
      "list",
      "--resource",
      resourceId,
      "--metrics",
      ...metricNames,
      "--offset",
      "24h",
      "--interval",
      "PT1H"
    ]);
    return { kind: "collected", series: countMetricSeries(metrics.value ?? []) };
  } catch {
    return { kind: "failed" };
  }
}

const network = collectSource(
  "Network inventory and metrics",
  () => {
    const inventory = graphQuery<{
      id: string;
      name: string;
      type: string;
      location?: string | null;
    }>(
      subscriptionId,
      "Resources | where type startswith 'microsoft.network/' | project id, name, type, location"
    );
    const outcomes = inventory.slice(0, 20).map((resource) => probeMetrics(resource.id));
    return { inventory, coverage: summarizeMetricCoverage(outcomes, inventory.length) };
  },
  (value) => ({
    // Flow telemetry is never collected, so this source can never be fully "available".
    availability: value.inventory.length ? "partial" : "unavailable",
    message: value.inventory.length
      ? networkMetricMessage(value.coverage)
      : "No Microsoft.Network resources were found in the subscription."
  }),
  "Network inventory and metrics are unavailable."
);
const networkStatus = network.status;

const healthByResource = indexAvailabilityStatuses(health.value ?? []);
// A type Azure actually evaluated is supported regardless of what the static list says, so the
// coverage denominator cannot shrink when the documented type list drifts.
const evaluatedResourceTypes = new Set(
  rawResources
    .filter((resource) => healthByResource.has(resource.id.toLowerCase()))
    .map((resource) => resource.type.trim().toLowerCase())
);
const resources: RawResource[] = rawResources.map((resource) => ({
  ...resource,
  status: classifyResourceHealth(
    resource.type,
    healthByResource.get(resource.id.toLowerCase())?.availabilityState,
    evaluatedResourceTypes
  ),
  owner:
    typeof resource.tags?.owner === "string"
      ? resource.tags.owner
      : typeof resource.tags?.team === "string"
        ? resource.tags.team
        : "unassigned",
  change: "Azure Resource Graph から収集"
}));

const reliabilityCoverage = summarizeReliabilityCoverage(resources);
const driftedTypes = unlistedEvaluatedTypes(resources);
if (driftedTypes.length) {
  // Resource type names are public Azure identifiers and carry no tenant data.
  console.warn(
    `Resource Health evaluated types missing from the static support list: ${driftedTypes.join(", ")}`
  );
}
const healthCoverageReport = resourceHealthReport(reliabilityCoverage);
const healthStatus: SourceStatus =
  health.status.availability === "unavailable"
    ? health.status
    : {
        source: "Resource Health",
        availability: healthCoverageReport.availability,
        message: healthCoverageReport.message
      };

const serviceHealthSummary = summarizeServiceHealth(serviceHealth.value, serviceHealth.status);

const costData = transformComparableCost(currentCost.value, previousCost.value);
// The source status must track the value that is actually published, not merely whether the query
// returned rows. A period whose columns or currency could not be interpreted has no total to show.
const currentCostUsable =
  currentCost.status.availability !== "unavailable" && costData.currentTotalJpy !== null;
const previousCostUsable =
  previousCost.status.availability !== "unavailable" && costData.previousTotalJpy !== null;
const costStatus: SourceStatus = !currentCostUsable
  ? {
      source: "Cost Management",
      availability: "unavailable",
      message:
        currentCost.status.availability === "unavailable"
          ? currentCost.status.message
          : costPeriodMessage(costData.currentOutcome, costData.currentRowCount)
    }
  : !previousCostUsable
    ? {
        source: "Cost Management",
        availability: "partial",
        message: `Current rounded JPY cost was collected from ${costData.currentRowCount} records; ${
          previousCost.status.availability === "unavailable"
            ? previousCost.status.message
            : costPeriodMessage(costData.previousOutcome, costData.previousRowCount)
        }`
      }
    : {
        source: "Cost Management",
        availability: "available",
        message: `Current and prior comparable rounded JPY periods were collected from ${costData.currentRowCount} and ${costData.previousRowCount} records.`
      };

const recommendations = summarizeAssessments(security.value?.assessments ?? []);
// `properties.score.percentage` is a 0-1 ratio, not a 0-100 percentage.
// https://learn.microsoft.com/rest/api/defenderforcloud/secure-scores/list
const secureScoreRatio = security.value?.scores?.[0]?.percentageRatio;
const secureScore: number | null =
  secureScoreRatio === undefined || !Number.isFinite(Number(secureScoreRatio))
    ? null
    : Math.max(0, Math.min(100, Math.round(percent(secureScoreRatio) * 100)));

const unavailableCount = [
  healthStatus,
  serviceHealth.status,
  activity.status,
  security.status,
  costStatus,
  networkStatus
].filter((item) => item.availability === "unavailable").length;
const healthPercent = reliabilityCoverage.evaluatedResources
  ? Math.round((reliabilityCoverage.healthyResources / reliabilityCoverage.evaluatedResources) * 100)
  : null;
const insights: AiInsight[] = [];

const raw: RawSnapshot = {
  generatedAt: new Date().toISOString(),
  mode: "AZURE",
  subscriptionDisplayName: "Azure subscription",
  subscriptionId,
  tenantId: account.tenantId,
  sources: [
    {
      source: "Azure Resource Graph",
      availability: "available",
      message: "Read-only inventory collection completed."
    },
    costStatus,
    healthStatus,
    serviceHealth.status,
    activity.status,
    security.status,
    networkStatus
  ],
  metrics: [
    {
      label: "Resource Health の評価範囲",
      value:
        reliabilityCoverage.supportedCoveragePercent === null
          ? "利用不可"
          : `${reliabilityCoverage.supportedCoveragePercent}%`,
      change: `対応 ${reliabilityCoverage.supportedResources} 件中 ${reliabilityCoverage.evaluatedResources} 件を評価済み（対象外 ${reliabilityCoverage.notApplicableResources} 件）`,
      direction: "flat",
      severity: reliabilityCoverage.supportedCoveragePercent === 100 ? "healthy" : "info",
      points: [
        reliabilityCoverage.supportedCoveragePercent ?? 0,
        reliabilityCoverage.supportedCoveragePercent ?? 0
      ]
    },
    {
      label: "コストの収集範囲",
      value: costCoverageLabel(costStatus.availability),
      change: "公開用に丸めた値",
      direction: "flat",
      severity: costStatus.availability === "available" ? "healthy" : "warning",
      points: [1, 1]
    },
    ...(security.status.availability !== "unavailable"
      ? [
          {
            label: "Defender recommendations",
            value: String(recommendations.filter((item) => item.status === "Open").length),
            change: "集計タイトルのみ",
            direction: "flat" as const,
            severity: recommendations.some((item) => item.severity === "critical")
              ? ("warning" as const)
              : ("info" as const),
            points: [recommendations.length, recommendations.length]
          }
        ]
      : []),
    {
      label: "利用不可のソース",
      value: String(unavailableCount),
      change: "未収集を明示",
      direction: "flat",
      severity: unavailableCount ? "warning" : "healthy",
      points: [unavailableCount, unavailableCount]
    }
  ],
  postureScore: healthPercent,
  events: [
    {
      id: "collection-complete",
      timestamp: "現在のスナップショット",
      severity: unavailableCount ? "warning" : "healthy",
      title: "Azure データ収集が完了",
      detail: `${resources.length} 件のリソースをサニタイズし、利用不可の任意ソースは ${unavailableCount} 件でした。`,
      route: "/overview"
    },
    ...(activity.value ?? []).slice(0, 4).map((event, eventIndex) => ({
      id: `activity-${eventIndex}`,
      timestamp: event.eventTimestamp ?? "収集時刻不明",
      severity:
        event.level === "Critical"
          ? ("critical" as const)
          : event.level === "Error"
            ? ("warning" as const)
            : ("info" as const),
      title: `${normalizeActivityOperationLabel(event)}を検出`,
      detail: "公開前に実行者と対象リソースの詳細を削除しています。",
      route: "/overview"
    })),
    ...(serviceHealth.value ?? []).slice(0, 2).map((event, eventIndex) => ({
      id: `service-health-${eventIndex}`,
      timestamp: "現在の収集期間",
      severity:
        (event.properties?.Status ?? event.properties?.status ?? "").toLowerCase() === "active"
          ? ("warning" as const)
          : ("info" as const),
      title: "Service Health イベントを検出",
      detail:
        "影響を受けたサブスクリプションやリソースの詳細を除き、サービス単位の状態のみを表示します。",
      route: "/reliability"
    }))
  ],
  regionalHealth: Object.entries(
    resources.reduce<
      Record<string, { evaluated: number; healthy: number; degraded: number; unavailable: number }>
    >((regions, resource) => {
      if (resource.status === "Unknown" || resource.status === "NotApplicable") return regions;
      const region = resource.location ?? "Unknown";
      regions[region] ??= { evaluated: 0, healthy: 0, degraded: 0, unavailable: 0 };
      regions[region].evaluated += 1;
      if (resource.status === "Healthy") regions[region].healthy += 1;
      if (resource.status === "Degraded") regions[region].degraded += 1;
      if (resource.status === "Unavailable") regions[region].unavailable += 1;
      return regions;
    }, {})
  )
    .filter(([, counts]) => counts.evaluated > 0)
    .slice(0, 8)
    .map(([region, counts]) => {
      const score = Math.round((counts.healthy / counts.evaluated) * 100);
      const status =
        counts.unavailable > 0
          ? ("critical" as const)
          : counts.degraded > 0
            ? ("warning" as const)
            : ("healthy" as const);
      return { region, score, status };
    }),
  exactCostJpy: costData.currentTotalJpy,
  exactPreviousCostJpy: costData.previousTotalJpy,
  forecastCostJpy: null,
  budgetLimitJpy: null,
  normalizedCostTrend: [],
  costCategories: costData.categories,
  resources,
  reliability: {
    availability:
      healthPercent === null
        ? "公開スナップショットでは未取得"
        : `評価済みリソースの ${healthPercent}% が正常`,
    ...uncollectedIncidentMetric(),
    meanTimeToRecover: "公開スナップショットでは未算出",
    services: [],
    serviceHealth: serviceHealthSummary
  },
  security: {
    secureScore,
    activeAlerts: security.value?.alertCount ?? null,
    recommendations,
    compliance:
      security.value &&
      security.value.regulatoryCount !== null &&
      security.value.regulatoryCount > 0 &&
      secureScore !== null
        ? [{ framework: "規制コンプライアンスの集計", score: secureScore }]
        : []
  },
  networkInventory: (network.value?.inventory ?? []).map((item) => ({
    id: item.id,
    type: item.type,
    location: item.location
  })),
  networkMetricCoverage: network.value?.coverage ?? null,
  networkTelemetry: {
    availability: "unavailable",
    message:
      "Flow telemetry was not collected. Network resource existence is not interpreted as connection health.",
    flows: []
  },
  aiInsights: insights
};

const sanitized = publicSnapshotSchema.parse(sanitizeSnapshot(raw));
const temporary = `${output}.tmp`;
await mkdir(dirname(output), { recursive: true });
await writeFile(temporary, `${JSON.stringify(sanitized, null, 2)}\n`, "utf8");
await rm(output, { force: true });
await rename(temporary, output);
console.log(`Collected and sanitized Azure snapshot: ${output}`);
