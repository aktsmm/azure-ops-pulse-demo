import { readFileSync } from "node:fs";
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

  it("preserves the historical non-null v1.1 schema identity", () => {
    const snapshotSchema = JSON.parse(
      readFileSync("schemas/public/v1.1/snapshot.schema.json", "utf8")
    ) as {
      $id: string;
      properties: { schemaVersion: { const: string } };
    };
    const healthSchema = JSON.parse(
      readFileSync("schemas/public/v1.1/health-activity.schema.json", "utf8")
    ) as {
      properties: { incidents: { type: string } };
    };

    expect(snapshotSchema.$id).toContain("/schemas/public/v1.1/");
    expect(snapshotSchema.properties.schemaVersion.const).toBe("1.1.0");
    expect(healthSchema.properties.incidents.type).toBe("integer");
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
