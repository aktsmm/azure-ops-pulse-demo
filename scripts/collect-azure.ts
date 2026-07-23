import { execFileSync } from "node:child_process";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  AiInsight,
  RawResource,
  RawSnapshot,
  SecurityRecommendation,
  SourceStatus
} from "../src/data/contracts";
import { sanitizeSnapshot } from "../src/lib/sanitize";
import { uncollectedIncidentMetric } from "./reliability-metrics";
import {
  comparableCostPeriods,
  costCoverageLabel,
  transformComparableCost,
  type CostQueryProperties
} from "./cost-transform";
import {
  normalizeActivityOperationLabel,
  type AzureActivityEvent
} from "./activity-normalization";
import { publicSnapshotSchema } from "./public-schema";

interface GraphResponse<T> {
  data?: T[];
  count?: number;
  totalRecords?: number;
  total_records?: number;
  skipToken?: string;
  skip_token?: string;
}

function runAzJson<T>(args: string[]): T {
  const operation = args.slice(0, 2).join(" ");
  try {
    const output = execFileSync("az", [...args, "--output", "json", "--only-show-errors"], {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"]
    });
    return JSON.parse(output) as T;
  } catch {
    throw new Error(`Azure CLI ${operation} failed; response content was intentionally suppressed`);
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

function optionalSource<T>(
  source: string,
  operation: () => T,
  availableMessage: string,
  unavailableMessage: string
): { value: T | null; status: SourceStatus } {
  try {
    return {
      value: operation(),
      status: { source, availability: "available", message: availableMessage }
    };
  } catch {
    return {
      value: null,
      status: { source, availability: "unavailable", message: unavailableMessage }
    };
  }
}

function percent(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function optionalNumber(value: unknown): number | null {
  const number = Number(value);
  return value !== null && value !== undefined && Number.isFinite(number) ? number : null;
}

function queryCostPeriod(
  subscriptionId: string,
  start: Date,
  end: Date
): CostQueryProperties {
  const result = runAzJson<{ properties?: CostQueryProperties }>([
    "rest",
    "--method",
    "post",
    "--url",
    `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.CostManagement/query?api-version=2025-03-01`,
    "--body",
    JSON.stringify({
      type: "ActualCost",
      timeframe: "Custom",
      timePeriod: { from: start.toISOString(), to: end.toISOString() },
      dataset: {
        granularity: "None",
        aggregation: { totalCost: { name: "Cost", function: "Sum" } },
        grouping: [{ type: "Dimension", name: "ServiceName" }]
      }
    })
  ]);
  return result.properties ?? {};
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

const health = optionalSource(
  "Resource Health",
  () =>
    graphQuery<{ id: string; properties?: { availabilityState?: string } }>(
      subscriptionId,
      "HealthResources | where type =~ 'microsoft.resourcehealth/availabilitystatuses' | project id, properties"
    ),
  "Resource Health availability was collected.",
  "Resource Health is unavailable or the current role cannot read it."
);

const serviceHealth = optionalSource(
  "Service Health",
  () =>
    graphQuery<{ properties?: { title?: string; status?: string } }>(
      subscriptionId,
      "HealthResources | where type =~ 'microsoft.resourcehealth/events' | project properties"
    ),
  "Service Health events were collected in aggregate.",
  "Service Health events are unavailable or the current role cannot read them."
);

const activity = optionalSource(
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
  "Recent Activity Log events were collected without actor or resource detail.",
  "Activity Log is unavailable or the current role cannot read it."
);

const security = optionalSource(
  "Defender for Cloud",
  () => {
    const assessments = graphQuery<{
      properties?: {
        displayName?: string;
        status?: { severity?: string; code?: string };
      };
    }>(
      subscriptionId,
      "SecurityResources | where type =~ 'microsoft.security/assessments' | project properties"
    );
    const subassessmentCount = graphQuery<{ count_: number }>(
      subscriptionId,
      "SecurityResources | where type contains 'subassessments' | summarize count_ = count()"
    )[0]?.count_;
    const controls = graphQuery<{ percentageScore?: number }>(
      subscriptionId,
      "SecurityResources | where type == 'microsoft.security/securescores/securescorecontrols' | project percentageScore=todouble(properties.score.percentage)"
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
      controls,
      alertCount: optionalNumber(alertCount),
      regulatoryCount: optionalNumber(regulatoryCount)
    };
  },
  "Defender assessments, subassessment counts, secure score controls, alerts, and compliance aggregates were collected.",
  "Defender data is unavailable; plans may be disabled or permissions may be insufficient."
);

const costPeriods = comparableCostPeriods(new Date());

const currentCost = optionalSource(
  "Cost Management",
  () => queryCostPeriod(subscriptionId, costPeriods.current.start, costPeriods.current.end),
  "Current Cost Management period was collected.",
  "Current Cost Management period is unavailable; billing scope or role access may be required."
);
const previousCost = optionalSource(
  "Cost Management prior period",
  () => queryCostPeriod(subscriptionId, costPeriods.previous.start, costPeriods.previous.end),
  "Prior comparable Cost Management period was collected.",
  "Prior comparable Cost Management period is unavailable."
);

const network = optionalSource(
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
    let metricSeries = 0;
    let metricFailures = 0;
    for (const resource of inventory.slice(0, 20)) {
      try {
        const metrics = runAzJson<{ value?: Array<{ timeseries?: unknown[] }> }>([
          "monitor",
          "metrics",
          "list",
          "--resource",
          resource.id,
          "--offset",
          "24h",
          "--interval",
          "PT1H"
        ]);
        metricSeries += (metrics.value ?? []).reduce(
          (count, metric) => count + (metric.timeseries?.length ?? 0),
          0
        );
      } catch {
        metricFailures += 1;
      }
    }
    return { inventory, metricSeries, metricFailures };
  },
  "Network inventory and supported Azure Monitor metric series were collected.",
  "Network inventory and metrics are unavailable."
);
const networkStatus: SourceStatus =
  network.status.availability === "available"
    ? {
        source: "Network inventory and metrics",
        availability: "partial",
        message: `Network inventory was collected with ${network.value?.metricSeries ?? 0} supported metric series; ${network.value?.metricFailures ?? 0} sampled resources had unavailable metrics. Flow telemetry was not collected.`
      }
    : network.status;

const healthByResource = new Map(
  (health.value ?? []).map((item) => [
    item.id.split("/providers/Microsoft.ResourceHealth")[0]?.toLowerCase(),
    item.properties?.availabilityState
  ])
);
const resources: RawResource[] = rawResources.map((resource) => ({
  ...resource,
  status: (() => {
    const state = healthByResource.get(resource.id.toLowerCase())?.toLowerCase();
    if (state === "available") return "Healthy";
    if (state === "degraded") return "Degraded";
    if (state === "unavailable") return "Unavailable";
    return "Unknown";
  })(),
  owner:
    typeof resource.tags?.owner === "string"
      ? resource.tags.owner
      : typeof resource.tags?.team === "string"
        ? resource.tags.team
        : "unassigned",
  change: "Collected from Azure Resource Graph"
}));

const costData = transformComparableCost(currentCost.value, previousCost.value);
const costStatus: SourceStatus =
  currentCost.status.availability === "unavailable" || !costData.currentCurrencyVerifiedJpy
    ? {
        source: "Cost Management",
        availability: "unavailable",
        message:
          currentCost.status.availability === "unavailable"
            ? currentCost.status.message
            : "Billing currency is not verified as JPY; no unverified conversion was published."
      }
    : previousCost.status.availability === "unavailable" ||
        !costData.previousCurrencyVerifiedJpy
      ? {
          source: "Cost Management",
          availability: "partial",
          message:
            "Current rounded JPY cost was collected; the prior comparable period is unavailable."
        }
      : {
          source: "Cost Management",
          availability: "available",
          message: "Current and prior comparable rounded JPY periods were collected."
        };

const recommendationCounts = new Map<string, SecurityRecommendation>();
for (const item of security.value?.assessments ?? []) {
  const title = item.properties?.displayName ?? "Defender recommendation";
  const current = recommendationCounts.get(title);
  const severity = item.properties?.status?.severity?.toLowerCase();
  const isOpen =
    item.properties?.status?.code !== "Healthy" &&
    item.properties?.status?.code !== "NotApplicable";
  const severityRank = { info: 0, warning: 1, critical: 2 } as const;
  const itemSeverity =
    isOpen && severity === "high"
      ? ("critical" as const)
      : isOpen && severity === "medium"
        ? ("warning" as const)
        : ("info" as const);
  const currentSeverity =
    current?.severity === "critical"
      ? "critical"
      : current?.severity === "warning"
        ? "warning"
        : "info";
  recommendationCounts.set(title, {
    title,
    severity:
      severityRank[itemSeverity] > severityRank[currentSeverity] ? itemSeverity : currentSeverity,
    affectedCount: (current?.affectedCount ?? 0) + (isOpen ? 1 : 0),
    status: current?.status === "Open" || isOpen ? "Open" : "Resolved"
  });
}
const recommendations = [...recommendationCounts.values()].slice(0, 12);
const secureScoreValues = (security.value?.controls ?? [])
  .map((item) => percent(item.percentageScore, Number.NaN))
  .filter(Number.isFinite);
const secureScore: number | null = secureScoreValues.length
  ? Math.max(
      0,
      Math.min(
        100,
        Math.round(
          secureScoreValues.reduce((sum, value) => sum + value, 0) / secureScoreValues.length
        )
      )
    )
  : null;

const unavailableCount = [
  health.status,
  serviceHealth.status,
  activity.status,
  security.status,
  costStatus,
  networkStatus
].filter((item) => item.availability === "unavailable").length;
const healthyCount = resources.filter((resource) => resource.status === "Healthy").length;
const evaluatedResources = resources.filter((resource) => resource.status !== "Unknown");
const healthCoveragePercent = resources.length
  ? Math.round((evaluatedResources.length / resources.length) * 100)
  : 0;
const healthPercent = evaluatedResources.length
  ? Math.round((healthyCount / evaluatedResources.length) * 100)
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
    health.status,
    serviceHealth.status,
    activity.status,
    security.status,
    networkStatus
  ],
  metrics: [
    {
      label: "Resource Health coverage",
      value: `${healthCoveragePercent}%`,
      change: `${evaluatedResources.length} of ${resources.length} evaluated`,
      direction: "flat",
      severity: healthCoveragePercent === 100 ? "healthy" : "info",
      points: [healthCoveragePercent, healthCoveragePercent]
    },
    {
      label: "Cost coverage",
      value: costCoverageLabel(costStatus.availability),
      change: "Rounded public view",
      direction: "flat",
      severity: costStatus.availability === "available" ? "healthy" : "warning",
      points: [1, 1]
    },
    ...(security.status.availability === "available"
      ? [
          {
            label: "Defender recommendations",
            value: String(recommendations.filter((item) => item.status === "Open").length),
            change: "Aggregate titles only",
            direction: "flat" as const,
            severity: recommendations.some((item) => item.severity === "critical")
              ? ("warning" as const)
              : ("info" as const),
            points: [recommendations.length, recommendations.length]
          }
        ]
      : []),
    {
      label: "Unavailable sources",
      value: String(unavailableCount),
      change: "Explicitly surfaced",
      direction: "flat",
      severity: unavailableCount ? "warning" : "healthy",
      points: [unavailableCount, unavailableCount]
    }
  ],
  postureScore: healthPercent,
  events: [
    {
      id: "collection-complete",
      timestamp: "Current snapshot",
      severity: unavailableCount ? "warning" : "healthy",
      title: "Azure データ収集が完了",
      detail: `${resources.length} 件のリソースをサニタイズし、利用不可の任意ソースは ${unavailableCount} 件でした。`,
      route: "/overview"
    },
    ...(activity.value ?? []).slice(0, 4).map((event, eventIndex) => ({
      id: `activity-${eventIndex}`,
      timestamp: event.eventTimestamp ?? "Recent",
      severity: event.level === "Error" ? ("warning" as const) : ("info" as const),
      title: `${normalizeActivityOperationLabel(event)}を検出`,
      detail: "公開前に実行者と対象リソースの詳細を削除しています。",
      route: "/overview"
    })),
    ...(serviceHealth.value ?? []).slice(0, 2).map((event, eventIndex) => ({
      id: `service-health-${eventIndex}`,
      timestamp: "Current collection window",
      severity: event.properties?.status === "Active" ? ("warning" as const) : ("info" as const),
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
      const region = resource.location ?? "Unknown";
      regions[region] ??= { evaluated: 0, healthy: 0, degraded: 0, unavailable: 0 };
      if (resource.status === "Unknown") return regions;
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
        ? "Unavailable from public snapshot"
        : `${healthPercent}% of evaluated resources available`,
    ...uncollectedIncidentMetric(),
    meanTimeToRecover: "Unavailable from public snapshot",
    services: []
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
        ? [{ framework: "Regulatory compliance aggregate", score: secureScore }]
        : []
  },
  networkInventory: (network.value?.inventory ?? []).map((item) => ({
    id: item.id,
    type: item.type,
    location: item.location
  })),
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
