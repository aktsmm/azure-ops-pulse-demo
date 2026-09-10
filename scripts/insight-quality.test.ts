import { describe, expect, it } from "vitest";
import { buildDemoSnapshot } from "./build-demo-snapshot";
import { insightQualityFindings, validateInsightQuality } from "./insight-quality";

function insight(...sources: string[]) {
  const base = buildDemoSnapshot().aiInsights[0]!;
  return {
    ...base,
    numericEvidence: sources.map((source) => ({ source, value: "1", label: "対象件数" }))
  };
}

describe("new insight admission quality", () => {
  it("rejects the reported network coverage warning regardless of its prose", () => {
    expect(() => validateInsightQuality([insight(
      "network.metricCoverage.sampledResources",
      "network.metricCoverage.metricCapableResources",
      "network.metricCoverage.notApplicableResources"
    )])).toThrow("collection-scope-only");
  });

  it("rejects coverage warnings padded with inventory totals", () => {
    expect(() => validateInsightQuality([insight(
      "reliability.coverage.supportedCoveragePercent",
      "reliability.coverage.notApplicableResources",
      "inventory.total",
      "network.inventory.total"
    )])).toThrow("collection-scope-only");
  });

  it("does not mistake actual degraded resource counts for collection scope", () => {
    expect(() => validateInsightQuality([insight(
      "reliability.coverage.degradedResources",
      "reliability.coverage.supportedResources"
    )])).not.toThrow();
  });

  it("accepts cost concentration with comparison evidence", () => {
    expect(() => validateInsightQuality([insight(
      "cost.categories.0.sharePercent", "cost.categories.0.deltaPercent", "cost.deltaPercent"
    )])).not.toThrow();
  });

  it("does not count duplicate sources as independent evidence", () => {
    expect(() => validateInsightQuality([insight(
      "cost.deltaPercent", "cost.deltaPercent"
    )])).toThrow("at least two distinct");
    expect(() => validateInsightQuality([insight("reliability.serviceHealth.activeEvents")]))
      .toThrow("at least two distinct");
  });

  it("allows no qualifying insights without requiring padding", () => {
    expect(() => validateInsightQuality([])).not.toThrow();
  });

  it("returns indexed findings without copying generated prose into logs", () => {
    const candidate = { ...insight("inventory.total"), title: "private-title-sentinel" };
    const findings = insightQualityFindings([candidate]).join("\n");
    expect(findings).toContain("aiInsights.0");
    expect(findings).not.toContain(candidate.title);
  });
});
