import { describe, expect, it } from "vitest";
import publishedSnapshot from "../../public/data/snapshot.json";
import { createDemoRawSnapshot } from "../../scripts/demo-data";
import { publicSnapshotSchema } from "../../scripts/public-schema";
import { JPY_DISCLOSURE_FLOOR, WITHHELD_JPY_AMOUNT_LABEL } from "./jpy-disclosure";
import {
  assertResourceAliasesAreInjective,
  classifyEndpoint,
  formatApproximateJpy,
  maskGuid,
  maskIdentity,
  maskIp,
  maskResourceGroup,
  maskResourceName,
  resourceAliasLabel,
  sanitizeSnapshot,
  sanitizeTags
} from "./sanitize";

/**
 * Synthetic, but shaped like the Azure names that used to leak through the partial mask: a project
 * token, a region, and a trailing serial suffix, plus the auto-generated form that embeds a
 * subscription GUID. The values are invented — publishing a real internal name in a test would
 * re-commit the very disclosure this change removes — while the *shape* is what the assertions
 * need. Keeping the raw value here rather than reading one out of the published snapshot is what
 * lets these tests assert that none of it survives, which the published data alone can never show.
 */
const RAW_RESOURCE_NAME = "grantportal-intake-prod-westus2-qzwlmk07";
const RAW_RESOURCE_GROUP = "rg-grantportal-intake-westus2-001";
const RAW_SUBSCRIPTION_GUID = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
const RAW_GENERATED_NAME = `DefaultWorkspace-${RAW_SUBSCRIPTION_GUID}-WUS2`;

function fragmentsOf(value: string, length: number): string[] {
  return Array.from({ length: Math.max(0, value.length - length + 1) }, (_, index) =>
    value.slice(index, index + length)
  );
}

/**
 * Strips the constant alias label so the assertion is about what the masking *derives* from the
 * Azure name, not about the fixed prefix the format always contributes. An alias that stopped
 * following the format keeps its whole value here, so a return to partial disclosure still fails.
 */
function derivedPartOf(alias: string, label: string): string {
  return alias.startsWith(`${label}-`) ? alias.slice(label.length + 1) : alias;
}

describe("public sanitization boundary", () => {
  it("reveals exactly the first and last eight GUID hex characters", () => {
    const masked = maskGuid(["01234567", "89ab", "cdef", "0123", "456789abcdef"].join("-"));
    expect(masked).toBe("01234567-****-****-****-****89abcdef");
    expect(masked.replaceAll("-", "").replaceAll("*", "")).toHaveLength(16);
  });

  it("leaves no fragment of an Azure resource name in the alias it publishes", () => {
    const alias = maskResourceName(RAW_RESOURCE_NAME, "microsoft.compute/virtualMachines");

    expect(alias).toMatch(/^virtualMachines-[0-9a-f]{8}$/);
    const derived = derivedPartOf(alias, "virtualMachines").toLowerCase();
    for (const fragment of fragmentsOf(RAW_RESOURCE_NAME, 3)) {
      expect(derived).not.toContain(fragment.toLowerCase());
    }
  });

  it("leaves no fragment of an Azure resource group name in the alias it publishes", () => {
    const alias = maskResourceGroup(RAW_RESOURCE_GROUP);

    expect(alias).toMatch(/^rg-[0-9a-f]{8}$/);
    const derived = derivedPartOf(alias, "rg").toLowerCase();
    for (const fragment of fragmentsOf(RAW_RESOURCE_GROUP, 3)) {
      expect(derived).not.toContain(fragment.toLowerCase());
    }
  });

  it("leaves no fragment of an Azure-generated name that embeds the subscription GUID", () => {
    const alias = maskResourceName(RAW_GENERATED_NAME, "microsoft.operationalinsights/workspaces");

    expect(alias).toMatch(/^workspaces-[0-9a-f]{8}$/);
    const derived = derivedPartOf(alias, "workspaces").toLowerCase();
    // The GUID is what actually escaped in production: the mask hid its middle in the subscription
    // field while an auto-generated resource name republished it verbatim.
    for (const fragment of fragmentsOf(RAW_SUBSCRIPTION_GUID.replaceAll("-", ""), 4)) {
      expect(derived).not.toContain(fragment.toLowerCase());
    }
  });

  it.each([
    ["a resource name", () => maskResourceName(RAW_RESOURCE_NAME, "microsoft.compute/virtualMachines"), "virtualMachines-17f18328"],
    ["a resource group", () => maskResourceGroup(RAW_RESOURCE_GROUP), "rg-e55748ad"]
  ])("keeps the alias of %s stable across runs", (_label, produce, expected) => {
    // Pins the hash input, not just the format. Changing the domain prefix would silently rewrite
    // every published identifier on the next collection, which no format assertion would notice.
    expect(produce()).toBe(expected);
  });

  it("takes the alias prefix from the resource type rather than the resource name", () => {
    const asVirtualMachine = maskResourceName(RAW_RESOURCE_NAME, "microsoft.compute/virtualMachines");
    const asStorageAccount = maskResourceName(RAW_RESOURCE_NAME, "microsoft.storage/storageAccounts");

    expect(asVirtualMachine.split("-").at(-1)).toBe(asStorageAccount.split("-").at(-1));
    expect(asVirtualMachine.split("-")[0]).toBe("virtualMachines");
    expect(asStorageAccount.split("-")[0]).toBe("storageAccounts");
  });

  it.each([
    ["an empty type", "", "resource"],
    ["a trailing separator", "microsoft.compute/", "resource"],
    ["a nested type", "microsoft.automation/automationAccounts/runbooks", "runbooks"],
    ["no separator at all", "microsoft.compute", "microsoftcompute"],
    ["punctuation in the tail", "microsoft.web/sites (classic)", "sitesclassic"],
    ["an unreasonably long tail", `microsoft.test/${"a".repeat(80)}`, "a".repeat(24)]
  ])("keeps the alias prefix well formed given %s", (_label, type, expected) => {
    expect(resourceAliasLabel(type)).toBe(expected);
    expect(maskResourceName("any-name", type)).toMatch(
      new RegExp(`^${expected}-[0-9a-f]{8}$`)
    );
  });

  it("gives every resource in one Azure resource group the same alias", () => {
    expect(maskResourceGroup(RAW_RESOURCE_GROUP)).toBe(maskResourceGroup(RAW_RESOURCE_GROUP));
    expect(maskResourceGroup(RAW_RESOURCE_GROUP)).not.toBe(maskResourceGroup(`${RAW_RESOURCE_GROUP}-2`));
  });

  it("keeps resource group and resource aliases apart for an identical Azure name", () => {
    expect(maskResourceGroup(RAW_RESOURCE_NAME).split("-").at(-1)).not.toBe(
      maskResourceName(RAW_RESOURCE_NAME, "microsoft.compute/virtualMachines").split("-").at(-1)
    );
  });

  it("masks network addresses and classifies endpoints", () => {
    expect(maskIp(["203", "0", "113", "42"].join("."))).toBe("203.0.*.*");
    expect(maskIp("2603:1030:20e:3::23")).toBe("2603:1030:*");
    expect(classifyEndpoint("app.blob.core.windows.net")).toBe("Azure Storage endpoint");
    expect(classifyEndpoint("api.example.org")).toBe("External service endpoint");
  });

  it.each([
    ["an oversized hextet", "deadbeefcafe:1"],
    ["a label and a port", `${RAW_RESOURCE_NAME}:443`],
    ["too many hextets", "1:2:3:4:5:6:7:8:9"],
    ["an empty hextet", "2603::1030::23"],
    ["an out-of-range IPv4 octet", "123.456.789.012"],
    ["a zero-padded IPv4 octet", "192.000.002.128"],
    ["an invalid IPv4 tail", "::ffff:999.999.999.999"],
    ["an IPv4 address in a non-final position", "1.2.3.4::1"]
  ])("refuses to publish %s as if it were an address", (_label, value) => {
    // A colon alone used to be enough to take the IPv6 branch, which republished the first two
    // colon-separated segments verbatim — an unbounded passthrough for anything shaped like a pair.
    expect(maskIp(value)).toMatch(/^network-[0-9a-f]{8}$/);
  });

  it("expands the address before choosing a prefix so a leading :: cannot shift host bits forward", () => {
    // Splitting on ":" and dropping the empties used to publish the low-order groups, which carry
    // far more of the address than the routing prefix the mask is meant to keep.
    expect(maskIp("::ffff:192.0.2.128")).toBe("0:0:*");
    expect(maskIp("::1")).toBe("0:0:*");
    expect(maskIp("2603:1030:20e:3::23")).toBe("2603:1030:*");
  });

  it("keeps the raw Azure names out of the collision error, which lands in a public log", () => {
    const raw = createDemoRawSnapshot();
    const [first, second] = raw.resources;
    if (!first || !second) throw new Error("The demo snapshot lost its resources");
    first.name = "svc-6uzx";
    second.name = "svc-d2ad";
    second.type = first.type;

    const message = (() => {
      try {
        sanitizeSnapshot(raw);
        return "";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    })();

    expect(message).toMatch(/Alias collision/);
    expect(message).not.toContain(first.name);
    expect(message).not.toContain(second.name);
    expect(message).not.toContain(first.resourceGroup);
  });

  it("fails the collection rather than publishing two Azure names under one alias", () => {
    // Real 32-bit FNV-1a collision, found by search: both names hash to f004ce67. Going through
    // sanitizeSnapshot proves the guard is wired into the publish path, not merely exported.
    const raw = createDemoRawSnapshot();
    const [first, second] = raw.resources;
    if (!first || !second) throw new Error("The demo snapshot lost its resources");
    first.name = "svc-6uzx";
    second.name = "svc-d2ad";
    second.type = first.type;

    expect(maskResourceName(first.name, first.type)).toBe(
      maskResourceName(second.name, second.type)
    );
    expect(() => sanitizeSnapshot(raw)).toThrow(/Alias collision: two distinct Azure resource name/);
  });

  it("fails the collection rather than publishing two resource groups under one alias", () => {
    // Companion collision for the rg: hash domain, both landing on b320e567.
    const raw = createDemoRawSnapshot();
    const [first, second] = raw.resources;
    if (!first || !second) throw new Error("The demo snapshot lost its resources");
    first.resourceGroup = "rg-17yzx";
    second.resourceGroup = "rg-1e6ad";

    expect(maskResourceGroup(first.resourceGroup)).toBe(maskResourceGroup(second.resourceGroup));
    expect(() => sanitizeSnapshot(raw)).toThrow(/Alias collision: two distinct Azure resource group/);
  });

  it("reports collisions through the exported guard so collectors can reuse it", () => {
    const raw = [
      { id: "/a/web-01", name: "web-01", resourceGroup: "rg-a", type: "microsoft.compute/virtualMachines" },
      { id: "/a/web-02", name: "web-02", resourceGroup: "rg-a", type: "microsoft.compute/virtualMachines" }
    ];
    const collided = raw.map((resource) => ({
      id: `res-${"0".repeat(8)}`,
      name: "virtualMachines-00000000",
      resourceGroup: maskResourceGroup(resource.resourceGroup),
      type: resource.type,
      region: "japaneast",
      status: "Unknown" as const,
      owner: "identity-00000000",
      tags: {},
      change: "No material change"
    }));

    expect(() => assertResourceAliasesAreInjective(raw, collided)).toThrow(
      /Alias collision: two distinct Azure resource (name|id)/
    );
    expect(() => assertResourceAliasesAreInjective(raw, collided.slice(0, 1))).toThrow(
      /one published record per Azure resource/
    );
  });

  it("accepts an alias two resources share because their Azure names are identical", () => {
    const raw = createDemoRawSnapshot();
    const [first, second] = raw.resources;
    if (!first || !second) throw new Error("The demo snapshot lost its resources");
    first.name = RAW_RESOURCE_NAME;
    second.name = RAW_RESOURCE_NAME;

    expect(() => sanitizeSnapshot(raw)).not.toThrow();
  });

  it.each([
    ["names a resource in the subscription", `Encrypt disks on ${RAW_RESOURCE_NAME}`],
    ["names a resource group", `Review access for ${RAW_RESOURCE_GROUP}`],
    ["embeds the subscription GUID", `Custom policy ${RAW_SUBSCRIPTION_GUID}`],
    ["embeds a bare hex run", "Custom assessment deadbeefcafe"]
  ])(
    "withholds a Defender title that %s, because operators author custom assessments",
    (_label, title) => {
      const raw = createDemoRawSnapshot();
      raw.mode = "AZURE";
      raw.subscriptionId = RAW_SUBSCRIPTION_GUID;
      const [first] = raw.resources;
      if (!first) throw new Error("The demo snapshot lost its resources");
      first.name = RAW_RESOURCE_NAME;
      first.resourceGroup = RAW_RESOURCE_GROUP;
      raw.security.recommendations = [
        { title, severity: "warning", affectedCount: 3, status: "Open" }
      ];

      const snapshot = sanitizeSnapshot(raw);

      const published = snapshot.security.recommendations[0]!;
      expect(published.title).toBe("Defender の推奨事項（タイトル非公開）");
      expect(published.affectedCount).toBe(3);
      expect(JSON.stringify(snapshot)).not.toContain(RAW_RESOURCE_NAME);
      expect(JSON.stringify(snapshot)).not.toContain(RAW_RESOURCE_GROUP);
    }
  );

  it("keeps a built-in Defender title that names no resource", () => {
    const raw = createDemoRawSnapshot();
    raw.security.recommendations = [
      {
        title: "Machines should have vulnerability findings resolved",
        severity: "warning",
        affectedCount: 2,
        status: "Open"
      }
    ];

    const snapshot = sanitizeSnapshot(raw);

    expect(snapshot.security.recommendations[0]!.title).toBe(
      "Machines should have vulnerability findings resolved"
    );
  });

  it("fully replaces identities and only allows approved tags", () => {
    expect(maskIdentity(["someone", "example.org"].join("@"))).toMatch(/^identity-[0-9a-f]{8}$/);
    expect(
      sanitizeTags({ environment: "production", secret: "remove-me", team: "unknown-team" })
    ).toEqual({ environment: "production", team: expect.stringMatching(/^value-/) });
  });

  it.each([
    ["null", null],
    ["undefined", undefined]
  ])("treats %s Azure resource tags as an empty object", (_label, tags) => {
    const raw = createDemoRawSnapshot();
    raw.resources[0]!.tags = tags;

    const snapshot = sanitizeSnapshot(raw);

    expect(snapshot.inventory.resources[0]!.tags).toEqual({});
    expect(() => publicSnapshotSchema.parse(snapshot)).not.toThrow();
  });

  it("rejects non-record tag input and non-string tag values", () => {
    expect(sanitizeTags("environment=production")).toEqual({});
    expect(sanitizeTags(["production"])).toEqual({});
    expect(sanitizeTags({ environment: null, team: { name: "platform" } })).toEqual({});
  });

  it("normalizes adjacent null Azure locations without failing collection", () => {
    const raw = createDemoRawSnapshot();
    raw.resources[0]!.location = null;
    raw.networkInventory[0]!.location = null;

    const snapshot = sanitizeSnapshot(raw);

    expect(snapshot.inventory.resources[0]!.region).toBe("Unknown");
    expect(snapshot.network.inventory.byRegion).toContainEqual({ label: "Unknown", count: 1 });
  });

  it("publishes rounded approximate JPY only", () => {
    expect(formatApproximateJpy(12_345)).toBe("約¥1.2万");
    expect(formatApproximateJpy(4_321_000)).toBe("約¥432.1万");
    expect(formatApproximateJpy(-12_345)).toBe("約¥1.2万 credit");
  });

  it("aliases a live Azure subscription display name and keeps public IDs unique", () => {
    const raw = createDemoRawSnapshot();
    raw.mode = "AZURE";
    raw.subscriptionDisplayName = "private-subscription-name";
    const snapshot = sanitizeSnapshot(raw);

    expect(snapshot.scope.displayName).toMatch(/^Azure subscription [0-9a-f]{8}$/);
    expect(snapshot.scope.displayName).not.toContain(raw.subscriptionDisplayName);
    expect(new Set(snapshot.inventory.resources.map((resource) => resource.id)).size).toBe(
      snapshot.inventory.resources.length
    );
  });

  it("marks unavailable cost signals explicitly instead of fabricating values", () => {
    const raw = createDemoRawSnapshot();
    const snapshot = sanitizeSnapshot(raw);

    expect(raw.forecastCostJpy).toBeNull();
    expect(raw.budgetLimitJpy).toBeNull();
    expect(snapshot.cost.forecast).toEqual({
      availability: "unavailable",
      approximateAmount: null
    });
    expect(snapshot.cost.budget).toEqual({
      availability: "unavailable",
      usedPercent: null
    });
  });

  it("never infers flow health from network inventory", () => {
    const raw = createDemoRawSnapshot();
    raw.networkTelemetry.availability = "unavailable";
    raw.networkTelemetry.message = "Flow telemetry unavailable.";
    const snapshot = sanitizeSnapshot(raw);

    expect(snapshot.network.inventory.total).toBe(raw.networkInventory.length);
    expect(snapshot.network.telemetry).toMatchObject({
      availability: "unavailable",
      healthyConnections: null,
      degradedConnections: null,
      blockedFlows: null,
      flows: []
    });
  });

  it("publishes credits without invalid negative service shares", () => {
    const raw = createDemoRawSnapshot();
    raw.exactCostJpy = 90;
    raw.costCategories = [
      { name: "Compute", amountJpy: 100, deltaPercent: 5 },
      { name: "Refund", amountJpy: -10, deltaPercent: null }
    ];
    const snapshot = sanitizeSnapshot(raw);

    expect(snapshot.cost.categories).toEqual([
      {
        name: "Compute",
        approximateAmount: "約¥1千未満",
        sharePercent: 90.9,
        deltaPercent: null
      },
      {
        name: "Refund credit",
        approximateAmount: "約¥1千未満 credit",
        sharePercent: 9.1,
        deltaPercent: null
      }
    ]);
    expect(() => publicSnapshotSchema.parse(snapshot)).not.toThrow();
  });

  it("withholds a service change while the published amount is withheld", () => {
    const raw = createDemoRawSnapshot();
    raw.exactCostJpy = JPY_DISCLOSURE_FLOOR - 1;
    raw.costCategories = [
      { name: "Storage", amountJpy: JPY_DISCLOSURE_FLOOR - 1, deltaPercent: 38_537.8 }
    ];
    const snapshot = sanitizeSnapshot(raw);

    expect(snapshot.cost.categories[0]?.approximateAmount).toBe(WITHHELD_JPY_AMOUNT_LABEL);
    expect(snapshot.cost.categories[0]?.deltaPercent).toBeNull();
    expect(() => publicSnapshotSchema.parse(snapshot)).not.toThrow();
  });

  it("keeps a service change once the published amount reaches the rounding unit", () => {
    const raw = createDemoRawSnapshot();
    raw.exactCostJpy = JPY_DISCLOSURE_FLOOR;
    raw.costCategories = [{ name: "Storage", amountJpy: JPY_DISCLOSURE_FLOOR, deltaPercent: 12.5 }];
    const snapshot = sanitizeSnapshot(raw);

    expect(snapshot.cost.categories[0]?.approximateAmount).not.toBe(WITHHELD_JPY_AMOUNT_LABEL);
    expect(snapshot.cost.categories[0]?.deltaPercent).toBe(12.5);
    expect(() => publicSnapshotSchema.parse(snapshot)).not.toThrow();
  });

  it("withholds the portfolio change while a period total is below the rounding unit", () => {
    const raw = createDemoRawSnapshot();
    raw.exactCostJpy = 400;
    raw.exactPreviousCostJpy = 1;
    const snapshot = sanitizeSnapshot(raw);

    expect(snapshot.cost.current.approximateAmount).toBe(WITHHELD_JPY_AMOUNT_LABEL);
    expect(snapshot.cost.deltaPercent).toBeNull();
    expect(() => publicSnapshotSchema.parse(snapshot)).not.toThrow();
  });

  it("still publishes the portfolio change once both periods reach the rounding unit", () => {
    const raw = createDemoRawSnapshot();
    raw.exactCostJpy = 2 * JPY_DISCLOSURE_FLOOR;
    raw.exactPreviousCostJpy = JPY_DISCLOSURE_FLOOR;
    const snapshot = sanitizeSnapshot(raw);

    expect(snapshot.cost.deltaPercent).toBe(100);
    expect(() => publicSnapshotSchema.parse(snapshot)).not.toThrow();
  });

  it("withholds the portfolio change when only the prior total is below the rounding unit", () => {
    const raw = createDemoRawSnapshot();
    raw.exactCostJpy = 140_000;
    raw.exactPreviousCostJpy = JPY_DISCLOSURE_FLOOR - 1;
    const snapshot = sanitizeSnapshot(raw);

    expect(snapshot.cost.current.approximateAmount).not.toBe(WITHHELD_JPY_AMOUNT_LABEL);
    expect(snapshot.cost.previous.approximateAmount).toBe(WITHHELD_JPY_AMOUNT_LABEL);
    expect(snapshot.cost.deltaPercent).toBeNull();
    expect(() => publicSnapshotSchema.parse(snapshot)).not.toThrow();
  });

  it("refuses to express a portfolio swing across zero as a percentage", () => {
    const raw = createDemoRawSnapshot();
    raw.exactCostJpy = -50_000;
    raw.exactPreviousCostJpy = JPY_DISCLOSURE_FLOOR;
    const snapshot = sanitizeSnapshot(raw);

    expect(snapshot.cost.deltaPercent).toBeNull();
    expect(() => publicSnapshotSchema.parse(snapshot)).not.toThrow();
  });

  it("compares two net-credit periods by magnitude rather than by signed division", () => {
    const raw = createDemoRawSnapshot();
    raw.exactCostJpy = -2 * JPY_DISCLOSURE_FLOOR;
    raw.exactPreviousCostJpy = -JPY_DISCLOSURE_FLOOR;
    const snapshot = sanitizeSnapshot(raw);

    expect(snapshot.cost.deltaPercent).toBe(100);
    expect(() => publicSnapshotSchema.parse(snapshot)).not.toThrow();
  });

  it("rejects a snapshot that publishes a change against a withheld amount", () => {
    const raw = createDemoRawSnapshot();
    const snapshot = sanitizeSnapshot(raw);
    const tampered = structuredClone(snapshot);
    const [first] = tampered.cost.categories;
    if (!first) throw new Error("Demo snapshot must publish at least one cost category");
    tampered.cost.categories[0] = {
      ...first,
      approximateAmount: WITHHELD_JPY_AMOUNT_LABEL,
      deltaPercent: 38_537.8
    };

    expect(() => publicSnapshotSchema.parse(tampered)).toThrow();
  });

  it("rejects a snapshot that publishes a portfolio change against a withheld prior total", () => {
    const raw = createDemoRawSnapshot();
    raw.exactCostJpy = 140_000;
    raw.exactPreviousCostJpy = JPY_DISCLOSURE_FLOOR - 1;
    const tampered = structuredClone(sanitizeSnapshot(raw));
    tampered.cost.deltaPercent = 13_913.9;

    expect(() => publicSnapshotSchema.parse(tampered)).toThrow();
  });

  it("keeps an unevaluated health posture null instead of publishing zero", () => {
    const raw = createDemoRawSnapshot();
    raw.postureScore = null;

    const snapshot = sanitizeSnapshot(raw);

    expect(snapshot.overview.postureScore).toBeNull();
    expect(() => publicSnapshotSchema.parse(snapshot)).not.toThrow();
  });

  it("removes Defender aggregates when the source is unavailable", () => {
    const raw = createDemoRawSnapshot();
    const defender = raw.sources.find((source) => source.source === "Defender for Cloud")!;
    defender.availability = "unavailable";
    raw.security.secureScore = 0;
    raw.security.activeAlerts = 0;

    const snapshot = sanitizeSnapshot(raw);

    expect(snapshot.security).toEqual({
      secureScore: null,
      activeAlerts: null,
      recommendations: [],
      compliance: []
    });
    expect(() => publicSnapshotSchema.parse(snapshot)).not.toThrow();
  });

  it("keeps partially collected Defender aggregates because partial data is still real", () => {
    const raw = createDemoRawSnapshot();
    const defender = raw.sources.find((source) => source.source === "Defender for Cloud")!;
    defender.availability = "partial";
    raw.security.secureScore = 0;
    raw.security.activeAlerts = 0;

    const snapshot = sanitizeSnapshot(raw);

    expect(snapshot.security.secureScore).toBe(0);
    expect(snapshot.security.activeAlerts).toBe(0);
    expect(() => publicSnapshotSchema.parse(snapshot)).not.toThrow();
  });

  it("preserves actual Defender zero values when the source is available", () => {
    const raw = createDemoRawSnapshot();
    raw.security.secureScore = 0;
    raw.security.activeAlerts = 0;

    const snapshot = sanitizeSnapshot(raw);

    expect(snapshot.security.secureScore).toBe(0);
    expect(snapshot.security.activeAlerts).toBe(0);
    expect(() => publicSnapshotSchema.parse(snapshot)).not.toThrow();
  });

  it("rejects stale Defender aggregates and overview metrics when the source is unavailable", () => {
    const raw = createDemoRawSnapshot();
    const defender = raw.sources.find((source) => source.source === "Defender for Cloud")!;
    defender.availability = "unavailable";
    const snapshot = sanitizeSnapshot(raw);

    snapshot.security.secureScore = 0;
    snapshot.overview.metrics.push({
      label: "Defender recommendations",
      value: "0",
      change: "Stale default",
      direction: "flat",
      severity: "info",
      points: [0, 0]
    });

    expect(() => publicSnapshotSchema.parse(snapshot)).toThrow(/Unavailable Defender data/);
  });

  it("rejects a numeric posture when Resource Health is unavailable", () => {
    const raw = createDemoRawSnapshot();
    const resourceHealth = raw.sources.find((source) => source.source === "Resource Health")!;
    resourceHealth.availability = "unavailable";
    const snapshot = sanitizeSnapshot(raw);
    snapshot.overview.postureScore = 0;

    expect(() => publicSnapshotSchema.parse(snapshot)).toThrow(
      /Resource Health posture must be null/
    );
  });

  it("removes a default incident zero when Resource Health is unavailable", () => {
    const raw = createDemoRawSnapshot();
    const resourceHealth = raw.sources.find((source) => source.source === "Resource Health")!;
    resourceHealth.availability = "unavailable";
    raw.reliability.incidentAvailability = "available";
    raw.reliability.incidents = 0;
    for (const resource of raw.resources) {
      if (resource.status !== "NotApplicable") {
        resource.status = "Unknown";
      }
    }

    const snapshot = sanitizeSnapshot(raw);

    expect(snapshot.reliability.incidents).toBeNull();
    expect(snapshot.reliability.coverage.evaluatedResources).toBe(0);
    expect(() => publicSnapshotSchema.parse(snapshot)).not.toThrow();
  });

  it("rejects evaluated resources while Resource Health reports unavailable", () => {
    const raw = createDemoRawSnapshot();
    const resourceHealth = raw.sources.find((source) => source.source === "Resource Health")!;
    resourceHealth.availability = "unavailable";

    const snapshot = sanitizeSnapshot(raw);

    expect(snapshot.reliability.coverage.evaluatedResources).toBeGreaterThan(0);
    expect(() => publicSnapshotSchema.parse(snapshot)).toThrow(
      /Evaluated resources cannot exist while Resource Health reports unavailable/
    );
  });

  it("separates unsupported resource types from supported but unevaluated resources", () => {
    const raw = createDemoRawSnapshot();

    const snapshot = sanitizeSnapshot(raw);
    const coverage = snapshot.reliability.coverage;

    expect(coverage.totalResources).toBe(snapshot.inventory.resources.length);
    expect(coverage.notApplicableResources).toBeGreaterThan(0);
    expect(coverage.unevaluatedResources).toBeGreaterThan(0);
    expect(
      coverage.notApplicableResources + coverage.supportedResources
    ).toBe(coverage.totalResources);
    expect(coverage.evaluatedResources + coverage.unevaluatedResources).toBe(
      coverage.supportedResources
    );
    expect(() => publicSnapshotSchema.parse(snapshot)).not.toThrow();
  });

  it("preserves an actually collected zero incidents when the metric is available", () => {
    const raw = createDemoRawSnapshot();
    raw.reliability.incidentAvailability = "available";
    raw.reliability.incidents = 0;

    const snapshot = sanitizeSnapshot(raw);

    expect(snapshot.reliability.incidents).toBe(0);
    expect(snapshot.reliability.incidentAvailability).toBe("available");
    expect(() => publicSnapshotSchema.parse(snapshot)).not.toThrow();
  });

  it("keeps incidents null when Resource Health has no evaluated observations", () => {
    const raw = createDemoRawSnapshot();
    raw.reliability.incidentAvailability = "unavailable";
    raw.reliability.incidents = null;

    const snapshot = sanitizeSnapshot(raw);

    expect(snapshot.reliability.incidents).toBeNull();
    expect(snapshot.reliability.incidentAvailability).toBe("unavailable");
    expect(() => publicSnapshotSchema.parse(snapshot)).not.toThrow();
  });

  it("does not infer incidents from available Resource Health without a count source", () => {
    const raw = createDemoRawSnapshot();
    raw.reliability.incidentAvailability = "unavailable";
    raw.reliability.incidents = 0;

    const snapshot = sanitizeSnapshot(raw);

    expect(snapshot.reliability).toMatchObject({
      incidentAvailability: "unavailable",
      incidents: null
    });
  });
});

describe("published snapshot masking contract", () => {
  const resources = publishedSnapshot.inventory.resources as Array<{
    name: string;
    resourceGroup: string;
    type: string;
  }>;

  it("publishes every resource name as an alias whose prefix its own type explains", () => {
    for (const resource of resources) {
      expect(resource.name).toMatch(/^[A-Za-z0-9]+-[0-9a-f]{8}$/);
      expect(resource.name.slice(0, resource.name.length - 9)).toBe(
        resourceAliasLabel(resource.type)
      );
    }
  });

  it("publishes every resource group as a bare alias", () => {
    for (const resource of resources) {
      expect(resource.resourceGroup).toMatch(/^rg-[0-9a-f]{8}$/);
    }
  });

  it("keeps resources that share an Azure resource group on one alias", () => {
    const raw = createDemoRawSnapshot();
    const [first, second, third] = raw.resources;
    if (!first || !second || !third) throw new Error("The demo snapshot lost its resources");
    first.resourceGroup = RAW_RESOURCE_GROUP;
    second.resourceGroup = RAW_RESOURCE_GROUP;
    third.resourceGroup = `${RAW_RESOURCE_GROUP}-other`;

    const published = sanitizeSnapshot(raw).inventory.resources;

    expect(published[0]!.resourceGroup).toBe(published[1]!.resourceGroup);
    expect(published[2]!.resourceGroup).not.toBe(published[0]!.resourceGroup);
  });

  it("keeps resource group membership visible in the published inventory", () => {
    const counts = new Map<string, number>();
    for (const resource of resources) {
      counts.set(resource.resourceGroup, (counts.get(resource.resourceGroup) ?? 0) + 1);
    }

    const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
    expect(total).toBe(resources.length);
    // Hashing anything per-resource — the resource id, say — would still satisfy the alias format
    // while quietly erasing every grouping the inventory is supposed to preserve.
    expect(Math.max(...counts.values())).toBeGreaterThan(1);
  });
});
