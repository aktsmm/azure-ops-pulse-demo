import { describe, expect, it } from "vitest";
import {
  classifyResourceHealth,
  indexAvailabilityStatuses,
  parentResourceIdFromAvailabilityStatus,
  resourceHealthReport,
  summarizeReliabilityCoverage,
  supportsResourceHealth,
  unlistedEvaluatedTypes
} from "./resource-health";

const VM_ID =
  "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/Ops/providers/Microsoft.Compute/virtualMachines/Web01";

describe("Resource Health identifier matching", () => {
  it("extracts the parent resource ID from a fully lowercased Resource Graph ID", () => {
    // Regression: Azure Resource Graph lowercases IDs, so a case-sensitive
    // split("/providers/Microsoft.ResourceHealth") never matched and every resource fell back to Unknown.
    const lowercased = `${VM_ID.toLowerCase()}/providers/microsoft.resourcehealth/availabilitystatuses/current`;
    expect(parentResourceIdFromAvailabilityStatus(lowercased)).toBe(VM_ID.toLowerCase());
  });

  it("extracts the parent resource ID from a PascalCase ARM ID", () => {
    const pascal = `${VM_ID}/providers/Microsoft.ResourceHealth/availabilityStatuses/current`;
    expect(parentResourceIdFromAvailabilityStatus(pascal)).toBe(VM_ID.toLowerCase());
  });

  it("returns null for values that carry no availability status segment", () => {
    expect(parentResourceIdFromAvailabilityStatus(VM_ID)).toBeNull();
    expect(parentResourceIdFromAvailabilityStatus("")).toBeNull();
    expect(parentResourceIdFromAvailabilityStatus(null)).toBeNull();
  });

  it("indexes lowercase Resource Graph rows so lookups by resource ID succeed", () => {
    const index = indexAvailabilityStatuses([
      {
        id: `${VM_ID.toLowerCase()}/providers/microsoft.resourcehealth/availabilitystatuses/current`,
        properties: { availabilityState: "Available" }
      }
    ]);

    expect(index.get(VM_ID.toLowerCase())?.availabilityState).toBe("Available");
  });

  it("prefers the documented targetResourceId over parsing the availability status ID", () => {
    const index = indexAvailabilityStatuses([
      {
        id: "/providers/Microsoft.ResourceHealth/availabilityStatuses/unrelated",
        properties: { targetResourceId: VM_ID, availabilityState: "Degraded" }
      }
    ]);

    expect(index.get(VM_ID.toLowerCase())?.availabilityState).toBe("Degraded");
  });

  it("keeps the most recent status when a resource reports several occurrences", () => {
    const index = indexAvailabilityStatuses([
      {
        properties: {
          targetResourceId: VM_ID,
          availabilityState: "Unavailable",
          occurredTime: "2026-01-01T00:00:00Z"
        }
      },
      {
        properties: {
          targetResourceId: VM_ID,
          availabilityState: "Available",
          // The REST API spells this "occuredTime".
          occuredTime: "2026-02-01T00:00:00Z"
        }
      }
    ]);

    expect(index.get(VM_ID.toLowerCase())?.availabilityState).toBe("Available");
  });

  it("ignores rows without a resolvable target or availability state", () => {
    const index = indexAvailabilityStatuses([
      { properties: { availabilityState: "Available" } },
      { properties: { targetResourceId: VM_ID } }
    ]);

    expect(index.size).toBe(0);
  });
});

describe("Resource Health support classification", () => {
  it("recognises supported types regardless of casing", () => {
    expect(supportsResourceHealth("microsoft.compute/virtualmachines")).toBe(true);
    expect(supportsResourceHealth("Microsoft.Compute/virtualMachines")).toBe(true);
    expect(supportsResourceHealth("Microsoft.Storage/storageAccounts")).toBe(true);
  });

  it("treats types Azure never evaluates as unsupported", () => {
    expect(supportsResourceHealth("microsoft.app/containerapps")).toBe(false);
    expect(supportsResourceHealth("microsoft.logic/workflows")).toBe(false);
    expect(supportsResourceHealth("microsoft.network/networkwatchers")).toBe(false);
  });

  it("maps a missing state to NotApplicable only for unsupported types", () => {
    expect(classifyResourceHealth("microsoft.app/containerapps", undefined)).toBe("NotApplicable");
    expect(classifyResourceHealth("microsoft.compute/virtualmachines", undefined)).toBe("Unknown");
  });

  it("keeps Unknown distinct because it is a real Resource Health state", () => {
    expect(classifyResourceHealth("microsoft.app/containerapps", "Unknown")).toBe("Unknown");
    expect(classifyResourceHealth("microsoft.compute/virtualmachines", "Available")).toBe("Healthy");
    expect(classifyResourceHealth("microsoft.compute/virtualmachines", "degraded")).toBe("Degraded");
    expect(classifyResourceHealth("microsoft.compute/virtualmachines", "Unavailable")).toBe(
      "Unavailable"
    );
  });
});

describe("Reliability coverage", () => {
  it("excludes out-of-scope resources from the coverage denominator", () => {
    const coverage = summarizeReliabilityCoverage([
      { status: "Healthy" },
      { status: "Degraded" },
      { status: "Unknown" },
      { status: "NotApplicable" },
      { status: "NotApplicable" }
    ]);

    expect(coverage).toEqual({
      totalResources: 5,
      supportedResources: 3,
      notApplicableResources: 2,
      evaluatedResources: 2,
      unevaluatedResources: 1,
      healthyResources: 1,
      degradedResources: 1,
      unavailableResources: 0,
      supportedCoveragePercent: 67
    });
  });

  it("reports null coverage rather than 0% when nothing is in scope", () => {
    const coverage = summarizeReliabilityCoverage([
      { status: "NotApplicable" },
      { status: "NotApplicable" }
    ]);

    expect(coverage.supportedCoveragePercent).toBeNull();
    expect(resourceHealthReport(coverage).availability).toBe("unavailable");
  });

  it("never reports available when no supported resource was evaluated", () => {
    const coverage = summarizeReliabilityCoverage([
      { status: "Unknown" },
      { status: "NotApplicable" }
    ]);

    const report = resourceHealthReport(coverage);
    expect(report.availability).toBe("unavailable");
    expect(report.message).toContain("no availability state");
  });

  it("reports partial when only some supported resources were evaluated", () => {
    const coverage = summarizeReliabilityCoverage([{ status: "Healthy" }, { status: "Unknown" }]);
    expect(resourceHealthReport(coverage).availability).toBe("partial");
  });

  it("reports available only when every supported resource carries a state", () => {
    const coverage = summarizeReliabilityCoverage([
      { status: "Healthy" },
      { status: "Unavailable" },
      { status: "NotApplicable" }
    ]);
    expect(resourceHealthReport(coverage).availability).toBe("available");
  });
});

describe("support list drift", () => {
  it("treats a type that actually returned a state as supported even when the static list is stale", () => {
    const evaluated = new Set(["microsoft.contoso/widgets"]);

    expect(classifyResourceHealth("microsoft.contoso/widgets", undefined)).toBe("NotApplicable");
    expect(classifyResourceHealth("microsoft.contoso/widgets", undefined, evaluated)).toBe(
      "Unknown"
    );
    expect(classifyResourceHealth("Microsoft.Contoso/Widgets", undefined, evaluated)).toBe(
      "Unknown"
    );
  });

  it("reports evaluated types that the static support list does not know about", () => {
    expect(
      unlistedEvaluatedTypes([
        { type: "microsoft.storage/storageAccounts", status: "Healthy" },
        { type: "Microsoft.Contoso/widgets", status: "Healthy" },
        { type: "microsoft.contoso/widgets", status: "Unknown" },
        { type: "microsoft.app/containerapps", status: "NotApplicable" }
      ])
    ).toEqual(["microsoft.contoso/widgets"]);
  });
});
