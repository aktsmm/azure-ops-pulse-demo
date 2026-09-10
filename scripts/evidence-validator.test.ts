import { describe, expect, it } from "vitest";
import { validateEvidenceItem } from "./evidence-validator";

describe("AI numeric evidence validation", () => {
  it("does not treat digits inside optional target references or addresses as observed quantities", () => {
    const snapshot = {
      inventory: { resources: [{ id: "res-abc123de", network: { privateIpv4: ["10.1.2.3"] } }] },
      advisor: { details: { groups: [{
        count: 1,
        resourceRefs: ["res-abc123de"],
        targets: [{ resourceRef: "res-abc123de", type: "example/v2" }]
      }] } },
      network: { topology: { nodes: [{ id: "res-abc123de" }] } }
    };
    for (const source of [
      "inventory.resources.0.id", "inventory.resources.0.network.privateIpv4.0",
      "advisor.details.groups.0.resourceRefs.0", "advisor.details.groups.0.targets.0.resourceRef",
      "advisor.details.groups.0.targets.0.type", "network.topology.nodes.0.id"
    ]) {
      expect(() => validateEvidenceItem(snapshot, "具体的な対象の確認", {
        label: "対象の数値", value: "123", source
      })).toThrow("context, not numeric evidence");
    }
    expect(() => validateEvidenceItem(snapshot, "具体的な推奨", {
      label: "推奨件数", value: "1件", source: "advisor.details.groups.0.count"
    })).not.toThrow();
  });

  it("keeps a successfully collected Defender field usable when another field is unavailable", () => {
    const snapshot = {
      sources: [{ source: "Defender for Cloud", availability: "partial" }],
      security: { activeAlerts: 1, secureScore: null, fieldAvailability: { activeAlerts: "available", secureScore: "unavailable" } }
    };
    const evidence = { source: "security.activeAlerts", label: "アクティブアラート", value: "1件" };
    expect(() => validateEvidenceItem(snapshot, "内容を確認", evidence)).not.toThrow();
    snapshot.security.fieldAvailability.activeAlerts = "unavailable";
    expect(() => validateEvidenceItem(snapshot, "内容を確認", evidence)).toThrow();
    snapshot.security.fieldAvailability.activeAlerts = "available";
    snapshot.sources[0]!.availability = "unavailable";
    expect(() => validateEvidenceItem(snapshot, "内容を確認", evidence)).toThrow();
  });

  it("keeps known unhealthy assessment counts usable without treating unknown codes as healthy", () => {
    const snapshot = {
      sources: [{ source: "Defender for Cloud", availability: "partial" }],
      security: {
        fieldAvailability: { assessments: "partial" },
        recommendations: [{ affectedCount: 2, unknownCount: 1 }],
        assessmentCoverage: { unhealthyAssessments: 2, unknownAssessments: 1 }
      }
    };
    for (const source of [
      "security.recommendations.0.affectedCount", "security.assessmentCoverage.unhealthyAssessments"
    ]) {
      expect(() => validateEvidenceItem(snapshot, "取得済み評価の確認", {
        label: "確認済みの不健全な評価数", value: "2件", source
      })).not.toThrow();
    }
    snapshot.security.recommendations[0]!.affectedCount = 0;
    expect(() => validateEvidenceItem(snapshot, "不明を正常と判断しない", {
      label: "確認済みの不健全な評価数", value: "0件", source: "security.recommendations.0.affectedCount"
    })).toThrow("not available");
    snapshot.sources[0]!.availability = "unavailable";
    expect(() => validateEvidenceItem(snapshot, "取得失敗", {
      label: "評価数", value: "2件", source: "security.assessmentCoverage.unhealthyAssessments"
    })).toThrow("not available");
  });

  it("uses the independent vulnerability availability without inheriting score or assessment failure", () => {
    const snapshot = {
      sources: [{ source: "Defender for Cloud", availability: "unavailable" }],
      security: {
        fieldAvailability: { secureScore: "unavailable", assessments: "unavailable", activeAlerts: "unavailable" },
        vulnerabilities: { availability: "available", totalFindings: 1, findings: [{ cve: "CVE-2026-12345", cvssScore: 8.1 }] }
      }
    };
    const evidence = { label: "観測されたスコア", value: "8.1", source: "security.vulnerabilities.findings.0.cvssScore" };
    expect(() => validateEvidenceItem(snapshot, "具体的な脆弱性の確認", evidence)).not.toThrow();
    snapshot.security.vulnerabilities.availability = "partial";
    expect(() => validateEvidenceItem(snapshot, "収集済みの脆弱性の確認", evidence)).not.toThrow();
    snapshot.sources[0]!.availability = "available";
    snapshot.security.vulnerabilities.availability = "unavailable";
    expect(() => validateEvidenceItem(snapshot, "未取得を正常と判断しない", evidence)).toThrow("Vulnerability observations");
    expect(() => validateEvidenceItem({ sources: [], security: {} }, "旧データ", evidence)).toThrow("Vulnerability observations");
  });

  it("allows observed degraded resources in partial health data, but not an all-clear zero", () => {
    const snapshot = {
      sources: [{ source: "Resource Health", availability: "partial" }],
      reliability: { coverage: { degradedResources: 1 } }
    };
    const evidence = { source: "reliability.coverage.degradedResources", label: "状態低下", value: "1件" };
    expect(() => validateEvidenceItem(snapshot, "観測された状態低下", evidence)).not.toThrow();
    snapshot.reliability.coverage.degradedResources = 0;
    expect(() => validateEvidenceItem(snapshot, "正常とは判断しない", { ...evidence, value: "0件" })).toThrow();
    snapshot.reliability.coverage.degradedResources = 1;
    snapshot.sources[0]!.availability = "unavailable";
    expect(() => validateEvidenceItem(snapshot, "未収集", evidence)).toThrow();
  });

  it("does not admit a flow count from unavailable telemetry", () => {
    expect(() => validateEvidenceItem({
      sources: [], network: { telemetry: { availability: "unavailable", blockedFlows: 1 } }
    }, "未収集", { source: "network.telemetry.blockedFlows", label: "拒否", value: "1件" })).toThrow("Flow telemetry");
  });

  it("distinguishes missing detail collection from partial content mapping", () => {
    const snapshot = {
      sources: [{ source: "Azure Advisor", availability: "available" }],
      advisor: { availability: "available", details: {
        availability: "available", groups: [{ count: 3, affectedResourceCount: null }]
      } }
    };
    const evidence = { label: "推奨レコード数", value: "3件", source: "advisor.details.groups.0.count" };
    expect(() => validateEvidenceItem(snapshot, "具体的な推奨", evidence)).not.toThrow();
    expect(() => validateEvidenceItem(snapshot, "対象数は未確認", {
      label: "対象数", value: "0件", source: "advisor.details.groups.0.affectedResourceCount"
    })).toThrow("invalid scalar");
    snapshot.advisor.details.availability = "partial";
    expect(() => validateEvidenceItem(snapshot, "個別に収集された推奨", evidence)).not.toThrow();
    for (const availability of ["missing", "unavailable"]) {
      snapshot.advisor.details.availability = availability;
      expect(() => validateEvidenceItem(snapshot, "具体的な推奨", evidence))
        .toThrow("Advisor detail collection is not available");
    }
  });

  it("accepts one normalized numeric value supported by the cited scalar", () => {
    expect(() =>
      validateEvidenceItem(
        { security: { secureScore: 87 } },
        "Supported evidence",
        { label: "Secure score", value: "87%", source: "security.secureScore" }
      )
    ).not.toThrow();
  });

  it("rejects an invented second value even when one value matches", () => {
    expect(() =>
      validateEvidenceItem(
        { security: { secureScore: 87 } },
        "Unsupported evidence",
        {
          label: "Invented assets",
          value: "87% and 42 exposed assets",
          source: "security.secureScore"
        }
      )
    ).toThrow(/87% and 42 exposed assets/);
  });

  it.each([
    ["9007199254740993", 9007199254740992],
    ["1", "1.0000000000000001"]
  ])("rejects precision-loss comparison %s against %s", (evidenceValue, sourceValue) => {
    expect(() =>
      validateEvidenceItem(
        { metric: sourceValue },
        "Precision-sensitive evidence",
        { label: "Metric", value: evidenceValue, source: "metric" }
      )
    ).toThrow(/Precision-sensitive evidence/);
  });

  it("canonicalizes formatting without changing the represented decimal", () => {
    expect(() =>
      validateEvidenceItem(
        { metric: "001.2300" },
        "Canonical evidence",
        { label: "Metric", value: "+1.23%", source: "metric" }
      )
    ).not.toThrow();
  });

  it("rejects a default zero from an unavailable source", () => {
    expect(() =>
      validateEvidenceItem(
        {
          sources: [
            {
              source: "Defender for Cloud",
              availability: "unavailable",
              message: "Unavailable."
            }
          ],
          security: { secureScore: 0 }
        },
        "Unavailable Defender evidence",
        { label: "Secure score", value: "0%", source: "security.secureScore" }
      )
    ).toThrow(/Defender for Cloud is not available/);
  });

  it("rejects null posture as numeric evidence", () => {
    expect(() =>
      validateEvidenceItem(
        {
          sources: [
            { source: "Resource Health", availability: "available", message: "Collected." }
          ],
          overview: { postureScore: null }
        },
        "Unknown health evidence",
        { label: "Health", value: "0%", source: "overview.postureScore" }
      )
    ).toThrow(/invalid scalar source/);
  });

  it("rejects a default incident zero when Resource Health is unavailable", () => {
    expect(() =>
      validateEvidenceItem(
        {
          sources: [
            {
              source: "Resource Health",
              availability: "unavailable",
              message: "Unavailable."
            }
          ],
          reliability: { incidentAvailability: "available", incidents: 0 }
        },
        "Unavailable incident evidence",
        { label: "障害件数", value: "0", source: "reliability.incidents" }
      )
    ).toThrow(/Resource Health is not available/);
  });

  it("rejects incident evidence when no incident count source was collected", () => {
    expect(() =>
      validateEvidenceItem(
        {
          sources: [
            {
              source: "Resource Health",
              availability: "available",
              message: "Collected."
            }
          ],
          reliability: { incidentAvailability: "unavailable", incidents: 0 }
        },
        "Uncollected incident evidence",
        { label: "障害件数", value: "0", source: "reliability.incidents" }
      )
    ).toThrow(/Incident observations are not available/);
  });

  it("rejects null incident evidence even when Resource Health is available", () => {
    expect(() =>
      validateEvidenceItem(
        {
          sources: [
            {
              source: "Resource Health",
              availability: "available",
              message: "Collected."
            }
          ],
          reliability: { incidentAvailability: "available", incidents: null }
        },
        "Null incident evidence",
        { label: "障害件数", value: "0", source: "reliability.incidents" }
      )
    ).toThrow(/invalid scalar source/);
  });
});
