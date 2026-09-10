export type Severity = "critical" | "warning" | "healthy" | "info";
export type Availability = "available" | "partial" | "unavailable";
export const SOURCE_REASONS = [
  "authentication", "forbidden", "throttled", "billing-scope", "unsupported",
  "invalid-response", "unknown", "empty", "unsupported-columns", "currency-mismatch",
  "invalid-rows", "partial-collection", "not-collected"
] as const;
export type SourceReason = typeof SOURCE_REASONS[number];

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
  reason?: SourceReason;
}

export interface CostPeriodDiagnostic {
  availability: "available" | "unavailable";
  reason?: SourceReason;
}

export interface CostPeriodDiagnostics {
  current: CostPeriodDiagnostic;
  previous: CostPeriodDiagnostic;
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

export type AdvisorCategory = "Cost" | "HighAvailability" | "Performance" | "Security" | "OperationalExcellence" | "Other";
export type AdvisorImpact = "High" | "Medium" | "Low" | "Unknown";

export interface AdvisorRecommendationGroup {
  /** Closed catalog slug, never an Azure recommendation identifier. */
  id: string;
  category: AdvisorCategory;
  contentStatus: "mapped" | "withheld";
  /** Recommendation records, not resources. Completed/dismissed/postponed records are excluded. */
  count: number;
  impacts: Record<AdvisorImpact, number>;
  /** Exact distinct ARM resource identities, or null if any identity is missing/non-resource scoped. */
  affectedResourceCount: number | null;
  /** Recommendation record counts by closed, public resource type. */
  resourceTypes: Array<{ type: string; count: number }>;
  title: string;
  description: string;
  recommendedAction: string;
  deferWhen: string;
  caveat: string;
  sourceUrl: string;
}

export interface AdvisorDetails {
  availability: Availability;
  message: string;
  mappedRecommendationCount: number;
  withheldRecommendationCount: number;
  excludedRecommendationCount: number;
  /** Included records whose lifecycle was neither New nor InProgress. Not proven active. */
  lifecycleUnknownCount: number;
  affectedResourceCount: number | null;
  groups: AdvisorRecommendationGroup[];
}

export interface AdvisorSummary {
  availability: Availability;
  message: string;
  recommendations: Array<{
    category: AdvisorCategory;
    impact: AdvisorImpact;
    count: number;
  }>;
  /** Legacy category/impact totals include all lifecycle states; details explain exclusions. */
  details?: AdvisorDetails;
}

export type TopologyEdgeKind =
  | "contains" | "subnet" | "virtual-machine" | "peering"
  | "network-security-group" | "route-table" | "nat-gateway"
  | "backend" | "frontend" | "public-ip" | "private-link";

export interface NetworkTopology {
  availability: Availability;
  message: string;
  nodes: Array<{
    id: string;
    type: string;
    region?: string;
    referenceOnly: boolean;
    scope: "inventory" | "external" | "uncollected";
  }>;
  edges: Array<{ source: string; target: string; kind: TopologyEdgeKind }>;
  truncated: boolean;
}

export interface DefenderFieldAvailability {
  secureScore: Availability;
  assessments: Availability;
  activeAlerts: Availability;
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
    periodDiagnostics?: CostPeriodDiagnostics;
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
    fieldAvailability?: DefenderFieldAvailability;
    secureScore: number | null;
    activeAlerts: number | null;
    recommendations: SecurityRecommendation[];
    compliance: Array<{ framework: string; score: number }>;
  };
  network: {
    topology?: NetworkTopology;
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
  advisor?: AdvisorSummary;
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
  costPeriodDiagnostics?: CostPeriodDiagnostics;
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
  /** Private ARM IDs are retained only until sanitizeSnapshot runs. */
  networkTopology?: NetworkTopology;
  advisor?: AdvisorSummary;
  networkTelemetry: {
    availability: Availability;
    message: string;
    flows: Array<
      Omit<NetworkFlow, "source" | "destination"> & { source: string; destination: string }
    >;
  };
  aiInsights: AiInsight[];
}
