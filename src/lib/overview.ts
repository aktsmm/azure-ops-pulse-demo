import type { AiInsight, PublicSnapshotV1, ResourceItem, SourceStatus } from "../data/contracts";

export interface ActionQueueItem {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  route: string;
}

const LARGE_COST_DELTA_THRESHOLD = 20;

function insightAction(insight: AiInsight): ActionQueueItem {
  return {
    id: `insight-${insight.id}`,
    severity: insight.severity === "healthy" ? "info" : insight.severity,
    title: insight.title,
    detail: insight.recommendedAction,
    route: insight.route
  };
}

function costDeltaAction(data: PublicSnapshotV1): ActionQueueItem | null {
  const { deltaPercent, current } = data.cost;
  if (deltaPercent === null || current.availability !== "available") return null;
  if (Math.abs(deltaPercent) < LARGE_COST_DELTA_THRESHOLD) return null;
  const direction = deltaPercent > 0 ? "増加" : "減少";
  return {
    id: "cost-delta",
    severity: deltaPercent > 0 ? "warning" : "info",
    title: `コストが前期比 ${Math.abs(deltaPercent)}% ${direction}`,
    detail: "コスト内訳で増減の大きいサービスを確認してください。",
    route: "/cost"
  };
}

function sourceGapActions(sources: SourceStatus[]): ActionQueueItem[] {
  return sources
    .filter((item) => item.availability !== "available")
    .map((item) => ({
      id: `source-${item.source}`,
      severity: item.availability === "unavailable" ? "warning" : "info",
      title: `${item.source} のデータが${item.availability === "unavailable" ? "取得不可" : "部分的にのみ取得"}`,
      detail: item.message,
      route: "/overview"
    }));
}

function unknownRegionAction(data: PublicSnapshotV1): ActionQueueItem | null {
  const unknownRegions = data.overview.regionalHealth.filter(
    (region) => region.coverage === "unknown"
  );
  if (unknownRegions.length === 0) return null;
  return {
    id: "regions-unknown-coverage",
    severity: "info",
    title: `${unknownRegions.length}件の地域で健全性データが未取得`,
    detail: "Resource Health のデータが一致しなかったため、正常/低下ではなく「不明」として扱っています。",
    route: "/reliability"
  };
}

/**
 * Grounded, evidence-linked action items only: AI insights, large cost swings,
 * data sources that are not fully available, and regions with no health signal.
 * Nothing here is inferred or fabricated — each item traces back to a concrete field in the snapshot.
 */
export function buildActionQueue(data: PublicSnapshotV1): ActionQueueItem[] {
  const items: ActionQueueItem[] = [
    ...data.aiInsights.map(insightAction),
    ...sourceGapActions(data.sources)
  ];
  const costItem = costDeltaAction(data);
  if (costItem) items.push(costItem);
  const regionItem = unknownRegionAction(data);
  if (regionItem) items.push(regionItem);

  const severityRank: Record<ActionQueueItem["severity"], number> = {
    critical: 0,
    warning: 1,
    info: 2
  };
  return items.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
}

export interface SourceCoverageSummary {
  total: number;
  available: number;
  partial: number;
  unavailable: number;
}

export function sourceCoverageSummary(sources: SourceStatus[]): SourceCoverageSummary {
  return {
    total: sources.length,
    available: sources.filter((item) => item.availability === "available").length,
    partial: sources.filter((item) => item.availability === "partial").length,
    unavailable: sources.filter((item) => item.availability === "unavailable").length
  };
}

export interface ResourceStatusCoverage {
  total: number;
  healthy: number;
  degraded: number;
  unavailable: number;
  unknown: number;
}

export function resourceStatusCoverage(resources: ResourceItem[]): ResourceStatusCoverage {
  return {
    total: resources.length,
    healthy: resources.filter((item) => item.status === "Healthy").length,
    degraded: resources.filter((item) => item.status === "Degraded").length,
    unavailable: resources.filter((item) => item.status === "Unavailable").length,
    unknown: resources.filter((item) => item.status === "Unknown").length
  };
}
