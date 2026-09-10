import { describe, expect, it } from "vitest";
import { buildDemoSnapshot } from "./build-demo-snapshot";
import { insightQualityFindings, validateInsightQuality } from "./insight-quality";
import { validateNumericEvidence } from "./evidence-validator";
import { applyDeterministicInsightIds } from "./insight-identity";
import { applyDeterministicInsightPeriods } from "./insight-period";
import { validatePublicJsonSchema } from "./json-schema-validator";
import { publicSnapshotSchema } from "./public-schema";
import { validateJapaneseInsights } from "./japanese-insights-validator";
import { validateUiLanguage } from "./ui-language-audit";

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

  it("does not turn optional Advisor target coverage into an operational finding", () => {
    const snapshot = {
      advisor: { availability: "available", details: {
        availability: "partial", groups: [{ contentStatus: "mapped", count: 1 }]
      } }
    };
    const candidate = {
      ...insight(
        "advisor.details.groups.0.targetCoverage.unresolvedResources",
        "advisor.details.groups.0.scopeCounts.unknown"
      ),
      route: "/recommendations"
    };
    expect(() => validateInsightQuality([candidate], snapshot)).toThrow("collection-scope-only");
    expect(() => validateInsightQuality([{
      ...candidate,
      numericEvidence: [{ source: "advisor.details.groups.0.count", value: "1", label: "推奨件数" }]
    }], snapshot)).not.toThrow();
  });

  it("does not mistake actual degraded resource counts for collection scope", () => {
    expect(() => validateInsightQuality([insight(
      "reliability.coverage.degradedResources",
      "reliability.coverage.supportedResources"
    )])).not.toThrow();
  });

  it("does not promote unknown Defender assessments or publication coverage into findings", () => {
    expect(() => validateInsightQuality([insight(
      "security.assessmentCoverage.unknownAssessments",
      "security.assessmentCoverage.publishedGroups",
      "security.recommendations.0.unknownCount"
    )])).toThrow("collection-scope-only");
    expect(() => validateInsightQuality([insight(
      "security.recommendations.0.affectedCount",
      "security.assessmentCoverage.unhealthyAssessments"
    )])).not.toThrow();
  });

  it("allows one scalar for a concrete observed CVE, but never invents findings from empty or unknown coverage", () => {
    const snapshot = { security: { vulnerabilities: {
      availability: "partial",
      totalFindings: 1,
      findings: [{ cve: "CVE-2026-12345", cvssScore: 1, resourceRefs: [] }]
    } } };
    const countCandidate = { ...insight("security.vulnerabilities.totalFindings"), route: "/security" };
    const scoreCandidate = { ...insight("security.vulnerabilities.findings.0.cvssScore"), route: "/security" };
    expect(() => validateInsightQuality([countCandidate, scoreCandidate], snapshot)).not.toThrow();
    expect(() => validateInsightQuality([{ ...countCandidate, route: "/recommendations" }], snapshot))
      .toThrow("Vulnerability observations belong at /security");
    snapshot.security.vulnerabilities.availability = "unavailable";
    expect(() => validateInsightQuality([countCandidate], snapshot)).toThrow("at least two distinct");
    snapshot.security.vulnerabilities.availability = "available";
    snapshot.security.vulnerabilities.findings = [];
    snapshot.security.vulnerabilities.totalFindings = 0;
    expect(() => validateInsightQuality([countCandidate], snapshot)).toThrow("at least two distinct");
    expect(() => validateInsightQuality([{
      ...insight("security.vulnerabilities.totalFindings", "security.vulnerabilities.unhealthySubAssessments"),
      route: "/security"
    }], snapshot)).toThrow("requires an observed CVE row");
    expect(() => validateInsightQuality([{
      ...insight(
        "security.vulnerabilities.unknownStatusSubAssessments",
        "security.vulnerabilities.unmappedSubAssessments",
        "security.vulnerabilities.unmappedTargetSubAssessments"
      ),
      route: "/security"
    }], snapshot)).toThrow("collection-scope-only");
  });

  it("passes a synthetic concrete-CVE decision through the combined schema, evidence and language gates", () => {
    const snapshot = buildDemoSnapshot("2026-09-10T00:00:00.000Z");
    snapshot.security.vulnerabilities = {
      availability: "partial", message: "取得済みの脆弱性を確認します。",
      totalSubAssessments: 2, unhealthySubAssessments: 1, unmappedSubAssessments: 0,
      unknownStatusSubAssessments: 1, totalFindings: 1, truncated: false,
      findings: [{
        cve: "CVE-2026-12345", severity: "High",
        resourceRefs: [snapshot.inventory.resources[0]!.id], cvssScore: 8.1
      }]
    };
    snapshot.aiInsights = [{
      ...snapshot.aiInsights[0]!,
      title: "観測された脆弱性の更新条件を確認",
      observation: "CVE-2026-12345 のスコアは8.1です。",
      impact: "スコア8.1は対象環境への適用可否を調べる確認材料です。悪用や業務影響を示したものではありません。",
      recommendedAction: "/security の CVE-2026-12345 と対象を確認し、運用担当者が更新の適用条件と停止許容条件を確かめてください。",
      numericEvidence: [{ label: "観測されたスコア", value: "8.1", source: "security.vulnerabilities.findings.0.cvssScore" }],
      route: "/security"
    }];
    applyDeterministicInsightIds(snapshot);
    applyDeterministicInsightPeriods(snapshot);
    expect(() => {
      validatePublicJsonSchema(snapshot);
      publicSnapshotSchema.parse(snapshot);
      validateNumericEvidence(snapshot);
      validateInsightQuality(snapshot.aiInsights, snapshot);
      validateJapaneseInsights(snapshot.aiInsights);
      validateUiLanguage(snapshot);
    }).not.toThrow();
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
