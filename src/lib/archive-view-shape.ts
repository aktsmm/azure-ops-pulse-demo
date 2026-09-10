import { SOURCE_REASONS, type PublicSnapshotV1 } from "../data/contracts";
import { isPrivateCidr, isPrivateIpv4, MASKED_PUBLIC_IPV4_PATTERN } from "./network-evidence";

type Check = (value: unknown) => boolean;
const text: Check = (value) => typeof value === "string";
const nonemptyText: Check = (value) => typeof value === "string" && value.trim().length > 0;
const number: Check = (value) => typeof value === "number" && Number.isFinite(value);
const count: Check = (value) => number(value) && Number.isSafeInteger(value) && (value as number) >= 0;
const boolean: Check = (value) => typeof value === "boolean";
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const shape = (fields: Record<string, Check>): Check => (value) => object(value) && Object.entries(fields).every(([key, check]) => check(value[key]));
const optional = (check: Check): Check => (value) => value === undefined || check(value);
const nullable = (check: Check): Check => (value) => value === null || check(value);
const list = (check: Check, limit = 5_000): Check => (value) => Array.isArray(value) && value.length <= limit && value.every(check);
const choices = (...values: string[]): Check => (value) => typeof value === "string" && values.includes(value);
const fields = (names: string[], check: Check) => Object.fromEntries(names.map((name) => [name, check]));
const date: Check = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const severity = choices("critical", "warning", "healthy", "info");
const availability = choices("available", "partial", "unavailable");
const collected = choices("available", "unavailable");
const route: Check = (value) => typeof value === "string" && /^\/(?:overview|cost|resources|reliability|security|recommendations|network|ai-insights)(?:\?[^#]*)?$/.test(value);
const reference: Check = (value) => typeof value === "string" && /^res-[0-9a-f]{8}$/.test(value);
const guideUrl: Check = (value) => {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "learn.microsoft.com" && !url.username && !url.password;
  } catch { return false; }
};
const distribution = list(shape({ label: text, count }));
const network = shape({
  privateIpv4: list((value) => typeof value === "string" && isPrivateIpv4(value), 32),
  privateCidrs: list((value) => typeof value === "string" && isPrivateCidr(value), 32),
  publicIpv4Masked: list((value) => typeof value === "string" && new RegExp(MASKED_PUBLIC_IPV4_PATTERN).test(value), 32),
  truncated: boolean
});
const resource = shape({
  ...fields(["id", "name", "resourceGroup", "type", "region", "owner", "change"], text),
  status: choices("Healthy", "Degraded", "Unavailable", "Unknown", "NotApplicable"),
  tags: (value) => object(value) && Object.values(value).every(text), network: optional(network)
});
const advisorGroup = shape({
  ...fields(["id", "title", "description", "recommendedAction", "deferWhen", "caveat"], text),
  category: choices("Security", "Cost", "HighAvailability", "Performance", "OperationalExcellence", "Other"),
  contentStatus: choices("mapped", "withheld"), count, affectedResourceCount: nullable(count),
  impacts: shape(fields(["High", "Medium", "Low", "Unknown"], count)),
  resourceTypes: list(shape({ type: text, count })), sourceUrl: (value) => value === "" || guideUrl(value),
  resourceRefs: optional(list(reference, 100)),
  targets: optional(list(shape({ resourceRef: reference, type: optional(text), region: optional(text) }), 100)),
  scopeCounts: optional(shape(fields(["resource", "subscription", "unknown"], count))),
  targetCoverage: optional(shape({ ...fields(["totalResources", "publishedResources", "unresolvedResources"], count), truncated: boolean }))
});
const diagnostic = shape({ availability: collected, reason: optional(choices(...SOURCE_REASONS)) });
const costAmount = shape({ availability: collected, approximateAmount: nullable(text) });

// A browser rendering guard, not a replacement for the publisher's schema/privacy/review gates.
const viewShape = shape({
  schemaVersion: choices("1.4.0"), generatedAt: date, mode: choices("AZURE"),
  freshness: shape({ state: choices("fresh", "stale"), ageMinutes: count, lastSuccessfulCollection: date, nextScheduledCollection: text }),
  scope: shape(fields(["displayName", "subscriptionId", "tenantId"], text)),
  sources: list(shape({ source: text, availability, message: text, reason: optional(choices(...SOURCE_REASONS)) }), 100),
  overview: shape({
    metrics: list(shape({ label: text, value: text, change: text, direction: choices("up", "down", "flat"), severity, points: list(number) })),
    postureScore: nullable(number),
    eventTimeline: list(shape({ id: text, timestamp: text, severity, title: text, detail: text, route })),
    regionalHealth: list(shape({ region: text, score: number, status: severity }))
  }),
  cost: shape({
    current: costAmount, previous: costAmount, forecast: costAmount,
    budget: shape({ availability: collected, usedPercent: nullable(number) }),
    deltaPercent: nullable(number), normalizedTrend: list(number),
    categories: list(shape({ name: text, approximateAmount: text, sharePercent: number, deltaPercent: nullable(number) })),
    periodDiagnostics: optional(shape({ current: diagnostic, previous: diagnostic }))
  }),
  inventory: shape({ total: count, resources: list(resource), byType: distribution, byRegion: distribution }),
  reliability: shape({
    availability: text, incidentAvailability: collected, incidents: nullable(count), meanTimeToRecover: text,
    services: list(shape({ name: text, objective: text, actual: text, incidents: count, status: severity, budgetRemainingPercent: number })),
    coverage: shape({
      ...fields(["totalResources", "supportedResources", "notApplicableResources", "evaluatedResources", "unevaluatedResources", "healthyResources", "unavailableResources", "degradedResources"], count),
      supportedCoveragePercent: nullable(number)
    }),
    serviceHealth: shape({ availability, message: text, activeEvents: nullable(count), resolvedEvents: nullable(count), categories: distribution })
  }),
  security: shape({
    secureScore: nullable(number), activeAlerts: nullable(count),
    fieldAvailability: optional(shape({ secureScore: availability, assessments: availability, activeAlerts: availability })),
    recommendations: list(shape({ title: text, severity, status: choices("Open", "In progress", "Resolved"), affectedCount: count, unknownCount: optional(count) })),
    compliance: list(shape({ framework: text, score: number })),
    assessmentCoverage: optional(shape({
      ...fields(["totalAssessments", "unhealthyAssessments", "healthyAssessments", "notApplicableAssessments", "unknownAssessments", "totalGroups", "publishedGroups"], count),
      truncated: boolean
    })),
    vulnerabilities: optional(shape({
      availability, message: text, truncated: boolean,
      ...fields(["totalSubAssessments", "unhealthySubAssessments", "unmappedSubAssessments", "unknownStatusSubAssessments", "totalFindings"], nullable(count)),
      unmappedTargetSubAssessments: optional(nullable(count)),
      findings: list(shape({
        cve: (value) => typeof value === "string" && /^CVE-\d{4}-\d{4,7}$/.test(value),
        severity: choices("High", "Medium", "Low", "Unknown"), resourceRefs: list(reference, 100),
        patchable: optional(boolean),
        cvssScore: optional((value) => number(value) && (value as number) >= 0 && (value as number) <= 10)
      }), 100)
    }))
  }),
  network: shape({
    inventory: shape({ total: count, byType: distribution, byRegion: distribution }),
    metricCoverage: nullable(shape(fields(["inventoryTotal", "sampledResources", "metricCapableResources", "metricSeries", "notApplicableResources", "failedResources"], count))),
    telemetry: shape({
      availability, message: text, healthyConnections: nullable(count), degradedConnections: nullable(count), blockedFlows: nullable(count),
      flows: list(shape({ ...fields(["id", "source", "destination", "protocol", "latency", "throughput"], text), status: choices("Allowed", "Degraded", "Blocked") }))
    }),
    topology: optional(shape({
      availability, message: text, truncated: boolean,
      nodes: list(shape({ id: text, type: text, region: optional(text), referenceOnly: boolean, scope: choices("inventory", "external", "uncollected"), network: optional(network) }), 400),
      edges: list(shape({ source: text, target: text, kind: choices("contains", "subnet", "virtual-machine", "peering", "network-security-group", "route-table", "nat-gateway", "backend", "frontend", "public-ip", "private-link") }), 800)
    }))
  }),
  advisor: optional(shape({
    availability, message: text,
    recommendations: list(shape({ category: text, impact: text, count })),
    details: optional(shape({
      availability, message: text, affectedResourceCount: nullable(count),
      ...fields(["mappedRecommendationCount", "withheldRecommendationCount", "excludedRecommendationCount", "lifecycleUnknownCount"], count),
      groups: list(advisorGroup, 200)
    }))
  })),
  aiInsights: list(shape({
    ...fields(["id", "title", "observation", "impact", "recommendedAction", "period"], nonemptyText), severity, route,
    confidence: (value) => number(value) && (value as number) >= 0 && (value as number) <= 1,
    numericEvidence: (value) => Array.isArray(value) && value.length > 0 && list(shape({ label: nonemptyText, value: nonemptyText, source: nonemptyText }), 6)(value)
  }), 100)
});

export function isArchiveViewData(value: unknown): value is PublicSnapshotV1 {
  if (!viewShape(value)) return false;
  const snapshot = value as PublicSnapshotV1;
  const unique = (ids: string[]) => new Set(ids).size === ids.length;
  return unique(snapshot.aiInsights.map((insight) => insight.id)) &&
    unique(snapshot.inventory.resources.map((resource) => resource.id)) &&
    unique(snapshot.advisor?.details?.groups.map((group) => group.id) ?? []) &&
    unique(snapshot.network.topology?.nodes.map((node) => node.id) ?? []);
}
