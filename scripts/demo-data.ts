import type { RawSnapshot } from "../src/data/contracts";

const guid = (...segments: string[]) => segments.join("-");
const address = (...octets: string[]) => octets.join(".");
const identity = (name: string, domain: string) => [name, domain].join("@");

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
        message: "この合成データは読み取り専用の Resource Graph 収集を模したものです。"
      },
      {
        source: "Cost Management",
        availability: "available",
        message:
          "今回期間と比較期間の概算 JPY を示す合成データです。予測値と予算は利用できません。"
      },
      {
        source: "Resource Health",
        availability: "available",
        message: "デモ用に正規化した健全性およびアクティビティ信号です。"
      },
      {
        source: "Defender for Cloud",
        availability: "partial",
        message: "推奨事項と集計件数のみを表示し、上位プランのデータは含みません。"
      },
      {
        source: "ネットワークインベントリ",
        availability: "available",
        message: "エンドポイントはマスクするか、サービス分類のみに縮約しています。"
      }
    ],
    metrics: [
      {
        label: "Resources healthy",
        value: "92%",
        change: "+1.8 pts",
        direction: "up",
        severity: "healthy",
        points: [82, 84, 83, 86, 87, 88, 90, 89, 91, 92]
      },
      {
        label: "Cost movement",
        value: "+7.8%",
        change: "vs prior period",
        direction: "up",
        severity: "warning",
        points: [64, 65, 68, 70, 69, 74, 76, 78, 81, 84]
      },
      {
        label: "Open alerts",
        value: "2",
        change: "3 resolved",
        direction: "down",
        severity: "healthy",
        points: [8, 7, 7, 6, 5, 6, 4, 3, 3, 2]
      },
      {
        label: "Availability",
        value: "99.94%",
        change: "+0.03 pts",
        direction: "up",
        severity: "healthy",
        points: [99.7, 99.8, 99.76, 99.86, 99.9, 99.88, 99.94]
      }
    ],
    postureScore: 87,
    events: [
      {
        id: "cost-variance-01",
        timestamp: "18分前",
        severity: "warning",
        title: "コンピューティングのコスト変動を検知",
        detail: "正規化後の支出が直近の基準値から 11.4% 上振れしました。",
        route: "/cost"
      },
      {
        id: "security-closed-02",
        timestamp: "1時間前",
        severity: "healthy",
        title: "セキュリティ推奨事項が解決済みに",
        detail: "影響を受けるリソースの集計件数が 5 件から 2 件に減少しました。",
        route: "/security"
      },
      {
        id: "latency-watch-03",
        timestamp: "3時間前",
        severity: "warning",
        title: "アプリケーションのレイテンシがしきい値を超過",
        detail: "12 回中 3 回の区間で P95 がサービス目標を超えました。",
        route: "/reliability"
      },
      {
        id: "inventory-change-04",
        timestamp: "昨日",
        severity: "info",
        title: "インベントリの変更を検知",
        detail: "監視対象の構成に、サニタイズ済みリソースが 2 件追加されました。",
        route: "/resources"
      }
    ],
    regionalHealth: [
      { region: "Japan East", score: 96, status: "healthy" },
      { region: "Japan West", score: 91, status: "healthy" },
      { region: "Southeast Asia", score: 84, status: "warning" },
      { region: "Global", score: 98, status: "healthy" }
    ],
    exactCostJpy: 1_248_730,
    exactPreviousCostJpy: 1_158_380,
    forecastCostJpy: null,
    budgetLimitJpy: null,
    normalizedCostTrend: [68, 72, 69, 76, 81, 79, 86, 83, 89, 92, 88, 94],
    costCategories: [
      { name: "Compute", amountJpy: 508_000, deltaPercent: 11.4 },
      { name: "Databases", amountJpy: 281_000, deltaPercent: 4.1 },
      { name: "Networking", amountJpy: 184_000, deltaPercent: 9.3 },
      { name: "Storage", amountJpy: 151_000, deltaPercent: -3.2 },
      { name: "Security", amountJpy: 124_730, deltaPercent: 2.7 }
    ],
    resources: [
      {
        id: "/subscriptions/demo/resourceGroups/commerce-prod-east/providers/Microsoft.Compute/virtualMachines/api-checkout-01",
        name: "api-checkout-production-01",
        resourceGroup: "commerce-production-japaneast",
        type: "Virtual machine",
        location: "Japan East",
        status: "Healthy",
        owner: identity("commerce-platform", "example.invalid"),
        tags: { environment: "production", team: "commerce", criticality: "high" },
        change: "2日前に構成が更新されました"
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
        change: "重大な変更はありません"
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
        change: "5日前にルールセットが更新されました"
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
        change: "3時間前にスケールアウトが発生しました"
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
        change: "保持ポリシーは変更されていません"
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
        change: "昨日モデルのデプロイが更新されました"
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
        change: "重大な変更はありません"
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
        change: "バックエンドの健全性に変動を検知しました"
      }
    ],
    reliability: {
      availability: "99.94%",
      incidents: 1,
      meanTimeToRecover: "38分",
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
      ]
    },
    security: {
      secureScore: 77,
      activeAlerts: 2,
      recommendations: [
        {
          title: "Enable adaptive application controls on compute",
          severity: "warning",
          affectedCount: 2,
          status: "In progress"
        },
        {
          title: "Apply system updates to protected resources",
          severity: "critical",
          affectedCount: 1,
          status: "Open"
        },
        {
          title: "Review least-privilege network access",
          severity: "warning",
          affectedCount: 4,
          status: "Open"
        },
        {
          title: "Enable diagnostic coverage for supported services",
          severity: "healthy",
          affectedCount: 0,
          status: "Resolved"
        }
      ],
      compliance: [
        { framework: "Microsoft cloud security benchmark", score: 81 },
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
    networkTelemetry: {
      availability: "available",
      message: "合成デモのフローテレメトリです。Azure インベントリの存在は接続の健全性として扱いません。",
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
        title: "コンピューティングの増加がコスト全体の傾向を上回っています",
        observation:
          "正規化後の信頼性は安定したまま、コンピューティングはポートフォリオ全体よりも速く増加しました。",
        impact:
          "この差が続くと、次回の比較期間でポートフォリオ全体のコスト変化が拡大する可能性があります。",
        numericEvidence: [
          { label: "コンピューティングの変化率", value: "+11.4%", source: "cost.categories.0.deltaPercent" },
          { label: "ポートフォリオ全体の変化率", value: "+7.8%", source: "cost.deltaPercent" }
        ],
        recommendedAction:
          "最も影響の大きいコンピューティングの変動要因を確認し、次回収集前にスケール設定を確認してください。",
        confidence: 0.92,
        period: "過去30日間",
        route: "/cost"
      },
      {
        id: "edge-error-budget",
        severity: "warning",
        title: "グローバルエッジのエラーバジェットが他サービスより大幅に低下",
        observation:
          "他の監視対象サービスが目標を上回る中、グローバルエッジサービスは目標を下回っています。",
        impact:
          "さらにレイテンシや可用性が悪化すると、残りのエラーバジェットを使い切る可能性があります。",
        numericEvidence: [
          { label: "実測値", value: "99.86%", source: "reliability.services.2.actual" },
          { label: "目標値", value: "99.90%", source: "reliability.services.2.objective" },
          {
            label: "残エラーバジェット",
            value: "28%",
            source: "reliability.services.2.budgetRemainingPercent"
          }
        ],
        recommendedAction:
          "直近のエッジ構成の変更内容を、信頼性ページに表示されているレイテンシの区間と比較してください。",
        confidence: 0.88,
        period: "直近30日間（ローリング）",
        route: "/reliability"
      },
      {
        id: "security-concentration",
        severity: "critical",
        title: "重大なセキュリティ推奨事項が1件未対応です",
        observation:
          "集計された推奨事項には、保護対象リソース1件に影響する重大な項目が1件含まれています。",
        impact:
          "未解決の重大な推奨事項は、全体の Secure Score とリスク許容度を低下させる可能性があります。",
        numericEvidence: [
          {
            label: "影響を受けるリソース数",
            value: "1",
            source: "security.recommendations.1.affectedCount"
          },
          { label: "Secure Score", value: "77%", source: "security.secureScore" }
        ],
        recommendedAction:
          "Defender for Cloud を個別に開き、資産の担当者とともに重大な推奨事項を確認してください。",
        confidence: 0.96,
        period: "現在のスナップショット",
        route: "/security"
      },
      {
        id: "network-latency",
        severity: "info",
        title: "分類済みの外部経路でレイテンシの上昇を検知",
        observation:
          "自社サービスの経路は健全なままですが、マスクされた外部接続の1件が劣化しています。",
        impact:
          "広範なネットワーク障害を示すものではありませんが、対象の連携がテールレイテンシの一因となっている可能性があります。",
        numericEvidence: [
          {
            label: "劣化しているフロー数",
            value: "1",
            source: "network.telemetry.degradedConnections"
          },
          {
            label: "観測されたレイテンシ",
            value: "168 ms",
            source: "network.telemetry.flows.2.latency"
          },
          {
            label: "健全なフロー数",
            value: "3",
            source: "network.telemetry.healthyConnections"
          }
        ],
        recommendedAction:
          "プロバイダーの状態を確認し、この経路をプライベートネットワークのテレメトリと比較してください。",
        confidence: 0.81,
        period: "過去24時間",
        route: "/network"
      }
    ]
  };
}
