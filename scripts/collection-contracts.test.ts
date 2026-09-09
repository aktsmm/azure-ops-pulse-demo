import { describe, expect, it } from "vitest";
import { createDemoRawSnapshot } from "./demo-data";
import { sanitizeSnapshot } from "../src/lib/sanitize";
import { publicSnapshotSchema } from "./public-schema";
import { validatePublicJsonSchema } from "./json-schema-validator";
import { validateEvidenceItem } from "./evidence-validator";
import type { PublicSnapshotV1 } from "../src/data/contracts";

function fixture(): PublicSnapshotV1 {
  const raw = createDemoRawSnapshot();
  raw.resources[0]!.type = "microsoft.compute/virtualmachines";
  raw.resources[0]!.location = "japaneast";
  const result = sanitizeSnapshot(raw);
  result.advisor = {
    availability: "available", message: "Advisor の集計を取得しました。",
    recommendations: [{ category: "Cost", impact: "High", count: 2 }]
  };
  const resource = result.inventory.resources[0]!;
  result.network.topology = {
    availability: "available", message: "構成参照を取得しました。",
    nodes: [{ id: resource.id, type: resource.type, region: resource.region, scope: "inventory", referenceOnly: false }],
    edges: [], truncated: false
  };
  result.sources.push(
    { source: "Azure Advisor", availability: "available", message: result.advisor.message },
    { source: "Network topology", availability: "available", message: result.network.topology.message }
  );
  return result;
}

describe("backward-compatible collection contracts", () => {
  it("accepts old snapshots with no new data and never invents collection evidence", () => {
    const result = sanitizeSnapshot(createDemoRawSnapshot());
    expect(result.advisor).toBeUndefined();
    expect(result.network.topology).toBeUndefined();
    expect(publicSnapshotSchema.safeParse(result).success).toBe(true);
    expect(() => validatePublicJsonSchema(result)).not.toThrow();
  });

  it("validates new optional aggregates and strict graph shape in both contracts", () => {
    const result = fixture();
    expect(publicSnapshotSchema.safeParse(result).success).toBe(true);
    expect(() => validatePublicJsonSchema(result)).not.toThrow();
    Object.assign(result.network.topology!.nodes[0]!, { name: "private-name", properties: { ip: "10.0.0.1" } });
    expect(publicSnapshotSchema.safeParse(result).success).toBe(false);
    expect(() => validatePublicJsonSchema(result)).toThrow();
  });

  it("rejects raw Advisor titles and identifiers in both contracts", () => {
    const result = fixture();
    Object.assign(result.advisor!.recommendations[0]!, { title: "private-name", resourceId: "secret" });
    expect(publicSnapshotSchema.safeParse(result).success).toBe(false);
    expect(() => validatePublicJsonSchema(result)).toThrow();
  });

  it("rejects duplicate nodes/edges, dangling edges and misreported caps", () => {
    const result = fixture();
    const graph = result.network.topology!;
    graph.nodes.push({ ...graph.nodes[0]! });
    expect(publicSnapshotSchema.safeParse(result).success).toBe(false);
    graph.nodes.pop();
    graph.edges.push({ source: graph.nodes[0]!.id, target: "res-abcdef12", kind: "contains" });
    expect(publicSnapshotSchema.safeParse(result).success).toBe(false);
    graph.edges.pop();
    graph.truncated = true;
    expect(publicSnapshotSchema.safeParse(result).success).toBe(false);
    expect(() => validatePublicJsonSchema(result)).toThrow();
  });

  it("requires per-source availability to match the optional aggregate", () => {
    const result = fixture();
    result.sources = result.sources.filter((source) => source.source !== "Azure Advisor");
    expect(publicSnapshotSchema.safeParse(result).success).toBe(false);
  });

  it("rejects populated unavailable results in both contracts", () => {
    const result = fixture();
    result.advisor!.availability = "unavailable";
    expect(publicSnapshotSchema.safeParse(result).success).toBe(false);
    expect(() => validatePublicJsonSchema(result)).toThrow();
  });

  it("accepts zero records only when a query explicitly succeeded", () => {
    const result = fixture();
    result.advisor!.recommendations = [];
    result.network.topology!.nodes = [];
    expect(publicSnapshotSchema.safeParse(result).success).toBe(true);
    expect(() => validatePublicJsonSchema(result)).not.toThrow();
  });

  it("gates Defender fields independently even when the source is partial", () => {
    const raw = createDemoRawSnapshot();
    raw.sources.find((source) => source.source === "Defender for Cloud")!.availability = "partial";
    raw.security.fieldAvailability = { secureScore: "available", assessments: "unavailable", activeAlerts: "unavailable" };
    const result = sanitizeSnapshot(raw);
    expect(result.security.secureScore).toBe(raw.security.secureScore);
    expect(result.security.activeAlerts).toBeNull();
    expect(result.security.recommendations).toEqual([]);
    expect(result.overview.metrics.some((metric) => metric.label === "Defender recommendations" || metric.label === "Open alerts")).toBe(false);
    expect(publicSnapshotSchema.safeParse(result).success).toBe(true);
    expect(() => validatePublicJsonSchema(result)).not.toThrow();
    result.security.activeAlerts = 123;
    expect(publicSnapshotSchema.safeParse(result).success).toBe(false);
    expect(() => validatePublicJsonSchema(result)).toThrow();
  });

  it("allows Advisor evidence only from available collection and matching values", () => {
    const result = fixture();
    const evidence = { label: "推奨数", value: "2", source: "advisor.recommendations.0.count" };
    expect(() => validateEvidenceItem(result, "推奨事項の確認", evidence)).not.toThrow();
    result.advisor!.availability = "unavailable";
    expect(() => validateEvidenceItem(result, "推奨事項の確認", evidence)).toThrow();
    result.advisor!.availability = "available";
    result.sources.find((source) => source.source === "Azure Advisor")!.availability = "partial";
    expect(() => validateEvidenceItem(result, "推奨事項の確認", evidence)).toThrow();
  });
});
