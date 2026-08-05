import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import type { ReliabilityCoverage } from "../src/data/contracts";
import { costFixture } from "../src/test/cost-fixtures";
import { publicSnapshotSchema } from "./public-schema";
import {
  PUBLIC_SCHEMA_DIRECTORY,
  PUBLIC_SCHEMA_VERSION,
  validatePublicJsonSchema
} from "./json-schema-validator";

type MutableSnapshot = {
  schemaVersion: string;
  sources: Array<{
    source: string;
    availability: "available" | "partial" | "unavailable";
  }>;
  overview: { postureScore: number | null };
  reliability: {
    incidentAvailability: "available" | "unavailable";
    incidents?: number | null;
    coverage: ReliabilityCoverage;
  };
  security: {
    secureScore: number | null;
    activeAlerts: number | null;
  };
};

type MutableCostSnapshot = {
  cost: {
    current: { approximateAmount: string };
    previous: { approximateAmount: string };
    deltaPercent: number | null;
    categories: Array<{ approximateAmount: string; deltaPercent: number | null }>;
  };
};

const LEGACY_SCHEMA_FILES = [
  "overview.schema.json",
  "cost.schema.json",
  "inventory.schema.json",
  "health-activity.schema.json",
  "defender.schema.json",
  "network.schema.json",
  "ai-insights.schema.json"
] as const;

function currentSnapshot(): MutableSnapshot {
  return JSON.parse(readFileSync("public/data/snapshot.json", "utf8")) as MutableSnapshot;
}

function validateLegacyV1Snapshot(snapshot: unknown): void {
  const directory = resolve("schemas/public/v1");
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const schemaFile of LEGACY_SCHEMA_FILES) {
    ajv.addSchema(JSON.parse(readFileSync(resolve(directory, schemaFile), "utf8")) as object);
  }
  const validate = ajv.compile(
    JSON.parse(readFileSync(resolve(directory, "snapshot.schema.json"), "utf8")) as object
  );
  if (!validate(snapshot)) {
    throw new Error(ajv.errorsText(validate.errors));
  }
}

function legacyV1Fixture(): object {
  const unavailableAmount = {
    availability: "unavailable",
    approximateAmount: null
  };
  return {
    schemaVersion: "1.1.0",
    generatedAt: "2026-01-01T00:00:00.000Z",
    mode: "DEMO",
    freshness: {},
    scope: {},
    sources: [],
    overview: {
      metrics: [],
      postureScore: 0,
      eventTimeline: [],
      regionalHealth: []
    },
    cost: {
      current: unavailableAmount,
      previous: unavailableAmount,
      deltaPercent: null,
      forecast: unavailableAmount,
      budget: { availability: "unavailable", usedPercent: null },
      normalizedTrend: [],
      categories: []
    },
    inventory: { total: 0, resources: [], byType: [], byRegion: [] },
    reliability: {
      availability: "Unavailable",
      incidents: 0,
      meanTimeToRecover: "Unavailable",
      services: []
    },
    security: {
      secureScore: 0,
      activeAlerts: 0,
      recommendations: [],
      compliance: []
    },
    network: {
      inventory: { total: 0, byType: [], byRegion: [] },
      telemetry: {
        availability: "unavailable",
        message: "Unavailable",
        healthyConnections: null,
        degradedConnections: null,
        blockedFlows: null,
        flows: []
      }
    },
    aiInsights: []
  };
}

describe("public JSON Schema contract", () => {
  it("validates the current snapshot against the authoritative v1.3 schema", () => {
    const snapshot = currentSnapshot();

    expect(PUBLIC_SCHEMA_VERSION).toBe("1.3.0");
    expect(PUBLIC_SCHEMA_DIRECTORY.replaceAll("\\", "/")).toMatch(/schemas\/public\/v1\.3$/);
    expect(() => validatePublicJsonSchema(snapshot)).not.toThrow();
    expect(() => publicSnapshotSchema.parse(snapshot)).not.toThrow();
  });

  it("keeps all v1.3 unavailable metrics nullable in both contracts", () => {
    const snapshot = currentSnapshot();
    snapshot.overview.postureScore = null;
    snapshot.security.secureScore = null;
    snapshot.security.activeAlerts = null;
    snapshot.reliability.incidentAvailability = "unavailable";
    snapshot.reliability.incidents = null;

    expect(() => validatePublicJsonSchema(snapshot)).not.toThrow();
    expect(() => publicSnapshotSchema.parse(snapshot)).not.toThrow();
  });

  it("rejects incident availability and value drift", () => {
    const unavailableWithZero = currentSnapshot();
    unavailableWithZero.reliability.incidentAvailability = "unavailable";
    unavailableWithZero.reliability.incidents = 0;
    expect(() => validatePublicJsonSchema(unavailableWithZero)).toThrow(/1\.3\.0/);
    expect(() => publicSnapshotSchema.parse(unavailableWithZero)).toThrow();

    const availableWithoutValue = currentSnapshot();
    availableWithoutValue.reliability.incidentAvailability = "available";
    availableWithoutValue.reliability.incidents = null;
    expect(() => validatePublicJsonSchema(availableWithoutValue)).toThrow(/1\.3\.0/);
    expect(() => publicSnapshotSchema.parse(availableWithoutValue)).toThrow();
  });

  it("keeps the JSON Schema and the runtime contract in agreement on withheld cost changes", () => {
    // Built from the real transform + sanitize pipeline so the shapes are the ones we actually ship.
    const bothWithheld = costFixture([
      { name: "Storage", amountJpy: 400, previousAmountJpy: 1 }
    ]) as unknown as MutableCostSnapshot;
    expect(() => validatePublicJsonSchema(bothWithheld)).not.toThrow();

    const priorWithheld = costFixture([
      { name: "Ramped up", amountJpy: 140_000, previousAmountJpy: 900 }
    ]) as unknown as MutableCostSnapshot;
    expect(priorWithheld.cost.previous.approximateAmount).toContain("約¥1千未満");
    expect(priorWithheld.cost.current.approximateAmount).not.toContain("約¥1千未満");
    expect(() => validatePublicJsonSchema(priorWithheld)).not.toThrow();

    // Each endpoint gets its own rule, so each has to be provably enforced on its own.
    const publishedAgainstWithheldPrior = structuredClone(priorWithheld);
    publishedAgainstWithheldPrior.cost.deltaPercent = 13_913.9;
    expect(() => validatePublicJsonSchema(publishedAgainstWithheldPrior)).toThrow(/1\.3\.0/);
    expect(() => publicSnapshotSchema.parse(publishedAgainstWithheldPrior)).toThrow();

    const publishedAgainstWithheldCurrent = structuredClone(bothWithheld);
    publishedAgainstWithheldCurrent.cost.deltaPercent = 38_537.8;
    expect(() => validatePublicJsonSchema(publishedAgainstWithheldCurrent)).toThrow(/1\.3\.0/);
    expect(() => publicSnapshotSchema.parse(publishedAgainstWithheldCurrent)).toThrow();

    const publishedAgainstWithheldService = structuredClone(bothWithheld);
    const [service] = publishedAgainstWithheldService.cost.categories;
    if (!service) throw new Error("Fixture must publish at least one cost category");
    service.deltaPercent = 38_537.8;
    expect(() => validatePublicJsonSchema(publishedAgainstWithheldService)).toThrow(/1\.3\.0/);
    expect(() => publicSnapshotSchema.parse(publishedAgainstWithheldService)).toThrow();
  });

  it("rejects reliability coverage that contradicts the inventory or the Resource Health source", () => {
    const inconsistentTotal = currentSnapshot();
    inconsistentTotal.reliability.coverage.totalResources += 1;
    expect(() => publicSnapshotSchema.parse(inconsistentTotal)).toThrow(
      /Reliability coverage must count every inventoried resource/
    );

    // The lie the guard exists for: a source claiming success while nothing was evaluated. The
    // published snapshot may legitimately carry evaluated resources, so the state is forced here.
    const lyingAvailability = currentSnapshot();
    const lyingCoverage = lyingAvailability.reliability.coverage;
    lyingCoverage.evaluatedResources = 0;
    lyingCoverage.unevaluatedResources = lyingCoverage.supportedResources;
    lyingCoverage.healthyResources = 0;
    lyingCoverage.degradedResources = 0;
    lyingCoverage.unavailableResources = 0;
    lyingCoverage.supportedCoveragePercent = lyingCoverage.supportedResources ? 0 : null;
    lyingAvailability.sources.find((source) => source.source === "Resource Health")!.availability =
      "available";
    expect(() => publicSnapshotSchema.parse(lyingAvailability)).toThrow(
      /Resource Health cannot report available/
    );
    expect(() => validatePublicJsonSchema(lyingAvailability)).toThrow(/1\.3\.0/);
  });

  it("preserves the published v1 path and validates its legacy 1.1 contract", () => {
    const legacyPath = "schemas/public/v1/snapshot.schema.json";
    const explicitLegacyPath = "schemas/public/v1.1/snapshot.schema.json";
    const currentPath = "schemas/public/v1.3/snapshot.schema.json";
    expect(existsSync(legacyPath)).toBe(true);
    expect(existsSync(explicitLegacyPath)).toBe(true);
    expect(existsSync(currentPath)).toBe(true);
    for (const schemaFile of [...LEGACY_SCHEMA_FILES, "snapshot.schema.json"]) {
      const compatibilityPath = `schemas/public/v1/${schemaFile}`;
      const versionedPath = `schemas/public/v1.1/${schemaFile}`;
      expect(lstatSync(compatibilityPath).isSymbolicLink()).toBe(false);
      expect(lstatSync(versionedPath).isSymbolicLink()).toBe(false);
      expect(readFileSync(compatibilityPath)).toEqual(readFileSync(versionedPath));
    }

    const legacySchema = JSON.parse(
      readFileSync(legacyPath, "utf8")
    ) as {
      $id: string;
      properties: { schemaVersion: { const: string } };
    };
    const currentSchema = JSON.parse(
      readFileSync(currentPath, "utf8")
    ) as {
      properties: { schemaVersion: { const: string } };
    };

    expect(legacySchema.$id).toContain("/schemas/public/v1/");
    expect(legacySchema.properties.schemaVersion.const).toBe("1.1.0");
    expect(currentSchema.properties.schemaVersion.const).toBe("1.3.0");
    expect(() => validateLegacyV1Snapshot(legacyV1Fixture())).not.toThrow();
  });

  it("rejects stale versions, wrong types, and missing reliability availability fields", () => {
    const stale = currentSnapshot();
    stale.schemaVersion = "1.1.0";
    expect(() => validatePublicJsonSchema(stale)).toThrow(/1\.3\.0/);

    const wrongType = currentSnapshot() as unknown as {
      reliability: { incidents: unknown };
    };
    wrongType.reliability.incidents = "0";
    expect(() => validatePublicJsonSchema(wrongType)).toThrow(/1\.3\.0/);

    const missingIncidents = currentSnapshot();
    delete missingIncidents.reliability.incidents;
    expect(() => validatePublicJsonSchema(missingIncidents)).toThrow(/incidents/);
  });

  it("rejects non-null health and Defender defaults when sources are unavailable", () => {
    const snapshot = currentSnapshot();
    snapshot.sources.find((source) => source.source === "Resource Health")!.availability =
      "unavailable";
    snapshot.sources.find((source) => source.source === "Defender for Cloud")!.availability =
      "partial";
    snapshot.overview.postureScore = 0;
    snapshot.reliability.incidents = 0;
    snapshot.security.secureScore = 0;
    snapshot.security.activeAlerts = 0;

    expect(() => validatePublicJsonSchema(snapshot)).toThrow();
    expect(() => publicSnapshotSchema.parse(snapshot)).toThrow();
  });
});
