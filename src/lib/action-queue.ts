import type { PublicSnapshotV1, Severity, SourceStatus } from "../data/contracts";
import { formatSignedPercentJa } from "./format-ja";

export interface ActionItem {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  route: string;
}

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
  healthy: 3
};

/** Picks a relevant dashboard route for a source-collection gap based on the source name.
 * Matches both the English Azure product names used today and the Japanese labels used for our
 * own composite source names, so this keeps working regardless of collector-string language.
 * Falls back to the overview when a source does not map to a specific page. */
function routeForSource(source: string): string {
  const lower = source.toLowerCase();
  if (lower.includes("cost")) return "/cost";
  if (lower.includes("defender") || lower.includes("security") || source.includes("セキュリティ")) {
    return "/security";
  }
  if (lower.includes("network") || source.includes("ネットワーク")) return "/network";
  if (lower.includes("health") || source.includes("ヘルス")) return "/reliability";
  if (lower.includes("resource graph") || source.includes("リソース")) return "/resources";
  return "/overview";
}

function unavailableSourceItems(sources: SourceStatus[]): ActionItem[] {
  return sources
    .filter((source) => source.availability === "unavailable")
    .map((source) => ({
      id: `source-${source.source}`,
      severity: "warning" as const,
      title: `${source.source} のデータを収集できませんでした`,
      detail: source.message,
      route: routeForSource(source.source)
    }));
}

function degradedResourceItem(data: PublicSnapshotV1): ActionItem | null {
  const degraded = data.inventory.resources.filter((resource) => resource.status === "Degraded");
  const unavailable = data.inventory.resources.filter(
    (resource) => resource.status === "Unavailable"
  );
  if (!degraded.length && !unavailable.length) return null;
  const parts: string[] = [];
  if (unavailable.length) parts.push(`利用不可 ${unavailable.length} 件`);
  if (degraded.length) parts.push(`劣化 ${degraded.length} 件`);
  return {
    id: "inventory-degraded",
    severity: unavailable.length ? "critical" : "warning",
    title: `リソースの健全性に対応が必要な項目があります（${parts.join(" / ")}）`,
    detail: `監視対象 ${data.inventory.total} 件のうち、${parts.join(" / ")} を検知しました。`,
    route: "/resources"
  };
}

function securityRecommendationItem(data: PublicSnapshotV1): ActionItem | null {
  const open = data.security.recommendations.filter(
    (item) => item.status !== "Resolved"
  );
  const critical = open.filter((item) => item.severity === "critical");
  if (!open.length) return null;
  return {
    id: "security-recommendations",
    severity: critical.length ? "critical" : "warning",
    title: `未対応のセキュリティ推奨事項が ${open.length} 件あります`,
    detail: critical.length
      ? `重大な推奨事項が ${critical.length} 件含まれています。Secure Score: ${data.security.secureScore}%`
      : `Secure Score: ${data.security.secureScore}%`,
    route: "/security"
  };
}

function costDeltaItem(data: PublicSnapshotV1, thresholdPercent = 20): ActionItem | null {
  const delta = data.cost.deltaPercent;
  if (delta === null || delta <= thresholdPercent) return null;
  return {
    id: "cost-delta",
    severity: "warning",
    title: `コストが前期比 ${formatSignedPercentJa(delta)} 変化しています`,
    detail: `現在の概算コストは ${data.cost.current.approximateAmount ?? "不明"} です。上位のサービス別内訳を確認してください。`,
    route: "/cost"
  };
}

function networkTelemetryItem(data: PublicSnapshotV1): ActionItem | null {
  const telemetry = data.network.telemetry;
  const degraded = telemetry.degradedConnections ?? 0;
  const blocked = telemetry.blockedFlows ?? 0;
  if (telemetry.availability === "unavailable" || (degraded === 0 && blocked === 0)) return null;
  return {
    id: "network-telemetry",
    severity: blocked > 0 ? "critical" : "warning",
    title: `ネットワークフローに劣化または遮断を検知しました（劣化 ${degraded} 件 / 遮断 ${blocked} 件）`,
    detail: "観測されたフローテレメトリの詳細はネットワークページで確認してください。",
    route: "/network"
  };
}

function criticalInsightItems(data: PublicSnapshotV1): ActionItem[] {
  return data.aiInsights
    .filter((insight) => insight.severity === "critical")
    .map((insight) => ({
      id: `insight-${insight.id}`,
      severity: "critical" as const,
      title: insight.title,
      detail: insight.recommendedAction,
      route: insight.route
    }));
}

/**
 * Builds a prioritized, evidence-based action queue for the Overview page. Every item is derived
 * directly from concrete snapshot fields — nothing here infers meaning from absent, partial, or
 * unknown data, and "Unknown" resource health never appears as an actionable problem.
 */
export function buildActionQueue(data: PublicSnapshotV1, limit = 6): ActionItem[] {
  const items = [
    ...criticalInsightItems(data),
    securityRecommendationItem(data),
    degradedResourceItem(data),
    networkTelemetryItem(data),
    costDeltaItem(data),
    ...unavailableSourceItems(data.sources)
  ].filter((item): item is ActionItem => item !== null);

  return items
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .slice(0, limit);
}
