import { describe, expect, it } from "vitest";
import { createDemoRawSnapshot } from "./demo-data";
import { sanitizeSnapshot, resourceRef } from "../src/lib/sanitize";
import { publicSnapshotSchema } from "./public-schema";
import { validatePublicJsonSchema } from "./json-schema-validator";
import { scanJson } from "./privacy-rules";
import { summarizeAdvisor } from "./advisor";
import { buildNetworkTopology } from "./network-topology";
import { transformComparableCost } from "./cost-transform";
import { collectDefender } from "./defender-collection";
import { isPrivateCidr } from "../src/lib/network-evidence";

const subscription = "00000000-0000-0000-0000-000000000001";
const arm = `/subscriptions/${subscription}/resourceGroups/private-group/providers/Microsoft.Storage/storageAccounts/private-account`;
const target = { id: arm, name: "private-account", resourceGroup: "private-group", type: "microsoft.storage/storageaccounts", location: "japaneast", status: "Healthy" };
const advisorRow = (id: string, resourceId = arm) => ({
  id: `${arm}/providers/Microsoft.Advisor/recommendations/${id}`,
  category: "HighAvailability", impact: "High", recommendationTypeId: "42dbf883-9e4b-4f84-9da4-232b87c4b5e9",
  recommendationStatus: "New", tracked: "false", resourceId
});

function validate(snapshot: ReturnType<typeof sanitizeSnapshot>) {
  publicSnapshotSchema.parse(snapshot);
  expect(() => validatePublicJsonSchema(snapshot)).not.toThrow();
  expect(scanJson(JSON.stringify(snapshot))).toEqual([]);
}

describe("useful evidence without private identities", () => {
  it.each([
    [10.1, 20.2, 30.3],
    [100.1, 200.2, 300.3],
    [-10.1, 20.2, -30.3]
  ])("tolerates decimal summation order but rejects a materially undersized denominator (%s, %s, %s)", (...amounts) => {
    const raw = createDemoRawSnapshot();
    const result = transformComparableCost({
      columns: [{ name: "Cost" }, { name: "ServiceName" }, { name: "Currency" }],
      rows: amounts.map((amount, i) => [amount, `Service ${i}`, "JPY"])
    }, null);
    raw.costCategories = result.categories;
    raw.costCategoryMagnitudeJpy = result.categoryMagnitudeJpy;
    const snapshot = sanitizeSnapshot(raw);
    expect(snapshot.cost.categories.map((category) => category.sharePercent)).toEqual([50, 33.3, 16.7]);
    validate(snapshot);
    raw.costCategoryMagnitudeJpy = result.categoryMagnitudeJpy - 0.01;
    expect(() => sanitizeSnapshot(raw)).toThrow("denominator");
  });

  it("uses the all-category magnitude after top8 and credits through the sanitizer", () => {
    const raw = createDemoRawSnapshot();
    const result = transformComparableCost({
      columns: [{ name: "Cost" }, { name: "ServiceName" }, { name: "Currency" }],
      rows: [10000, 9000, 8000, 7000, 6000, 5000, 4000, 3000, -2000].map((amount, i) => [amount, `Service ${i}`, "JPY"])
    }, null);
    raw.costCategories = result.categories;
    raw.costCategoryMagnitudeJpy = result.categoryMagnitudeJpy;
    const snapshot = sanitizeSnapshot(raw);
    expect(snapshot.cost.categories[0]!.sharePercent).toBe(18.5);
    expect(snapshot.cost.categories.reduce((sum, item) => sum + item.sharePercent, 0)).toBeCloseTo(96.4, 1);
    raw.costCategoryMagnitudeJpy = 1;
    expect(() => sanitizeSnapshot(raw)).toThrow("denominator");
  });

  it("publishes normalized Advisor references and fetched target context only", () => {
    const raw = createDemoRawSnapshot();
    raw.resources = [target];
    raw.advisor = summarizeAdvisor([advisorRow("one", arm.toUpperCase()), advisorRow("missing", `${arm}-uncollected`)], raw.resources);
    raw.sources.push({ source: "Azure Advisor", availability: raw.advisor.availability, message: raw.advisor.message });
    const result = sanitizeSnapshot(raw);
    const group = result.advisor!.details!.groups[0]!;
    expect(group.resourceRefs).toEqual([result.inventory.resources[0]!.id]);
    expect(group.targets).toEqual([{ resourceRef: resourceRef(arm), type: target.type, region: "japaneast" }]);
    expect(group.targetCoverage).toEqual({ totalResources: 2, publishedResources: 1, unresolvedResources: 1, truncated: false });
    expect(group.scopeCounts).toEqual({ resource: 2, subscription: 0, unknown: 0 });
    validate(result);
    group.targets![0]!.region = "westus";
    expect(publicSnapshotSchema.safeParse(result).success).toBe(false);
  });

  it("marks subscription scope and unknown identities separately, with no guessed resource target", () => {
    const result = summarizeAdvisor([
      advisorRow("subscription", `/subscriptions/${subscription}`), advisorRow("unknown", "")
    ], [target]);
    expect(result.details!.groups.every((group) => group.targets?.length === 0)).toBe(true);
    const counts = result.details!.groups.map((group) => group.scopeCounts!);
    expect(counts.reduce((sum, item) => sum + item.subscription, 0)).toBe(1);
    expect(counts.reduce((sum, item) => sum + item.unknown, 0)).toBe(1);
  });

  it("bounds target drilldowns without changing exact group resource counts", () => {
    const targets = Array.from({ length: 105 }, (_, i) => ({ ...target, id: `${arm}-${i}` }));
    const result = summarizeAdvisor(targets.map((item, i) => advisorRow(String(i), item.id)), targets);
    expect(result.details!.groups[0]).toMatchObject({
      affectedResourceCount: 105,
      targetCoverage: { totalResources: 105, publishedResources: 100, unresolvedResources: 0, truncated: true }
    });
    expect(result.details!.groups[0]!.resourceRefs).toHaveLength(100);
  });

  it("collects structured private addresses, CIDRs and partially masked public addresses end to end", () => {
    const raw = createDemoRawSnapshot();
    const nic = { ...target, id: arm.replace("Microsoft.Storage/storageAccounts", "Microsoft.Network/networkInterfaces"), type: "microsoft.network/networkinterfaces" };
    const pip = { ...target, id: arm.replace("Microsoft.Storage/storageAccounts", "Microsoft.Network/publicIPAddresses"), type: "microsoft.network/publicipaddresses" };
    raw.resources = [nic, pip];
    raw.networkTopology = buildNetworkTopology([
      { ...nic, properties: { ipConfigurations: [{ properties: { privateIPAddress: "10.2.3.4", publicIPAddress: { id: pip.id } } }] } },
      { ...pip, properties: { ipAddress: "203.0.113.42", addressPrefix: "192.168.0.0/16" } }
    ], raw.resources, subscription);
    raw.sources.push({ source: "Network topology", availability: raw.networkTopology.availability, message: raw.networkTopology.message });
    const result = sanitizeSnapshot(raw);
    expect(result.inventory.resources[0]!.network?.privateIpv4).toEqual(["10.2.3.4"]);
    expect(result.inventory.resources[1]!.network?.publicIpv4Masked).toEqual(["203.0.*.*"]);
    expect(result.network.topology!.nodes.find((node) => node.id === result.inventory.resources[0]!.id)?.network?.privateIpv4).toEqual(["10.2.3.4"]);
    expect(JSON.stringify(result)).not.toContain("203.0.113.42");
    validate(result);
  });

  it("keeps unknown Defender statuses out of confirmed findings and reports incomplete assessment coverage", () => {
    const result = collectDefender(<T>(query: string): T[] => (
      query.includes("securescores") ? [{ percentageRatio: 0.75 }] :
      query.includes("alerts") ? [{ count_: 0 }] : [
        { properties: { displayName: "same", status: { code: "Unhealthy" }, metadata: { severity: "High" } } },
        { properties: { displayName: "same", status: { code: "Unknown" } } },
        { properties: {} }
      ]
    ) as T[]);
    expect(result.status.availability).toBe("partial");
    expect(result.security.fieldAvailability?.assessments).toBe("partial");
    expect(result.security.assessmentCoverage).toMatchObject({ totalAssessments: 3, unhealthyAssessments: 1, unknownAssessments: 2 });
    expect(result.security.recommendations.reduce((sum, item) => sum + item.affectedCount, 0)).toBe(1);
    const raw = createDemoRawSnapshot();
    raw.security = result.security;
    raw.sources = raw.sources.map((source) => source.source === "Defender for Cloud" ? result.status : source);
    validate(sanitizeSnapshot(raw));
  });
});

describe("field-aware network privacy", () => {
  const structured = (field: string, value: string) => JSON.stringify({ inventory: { resources: [{ network: { [field]: [value] } }] } });
  it.each(["10.0.0.1", "172.16.0.1", "172.31.255.254", "192.168.1.1"])("allows RFC1918 %s only as structured network data", (value) => {
    expect(scanJson(structured("privateIpv4", value))).toEqual([]);
    expect(scanJson(JSON.stringify({ observation: value }))).not.toEqual([]);
    expect(scanJson(JSON.stringify({ privateIpv4: [value] }))).not.toEqual([]);
    expect(scanJson(JSON.stringify({ inventory: { resources: [{ tags: { privateIpv4: [value] } }] } }))).not.toEqual([]);
  });
  it.each(["172.15.0.1", "172.32.0.1", "100.64.1.1", "127.0.0.1", "203.0.113.42"])("rejects non-RFC1918 %s even in a private field", (value) => {
    expect(scanJson(structured("privateIpv4", value))).not.toEqual([]);
  });
  it.each(["10.0.0.0/7", "172.16.0.0/11", "192.168.0.0/15"])("rejects overbroad private CIDR %s", (value) => {
    expect(isPrivateCidr(value)).toBe(false);
    expect(scanJson(structured("privateCidrs", value))).not.toEqual([]);
  });
  it("rejects prose smuggling and invalid address values in runtime and JSON Schema", () => {
    for (const value of ["10.0.0.1 private-secret", "10.999.0.1", "203.0.113.42", "010.0.0.1"]) {
      const result = sanitizeSnapshot(createDemoRawSnapshot());
      result.inventory.resources[0]!.network = { privateIpv4: [value], privateCidrs: [], publicIpv4Masked: [], truncated: false };
      expect(publicSnapshotSchema.safeParse(result).success).toBe(false);
      expect(() => validatePublicJsonSchema(result)).toThrow();
    }
  });
  it("keeps whole CIDR blocks inside RFC1918 in both schemas and explicitly caps address arrays", () => {
    for (const cidr of ["10.0.0.0/7", "172.16.0.0/11", "192.168.0.0/15", "10.999.0.0/16"]) {
      const result = sanitizeSnapshot(createDemoRawSnapshot());
      result.inventory.resources[0]!.network = { privateIpv4: [], privateCidrs: [cidr], publicIpv4Masked: [], truncated: false };
      expect(publicSnapshotSchema.safeParse(result).success).toBe(false);
      expect(() => validatePublicJsonSchema(result)).toThrow();
    }
    const raw = createDemoRawSnapshot();
    raw.resources[0]!.network = {
      privateIpv4: Array.from({ length: 40 }, (_, i) => `10.0.0.${i + 1}`),
      privateCidrs: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"],
      publicIpv4Masked: ["203.0.*.*"], truncated: false
    };
    const result = sanitizeSnapshot(raw);
    expect(result.inventory.resources[0]!.network?.privateIpv4).toHaveLength(32);
    expect(result.inventory.resources[0]!.network?.truncated).toBe(true);
    validate(result);
  });
});
