import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ADVISOR_QUERY, summarizeAdvisor, type AdvisorRow } from "./advisor";
import { ADVISOR_CATALOG, ADVISOR_CATEGORIES, ADVISOR_RESOURCE_TYPES, ADVISOR_PERFORMANCE_REFERENCE_URL, advisorContent } from "../src/lib/advisor-catalog";
import { sanitizeSnapshot } from "../src/lib/sanitize";
import { createDemoRawSnapshot } from "./demo-data";
import { publicSnapshotSchema } from "./public-schema";
import { validatePublicJsonSchema } from "./json-schema-validator";
import { scanJson } from "./privacy-rules";

const subscription = "/subscriptions/00000000-0000-0000-0000-000000000001";
const resource = `${subscription}/resourceGroups/private-group/providers/Microsoft.Storage/storageAccounts/private-account`;
const knownType = "42dbf883-9e4b-4f84-9da4-232b87c4b5e9";
const cosmosIndexType = "4391ebb6-9519-4563-97c8-85f40cb92a63";
const cosmosResource = `${subscription}/resourceGroups/private-group/providers/Microsoft.DocumentDB/databaseAccounts/private-account`;
const record = (id: string, overrides: Partial<AdvisorRow> = {}): AdvisorRow => ({
  id: `${resource}/providers/Microsoft.Advisor/recommendations/${id}`, category: "HighAvailability",
  impact: "Medium", recommendationTypeId: knownType, resourceId: resource,
  recommendationStatus: "New", tracked: "false", ...overrides
});

function snapshot(rows: AdvisorRow[]) {
  const raw = createDemoRawSnapshot();
  raw.advisor = summarizeAdvisor(rows);
  raw.sources.push({ source: "Azure Advisor", availability: raw.advisor.availability, message: raw.advisor.message });
  return sanitizeSnapshot(raw);
}

describe("Advisor reviewed recommendation content", () => {
  it("projects pagination identity, built-in type and lifecycle but never raw free text", () => {
    expect(ADVISOR_QUERY).toContain("| project id,");
    expect(ADVISOR_QUERY).toMatch(/\| order by id asc$/);
    expect(ADVISOR_QUERY).toContain("properties.recommendationTypeId");
    expect(ADVISOR_QUERY).toContain("properties.resourceMetadata.resourceId");
    expect(ADVISOR_QUERY).toContain("properties.recommendationStatus");
    expect(ADVISOR_QUERY).not.toMatch(/shortDescription|extendedProperties|label|dcount|summarize|\btake\b|\blimit\b/);
  });

  it("groups High and Medium of the same content together, deduplicating resource identities exactly", () => {
    const result = summarizeAdvisor([
      record("one", { impact: "High" }), record("two", { resourceId: resource.toUpperCase() }),
      record("three", { resourceId: `${resource}-other` })
    ]);
    expect(result.details).toMatchObject({ mappedRecommendationCount: 3, withheldRecommendationCount: 0, affectedResourceCount: 2 });
    expect(result.details!.groups).toHaveLength(1);
    expect(result.details!.groups[0]).toMatchObject({
      id: "blob-soft-delete", count: 3, impacts: { High: 1, Medium: 2, Low: 0, Unknown: 0 },
      affectedResourceCount: 2, resourceTypes: [{ type: "microsoft.storage/storageaccounts", count: 3 }]
    });
    expect(result.recommendations.reduce((sum, group) => sum + group.count, 0)).toBe(3);
  });

  it("keeps successful category collection available when one concrete group is unmapped", () => {
    const result = snapshot([record("known"), record("unmapped", { recommendationTypeId: "unreviewed-type" })]).advisor!;
    expect(result.availability).toBe("available");
    expect(result.details).toMatchObject({
      availability: "partial", mappedRecommendationCount: 1, withheldRecommendationCount: 1
    });
    expect(result.details!.groups.find((group) => group.id === "blob-soft-delete")).toMatchObject({
      contentStatus: "mapped", count: 1, affectedResourceCount: 1,
      impacts: { High: 0, Medium: 1, Low: 0, Unknown: 0 }
    });
  });

  it("maps the documented Cosmos DB missing-index type without publishing private query text", () => {
    const performance = {
      ...record("cosmos", {
        category: "Performance", recommendationTypeId: cosmosIndexType, resourceId: cosmosResource
      }),
      shortDescription: { solution: "private-query-name" },
      extendedProperties: { indexPath: "/private-field/?" }
    };
    const result = snapshot([performance]);
    expect(result.advisor!.details).toMatchObject({
      availability: "available", mappedRecommendationCount: 1, withheldRecommendationCount: 0,
      excludedRecommendationCount: 0, affectedResourceCount: 1,
      groups: [{
        id: "cosmos-missing-indexes", category: "Performance", contentStatus: "mapped",
        count: 1, impacts: { High: 0, Medium: 1, Low: 0, Unknown: 0 }, affectedResourceCount: 1,
        resourceTypes: [{ type: "microsoft.documentdb/databaseaccounts", count: 1 }],
        title: "Cosmos DB の不足インデックスを確認", sourceUrl: ADVISOR_PERFORMANCE_REFERENCE_URL
      }]
    });
    expect(publicSnapshotSchema.safeParse(result).success).toBe(true);
    expect(() => validatePublicJsonSchema(result)).not.toThrow();
    expect(JSON.stringify(result.advisor)).not.toMatch(/private-|4391ebb6|shortDescription|extendedProperties/);
    expect(scanJson(JSON.stringify(result.advisor))).toEqual([]);
  });

  it("keeps untrusted Cosmos index lookalikes withheld and does not reclassify completed records as candidates", () => {
    const base = { category: "Performance", recommendationTypeId: cosmosIndexType, resourceId: cosmosResource };
    const result = summarizeAdvisor([
      record("wrong-type", { ...base, resourceId: resource }),
      record("wrong-category", { ...base, category: "HighAvailability" }),
      record("tracked", { ...base, tracked: "true" }),
      record("unknown", { ...base, recommendationTypeId: "unreviewed" }),
      record("completed", { ...base, recommendationStatus: "Completed" })
    ]);
    expect(result.details).toMatchObject({
      mappedRecommendationCount: 0, withheldRecommendationCount: 4, excludedRecommendationCount: 1
    });
    expect(result.details!.groups.every((group) => group.contentStatus === "withheld")).toBe(true);
    expect(result.recommendations.reduce((sum, group) => sum + group.count, 0)).toBe(5);
  });

  it("rejects repeated ARG identities instead of declaring a deduplicated partial result complete", () => {
    expect(() => summarizeAdvisor([record("same"), record("same")])).toThrow();
    expect(() => summarizeAdvisor([
      ...Array.from({ length: 1000 }, (_, index) => record(String(index))), record("0")
    ])).toThrow();
    expect(() => summarizeAdvisor([record("same"), record("same", { recommendationStatus: "Completed" })])).toThrow();
    expect(() => summarizeAdvisor([{ category: "Cost" }])).toThrow();
    expect(() => summarizeAdvisor([
      { category: "Cost", impact: "High", count: Number.MAX_SAFE_INTEGER },
      { category: "Performance", impact: "Medium", count: 1 }
    ])).toThrow();
  });

  it("preserves legacy totals while excluding completed, dismissed and postponed content", () => {
    const result = summarizeAdvisor(["New", "InProgress", "Completed", "Dismissed", "Postponed", ""]
      .map((recommendationStatus, index) => record(String(index), { recommendationStatus })));
    expect(result.recommendations).toEqual([{ category: "HighAvailability", impact: "Medium", count: 6 }]);
    expect(result.details).toMatchObject({
      availability: "partial", mappedRecommendationCount: 3, excludedRecommendationCount: 3, lifecycleUnknownCount: 1
    });
    expect(result.details!.groups[0]!.count).toBe(3);
  });

  it("does not label missing resource identities or subscription-level scope as exact resource counts", () => {
    const missing = summarizeAdvisor([record("one"), record("two", { resourceId: "" })]);
    expect(missing.details).toMatchObject({ availability: "partial", affectedResourceCount: null, withheldRecommendationCount: 1 });
    expect(missing.details!.groups.find((group) => group.contentStatus === "withheld")!.affectedResourceCount).toBeNull();
    const scope = summarizeAdvisor([record("one", { recommendationTypeId: "242639fd-cd73-4be2-8f55-70478db8d1a5", resourceId: subscription })]);
    expect(scope.details!.groups[0]).toMatchObject({ id: "service-health-alert", affectedResourceCount: null, contentStatus: "mapped" });
  });

  it("ignores titles including impersonated generic templates; unknown, tracked and wrong-type records are withheld", () => {
    const malicious = {
      ...record("private", { recommendationTypeId: "unknown-secret" }),
      shortDescription: { solution: "Enable Soft Delete to protect your blob data", problem: "password='private-secret-value'" }
    };
    const result = summarizeAdvisor([
      malicious,
      record("tracked", { tracked: "true" }),
      record("wrongtype", { resourceId: `${subscription}/resourceGroups/secret/providers/Custom.Secret/private/hostname` }),
      record("wrongcategory", { category: "Security" })
    ]);
    expect(result.details).toMatchObject({ mappedRecommendationCount: 0, withheldRecommendationCount: 4, availability: "partial" });
    expect(JSON.stringify(result)).not.toMatch(/private|secret|hostname|42dbf883|subscriptions\/0000/);
    expect(scanJson(JSON.stringify(result))).toEqual([]);
  });

  it("publishes only reviewed Japanese catalog strings with bounded conditional actions", () => {
    for (const item of ADVISOR_CATALOG) {
      expect(item.title).toMatch(/[ぁ-んァ-ン一-龯]/);
      expect(item.recommendedAction.length).toBeGreaterThan(25);
      expect(item.deferWhen).toMatch(/なら|場合/);
      expect(item.sourceUrl).toMatch(/^https:\/\/learn\.microsoft\.com\/ja-jp\//);
      expect(advisorContent(item.id, item.category)).toMatchObject({ contentStatus: "mapped", title: item.title });
    }
    expect(scanJson(JSON.stringify(ADVISOR_CATALOG))).toEqual([]);
  });

  it("keeps JSON Schema's closed public vocabulary synchronized with the reviewed catalog", () => {
    const schema = JSON.parse(readFileSync("schemas/public/v1.4/advisor.schema.json", "utf8"));
    const contents = [...ADVISOR_CATALOG.map((item) => advisorContent(item.id, item.category)),
      ...ADVISOR_CATEGORIES.map((category) => advisorContent("", category))];
    for (const field of ["id", "title", "description", "recommendedAction", "deferWhen", "caveat", "sourceUrl"] as const) {
      expect(new Set(schema.$defs.group.properties[field].enum)).toEqual(new Set(contents.map((content) => content[field])));
    }
    expect(schema.$defs.group.properties.resourceTypes.maxItems).toBe(ADVISOR_RESOURCE_TYPES.length);
    expect(schema.$defs.details.properties.groups.maxItems).toBe(ADVISOR_CATALOG.length + ADVISOR_CATEGORIES.length);
  });

  it("sanitizer reconstructs content, rejects arbitrary types and does not forward poisoned messages", () => {
    const raw = createDemoRawSnapshot();
    raw.advisor = summarizeAdvisor([record("one")]);
    const group = raw.advisor.details!.groups[0]!;
    Object.assign(group, {
      title: "secret-host", description: "secret-person", recommendedAction: "secret-value",
      deferWhen: "secret-project", caveat: "secret-ip", sourceUrl: "https://secret.invalid",
      resourceId: resource
    });
    raw.advisor.message = "secret-summary";
    raw.advisor.details!.message = "secret-detail";
    group.resourceTypes[0]!.type = "microsoft.secret/private-host";
    const result = sanitizeSnapshot(raw).advisor!;
    expect(result.details!.groups[0]!.title).toBe(advisorContent("blob-soft-delete", "HighAvailability").title);
    expect(result.details!.groups[0]!.resourceTypes).toEqual([{ type: "other", count: 1 }]);
    expect(JSON.stringify(result)).not.toMatch(/secret|private-host|resourceId/);
    expect(scanJson(JSON.stringify(result))).toEqual([]);
  });

  it("accepts backward-compatible and detailed snapshots in both schemas", () => {
    for (const rows of [[], [record("one")], [record("done", { recommendationStatus: "Completed" })], [record("unknown", { recommendationTypeId: "" })]]) {
      const result = snapshot(rows);
      expect(publicSnapshotSchema.safeParse(result).success).toBe(true);
      expect(() => validatePublicJsonSchema(result)).not.toThrow();
      delete result.advisor!.details;
      expect(publicSnapshotSchema.safeParse(result).success).toBe(true);
      expect(() => validatePublicJsonSchema(result)).not.toThrow();
    }
  });

  it("accepts the recommendations AI route while retaining historical security routes", () => {
    const result = snapshot([record("one")]);
    expect(result.aiInsights.length).toBeGreaterThan(0);
    for (const route of ["/recommendations", "/security"]) {
      result.aiInsights[0]!.route = route;
      expect(publicSnapshotSchema.safeParse(result).success).toBe(true);
      expect(() => validatePublicJsonSchema(result)).not.toThrow();
    }
  });

  it("rejects raw identifiers, free titles and schema extras in both schemas", () => {
    for (const poison of [
      { id: knownType }, { title: "private-title" }, { description: "private-description" },
      { recommendedAction: "private-action" }, { deferWhen: "private-condition" }, { caveat: "private-caveat" },
      { resourceId: resource }, { sourceUrl: "https://private.invalid" }
    ]) {
      const result = snapshot([record("one")]);
      Object.assign(result.advisor!.details!.groups[0]!, poison);
      expect(publicSnapshotSchema.safeParse(result).success).toBe(false);
      expect(() => validatePublicJsonSchema(result)).toThrow();
    }
  });

  it("rejects mismatched content, counts, availability, category and duplicate groups", () => {
    const mutations = [
      (value: ReturnType<typeof snapshot>) => { value.advisor!.details!.groups[0]!.description = "private-description"; },
      (value: ReturnType<typeof snapshot>) => { value.advisor!.details!.mappedRecommendationCount += 1; },
      (value: ReturnType<typeof snapshot>) => { value.advisor!.details!.groups[0]!.impacts.High += 1; },
      (value: ReturnType<typeof snapshot>) => { value.advisor!.details!.excludedRecommendationCount += 1; },
      (value: ReturnType<typeof snapshot>) => { value.advisor!.details!.groups.push(value.advisor!.details!.groups[0]!); },
      (value: ReturnType<typeof snapshot>) => { value.advisor!.details!.groups[0]!.category = "Cost"; },
      (value: ReturnType<typeof snapshot>) => { value.advisor!.details!.affectedResourceCount = 0; },
      (value: ReturnType<typeof snapshot>) => { value.advisor!.details!.lifecycleUnknownCount = 2; },
      (value: ReturnType<typeof snapshot>) => { value.advisor!.details!.groups[0]!.resourceTypes[0]!.count = 2; },
      (value: ReturnType<typeof snapshot>) => { value.advisor!.details!.groups[0]!.resourceTypes.push({ ...value.advisor!.details!.groups[0]!.resourceTypes[0]! }); },
      (value: ReturnType<typeof snapshot>) => { value.advisor!.details!.availability = "unavailable"; }
    ];
    for (const mutate of mutations) {
      const result = snapshot([record("one")]);
      mutate(result);
      expect(publicSnapshotSchema.safeParse(result).success).toBe(false);
    }
  });

  it("validates detail state and card enums and rejects invalid numeric counters in both contracts", () => {
    for (const poison of [
      { availability: "private-state" },
      { mappedRecommendationCount: -1 },
      { withheldRecommendationCount: 0.5 },
      { excludedRecommendationCount: Number.MAX_SAFE_INTEGER + 1 },
      { lifecycleUnknownCount: null }
    ]) {
      const result = snapshot([record("one")]);
      Object.assign(result.advisor!.details!, poison);
      expect(publicSnapshotSchema.safeParse(result).success).toBe(false);
      expect(() => validatePublicJsonSchema(result)).toThrow();
    }
    const result = snapshot([record("one")]);
    Object.assign(result.advisor!.details!.groups[0]!, { contentStatus: "reviewed" });
    expect(publicSnapshotSchema.safeParse(result).success).toBe(false);
    expect(() => validatePublicJsonSchema(result)).toThrow();
  });

  it("clears unavailable details without inventing zero-resource success", () => {
    const raw = createDemoRawSnapshot();
    raw.advisor = summarizeAdvisor([record("one")]);
    raw.advisor.availability = "unavailable";
    raw.sources.push({ source: "Azure Advisor", availability: "unavailable", message: "Advisor の読み取りは利用できません。" });
    const result = sanitizeSnapshot(raw);
    expect(result.advisor).toMatchObject({
      recommendations: [],
      details: {
        availability: "unavailable", mappedRecommendationCount: 0, withheldRecommendationCount: 0,
        excludedRecommendationCount: 0, lifecycleUnknownCount: 0, affectedResourceCount: null, groups: []
      }
    });
    expect(publicSnapshotSchema.safeParse(result).success).toBe(true);
    expect(() => validatePublicJsonSchema(result)).not.toThrow();
  });
});
