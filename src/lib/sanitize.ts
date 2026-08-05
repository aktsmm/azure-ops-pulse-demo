import type {
  AiInsight,
  NetworkFlow,
  PublicSnapshotV1,
  RawResource,
  RawSnapshot,
  ResourceHealthStatus,
  SecurityRecommendation
} from "../data/contracts";
import {
  JPY_DISCLOSURE_FLOOR,
  WITHHELD_JPY_AMOUNT_LABEL,
  isComparableJpyChange
} from "./jpy-disclosure";
import { summarizeReliabilityCoverage } from "./resource-health";
import { WITHHELD_RECOMMENDATION_TITLE } from "./defender-recommendations";

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

const RESOURCE_ALIAS_LABEL_LIMIT = 24;

/**
 * Picks the alias prefix from the ARM resource type, which is already published verbatim on the
 * same record and comes from a fixed Azure vocabulary rather than from anything an operator names.
 * The raw resource name is deliberately not an input: deriving any part of the alias from the name
 * is what previously let fragments of it — including characters of the masked subscription GUID
 * embedded in Azure-generated names — survive publication.
 */
export function resourceAliasLabel(type: string): string {
  const tail = type.split("/").at(-1) ?? "";
  const normalized = tail.replace(/[^A-Za-z0-9]/g, "");
  return normalized === "" ? "resource" : normalized.slice(0, RESOURCE_ALIAS_LABEL_LIMIT);
}

/**
 * Resource groups have no published type to borrow from, so they carry the bare alias. Every
 * resource in one group hashes the same input, which is what keeps grouping and filtering intact.
 */
export function maskResourceGroup(value: string): string {
  return `rg-${stableHash(`rg:${value}`)}`;
}

export function maskResourceName(value: string, type: string): string {
  return `${resourceAliasLabel(type)}-${stableHash(`resource:${value}`)}`;
}

const IPV6_HEXTET = /^[0-9a-f]{1,4}$/i;
const IPV4_ADDRESS = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Rejects out-of-range and zero-padded octets so `123.456.789.012` cannot take the IPv4 branch. */
function parseIpv4(value: string): string[] | null {
  const match = value.match(IPV4_ADDRESS);
  if (!match) return null;
  const octets = match.slice(1, 5);
  if (octets.some((octet) => octet.length > 1 && octet.startsWith("0"))) return null;
  if (octets.some((octet) => Number(octet) > 255)) return null;
  return octets;
}

function toHextets(parts: readonly string[], allowIpv4Tail: boolean): string[] | null {
  const hextets: string[] = [];
  for (const [index, part] of parts.entries()) {
    if (part.includes(".")) {
      // An embedded IPv4 address is only legal as the final component of the whole address.
      if (!allowIpv4Tail || index !== parts.length - 1) return null;
      const octets = parseIpv4(part)?.map(Number);
      if (!octets) return null;
      hextets.push(
        (((octets[0] as number) << 8) | (octets[1] as number)).toString(16),
        (((octets[2] as number) << 8) | (octets[3] as number)).toString(16)
      );
      continue;
    }
    if (!IPV6_HEXTET.test(part)) return null;
    hextets.push(part.toLowerCase());
  }
  return hextets;
}

/**
 * A colon alone does not make a value an address. Treating it as one used to publish the first two
 * colon-separated segments verbatim, so any unexpected `label:value` string escaped masking.
 *
 * The address is expanded to all eight hextets before anything is published, because a leading `::`
 * would otherwise shift the low-order — and far more identifying — groups into the published prefix.
 */
function expandIpv6(value: string): string[] | null {
  if (!value.includes(":")) return null;
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const split = (half: string) => (half === "" ? [] : half.split(":"));
  const head = toHextets(split(halves[0] ?? ""), halves.length === 1);
  const tail = halves.length === 2 ? toHextets(split(halves[1] ?? ""), true) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const filled = 8 - head.length - tail.length;
  if (filled < 1) return null;
  return [...head, ...(Array<string>(filled).fill("0")), ...tail];
}

export function maskIp(value: string): string {
  const ipv4 = parseIpv4(value);
  if (ipv4) {
    return `${ipv4[0]}.${ipv4[1]}.*.*`;
  }
  const hextets = expandIpv6(value);
  if (hextets) {
    return `${hextets[0]}:${hextets[1]}:*`;
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
  if (magnitude >= JPY_DISCLOSURE_FLOOR) {
    return `約¥${Math.round(magnitude / JPY_DISCLOSURE_FLOOR)}千${suffix}`;
  }
  return `${WITHHELD_JPY_AMOUNT_LABEL}${suffix}`;
}

const RESOURCE_HEALTH_STATUSES: ReadonlySet<ResourceHealthStatus> = new Set([
  "Healthy",
  "Degraded",
  "Unavailable",
  "Unknown",
  "NotApplicable"
]);

/**
 * `stableHash` is 32 bits wide, so two different names could in principle land on the same alias.
 * That would silently merge unrelated resources — or unrelated resource groups — in the published
 * view, which is the same class of quiet lie the snapshot exists to avoid. A collision is
 * astronomically unlikely at this scale, so failing the collection is a better answer than
 * disambiguating and pretending the grouping is still faithful.
 */
export function assertResourceAliasesAreInjective(
  raw: readonly RawResource[],
  published: readonly PublicSnapshotV1["inventory"]["resources"][number][]
): void {
  if (raw.length !== published.length) {
    throw new Error(
      `Alias check needs one published record per Azure resource, got ${published.length} for ${raw.length}`
    );
  }
  const owners = new Map<string, { source: string; index: number }>();
  const claim = (kind: string, alias: string, source: string, index: number): void => {
    const key = `${kind}\u0000${alias}`;
    const existing = owners.get(key);
    if (existing !== undefined && existing.source !== source) {
      // The raw values are deliberately absent: the collector runs in a public Actions log, so an
      // error that quoted the Azure names would leak exactly what the aliases exist to withhold.
      throw new Error(
        `Alias collision: two distinct Azure ${kind} values both publish as "${alias}" (records ${existing.index} and ${index})`
      );
    }
    owners.set(key, { source, index });
  };
  for (const [index, item] of published.entries()) {
    const source = raw[index];
    if (!source) continue;
    claim("resource group", item.resourceGroup, source.resourceGroup, index);
    claim("resource name", item.name, source.name, index);
    claim("resource id", item.id, source.id, index);
  }
}

function sanitizeResource(resource: RawResource): PublicSnapshotV1["inventory"]["resources"][number] {
  const status = RESOURCE_HEALTH_STATUSES.has(resource.status as ResourceHealthStatus)
    ? (resource.status as ResourceHealthStatus)
    : "Unknown";
  return {
    id: `res-${stableHash(resource.id)}`,
    name: maskResourceName(resource.name, resource.type),
    resourceGroup: maskResourceGroup(resource.resourceGroup),
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

const IDENTIFIER_MATCH_FLOOR = 4;
const EMBEDDED_GUID =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const EMBEDDED_HEX_RUN = /[0-9a-f]{9,}/i;

/**
 * Collects the raw values this snapshot exists to withhold, so free text sourced from Azure can be
 * checked against them before publication.
 */
function collectWithheldIdentifiers(raw: RawSnapshot): readonly string[] {
  const tokens = new Set<string>();
  const add = (value: string | null | undefined): void => {
    const trimmed = value?.trim().toLowerCase() ?? "";
    if (trimmed.length >= IDENTIFIER_MATCH_FLOOR) tokens.add(trimmed);
  };
  for (const resource of raw.resources) {
    add(resource.name);
    add(resource.resourceGroup);
    add(resource.owner);
  }
  add(raw.subscriptionId);
  add(raw.tenantId);
  if (raw.mode !== "DEMO") add(raw.subscriptionDisplayName);
  return [...tokens];
}

function disclosesIdentifier(value: string, withheld: readonly string[]): boolean {
  if (EMBEDDED_GUID.test(value) || EMBEDDED_HEX_RUN.test(value)) return true;
  const haystack = value.toLowerCase();
  return withheld.some((token) => haystack.includes(token));
}

/**
 * The collector never republishes an Azure-authored recommendation title, so in practice this only
 * guards the DEMO and fixture paths, where titles are repository-authored. It stays because it is
 * the publication boundary: any future caller that hands a title to `sanitizeSnapshot` still cannot
 * disclose a name the rest of the snapshot masks. It is a backstop, not the control — a denylist
 * cannot recognise a project name that appears nowhere else, which is why the collector withholds
 * by default instead of filtering.
 */
function sanitizeRecommendation(
  recommendation: SecurityRecommendation,
  withheld: readonly string[]
): SecurityRecommendation {
  return {
    title: disclosesIdentifier(recommendation.title, withheld)
      ? WITHHELD_RECOMMENDATION_TITLE
      : recommendation.title,
    severity: recommendation.severity,
    affectedCount: Math.max(0, Math.round(recommendation.affectedCount)),
    status: recommendation.status
  };
}

/**
 * Publishes a period-over-period change only while both totals reach the disclosure floor and stay
 * on the same side of zero. Below the floor the amounts themselves are withheld, so the reader has
 * no visible endpoint to check the ratio against; across a sign flip the ratio stops describing a
 * trend at all. Mirrors the per-category rule in `scripts/cost-transform.ts` so the portfolio card
 * and the service list cannot disagree about what is comparable.
 */
function deltaPercent(current: number | null, previous: number | null): number | null {
  if (!isComparableJpyChange(current, previous)) return null;
  const currentJpy = current as number;
  const previousJpy = previous as number;
  if (Math.sign(currentJpy) !== Math.sign(previousJpy)) return null;
  return Number(
    (((Math.abs(currentJpy) - Math.abs(previousJpy)) / Math.abs(previousJpy)) * 100).toFixed(1)
  );
}

export function sanitizeSnapshot(raw: RawSnapshot): PublicSnapshotV1 {
  const resources = raw.resources.map(sanitizeResource);
  assertResourceAliasesAreInjective(raw.resources, resources);
  const withheldIdentifiers = collectWithheldIdentifiers(raw);
  const reliabilityCoverage = summarizeReliabilityCoverage(resources);
  const resourceHealthPublishable =
    raw.sources.find((source) => source.source === "Resource Health")?.availability !==
    "unavailable";
  const incidentsAvailable =
    resourceHealthPublishable &&
    raw.reliability.incidentAvailability === "available" &&
    raw.reliability.incidents !== null;
  const defenderPublishable =
    raw.sources.find((source) => source.source === "Defender for Cloud")?.availability !==
    "unavailable";
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
    schemaVersion: "1.4.0",
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
      metrics: defenderPublishable
        ? raw.metrics
        : raw.metrics.filter((metric) => !DEFENDER_METRIC_LABELS.has(metric.label)),
      postureScore: resourceHealthPublishable ? raw.postureScore : null,
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
        // The published amount is withheld below the disclosure floor, so a change measured against
        // it has nothing visible to anchor to. Enforced here as well as in the collector so any
        // future cost source inherits the rule at the publication boundary. Note the prior-period
        // per-service amount is never published, so only the collector can enforce the floor on the
        // other side of the ratio — the schema cannot backstop that half.
        deltaPercent:
          Math.abs(item.amountJpy) >= JPY_DISCLOSURE_FLOOR ? item.deltaPercent : null
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
      incidents: incidentsAvailable ? raw.reliability.incidents : null,
      coverage: reliabilityCoverage
    },
    security: {
      secureScore: defenderPublishable ? raw.security.secureScore : null,
      activeAlerts: defenderPublishable ? raw.security.activeAlerts : null,
      recommendations: defenderPublishable
        ? raw.security.recommendations.map((recommendation) =>
            sanitizeRecommendation(recommendation, withheldIdentifiers)
          )
        : [],
      compliance: defenderPublishable ? raw.security.compliance : []
    },
    network: {
      inventory: {
        total: raw.networkInventory.length,
        byType: networkByType,
        byRegion: networkByRegion
      },
      metricCoverage: raw.networkMetricCoverage,
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
