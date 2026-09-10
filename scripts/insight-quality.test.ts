import { describe, expect, it } from "vitest";
import { buildDemoSnapshot } from "./build-demo-snapshot";
import { insightQualityFindings, validateInsightQuality } from "./insight-quality";

function insight(...sources: string[]) {
  const base = buildDemoSnapshot().aiInsights[0]!;
  return {
    ...base,
    title: "対象の比較",
    observation: "対象1件と関連する指標を比較しています。",
    impact: "対象1件の比較を根拠に確認対象を絞ります。",
    recommendedAction: "カテゴリの変化と全体の変化を比較して確認順を判断してください。",
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

  it("rejects isolated active/resolved event totals", () => {
    expect(() => validateInsightQuality([insight(
      "reliability.serviceHealth.activeEvents", "reliability.serviceHealth.resolvedEvents"
    )])).toThrow("event-totals-only");
  });

  it("requires impact to be anchored in cited values rather than generic prose", () => {
    const candidate = insight("cost.categories.0.sharePercent", "cost.deltaPercent");
    expect(() => validateInsightQuality([{ ...candidate, impact: "変動が全体へ波及する可能性があります。" }]))
      .toThrow("tie the impact");
    expect(() => validateInsightQuality([{ ...candidate, impact: "未確認の99件に影響します。" }]))
      .toThrow("tie the impact");
  });

  it.each(["title", "observation", "impact", "recommendedAction"] as const)(
    "rejects extra numerical claims in %s even when an evidence number is present", (field) => {
      const candidate = insight("cost.categories.0.sharePercent", "cost.deltaPercent");
      expect(() => validateInsightQuality([{
        ...candidate, [field]: "構成比1%の確認で99%の削減ができます。"
      }])).toThrow("every numeric claim");
      expect(() => validateInsightQuality([{
        ...candidate, [field]: "構成比１％の確認で９９％の削減ができます。"
      }])).toThrow("every numeric claim");
    }
  );

  it("allows a signed value to be described as a decrease, and embedded protocol names", () => {
    const candidate = {
      ...insight("cost.categories.0.deltaPercent", "cost.deltaPercent"),
      title: "IPv4 の比較",
      observation: "5.4%減少と、全体の0.9%減少を比較します。",
      impact: "全体-0.9%とカテゴリ-5.4%の違いを確認します。",
      numericEvidence: [
        { source: "cost.categories.0.deltaPercent", value: "-5.4%", label: "カテゴリ" },
        { source: "cost.deltaPercent", value: "-0.9%", label: "全体" }
      ]
    };
    expect(() => validateInsightQuality([candidate])).not.toThrow();
  });

  it("rejects the reported category-count-only Advisor priority, even with cost padding", () => {
    const candidate = insight("advisor.recommendations.0.count", "advisor.recommendations.1.count");
    expect(() => validateInsightQuality([{ ...candidate, route: "/recommendations" }]))
      .toThrow("mapped recommendation content group");
    expect(() => validateInsightQuality([{
      ...candidate, numericEvidence: [...candidate.numericEvidence, { source: "cost.deltaPercent", value: "1", label: "変化率" }]
    }])).toThrow("mapped recommendation content group");
  });

  it("allows a concrete mapped recommendation with one count instead of padded evidence", () => {
    const candidate = { ...insight("advisor.details.groups.0.count"), route: "/recommendations" };
    const snapshot = {
      advisor: { availability: "available", details: {
        availability: "available", groups: [{ contentStatus: "mapped", count: 1 }]
      } }
    };
    expect(() => validateInsightQuality([candidate], snapshot)).not.toThrow();
    snapshot.advisor.details.availability = "partial";
    expect(() => validateInsightQuality([candidate], snapshot)).not.toThrow();
    expect(() => validateInsightQuality([{ ...candidate, route: "/security" }], snapshot))
      .toThrow("belongs at /recommendations");
    for (const contentStatus of ["withheld", "unknown"]) {
      const unknown = structuredClone(snapshot);
      unknown.advisor.details.groups[0]!.contentStatus = contentStatus;
      expect(() => validateInsightQuality([candidate], unknown)).toThrow("mapped recommendation content group");
    }
    expect(() => validateInsightQuality([candidate])).toThrow("mapped recommendation content group");
    snapshot.advisor.details.availability = "unavailable";
    expect(() => validateInsightQuality([candidate], snapshot)).toThrow("mapped recommendation content group");
  });

  it("allows a specific external follow-up instead of blocking the word usage", () => {
    const candidate = insight("cost.categories.0.sharePercent", "cost.deltaPercent");
    expect(() => validateInsightQuality([{
      ...candidate, recommendedAction: "この画面でカテゴリを比較し、原因の調査は Azure portal のコスト分析で対象カテゴリの使用量を確認してください。使用量はこの画面にはありません。"
    }])).not.toThrow();
  });

  it.each([
    ["security.activeAlerts", { security: { activeAlerts: 1 } }],
    ["reliability.coverage.degradedResources", { reliability: { coverage: { degradedResources: 1 } } }],
    ["network.telemetry.blockedFlows", { network: { telemetry: { blockedFlows: 1 } } }]
  ])("does not demand a second unrelated metric for the observed condition %s", (source, snapshot) => {
    expect(() => validateInsightQuality([insight(source)], snapshot)).not.toThrow();
    expect(() => validateInsightQuality([insight(source)])).toThrow("at least two distinct");
    expect(() => validateInsightQuality([insight("security.activeAlerts")], { security: { activeAlerts: 0 } }))
      .toThrow("at least two distinct");
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
