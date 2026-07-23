import { describe, expect, it } from "vitest";
import { createDemoRawSnapshot } from "../../scripts/demo-data";
import { publicSnapshotSchema } from "../../scripts/public-schema";
import {
  classifyEndpoint,
  formatApproximateJpy,
  maskGuid,
  maskIdentity,
  maskIp,
  maskName,
  sanitizeSnapshot,
  sanitizeTags
} from "./sanitize";

describe("public sanitization boundary", () => {
  it("reveals exactly the first and last eight GUID hex characters", () => {
    const masked = maskGuid(["01234567", "89ab", "cdef", "0123", "456789abcdef"].join("-"));
    expect(masked).toBe("01234567-****-****-****-****89abcdef");
    expect(masked.replaceAll("-", "").replaceAll("*", "")).toHaveLength(16);
  });

  it("uses deterministic typed aliases for short names", () => {
    expect(maskName("prod-rg", "rg")).toMatch(/^rg-[0-9a-f]{8}$/);
    expect(maskName("prod-rg", "rg")).toBe(maskName("prod-rg", "rg"));
  });

  it("retains about half of longer names and adds a stable suffix", () => {
    const masked = maskName("commerce-production-east", "resource");
    expect(masked).toMatch(/^commer…n-east-[0-9a-f]{8}$/);
    expect(masked).not.toContain("commerce-production-east");
  });

  it("masks network addresses and classifies endpoints", () => {
    expect(maskIp(["203", "0", "113", "42"].join("."))).toBe("203.0.*.*");
    expect(maskIp("2603:1030:20e:3::23")).toBe("2603:1030:*");
    expect(classifyEndpoint("app.blob.core.windows.net")).toBe("Azure Storage endpoint");
    expect(classifyEndpoint("api.example.org")).toBe("External service endpoint");
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
        deltaPercent: 5
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

  it("keeps an unevaluated health posture null instead of publishing zero", () => {
    const raw = createDemoRawSnapshot();
    raw.postureScore = null;

    const snapshot = sanitizeSnapshot(raw);

    expect(snapshot.overview.postureScore).toBeNull();
    expect(() => publicSnapshotSchema.parse(snapshot)).not.toThrow();
  });

  it.each(["partial", "unavailable"] as const)(
    "removes Defender aggregates when the source is %s",
    (availability) => {
      const raw = createDemoRawSnapshot();
      const defender = raw.sources.find((source) => source.source === "Defender for Cloud")!;
      defender.availability = availability;
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
    }
  );

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

    expect(() => publicSnapshotSchema.parse(snapshot)).toThrow(
      /Unavailable or partial Defender data/
    );
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

    const snapshot = sanitizeSnapshot(raw);

    expect(snapshot.reliability.incidents).toBeNull();
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
