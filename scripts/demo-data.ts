import type {
  RawResource,
  RawSnapshot,
  SecurityRecommendation
} from "../src/data/contracts";
import { snapshotInsightPeriod } from "./insight-period";
import { localizeServiceHealthEventType } from "./service-health-event-types";

const guid = (...segments: string[]) => segments.join("-");
const address = (...octets: string[]) => octets.join(".");
const identity = (name: string, domain: string) => [name, domain].join("@");

/**
 * Activity timestamps are ISO strings offset from the generation time, the same shape the Azure
 * collector publishes. Storing a frozen relative phrase such as "18 min ago" would keep the demo
 * timeline pinned to a moment that never advances, and it would force the UI to parse English.
 */
const minutesBefore = (generatedAt: string, minutes: number): string =>
  new Date(new Date(generatedAt).getTime() - minutes * 60_000).toISOString();

/**
 * The demo snapshot is synthetic, but every value it renders still has to agree with the other
 * values it publishes: a preview that shows "正常なリソース 92%" beside a coverage bar reading 6/8
 * teaches reviewers to distrust the dashboard, and it is the same "honest but misleading" failure
 * the published pipeline is built to prevent. Deriving the headline numbers from the fixtures below
 * means an edit to a resource or a recommendation cannot silently desynchronise the overview.
 *
 * The fixtures are module constants so the derivations can read them, which makes handing them
 * straight to a caller unsafe: tests build a raw snapshot and edit it in place, and a shared array
 * would carry those edits into every later call. Every builder therefore returns a copy.
 */
const EVALUATED_STATUSES = new Set(["Healthy", "Degraded", "Unavailable"]);
const isEvaluated = (resource: RawResource): boolean =>
  resource.status !== undefined && EVALUATED_STATUSES.has(resource.status);
const countResources = (predicate: (resource: RawResource) => boolean): number =>
  DEMO_RESOURCES.filter(predicate).length;
const countRecommendations = (status: SecurityRecommendation["status"]): number =>
  DEMO_RECOMMENDATIONS.filter((item) => item.status === status).length;
const copyOf = <T>(items: readonly T[]): T[] => items.map((item) => structuredClone(item));

/** Mirrors the collector's `healthPercent`: healthy over *evaluated*, never over the inventory. */
function demoHealthyPercent(): number {
  const evaluated = countResources((resource) => isEvaluated(resource));
  const healthy = countResources((resource) => resource.status === "Healthy");
  return Math.round((healthy / evaluated) * 100);
}

const DEMO_COST_JPY = 1_248_730;const DEMO_PREVIOUS_COST_JPY = 1_158_380;
/** The sanitizer derives the published `cost.deltaPercent` from the same two amounts. */
const demoCostDeltaPercent = (): number =>
  Math.round(((DEMO_COST_JPY - DEMO_PREVIOUS_COST_JPY) / DEMO_PREVIOUS_COST_JPY) * 1000) / 10;
const DEMO_AVAILABILITY = "99.94%";

const DEMO_COST_CATEGORIES = [
  { name: "Compute", amountJpy: 508_000, deltaPercent: 11.4 },
  { name: "Databases", amountJpy: 281_000, deltaPercent: 4.1 },
  { name: "Networking", amountJpy: 184_000, deltaPercent: 9.3 },
  { name: "Storage", amountJpy: 151_000, deltaPercent: -3.2 },
  { name: "Security", amountJpy: 124_730, deltaPercent: 2.7 }
];

const DEMO_RESOURCES: RawResource[] = [
  {
    id: "/subscriptions/demo/resourceGroups/commerce-prod-east/providers/Microsoft.Compute/virtualMachines/api-checkout-01",
    name: "api-checkout-production-01",
    resourceGroup: "commerce-production-japaneast",
    type: "Virtual machine",
    location: "Japan East",
    status: "Healthy",
    owner: identity("commerce-platform", "example.invalid"),
    tags: { environment: "production", team: "commerce", criticality: "high" },
    change: "2 日前に構成を更新"
  },
  {
    id: "/subscriptions/demo/resourceGroups/data-platform/providers/Microsoft.Sql/servers/orders-primary",
    name: "orders-primary-database",
    resourceGroup: "data-platform-production",
    type: "Azure SQL",
    location: "Japan East",
    status: "Healthy",
    owner: identity("data-owner", "example.invalid"),
    tags: { environment: "production", team: "data", criticality: "high" },
    change: "特筆すべき変更なし"
  },
  {
    id: "/subscriptions/demo/resourceGroups/edge-network/providers/Microsoft.Network/frontDoors/global-edge",
    name: "global-edge-frontdoor",
    resourceGroup: "edge-network-global",
    type: "Front Door",
    location: "Global",
    status: "Healthy",
    owner: identity("platform-network", "example.invalid"),
    tags: { environment: "production", team: "platform", criticality: "high" },
    change: "5 日前にルール セットを更新"
  },
  {
    id: "/subscriptions/demo/resourceGroups/commerce-prod-west/providers/Microsoft.Web/sites/catalog-api",
    name: "catalog-application-service",
    resourceGroup: "commerce-production-japanwest",
    type: "App Service",
    location: "Japan West",
    status: "Degraded",
    owner: identity("commerce-apps", "example.invalid"),
    tags: { environment: "production", team: "commerce", criticality: "medium" },
    change: "3 時間前にスケールアウトを実施"
  },
  {
    id: "/subscriptions/demo/resourceGroups/telemetry/providers/Microsoft.OperationalInsights/workspaces/ops-central",
    name: "operations-central-workspace",
    resourceGroup: "observability-shared-services",
    type: "Log Analytics",
    location: "Japan East",
    status: "Healthy",
    owner: identity("platform-observability", "example.invalid"),
    tags: { environment: "production", team: "platform", criticality: "high" },
    change: "保持ポリシーに変更なし"
  },
  {
    id: "/subscriptions/demo/resourceGroups/ai-insights/providers/Microsoft.CognitiveServices/accounts/pulse-analysis",
    name: "pulse-analysis-foundry",
    resourceGroup: "ai-insights-development",
    type: "AI service",
    location: "Southeast Asia",
    status: "Healthy",
    owner: identity("platform-ai", "example.invalid"),
    tags: { environment: "development", team: "platform", criticality: "low" },
    change: "前日にモデル デプロイを更新"
  },
  {
    id: "/subscriptions/demo/resourceGroups/storage/providers/Microsoft.Storage/storageAccounts/publicassets",
    name: "operations-public-assets",
    resourceGroup: "shared-storage-production",
    type: "Storage account",
    location: "Japan East",
    status: "Healthy",
    owner: identity("platform-storage", "example.invalid"),
    tags: { environment: "production", team: "platform", criticality: "medium" },
    change: "特筆すべき変更なし"
  },
  {
    id: "/subscriptions/demo/resourceGroups/gateway/providers/Microsoft.Network/applicationGateways/commerce-gateway",
    name: "commerce-application-gateway",
    resourceGroup: "edge-network-japaneast",
    type: "Application Gateway",
    location: "Japan East",
    status: "Degraded",
    owner: identity("platform-network", "example.invalid"),
    tags: { environment: "production", team: "platform", criticality: "high" },
    change: "バックエンドの正常性に変動を検出"
  },
  {
    id: "/subscriptions/demo/resourceGroups/observability/providers/Microsoft.Insights/actionGroups/on-call",
    name: "operations-on-call-action-group",
    resourceGroup: "observability-production",
    type: "Action group",
    location: "Global",
    status: "NotApplicable",
    owner: identity("platform-observability", "example.invalid"),
    tags: { environment: "production", team: "platform", criticality: "low" },
    change: "Azure Resource Health はこの種別を評価しません"
  },
  {
    id: "/subscriptions/demo/resourceGroups/data/providers/Microsoft.DocumentDB/databaseAccounts/pulse-catalog",
    name: "pulse-catalog-cosmos",
    resourceGroup: "data-platform-production",
    type: "Cosmos DB account",
    location: "Japan West",
    status: "Unknown",
    owner: identity("platform-data", "example.invalid"),
    tags: { environment: "production", team: "platform", criticality: "medium" },
    change: "Resource Health が直近の可用性状態を報告していません"
  }
];

const DEMO_RECOMMENDATIONS: SecurityRecommendation[] = [
  // These are demo copy, not Defender for Cloud `displayName` values. An AZURE snapshot never
  // publishes an Azure-authored title at all — `summarizeAssessments` replaces every one with
  // `Defender の推奨事項（タイトル非公開） #N` — so keeping English here would not make the preview
  // any more faithful, it would only leave English on a Japanese page. DEMO keeps titles readable
  // because a preview with nothing but withheld labels shows the reader less than the real page does.
  {
    title: "コンピューティングでアダプティブ アプリケーション制御を有効化する",
    severity: "warning",
    affectedCount: 2,
    status: "In progress"
  },
  {
    title: "保護対象リソースにシステム更新プログラムを適用する",
    severity: "critical",
    affectedCount: 1,
    status: "Open"
  },
  {
    title: "ネットワーク アクセスを最小権限で見直す",
    severity: "warning",
    affectedCount: 4,
    status: "Open"
  },
  {
    title: "対応サービスの診断カバレッジを有効化する",
    severity: "healthy",
    affectedCount: 0,
    status: "Resolved"
  }
];

export function createDemoRawSnapshot(generatedAt = new Date().toISOString()): RawSnapshot {
  return {
    generatedAt,
    mode: "DEMO",
    subscriptionDisplayName: "Visual Studio Enterprise",
    subscriptionId: guid("2f7a51c4", "91b8", "43ef", "a274", "8d36c19e40b7"),
    tenantId: guid("53da711e", "3cf2", "486c", "bc12", "943b0761a58d"),
    sources: [
      {
        source: "Azure Resource Graph",
        availability: "available",
        message: "Synthetic inventory mirrors a read-only Resource Graph collection."
      },
      {
        source: "Cost Management",
        availability: "available",
        message:
          "Synthetic current and prior rounded JPY views; forecast and budget are unavailable."
      },
      {
        source: "Resource Health",
        availability: "available",
        message: "Health and activity signals normalized for the demo."
      },
      {
        source: "Service Health",
        availability: "available",
        message: "Synthetic Service Health events were collected in aggregate."
      },
      {
        source: "Activity Log",
        availability: "available",
        message: "Synthetic Activity Log events were collected without actor or resource detail."
      },
      {
        source: "Defender for Cloud",
        availability: "available",
        message: "Synthetic recommendations and aggregate counts were collected."
      },
      {
        source: "Network inventory and metrics",
        availability: "partial",
        message: "Endpoints are masked or reduced to service classification."
      }
    ],
    metrics: [
      {
        label: "正常なリソース",
        value: `${demoHealthyPercent()}%`,
        change: `評価済み ${countResources(isEvaluated)} 件中 ${countResources((resource) => resource.status === "Healthy")} 件が正常`,
        direction: "flat",
        severity: "healthy",
        points: [demoHealthyPercent(), demoHealthyPercent()]
      },
      {
        label: "コストの変動",
        value: `+${demoCostDeltaPercent()}%`,
        change: "前期間との比較",
        direction: "up",
        severity: "warning",
        points: [demoCostDeltaPercent(), demoCostDeltaPercent()]
      },
      {
        label: "Open alerts",
        value: String(countRecommendations("Open")),
        change: `解決済み ${countRecommendations("Resolved")} 件`,
        direction: "flat",
        severity: "warning",
        points: [countRecommendations("Open"), countRecommendations("Open")]
      },
      {
        label: "可用性",
        value: DEMO_AVAILABILITY,
        change: "サービス目標との比較は信頼性ページ",
        direction: "flat",
        severity: "healthy",
        points: [99.94, 99.94]
      }
    ],
    postureScore: demoHealthyPercent(),
    events: [
      {
        id: "cost-variance-01",
        timestamp: minutesBefore(generatedAt, 18),
        severity: "warning",
        title: "Compute の支出が前期間より増加",
        detail: "Compute の丸め済み支出が前期間比 +11.4% です。",
        route: "/cost"
      },
      {
        id: "security-closed-02",
        timestamp: minutesBefore(generatedAt, 60),
        severity: "healthy",
        title: "セキュリティ推奨事項が解決済み",
        detail: "「対応サービスの診断カバレッジを有効化する」は解決済みで、影響を受けるリソースは 0 件です。",
        route: "/security"
      },
      {
        id: "latency-watch-03",
        timestamp: minutesBefore(generatedAt, 180),
        severity: "warning",
        title: "サービス目標を下回る可用性",
        detail: "Global edge の実測可用性 99.86% が目標の 99.90% を下回っています。",
        route: "/reliability"
      },
      {
        id: "inventory-change-04",
        timestamp: minutesBefore(generatedAt, 60 * 26),
        severity: "info",
        title: "インベントリの構成変更イベント",
        detail: "Activity Log の構成変更イベントです。実行者と対象リソースの詳細は公開前に削除しています。",
        route: "/resources"
      }
    ],
    regionalHealth: [
      { region: "Japan East", score: 96, status: "healthy" },
      { region: "Japan West", score: 91, status: "healthy" },
      { region: "Southeast Asia", score: 84, status: "warning" },
      { region: "Global", score: 98, status: "healthy" }
    ],
    exactCostJpy: DEMO_COST_JPY,
    exactPreviousCostJpy: DEMO_PREVIOUS_COST_JPY,
    forecastCostJpy: null,
    budgetLimitJpy: null,
    normalizedCostTrend: [68, 72, 69, 76, 81, 79, 86, 83, 89, 92, 88, 94],
    costCategories: copyOf(DEMO_COST_CATEGORIES),
    resources: copyOf(DEMO_RESOURCES),
    reliability: {
      availability: DEMO_AVAILABILITY,
      incidentAvailability: "available",
      incidents: 1,
      meanTimeToRecover: "38 分",
      services: [
        {
          name: "Commerce API",
          objective: "99.90%",
          actual: "99.95%",
          incidents: 1,
          status: "healthy",
          budgetRemainingPercent: 62
        },
        {
          name: "Order data",
          objective: "99.95%",
          actual: "99.98%",
          incidents: 0,
          status: "healthy",
          budgetRemainingPercent: 78
        },
        {
          name: "Global edge",
          objective: "99.90%",
          actual: "99.86%",
          incidents: 1,
          status: "warning",
          budgetRemainingPercent: 28
        },
        {
          name: "Observability",
          objective: "99.50%",
          actual: "99.99%",
          incidents: 0,
          status: "healthy",
          budgetRemainingPercent: 91
        }
      ],
      serviceHealth: {
        availability: "available",
        message:
          "Synthetic DEMO Service Health aggregate; only event counts and categories are published.",
        activeEvents: 1,
        resolvedEvents: 3,
        // Written through the collector's own mapping rather than as literal Japanese, so DEMO
        // cannot drift from AZURE and cannot be updated without updating the mapping.
        categories: [
          { label: localizeServiceHealthEventType("ServiceIssue"), count: 3 },
          { label: localizeServiceHealthEventType("HealthAdvisory"), count: 1 }
        ]
      }
    },
    security: {
      secureScore: 77,
      activeAlerts: 2,
      // These titles are demo copy, not Defender for Cloud `displayName` values returned by Azure,
      // so they are written in Japanese like the rest of the reader-facing fixture.
      recommendations: copyOf(DEMO_RECOMMENDATIONS),
      compliance: [
        { framework: "Microsoft クラウド セキュリティ ベンチマーク", score: 81 },
        { framework: "ISO 27001", score: 76 },
        { framework: "PCI DSS", score: 72 }
      ]
    },
    networkInventory: [
      { id: "network-01", type: "microsoft.network/virtualNetworks", location: "Japan East" },
      { id: "network-02", type: "microsoft.network/applicationGateways", location: "Japan East" },
      { id: "network-03", type: "microsoft.network/frontDoors", location: "Global" },
      { id: "network-04", type: "microsoft.network/networkSecurityGroups", location: "Japan West" },
      { id: "network-05", type: "microsoft.network/privateEndpoints", location: "Japan East" }
    ],
    networkMetricCoverage: {
      inventoryTotal: 5,
      sampledResources: 5,
      metricCapableResources: 3,
      metricSeries: 9,
      notApplicableResources: 2,
      failedResources: 0
    },
    networkTelemetry: {
      availability: "available",
      message: "Synthetic DEMO flow telemetry; Azure inventory is not treated as connection health.",
      flows: [
        {
        id: "flow-01",
        source: address("10", "24", "8", "17"),
        destination: "commerce-edge.azurefd.net",
        protocol: "HTTPS",
        status: "Allowed",
        latency: "24 ms",
        throughput: "182 Mbps"
        },
        {
        id: "flow-02",
        source: address("10", "24", "12", "9"),
        destination: "orders-primary.database.windows.net",
        protocol: "TDS",
        status: "Allowed",
        latency: "7 ms",
        throughput: "64 Mbps"
        },
        {
        id: "flow-03",
        source: address("10", "31", "4", "22"),
        destination: address("203", "0", "113", "42"),
        protocol: "HTTPS",
        status: "Degraded",
        latency: "168 ms",
        throughput: "11 Mbps"
        },
        {
        id: "flow-04",
        source: "2603:1030:20e:3::23",
        destination: "telemetry.microsoft.com",
        protocol: "HTTPS",
        status: "Allowed",
        latency: "38 ms",
        throughput: "32 Mbps"
        },
        {
        id: "flow-05",
        source: address("10", "24", "9", "88"),
        destination: "unapproved.example.invalid",
        protocol: "HTTPS",
        status: "Blocked",
        latency: "—",
        throughput: "0 Mbps"
        }
      ]
    },
    aiInsights: [
      {
        id: "compute-cost-rise",
        severity: "warning",
    title: "コンピューティングの増加が全体のコスト増を上回る",
        observation:
          "コンピューティングのコストの増減率が、ポートフォリオ全体の増減率を上回っている。",
        impact:
          "この乖離が続くと、次回の比較期間で全体のコスト変化率がさらに拡大するおそれがある。",
        numericEvidence: [
          {
            label: "コンピューティングの増減率",
            value: "+11.4%",
            source: "cost.categories.0.deltaPercent"
          },
          {
            label: "ポートフォリオ全体の増減率",
            value: "+7.8%",
            source: "cost.deltaPercent"
          }
        ],
        recommendedAction:
          "コスト ページで増加が大きい要因を確認し、次回の収集までにスケール設定を見直すことを推奨する。",
        confidence: 0.92,
        period: snapshotInsightPeriod(generatedAt),
        route: "/cost"
      },
      {
        id: "edge-error-budget",
        severity: "warning",
        title: "グローバル エッジのエラーバジェットが他サービスより少ない",
        observation:
          "グローバル エッジのサービスが目標値を下回っている一方で、他の監視対象サービスは目標を満たしている。",
        impact:
          "レイテンシまたは可用性がさらに低下すると、残りのエラーバジェットを使い切るおそれがある。",
        numericEvidence: [
          { label: "実測の可用性", value: "99.86%", source: "reliability.services.2.actual" },
          { label: "目標の可用性", value: "99.90%", source: "reliability.services.2.objective" },
          {
            label: "エラーバジェットの残量",
            value: "28%",
            source: "reliability.services.2.budgetRemainingPercent"
          }
        ],
        recommendedAction:
          "信頼性ページのサービス目標とエラー バジェット残量を確認し、直近のエッジ構成変更と突き合わせることを推奨する。",
        confidence: 0.88,
        period: snapshotInsightPeriod(generatedAt),
        route: "/reliability"
      },
      {
        id: "security-concentration",
        severity: "critical",
        title: "重大度の高いセキュリティ推奨事項が 1 件未対応",
        observation:
          "集計した推奨事項のうち 1 件が重大度クリティカルで、保護対象リソース 1 件に影響している。",
        impact:
          "重大度の高い推奨事項が未対応のままだと、セキュア スコアと許容できるリスクの水準が低下するおそれがある。",
        numericEvidence: [
          {
            label: "影響を受けるリソース数",
            value: "1",
            source: "security.recommendations.1.affectedCount"
          },
          { label: "セキュア スコア", value: "77%", source: "security.secureScore" }
        ],
        recommendedAction:
          "Defender for Cloud を非公開の環境で開き、資産の所有者とクリティカルな推奨事項を確認することを推奨する。",
        confidence: 0.96,
        period: snapshotInsightPeriod(generatedAt),
        route: "/security"
      },
      {
        id: "network-latency",
        severity: "info",
        title: "分類済みの外部通信経路で高いレイテンシを観測",
        observation:
          "マスク済みの外部接続 1 件が低下と分類されている一方で、ファーストパーティのサービス経路は正常と分類されている。",
        impact:
          "該当する連携がテール レイテンシに寄与している可能性はあるが、ネットワーク全体の障害を示すものではない。",
        numericEvidence: [
          {
            label: "低下している通信経路数",
            value: "1",
            source: "network.telemetry.degradedConnections"
          },
          {
            label: "観測されたレイテンシ",
            value: "168 ms",
            source: "network.telemetry.flows.2.latency"
          },
          {
            label: "正常な通信経路数",
            value: "3",
            source: "network.telemetry.healthyConnections"
          }
        ],
        recommendedAction:
          "プロバイダー側の稼働状況を確認し、プライベート ネットワークのテレメトリと経路を比較することを推奨する。",
        confidence: 0.81,
        period: snapshotInsightPeriod(generatedAt),
        route: "/network"
      }
    ]
  };
}
