import type {
  AiInsight,
  NetworkFlow,
  PublicSnapshotV1,
  RawResource,
  RawSnapshot,
  SecurityRecommendation
} from "../data/contracts";

const GUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_TAGS = new Set(["environment", "team", "workload", "criticality"]);
const DEFENDER_METRIC_LABELS = new Set(["Defender recommendations", "Open alerts"]);
const ALLOWED_TAG_VALUES = new Set([
  "production",
  "staging",
  "development",
  "platform",
  "commerce",
  "data",
  "high",
  "medium",
  "low"
]);

export function stableHash(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function maskGuid(value: string): string {
  if (!GUID_PATTERN.test(value)) {
    return `id-${stableHash(value)}`;
  }
  const compact = value.replaceAll("-", "").toLowerCase();
  const masked = `${compact.slice(0, 8)}${"*".repeat(16)}${compact.slice(-8)}`;
  return [
    masked.slice(0, 8),
    masked.slice(8, 12),
    masked.slice(12, 16),
    masked.slice(16, 20),
    masked.slice(20)
  ].join("-");
}

export function maskName(value: string, type: "rg" | "resource" | "identity"): string {
  const hash = stableHash(`${type}:${value}`);
  if (value.length <= 8) {
    return `${type}-${hash}`;
  }
  const visible = Math.max(2, Math.floor(value.length * 0.25));
  return `${value.slice(0, visible)}…${value.slice(-visible)}-${hash}`;
}

export function maskIp(value: string): string {
  const ipv4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    return `${ipv4[1]}.${ipv4[2]}.*.*`;
  }
  if (value.includes(":")) {
    const hextets = value.split(":").filter(Boolean);
    return `${hextets[0] ?? "0"}:${hextets[1] ?? "0"}:*`;
  }
  return `network-${stableHash(value)}`;
}

export function classifyEndpoint(value: string): string {
  let host = value.toLowerCase();
  try {
    host = new URL(value.includes("://") ? value : `https://${value}`).hostname;
  } catch {
    return "Unclassified service endpoint";
  }
  if (host.endsWith(".blob.core.windows.net")) return "Azure Storage endpoint";
  if (host.endsWith(".azurefd.net")) return "Azure Front Door endpoint";
  if (host.endsWith(".database.windows.net")) return "Azure SQL endpoint";
  if (host.endsWith(".azure.com") || host.endsWith(".microsoft.com")) {
    return "Microsoft service endpoint";
  }
  return "External service endpoint";
}

export function maskIdentity(value: string): string {
  return `identity-${stableHash(value)}`;
}

export function sanitizeTags(tags: unknown): Record<string, string> {
  if (tags === null || typeof tags !== "object" || Array.isArray(tags)) return {};

  const prototype = Object.getPrototypeOf(tags);
  if (prototype !== Object.prototype && prototype !== null) return {};

  return Object.fromEntries(
    Object.entries(tags)
      .filter(
        (entry): entry is [string, string] =>
          ALLOWED_TAGS.has(entry[0].toLowerCase()) && typeof entry[1] === "string"
      )
      .map(([key, value]) => [
        key.toLowerCase(),
        ALLOWED_TAG_VALUES.has(value.toLowerCase())
          ? value.toLowerCase()
          : `value-${stableHash(value)}`
      ])
  );
}

export function formatApproximateJpy(amount: number): string {
  if (!Number.isFinite(amount)) return "Unavailable";
  const magnitude = Math.abs(amount);
  const suffix = amount < 0 ? " credit" : "";
  if (magnitude === 0) return "約¥0";
  if (magnitude >= 100_000_000) {
    return `約¥${(magnitude / 100_000_000).toFixed(1)}億${suffix}`;
  }
  if (magnitude >= 10_000) return `約¥${(magnitude / 10_000).toFixed(1)}万${suffix}`;
  if (magnitude >= 1_000) return `約¥${Math.round(magnitude / 1_000)}千${suffix}`;
  return `約¥1千未満${suffix}`;
}

function sanitizeResource(resource: RawResource): PublicSnapshotV1["inventory"]["resources"][number] {
  const status =
    resource.status === "Healthy" ||
    resource.status === "Degraded" ||
    resource.status === "Unavailable"
      ? resource.status
      : "Unknown";
  return {
    id: `res-${stableHash(resource.id)}`,
    name: maskName(resource.name, "resource"),
    resourceGroup: maskName(resource.resourceGroup, "rg"),
    type: resource.type,
    region: resource.location || "Unknown",
    status,
    owner: maskIdentity(resource.owner || "unassigned"),
    tags: sanitizeTags(resource.tags),
    change: resource.change || "No material change"
  };
}

function sanitizeEndpoint(value: string): string {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) || value.includes(":")) {
    return maskIp(value);
  }
  return classifyEndpoint(value);
}

function sanitizeInsight(insight: AiInsight): AiInsight {
  return {
    ...insight,
    id: `insight-${stableHash(insight.id)}`,
    confidence: Math.max(0, Math.min(1, insight.confidence)),
    numericEvidence: insight.numericEvidence.slice(0, 6),
    route: insight.route.startsWith("/") ? insight.route : "/ai-insights"
  };
}

function sanitizeRecommendation(
  recommendation: SecurityRecommendation
): SecurityRecommendation {
  return {
    title: recommendation.title,
    severity: recommendation.severity,
    affectedCount: Math.max(0, Math.round(recommendation.affectedCount)),
    status: recommendation.status
  };
}

function deltaPercent(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

export function sanitizeSnapshot(raw: RawSnapshot): PublicSnapshotV1 {
  const resources = raw.resources.map(sanitizeResource);
  const resourceHealthAvailable =
    raw.sources.find((source) => source.source === "Resource Health")?.availability === "available";
  const incidentsAvailable =
    resourceHealthAvailable &&
    raw.reliability.incidentAvailability === "available" &&
    raw.reliability.incidents !== null;
  const defenderAvailable =
    raw.sources.find((source) => source.source === "Defender for Cloud")?.availability ===
    "available";
  if (raw.costCategories.some((item) => !Number.isFinite(item.amountJpy))) {
    throw new Error("Cost categories contain a non-finite amount");
  }
  const categoryMagnitude = Math.max(
    1,
    raw.costCategories.reduce((sum, item) => sum + Math.abs(item.amountJpy), 0)
  );
  const networkFlows: NetworkFlow[] =
    raw.networkTelemetry.availability === "unavailable"
      ? []
      : raw.networkTelemetry.flows.map((flow) => ({
          ...flow,
          id: `flow-${stableHash(flow.id)}`,
          source: sanitizeEndpoint(flow.source),
          destination: sanitizeEndpoint(flow.destination)
        }));
  const generatedAt = new Date(raw.generatedAt);
  const ageMinutes = Math.max(0, Math.round((Date.now() - generatedAt.getTime()) / 60_000));
  const costAmount = (amount: number | null) => {
    const available = amount !== null && Number.isFinite(amount);
    return {
      availability: available ? ("available" as const) : ("unavailable" as const),
      approximateAmount: available ? formatApproximateJpy(amount) : null
    };
  };
  const networkByType = Object.entries(
    raw.networkInventory.reduce<Record<string, number>>((counts, item) => {
      const label = item.type.split("/").at(-1) || item.type;
      counts[label] = (counts[label] ?? 0) + 1;
      return counts;
    }, {})
  ).map(([label, count]) => ({ label, count }));
  const networkByRegion = Object.entries(
    raw.networkInventory.reduce<Record<string, number>>((counts, item) => {
      const label = item.location || "Unknown";
      counts[label] = (counts[label] ?? 0) + 1;
      return counts;
    }, {})
  ).map(([label, count]) => ({ label, count }));
  const telemetryAvailable = raw.networkTelemetry.availability !== "unavailable";

  return {
    schemaVersion: "1.2.0",
    generatedAt: generatedAt.toISOString(),
    mode: raw.mode,
    freshness: {
      state: ageMinutes > 4_320 ? "stale" : "fresh",
      ageMinutes,
      lastSuccessfulCollection: generatedAt.toISOString(),
      nextScheduledCollection: "Tuesday / Friday 06:00 JST"
    },
    scope: {
      displayName:
        raw.mode === "DEMO" ? raw.subscriptionDisplayName : `Azure subscription ${stableHash(raw.subscriptionId)}`,
      subscriptionId: maskGuid(raw.subscriptionId),
      tenantId: maskGuid(raw.tenantId)
    },
    sources: raw.sources,
    overview: {
      metrics: defenderAvailable
        ? raw.metrics
        : raw.metrics.filter((metric) => !DEFENDER_METRIC_LABELS.has(metric.label)),
      postureScore: resourceHealthAvailable ? raw.postureScore : null,
      eventTimeline: raw.events.map((event) => ({
        ...event,
        id: `event-${stableHash(event.id)}`
      })),
      regionalHealth: raw.regionalHealth
    },
    cost: {
      current: costAmount(raw.exactCostJpy),
      previous: costAmount(raw.exactPreviousCostJpy),
      deltaPercent: deltaPercent(raw.exactCostJpy, raw.exactPreviousCostJpy),
      forecast: costAmount(raw.forecastCostJpy),
      budget: {
        availability:
          raw.exactCostJpy === null || raw.budgetLimitJpy === null || raw.budgetLimitJpy <= 0
            ? "unavailable"
            : "available",
        usedPercent:
          raw.exactCostJpy === null || raw.budgetLimitJpy === null || raw.budgetLimitJpy <= 0
            ? null
            : Math.max(
                0,
                Math.min(100, Math.round((raw.exactCostJpy / raw.budgetLimitJpy) * 100))
              )
      },
      normalizedTrend: raw.normalizedCostTrend,
      categories: raw.costCategories.map((item) => ({
        name: item.amountJpy < 0 ? `${item.name} credit` : item.name,
        approximateAmount: formatApproximateJpy(item.amountJpy),
        sharePercent: Number(((Math.abs(item.amountJpy) / categoryMagnitude) * 100).toFixed(1)),
        deltaPercent: item.deltaPercent
      }))
    },
    inventory: {
      total: resources.length,
      resources,
      byType: Object.entries(
        resources.reduce<Record<string, number>>((counts, resource) => {
          counts[resource.type] = (counts[resource.type] ?? 0) + 1;
          return counts;
        }, {})
      ).map(([label, count]) => ({ label, count })),
      byRegion: Object.entries(
        resources.reduce<Record<string, number>>((counts, resource) => {
          counts[resource.region] = (counts[resource.region] ?? 0) + 1;
          return counts;
        }, {})
      ).map(([label, count]) => ({ label, count }))
    },
    reliability: {
      ...raw.reliability,
      incidentAvailability: incidentsAvailable ? "available" : "unavailable",
      incidents: incidentsAvailable ? raw.reliability.incidents : null
    },
    security: {
      secureScore: defenderAvailable ? raw.security.secureScore : null,
      activeAlerts: defenderAvailable ? raw.security.activeAlerts : null,
      recommendations: defenderAvailable
        ? raw.security.recommendations.map(sanitizeRecommendation)
        : [],
      compliance: defenderAvailable ? raw.security.compliance : []
    },
    network: {
      inventory: {
        total: raw.networkInventory.length,
        byType: networkByType,
        byRegion: networkByRegion
      },
      telemetry: {
        availability: raw.networkTelemetry.availability,
        message: raw.networkTelemetry.message,
        healthyConnections: telemetryAvailable
          ? networkFlows.filter((flow) => flow.status === "Allowed").length
          : null,
        degradedConnections: telemetryAvailable
          ? networkFlows.filter((flow) => flow.status === "Degraded").length
          : null,
        blockedFlows: telemetryAvailable
          ? networkFlows.filter((flow) => flow.status === "Blocked").length
          : null,
        flows: networkFlows
      }
    },
    aiInsights: raw.aiInsights.map(sanitizeInsight)
  };
}
