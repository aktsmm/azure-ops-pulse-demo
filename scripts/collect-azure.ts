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
import { activityTitleJa } from "./activity-normalize";
import {
  comparableCostPeriods,
  costCoverageLabel,
  transformComparableCost,
  type CostQueryProperties
} from "./cost-transform";
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
  "Resource Health の可用性情報を収集しました。",
  "Resource Health を利用できないか、現在のロールでは読み取れません。"
);

const serviceHealth = optionalSource(
  "Service Health",
  () =>
    graphQuery<{ properties?: { title?: string; status?: string } }>(
      subscriptionId,
      "HealthResources | where type =~ 'microsoft.resourcehealth/events' | project properties"
    ),
  "Service Health のイベントを集計で収集しました。",
  "Service Health のイベントを利用できないか、現在のロールでは読み取れません。"
);

const activity = optionalSource(
  "Activity Log",
  () =>
    runAzJson<Array<{ category?: string; level?: string; eventTimestamp?: string }>>([
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
  "直近の Activity Log イベントを、実行者やリソースの詳細を除いて収集しました。",
  "Activity Log を利用できないか、現在のロールでは読み取れません。"
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
      subassessmentCount: percent(subassessmentCount),
      controls,
      alertCount: percent(alertCount),
      regulatoryCount: percent(regulatoryCount)
    };
  },
  "Defender の評価、サブ評価件数、Secure Score の管理項目、アラート、コンプライアンス集計を収集しました。",
  "Defender のデータを利用できません。プランが無効か、権限が不足している可能性があります。"
);

const costPeriods = comparableCostPeriods(new Date());

const currentCost = optionalSource(
  "Cost Management",
  () => queryCostPeriod(subscriptionId, costPeriods.current.start, costPeriods.current.end),
  "今回の Cost Management 期間を収集しました。",
  "今回の Cost Management 期間を利用できません。課金スコープまたはロールへのアクセス権が必要な可能性があります。"
);
const previousCost = optionalSource(
  "Cost Management prior period",
  () => queryCostPeriod(subscriptionId, costPeriods.previous.start, costPeriods.previous.end),
  "比較対象となる直前の Cost Management 期間を収集しました。",
  "比較対象となる直前の Cost Management 期間を利用できません。"
);

const network = optionalSource(
  "ネットワークインベントリとメトリクス",
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
  "ネットワークインベントリと対応する Azure Monitor のメトリクス系列を収集しました。",
  "ネットワークインベントリとメトリクスを利用できません。"
);
const networkStatus: SourceStatus =
  network.status.availability === "available"
    ? {
        source: "ネットワークインベントリとメトリクス",
        availability: "partial",
        message: `ネットワークインベントリを収集しました（対応メトリクス系列: ${network.value?.metricSeries ?? 0} 件、メトリクス取得不可のサンプリング対象リソース: ${network.value?.metricFailures ?? 0} 件）。フローテレメトリは収集していません。`
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
  change: "Azure Resource Graph から収集"
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
            : "課金通貨が JPY であることを確認できないため、未検証の換算は公開していません。"
      }
    : previousCost.status.availability === "unavailable" ||
        !costData.previousCurrencyVerifiedJpy
      ? {
          source: "Cost Management",
          availability: "partial",
          message:
            "今回の概算 JPY コストを収集しましたが、比較対象となる直前期間は利用できません。"
        }
      : {
          source: "Cost Management",
          availability: "available",
          message: "今回期間と比較対象期間の概算 JPY コストを収集しました。"
        };

const recommendationCounts = new Map<string, SecurityRecommendation>();
for (const item of security.value?.assessments ?? []) {
  const title = item.properties?.displayName ?? "Defender の推奨事項";
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
const secureScore = secureScoreValues.length
  ? Math.max(
      0,
      Math.min(
        100,
        Math.round(
          secureScoreValues.reduce((sum, value) => sum + value, 0) / secureScoreValues.length
        )
      )
    )
  : 0;

const unavailableCount = [
  health.status,
  serviceHealth.status,
  activity.status,
  security.status,
  costStatus,
  networkStatus
].filter((item) => item.availability === "unavailable").length;
const healthyCount = resources.filter((resource) => resource.status === "Healthy").length;
const healthPercent = Math.round((healthyCount / Math.max(1, resources.length)) * 100);
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
      message: "読み取り専用のインベントリ収集が完了しました。"
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
      label: "Resources healthy",
      value: `${healthPercent}%`,
      change: `${resources.length} monitored`,
      direction: "flat",
      severity: healthPercent >= 90 ? "healthy" : "warning",
      points: [healthPercent, healthPercent]
    },
    {
      label: "Cost coverage",
      value: costCoverageLabel(costStatus.availability),
      change: "Rounded public view",
      direction: "flat",
      severity: costStatus.availability === "available" ? "healthy" : "warning",
      points: [1, 1]
    },
    {
      label: "Defender recommendations",
      value: String(recommendations.filter((item) => item.status === "Open").length),
      change: "Aggregate titles only",
      direction: "flat",
      severity: recommendations.some((item) => item.severity === "critical")
        ? "warning"
        : "healthy",
      points: [recommendations.length, recommendations.length]
    },
    {
      label: "Unavailable sources",
      value: String(unavailableCount),
      change: "Explicitly surfaced",
      direction: "flat",
      severity: unavailableCount ? "warning" : "healthy",
      points: [unavailableCount, unavailableCount]
    }
  ],
  postureScore: Math.max(0, Math.min(100, healthPercent - unavailableCount * 3)),
  events: [
    {
      id: "collection-complete",
      timestamp: "現在のスナップショット",
      severity: unavailableCount ? "warning" : "healthy",
      title: "Azure の収集が完了しました",
      detail: `${resources.length} 件のリソースをサニタイズしました。オプションのデータソースのうち ${unavailableCount} 件が利用できません。`,
      route: "/overview"
    },
    ...(activity.value ?? []).slice(0, 4).map((event, eventIndex) => ({
      id: `activity-${eventIndex}`,
      timestamp: event.eventTimestamp ?? "最近",
      severity: event.level === "Error" ? ("warning" as const) : ("info" as const),
      title: activityTitleJa(event.category),
      detail: "対象者・リソース・操作の詳細は公開前に削除されています。",
      route: "/overview"
    })),
    ...(serviceHealth.value ?? []).slice(0, 2).map((event, eventIndex) => ({
      id: `service-health-${eventIndex}`,
      timestamp: "今回の収集期間",
      severity: event.properties?.status === "Active" ? ("warning" as const) : ("info" as const),
      title: "Service Health のイベントを検知",
      detail: "サブスクリプションやリソースの詳細を含まない、サービス単位の状態のみを表示しています。",
      route: "/reliability"
    }))
  ],
  regionalHealth: Object.entries(
    resources.reduce<Record<string, { total: number; healthy: number }>>((regions, resource) => {
      const region = resource.location ?? "Unknown";
      regions[region] ??= { total: 0, healthy: 0 };
      regions[region].total += 1;
      if (resource.status === "Healthy") regions[region].healthy += 1;
      return regions;
    }, {})
  )
    .slice(0, 8)
    .map(([region, counts]) => {
      const score = Math.round((counts.healthy / Math.max(1, counts.total)) * 100);
      return { region, score, status: score >= 90 ? ("healthy" as const) : ("warning" as const) };
    }),
  exactCostJpy: costData.currentTotalJpy,
  exactPreviousCostJpy: costData.previousTotalJpy,
  forecastCostJpy: null,
  budgetLimitJpy: null,
  normalizedCostTrend: [],
  costCategories: costData.categories,
  resources,
  reliability: {
    availability: `${healthPercent}%`,
    incidents: resources.filter((resource) => resource.status === "Unavailable").length,
    meanTimeToRecover: "公開スナップショットでは利用できません",
    services: []
  },
  security: {
    secureScore,
    activeAlerts: security.value?.alertCount ?? 0,
    recommendations,
    compliance:
      security.value && security.value.regulatoryCount > 0
        ? [{ framework: "規制コンプライアンス集計", score: secureScore }]
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
      "フローテレメトリは収集していません。ネットワークリソースの存在は接続の健全性として解釈しません。",
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
