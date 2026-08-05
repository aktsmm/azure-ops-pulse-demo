export type Severity = "critical" | "warning" | "healthy" | "info";
export type Availability = "available" | "partial" | "unavailable";

/**
 * `NotApplicable` means Azure Resource Health never evaluates this resource type (対象外).
 * `Unknown` means the resource type is in scope but no availability state was collected (未評価).
 * Collapsing both into `Unknown` made a fully supported subscription look unmonitored.
 */
export type ResourceHealthStatus =
  | "Healthy"
  | "Degraded"
  | "Unavailable"
  | "Unknown"
  | "NotApplicable";

export interface SourceStatus {
  source: string;
  availability: Availability;
  message: string;
}

export interface TrendMetric {
  label: string;
  value: string;
  change: string;
  direction: "up" | "down" | "flat";
  severity: Severity;
  points: number[];
}

export interface ResourceItem {
  id: string;
  name: string;
  resourceGroup: string;
  type: string;
  region: string;
  status: ResourceHealthStatus;
  owner: string;
  tags: Record<string, string>;
  change: string;
}

export interface ActivityEvent {
  id: string;
  timestamp: string;
  severity: Severity;
  title: string;
  detail: string;
  route: string;
}

export interface CostCategory {
  name: string;
  approximateAmount: string;
  sharePercent: number;
  deltaPercent: number | null;
}

export interface CostAmount {
  availability: "available" | "unavailable";
  approximateAmount: string | null;
}

export interface CostBudget {
  availability: "available" | "unavailable";
  usedPercent: number | null;
}

export interface ReliabilityService {
  name: string;
  objective: string;
  actual: string;
  incidents: number;
  status: Severity;
  budgetRemainingPercent: number;
}

/** Explicit split between 対象外 (NotApplicable) and 未評価 (supported but not evaluated). */
export interface ReliabilityCoverage {
  totalResources: number;
  supportedResources: number;
  notApplicableResources: number;
  evaluatedResources: number;
  unevaluatedResources: number;
  healthyResources: number;
  degradedResources: number;
  unavailableResources: number;
  supportedCoveragePercent: number | null;
}

export interface ServiceHealthSummary {
  availability: Availability;
  message: string;
  activeEvents: number | null;
  resolvedEvents: number | null;
  categories: Array<{ label: string; count: number }>;
}

export interface NetworkMetricCoverage {
  inventoryTotal: number;
  sampledResources: number;
  metricCapableResources: number;
  metricSeries: number;
  notApplicableResources: number;
  failedResources: number;
}

export interface SecurityRecommendation {
  title: string;
  severity: Severity;
  affectedCount: number;
  status: "Open" | "In progress" | "Resolved";
}

export interface NetworkFlow {
  id: string;
  source: string;
  destination: string;
  protocol: string;
  status: "Allowed" | "Degraded" | "Blocked";
  latency: string;
  throughput: string;
}

export interface NetworkInventoryItem {
  id: string;
  type: string;
  location?: string | null;
}

export interface AiInsight {
  id: string;
  severity: Severity;
  title: string;
  observation: string;
  impact: string;
  numericEvidence: Array<{
    label: string;
    value: string;
    source: string;
  }>;
  recommendedAction: string;
  confidence: number;
  period: string;
  route: string;
}

export interface PublicSnapshotV1 {
  schemaVersion: "1.4.0";
  generatedAt: string;
  mode: "DEMO" | "AZURE";
  freshness: {
    state: "fresh" | "stale";
    ageMinutes: number;
    lastSuccessfulCollection: string;
    nextScheduledCollection: string;
  };
  scope: {
    displayName: string;
    subscriptionId: string;
    tenantId: string;
  };
  sources: SourceStatus[];
  overview: {
    metrics: TrendMetric[];
    postureScore: number | null;
    eventTimeline: ActivityEvent[];
    regionalHealth: Array<{ region: string; score: number; status: Severity }>;
  };
  cost: {
    current: CostAmount;
    previous: CostAmount;
    deltaPercent: number | null;
    forecast: CostAmount;
    budget: CostBudget;
    normalizedTrend: number[];
    categories: CostCategory[];
  };
  inventory: {
    total: number;
    resources: ResourceItem[];
    byType: Array<{ label: string; count: number }>;
    byRegion: Array<{ label: string; count: number }>;
  };
  reliability: {
    availability: string;
    incidentAvailability: "available" | "unavailable";
    incidents: number | null;
    meanTimeToRecover: string;
    services: ReliabilityService[];
    coverage: ReliabilityCoverage;
    serviceHealth: ServiceHealthSummary;
  };
  security: {
    secureScore: number | null;
    activeAlerts: number | null;
    recommendations: SecurityRecommendation[];
    compliance: Array<{ framework: string; score: number }>;
  };
  network: {
    inventory: {
      total: number;
      byType: Array<{ label: string; count: number }>;
      byRegion: Array<{ label: string; count: number }>;
    };
    /**
     * Azure Monitor platform-metric probe result. Independent of `telemetry`, which describes flow
     * telemetry only; metric coverage is still published when flow telemetry is unavailable.
     */
    metricCoverage: NetworkMetricCoverage | null;
    telemetry: {
      availability: Availability;
      message: string;
      healthyConnections: number | null;
      degradedConnections: number | null;
      blockedFlows: number | null;
      flows: NetworkFlow[];
    };
  };
  aiInsights: AiInsight[];
}

export interface RawResource {
  id: string;
  name: string;
  resourceGroup: string;
  type: string;
  location?: string | null;
  status?: string;
  owner?: string;
  tags?: Record<string, unknown> | null;
  change?: string;
}

export interface RawSnapshot {
  generatedAt: string;
  mode: "DEMO" | "AZURE";
  subscriptionDisplayName: string;
  subscriptionId: string;
  tenantId: string;
  sources: SourceStatus[];
  metrics: TrendMetric[];
  postureScore: number | null;
  events: ActivityEvent[];
  regionalHealth: Array<{ region: string; score: number; status: Severity }>;
  exactCostJpy: number | null;
  exactPreviousCostJpy: number | null;
  forecastCostJpy: number | null;
  budgetLimitJpy: number | null;
  normalizedCostTrend: number[];
  costCategories: Array<{ name: string; amountJpy: number; deltaPercent: number | null }>;
  resources: RawResource[];
  reliability: Omit<PublicSnapshotV1["reliability"], "coverage">;
  security: PublicSnapshotV1["security"];
  networkInventory: NetworkInventoryItem[];
  networkMetricCoverage: NetworkMetricCoverage | null;
  networkTelemetry: {
    availability: Availability;
    message: string;
    flows: Array<
      Omit<NetworkFlow, "source" | "destination"> & { source: string; destination: string }
    >;
  };
  aiInsights: AiInsight[];
}
