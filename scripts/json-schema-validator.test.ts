import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
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
  };
  security: {
    secureScore: number | null;
    activeAlerts: number | null;
  };
};

function currentSnapshot(): MutableSnapshot {
  return JSON.parse(readFileSync("public/data/snapshot.json", "utf8")) as MutableSnapshot;
}

function validateLegacyV1Snapshot(snapshot: unknown): void {
  const directory = resolve("schemas/public/v1");
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const schemaFile of [
    "overview.schema.json",
    "cost.schema.json",
    "inventory.schema.json",
    "health-activity.schema.json",
    "defender.schema.json",
    "network.schema.json",
    "ai-insights.schema.json"
  ]) {
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
  it("validates the current snapshot against the authoritative v1.2 schema", () => {
    const snapshot = currentSnapshot();

    expect(PUBLIC_SCHEMA_VERSION).toBe("1.2.0");
    expect(PUBLIC_SCHEMA_DIRECTORY.replaceAll("\\", "/")).toMatch(/schemas\/public\/v1\.2$/);
    expect(() => validatePublicJsonSchema(snapshot)).not.toThrow();
    expect(() => publicSnapshotSchema.parse(snapshot)).not.toThrow();
  });

  it("keeps all v1.2 unavailable metrics nullable in both contracts", () => {
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
    expect(() => validatePublicJsonSchema(unavailableWithZero)).toThrow(/1\.2\.0/);
    expect(() => publicSnapshotSchema.parse(unavailableWithZero)).toThrow();

    const availableWithoutValue = currentSnapshot();
    availableWithoutValue.reliability.incidentAvailability = "available";
    availableWithoutValue.reliability.incidents = null;
    expect(() => validatePublicJsonSchema(availableWithoutValue)).toThrow(/1\.2\.0/);
    expect(() => publicSnapshotSchema.parse(availableWithoutValue)).toThrow();
  });

  it("preserves the published v1 path and validates its legacy 1.1 contract", () => {
    const legacyPath = "schemas/public/v1/snapshot.schema.json";
    const currentPath = "schemas/public/v1.2/snapshot.schema.json";
    expect(existsSync(legacyPath)).toBe(true);
    expect(existsSync(currentPath)).toBe(true);

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
    expect(currentSchema.properties.schemaVersion.const).toBe("1.2.0");
    expect(() => validateLegacyV1Snapshot(legacyV1Fixture())).not.toThrow();
  });

  it("rejects stale versions, wrong types, and missing reliability availability fields", () => {
    const stale = currentSnapshot();
    stale.schemaVersion = "1.1.0";
    expect(() => validatePublicJsonSchema(stale)).toThrow(/1\.2\.0/);

    const wrongType = currentSnapshot() as unknown as {
      reliability: { incidents: unknown };
    };
    wrongType.reliability.incidents = "0";
    expect(() => validatePublicJsonSchema(wrongType)).toThrow(/1\.2\.0/);

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
