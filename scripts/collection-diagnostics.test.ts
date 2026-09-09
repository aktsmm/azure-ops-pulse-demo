import { describe, expect, it } from "vitest";
import { CollectionError, classifyCollectionFailure, safeCollectionFailure } from "./collection-diagnostics";
import { collectSource } from "./source-status";
import { collectDefender } from "./defender-collection";
import { summarizeAdvisor, ADVISOR_QUERY } from "./advisor";

describe("safe collection diagnostics", () => {
  it.each([
    ["ERROR AADSTS700024 private-secret", "authentication"],
    ["AuthorizationFailed 403 private-secret", "forbidden"],
    ["TooManyRequests 429 private-secret", "throttled"],
    ["BillingAccessDenied private-secret", "billing-scope"],
    ["InvalidSubscriptionType private-secret", "billing-scope"],
    ["SubscriptionTypeNotSupported private-secret", "billing-scope"],
    ["Unsupported private-secret", "unsupported"],
    ["response was not valid JSON private-secret", "invalid-response"],
    ["private-secret", "unknown"]
  ])("classifies %s without retaining raw output", (diagnostic, expected) => {
    const failure = classifyCollectionFailure(diagnostic);
    expect(failure).toBe(expected);
    const error = new CollectionError(failure);
    const result = collectSource("test", () => { throw error; }, () => ({
      availability: "available", message: ""
    }), safeCollectionFailure);
    expect(JSON.stringify(result)).not.toContain("private-secret");
    expect(result.status.availability).toBe("unavailable");
    expect(result.status.reason).toBe(expected);
    expect(result.status.message).toBe(error.message);
    expect(safeCollectionFailure(new Error(diagnostic))).not.toContain("private-secret");
  });
});

function defenderQuery(options: { assessments?: unknown[] | Error; scores?: unknown[] | Error; alerts?: unknown[] | Error }) {
  return <T>(query: string): T[] => {
    const result = query.includes("/assessments'")
      ? options.assessments ?? []
      : query.includes("/securescores'") ? options.scores ?? [] : options.alerts ?? [{ count_: 0 }];
    if (result instanceof Error) throw result;
    return result as T[];
  };
}

describe("independent Defender fields", () => {
  it("does not infer plan configuration from empty scores and assessments", () => {
    const result = collectDefender(defenderQuery({}));
    expect(result.status.availability).toBe("partial");
    expect(result.status.reason).toBe("empty");
    expect(result.security.secureScore).toBeNull();
    expect(result.security.activeAlerts).toBe(0);
    expect(result.security.fieldAvailability?.assessments).toBe("available");
    expect(result.status.message).toContain("評価の読み取り成功: 0 件");
    expect(result.status.message).not.toMatch(/likely disabled|plans may be disabled/);
  });

  it("retains available scores and alerts when assessments fail", () => {
    const result = collectDefender(defenderQuery({
      assessments: new CollectionError("forbidden"),
      scores: [{ percentageRatio: 0.72 }],
      alerts: [{ count_: 3 }]
    }));
    expect(result.status.availability).toBe("partial");
    expect(result.status.reason).toBe("forbidden");
    expect(result.security).toMatchObject({
      secureScore: 72, activeAlerts: 3, recommendations: [], compliance: [],
      fieldAvailability: { secureScore: "available", assessments: "unavailable", activeAlerts: "available" }
    });
  });

  it("retains safe assessments when only score fails", () => {
    const result = collectDefender(defenderQuery({
      assessments: [{ properties: { displayName: "private-project", status: { code: "Unhealthy", severity: "High" } } }],
      scores: new CollectionError("throttled")
    }));
    expect(result.security.recommendations).toHaveLength(1);
    expect(result.security.fieldAvailability?.secureScore).toBe("unavailable");
    expect(JSON.stringify(result)).not.toContain("private-project");
  });

  it.each([null, "", -0.1, 1.1, "0.5"])("does not coerce invalid score %s to healthy or zero", (percentageRatio) => {
    const result = collectDefender(defenderQuery({ scores: [{ percentageRatio }] }));
    expect(result.security.secureScore).toBeNull();
    expect(result.status.availability).toBe("partial");
  });

  it("never replaces unreadable active alerts with zero", () => {
    const result = collectDefender(defenderQuery({ alerts: [] }));
    expect(result.security.activeAlerts).toBeNull();
    expect(result.security.fieldAvailability?.activeAlerts).toBe("unavailable");
  });

  it("marks all failures unavailable without raw diagnostics", () => {
    const error = new Error("private-data");
    const result = collectDefender(defenderQuery({ assessments: error, scores: error, alerts: error }));
    expect(result.status.availability).toBe("unavailable");
    expect(JSON.stringify(result)).not.toContain("private-data");
  });
});

describe("Advisor closed-vocabulary aggregates", () => {
  it("queries no recommendation names, IDs, savings, or titles", () => {
    expect(ADVISOR_QUERY).toContain("AdvisorResources");
    expect(ADVISOR_QUERY).toContain("properties.category");
    expect(ADVISOR_QUERY).toContain("properties.impact");
    expect(ADVISOR_QUERY).not.toMatch(/resourceId|shortDescription|savings|displayName/);
  });

  it("merges categories case insensitively and masks unknown terms", () => {
    const result = summarizeAdvisor([
      { category: "Cost", impact: "High", count: 2 },
      { category: "cost", impact: "high", count: 3 },
      { category: "private-title", impact: "private-impact", count: 1 }
    ]);
    expect(result.availability).toBe("partial");
    expect(result.recommendations).toEqual([
      { category: "Cost", impact: "High", count: 5 },
      { category: "Other", impact: "Unknown", count: 1 }
    ]);
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("distinguishes successful empty results from unavailable collection", () => {
    expect(summarizeAdvisor([])).toMatchObject({ availability: "available", recommendations: [] });
    expect(() => summarizeAdvisor([{ count: "4" }])).toThrow(CollectionError);
    expect(() => summarizeAdvisor([{ count: -1 }])).toThrow(CollectionError);
  });
});
