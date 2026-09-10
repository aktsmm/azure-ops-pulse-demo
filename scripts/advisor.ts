import type { AdvisorSummary, AdvisorRecommendationGroup, RawResource } from "../src/data/contracts";
import { resourceRef, normalizeResourceId } from "../src/lib/sanitize";
import {
  ADVISOR_CATEGORIES, ADVISOR_IMPACTS, ADVISOR_CATALOG, ADVISOR_RESOURCE_TYPES,
  ADVISOR_SUMMARY_MESSAGE, ADVISOR_DETAILS_MESSAGE, advisorContent
} from "../src/lib/advisor-catalog";
import { CollectionError } from "./collection-diagnostics";

// Scalar id projection preserves ARG pagination. Private IDs never leave this module's aggregation.
// https://learn.microsoft.com/ja-jp/azure/advisor/advisor-azure-resource-graph
export const ADVISOR_QUERY = `AdvisorResources
| where type =~ 'microsoft.advisor/recommendations'
| project id, category=tostring(properties.category), impact=tostring(properties.impact),
  recommendationTypeId=tostring(properties.recommendationTypeId),
  resourceId=tostring(properties.resourceMetadata.resourceId),
  recommendationStatus=tostring(properties.recommendationStatus), tracked=tostring(properties.tracked)
| order by id asc`;

// Trusted built-in type IDs verified against the official public reference on 2026-09-10.
// https://learn.microsoft.com/ja-jp/azure/advisor/advisor-reference-reliability-recommendations
// https://learn.microsoft.com/ja-jp/azure/advisor/advisor-reference-performance-recommendations
// Keep GUIDs collector-only: the public catalog and frontend expose closed slugs, never these IDs.
const TYPE_IDS: Readonly<Record<string, string>> = {
  "242639fd-cd73-4be2-8f55-70478db8d1a5": "service-health-alert",
  "b4d988a9-85e6-4179-b69c-549bdd8a55bb": "vmss-automatic-repair",
  "3b587048-b04b-4f81-aaed-e43793652b0f": "vmss-health-monitoring",
  "56f0c458-521d-4b8b-a704-c0a099483d19": "outbound-nat-capacity",
  "4c10f447-fc3d-48b5-931d-23cea8486023": "storage-zone-redundancy",
  "42dbf883-9e4b-4f84-9da4-232b87c4b5e9": "blob-soft-delete",
  "066a047a-9ace-45f4-ac50-6325840a6b00": "vm-availability-zones",
  "b7e00078-7703-4a0a-afac-1b403803ba62": "container-apps-zone-redundancy",
  "af0cdbce-c610-499b-9bd7-b169cdb1bb2e": "registry-premium-tier",
  "dcfa2602-227e-4b6c-a60d-7b1f6514e690": "registry-geo-replication",
  "52fef986-5897-4359-8b92-0f22749f0d73": "cosmos-continuous-backup",
  "98acf571-d0a4-4111-993c-829f91b8c71b": "search-replica-capacity",
  "ced5fa9f-b5bf-4982-9f25-8190fb36dfca": "storage-tls-version",
  "4391ebb6-9519-4563-97c8-85f40cb92a63": "cosmos-missing-indexes"
};

export interface AdvisorRow {
  id?: unknown;
  category?: unknown;
  impact?: unknown;
  /** Legacy aggregate input only. New collector rows have no count field. */
  count?: unknown;
  recommendationTypeId?: unknown;
  resourceId?: unknown;
  recommendationStatus?: unknown;
  tracked?: unknown;
}

export function summarizeAdvisor(rows: readonly AdvisorRow[], inventory: readonly RawResource[] = []): AdvisorSummary {
  const known = new Map(inventory.map((item) => [normalizeResourceId(item.id), item]));
  if (rows.some((row) => row?.count !== undefined)) return summarizeLegacyAdvisor(rows);
  const unique = new Map<string, AdvisorRow>();
  for (const row of rows) {
    if (!row || typeof row.id !== "string" || !row.id.trim()) throw new CollectionError("invalid-response");
    const id = row.id.toLowerCase();
    // A repeated ARG identity may hide a missing record across pages; do not publish a deduplicated partial result.
    if (unique.has(id)) throw new CollectionError("invalid-response");
    unique.set(id, row);
  }
  const totals = summarizeLegacyAdvisor([...unique.values()].map((row) => ({ ...row, count: 1 })));
  const groups = new Map<string, { group: AdvisorRecommendationGroup; resources: Set<string>; missingIdentity: boolean }>();
  const resources = new Set<string>();
  let missingIdentity = false;
  let excludedRecommendationCount = 0;
  let lifecycleUnknownCount = 0;
  for (const row of unique.values()) {
    const status = String(row.recommendationStatus ?? "").toLowerCase();
    if (["completed", "dismissed", "postponed"].includes(status)) {
      excludedRecommendationCount += 1;
      continue;
    }
    if (!["new", "inprogress"].includes(status)) lifecycleUnknownCount += 1;
    const category = ADVISOR_CATEGORIES.find((value) => value.toLowerCase() === String(row.category).toLowerCase()) ?? "Other";
    const impact = ADVISOR_IMPACTS.find((value) => value.toLowerCase() === String(row.impact).toLowerCase()) ?? "Unknown";
    const identity = resourceIdentity(row.resourceId);
    const rawType = identity?.type ?? "other";
    const resourceType = ADVISOR_RESOURCE_TYPES.includes(rawType) ? rawType : "other";
    const slug = TYPE_IDS[String(row.recommendationTypeId ?? "").toLowerCase()];
    const catalog = ADVISOR_CATALOG.find((item) =>
      item.id === slug && item.category === category && item.resourceType === rawType);
    // Tracked (custom) recommendations and unexpected provenance never inherit built-in semantics.
    const tracked = String(row.tracked ?? "").toLowerCase();
    const content = advisorContent(catalog && ["", "false"].includes(tracked) ? catalog.id : "", category);
    const state = groups.get(content.id) ?? {
      group: {
        ...content, count: 0, impacts: { High: 0, Medium: 0, Low: 0, Unknown: 0 },
        affectedResourceCount: null, resourceTypes: [],
        scopeCounts: { resource: 0, subscription: 0, unknown: 0 }
      },
      resources: new Set<string>(), missingIdentity: false
    };
    state.group.count += 1;
    state.group.impacts[impact] += 1;
    const typeCount = state.group.resourceTypes.find((item) => item.type === resourceType);
    if (typeCount) typeCount.count += 1;
    else state.group.resourceTypes.push({ type: resourceType, count: 1 });
    if (identity && identity.type !== "microsoft.subscriptions/subscriptions") {
      state.group.scopeCounts!.resource += 1;
      state.resources.add(identity.id);
      resources.add(identity.id);
    } else {
      if (identity) state.group.scopeCounts!.subscription += 1;
      else state.group.scopeCounts!.unknown += 1;
      state.missingIdentity = true;
      missingIdentity = true;
    }
    groups.set(content.id, state);
  }
  const contentGroups = [...groups.values()].map(({ group, resources: identities, missingIdentity: missing }) => {
    const matched = [...identities].sort().filter((id) => known.has(id));
    const targets = matched.slice(0, 100).map((id) => {
      const item = known.get(id)!;
      return { resourceRef: resourceRef(id), type: item.type, ...(item.location ? { region: item.location } : {}) };
    });
    return {
      ...group, affectedResourceCount: missing ? null : identities.size,
      resourceRefs: targets.map((target) => target.resourceRef), targets,
      targetCoverage: {
        totalResources: identities.size, publishedResources: targets.length,
        unresolvedResources: identities.size - matched.length, truncated: matched.length > 100
      },
      resourceTypes: group.resourceTypes.sort((a, b) => a.type.localeCompare(b.type))
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const mappedRecommendationCount = contentGroups.filter((group) => group.contentStatus === "mapped").reduce((sum, group) => sum + group.count, 0);
  const withheldRecommendationCount = contentGroups.filter((group) => group.contentStatus === "withheld").reduce((sum, group) => sum + group.count, 0);
  return {
    ...totals, message: ADVISOR_SUMMARY_MESSAGE,
    details: {
      availability: withheldRecommendationCount || lifecycleUnknownCount || missingIdentity || totals.availability === "partial" ? "partial" : "available",
      message: ADVISOR_DETAILS_MESSAGE, mappedRecommendationCount, withheldRecommendationCount,
      excludedRecommendationCount, lifecycleUnknownCount,
      affectedResourceCount: missingIdentity ? null : resources.size, groups: contentGroups
    }
  };
}

function resourceIdentity(value: unknown): { id: string; type: string } | null {
  if (typeof value !== "string") return null;
  const id = normalizeResourceId(value);
  const subscription = /^\/subscriptions\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/;
  if (!subscription.test(id)) return null;
  const scopedPath = id.replace(subscription, "");
  if (!scopedPath) return { id, type: "microsoft.subscriptions/subscriptions" };
  if (!/^\/(?:resourcegroups\/[^/]+\/)?providers\//.test(scopedPath)) return null;
  const suffix = id.split("/providers/").at(-1)?.split("/") ?? [];
  if (suffix.length < 3 || suffix.length % 2 !== 1 || suffix.some((part) => !part)) return null;
  return { id, type: [suffix[0], ...suffix.slice(1).filter((_, index) => index % 2 === 0)].join("/") };
}

function summarizeLegacyAdvisor(rows: readonly AdvisorRow[]): AdvisorSummary {
  const groups = new Map<string, AdvisorSummary["recommendations"][number]>();
  let unknown = false;
  let total = 0;
  for (const row of rows) {
    if (!row || !Number.isSafeInteger(row.count) || Number(row.count) < 0) {
      throw new CollectionError("invalid-response");
    }
    total += Number(row.count);
    if (!Number.isSafeInteger(total)) throw new CollectionError("invalid-response");
    const category = ADVISOR_CATEGORIES.find((value) => value.toLowerCase() === String(row.category).toLowerCase()) ?? "Other";
    const impact = ADVISOR_IMPACTS.find((value) => value.toLowerCase() === String(row.impact).toLowerCase()) ?? "Unknown";
    unknown ||= category === "Other" || impact === "Unknown";
    const key = `${category}:${impact}`;
    const count = (groups.get(key)?.count ?? 0) + Number(row.count);
    if (!Number.isSafeInteger(count)) throw new CollectionError("invalid-response");
    if (count > 0) groups.set(key, { category, impact, count });
  }
  return {
    availability: unknown ? "partial" : "available",
    message: unknown
      ? "Advisor の分類を一部判別できなかったため、その他・不明に集約しました。"
      : rows.length
        ? "Advisor の推奨事項をカテゴリと影響度で集計しました。タイトル・対象名は公開しません。"
        : "Advisor の読み取りは成功しましたが、対象スコープで推奨事項は返されませんでした。",
    recommendations: [...groups.values()].sort((a, b) => `${a.category}:${a.impact}`.localeCompare(`${b.category}:${b.impact}`))
  };
}
