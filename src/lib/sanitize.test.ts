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
});
