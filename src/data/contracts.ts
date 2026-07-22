export type Severity = "critical" | "warning" | "healthy" | "info";
export type Availability = "available" | "partial" | "unavailable";

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
  status: "Healthy" | "Degraded" | "Unavailable" | "Unknown";
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
  deltaPercent: number;
}

export interface ReliabilityService {
  name: string;
  objective: string;
  actual: string;
  incidents: number;
  status: Severity;
  budgetRemainingPercent: number;
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
  schemaVersion: "1.0.0";
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
    postureScore: number;
    eventTimeline: ActivityEvent[];
    regionalHealth: Array<{ region: string; score: number; status: Severity }>;
  };
  cost: {
    currentApproximate: string;
    previousApproximate: string;
    deltaPercent: number;
    forecastApproximate: string;
    budgetUsedPercent: number;
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
    incidents: number;
    meanTimeToRecover: string;
    services: ReliabilityService[];
  };
  security: {
    secureScore: number;
    activeAlerts: number;
    recommendations: SecurityRecommendation[];
    compliance: Array<{ framework: string; score: number }>;
  };
  network: {
    healthyConnections: number;
    degradedConnections: number;
    blockedFlows: number;
    flows: NetworkFlow[];
  };
  aiInsights: AiInsight[];
}

export interface RawResource {
  id: string;
  name: string;
  resourceGroup: string;
  type: string;
  location?: string;
  status?: string;
  owner?: string;
  tags?: Record<string, string>;
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
  postureScore: number;
  events: ActivityEvent[];
  regionalHealth: Array<{ region: string; score: number; status: Severity }>;
  exactCostJpy: number;
  exactPreviousCostJpy: number;
  forecastCostJpy: number;
  costCategories: Array<{ name: string; amountJpy: number; deltaPercent: number }>;
  resources: RawResource[];
  reliability: PublicSnapshotV1["reliability"];
  security: PublicSnapshotV1["security"];
  networkFlows: Array<Omit<NetworkFlow, "source" | "destination"> & { source: string; destination: string }>;
  aiInsights: AiInsight[];
}
