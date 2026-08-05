import { describe, expect, it } from "vitest";
import {
  summarizeAssessments,
  withheldRecommendationTitle,
  type DefenderAssessmentRow
} from "./defender-recommendations";

/**
 * These stand in for what an operator can put in a custom assessment: a project codename, a person,
 * and a hostname. None of them appear anywhere else in a snapshot, so no mask that inspects the
 * published document could recognise them — which is exactly why the collector withholds the title
 * rather than filtering it.
 */
const OPERATOR_AUTHORED_TITLES = [
  "Orion ledger nodes must rotate their signing keys",
  "Ask Alice Tanaka before disabling this control",
  "db must not accept public traffic",
  "Legacy host grantportal-intake-prod-westus2 needs patching"
];

function assessment(
  displayName: string,
  code: string,
  severity?: string
): DefenderAssessmentRow {
  return { properties: { displayName, status: { code, severity } } };
}

describe("Defender recommendation summarisation", () => {
  it("never publishes a string Azure supplied, whatever the assessment claims about itself", () => {
    // `assessmentType` is a caller-supplied request field on the customer-writable metadata
    // endpoint and accepts `BuiltIn`, so no field on the response can establish authorship.
    // https://learn.microsoft.com/rest/api/defenderforcloud/assessments-metadata/create-in-subscription
    const rows = OPERATOR_AUTHORED_TITLES.map((title) => assessment(title, "Unhealthy", "High"));

    const published = summarizeAssessments(rows);

    const serialized = JSON.stringify(published);
    for (const title of OPERATOR_AUTHORED_TITLES) {
      for (const word of title.split(/\s+/)) {
        if (word.length < 3) continue;
        expect(serialized.toLowerCase()).not.toContain(word.toLowerCase());
      }
    }
  });

  it("publishes only the repository-authored label and an ordinal", () => {
    const rows = OPERATOR_AUTHORED_TITLES.map((title) => assessment(title, "Unhealthy", "High"));

    const published = summarizeAssessments(rows);

    expect(published).toHaveLength(4);
    expect(published.map((item) => item.title)).toEqual([
      withheldRecommendationTitle(1),
      withheldRecommendationTitle(2),
      withheldRecommendationTitle(3),
      withheldRecommendationTitle(4)
    ]);
  });

  it("keeps distinct assessments as distinct rows and groups repeats of one", () => {
    const rows = [
      assessment("finding A", "Unhealthy", "High"),
      assessment("finding A", "Unhealthy", "High"),
      assessment("finding A", "Healthy"),
      assessment("finding B", "Unhealthy", "Medium")
    ];

    const published = summarizeAssessments(rows);

    expect(published).toHaveLength(2);
    expect(published[0]).toMatchObject({ severity: "critical", affectedCount: 2, status: "Open" });
    expect(published[1]).toMatchObject({ severity: "warning", affectedCount: 1, status: "Open" });
  });

  it("does not count healthy or not-applicable assessments as findings", () => {
    const published = summarizeAssessments([
      assessment("finding", "Healthy"),
      assessment("finding", "NotApplicable")
    ]);

    expect(published).toEqual([
      { title: withheldRecommendationTitle(1), severity: "info", affectedCount: 0, status: "Resolved" }
    ]);
  });

  it("treats an unrecognised status code as open rather than reporting it resolved", () => {
    const published = summarizeAssessments([assessment("finding", "Unknown")]);

    expect(published[0]).toMatchObject({ affectedCount: 1, status: "Open" });
  });

  it("orders rows deterministically so ordinals do not shuffle between runs", () => {
    const rows = [
      assessment("zeta", "Unhealthy", "Low"),
      assessment("alpha", "Unhealthy", "Low"),
      assessment("mid", "Unhealthy", "Medium")
    ];

    const first = summarizeAssessments(rows);
    const reversed = summarizeAssessments([...rows].reverse());

    expect(first).toEqual(reversed);
    expect(first[0]!.severity).toBe("warning");
  });

  it("tolerates rows with no properties at all", () => {
    expect(summarizeAssessments([{}, { properties: {} }])).toEqual([
      { title: withheldRecommendationTitle(1), severity: "info", affectedCount: 2, status: "Open" }
    ]);
  });

  it("caps the published rows", () => {
    const rows = Array.from({ length: 30 }, (_, index) =>
      assessment(`finding ${index}`, "Unhealthy", "High")
    );

    expect(summarizeAssessments(rows)).toHaveLength(12);
    expect(summarizeAssessments(rows, 3)).toHaveLength(3);
  });
});
