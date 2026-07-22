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
        message: "Synthetic inventory mirrors a read-only Resource Graph collection."
      },
      {
        source: "Cost Management",
        availability: "available",
        message: "Rounded JPY approximations and percentages only."
      },
      {
        source: "Resource Health",
        availability: "available",
        message: "Health and activity signals normalized for the demo."
      },
      {
        source: "Defender for Cloud",
        availability: "partial",
        message: "Recommendations and aggregate counts; advanced plan data omitted."
      },
      {
        source: "Network inventory",
        availability: "available",
        message: "Endpoints are masked or reduced to service classification."
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
        timestamp: "18 min ago",
        severity: "warning",
        title: "Compute cost variance detected",
        detail: "Normalized spend moved 11.4% above its trailing baseline.",
        route: "/cost"
      },
      {
        id: "security-closed-02",
        timestamp: "1 hr ago",
        severity: "healthy",
        title: "Security recommendation resolved",
        detail: "Aggregate affected-resource count decreased from 5 to 2.",
        route: "/security"
      },
      {
        id: "latency-watch-03",
        timestamp: "3 hrs ago",
        severity: "warning",
        title: "Application latency threshold crossed",
        detail: "P95 exceeded the service target in 3 of 12 intervals.",
        route: "/reliability"
      },
      {
        id: "inventory-change-04",
        timestamp: "Yesterday",
        severity: "info",
        title: "Inventory change observed",
        detail: "Two sanitized resources were added to the monitored estate.",
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
    forecastCostJpy: 1_430_000,
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
        change: "Configuration updated 2 days ago"
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
        change: "No material change"
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
        change: "Rule set updated 5 days ago"
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
        change: "Scale-out event 3 hours ago"
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
        change: "Retention policy unchanged"
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
        change: "Model deployment updated yesterday"
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
        change: "No material change"
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
        change: "Backend health variance observed"
      }
    ],
    reliability: {
      availability: "99.94%",
      incidents: 1,
      meanTimeToRecover: "38 min",
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
    networkFlows: [
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
    ],
    aiInsights: [
      {
        id: "compute-cost-rise",
        severity: "warning",
        title: "Compute growth is outpacing the overall cost trend",
        observation:
          "Compute increased faster than the portfolio while normalized reliability remained stable.",
        impact:
          "If the current direction continues, forecast spend may approach the configured public budget guardrail.",
        numericEvidence: [
          { label: "Compute delta", value: "+11.4%", source: "cost.categories.0.deltaPercent" },
          { label: "Portfolio delta", value: "+7.8%", source: "cost.deltaPercent" },
          { label: "Budget used", value: "87%", source: "cost.budgetUsedPercent" }
        ],
        recommendedAction:
          "Review the largest compute change drivers and validate scale settings before the next collection.",
        confidence: 0.92,
        period: "Last 30 days",
        route: "/cost"
      },
      {
        id: "edge-error-budget",
        severity: "warning",
        title: "Global edge error budget is materially lower than peers",
        observation:
          "The global edge service is below its objective while other monitored services remain above target.",
        impact:
          "Further latency or availability degradation could exhaust the remaining error budget.",
        numericEvidence: [
          { label: "Actual", value: "99.86%", source: "reliability.services.2.actual" },
          { label: "Objective", value: "99.90%", source: "reliability.services.2.objective" },
          {
            label: "Budget remaining",
            value: "28%",
            source: "reliability.services.2.budgetRemainingPercent"
          }
        ],
        recommendedAction:
          "Compare recent edge configuration changes with the latency intervals shown in Reliability.",
        confidence: 0.88,
        period: "Rolling 30 days",
        route: "/reliability"
      },
      {
        id: "security-concentration",
        severity: "critical",
        title: "One critical security recommendation remains open",
        observation:
          "The aggregate recommendation set includes one critical item affecting one protected resource.",
        impact:
          "Unresolved critical recommendations can reduce the overall secure score and risk tolerance.",
        numericEvidence: [
          {
            label: "Affected resources",
            value: "1",
            source: "security.recommendations.1.affectedCount"
          },
          { label: "Secure score", value: "77%", source: "security.secureScore" }
        ],
        recommendedAction:
          "Open Defender for Cloud privately and review the critical recommendation with the asset owner.",
        confidence: 0.96,
        period: "Current snapshot",
        route: "/security"
      },
      {
        id: "network-latency",
        severity: "info",
        title: "A classified external path shows elevated latency",
        observation:
          "One masked external connection is degraded while first-party service paths remain healthy.",
        impact:
          "The affected integration may contribute to tail latency without indicating a broad network incident.",
        numericEvidence: [
          { label: "Degraded flows", value: "1", source: "network.degradedConnections" },
          { label: "Observed latency", value: "168 ms", source: "network.flows.2.latency" },
          { label: "Healthy flows", value: "3", source: "network.healthyConnections" }
        ],
        recommendedAction:
          "Validate provider status and compare the path against private network telemetry.",
        confidence: 0.81,
        period: "Last 24 hours",
        route: "/network"
      }
    ]
  };
}
