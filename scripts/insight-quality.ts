import type { AiInsight } from "../src/data/contracts";
import { numericTokens } from "./evidence-validator";

// These values describe collection scope, not operational degradation. Actual degraded/unavailable
// resource counts remain eligible evidence, even though they share the coverage object.
const COLLECTION_ONLY_SOURCE =
  /^(?:network\.metricCoverage\.|network\.inventory\.total$|inventory\.total$|reliability\.coverage\.(?:totalResources|supportedResources|notApplicableResources|evaluatedResources|unevaluatedResources|supportedCoveragePercent)$)/u;

export function insightQualityFindings(insights: readonly AiInsight[]): string[] {
  return insights.flatMap((insight, index) => {
    const sources = new Set(insight.numericEvidence.map((evidence) => evidence.source));
    const findings: string[] = [];
    if (sources.size < 2) {
      findings.push(`aiInsights.${index}: analytical claims require at least two distinct evidence paths; do not pad with duplicate evidence.`);
    }
    if ([...sources].every((source) => COLLECTION_ONLY_SOURCE.test(source))) {
      findings.push(`aiInsights.${index}: collection-scope-only evidence belongs in the deterministic diagnostics, not AI insights. Omit this candidate; unsupported does not mean unhealthy.`);
    }
    if ([...sources].some((source) => source.startsWith("reliability.serviceHealth.")) &&
        [...sources].every((source) => COLLECTION_ONLY_SOURCE.test(source) ||
          /^reliability\.serviceHealth\.(?:activeEvents|resolvedEvents)$/u.test(source))) {
      findings.push(`aiInsights.${index}: event-totals-only evidence is a status summary, not comparative analysis. Omit it unless relevant independent observations support a review priority.`);
    }
    const impactNumbers = numericTokens(insight.impact);
    const evidenceNumbers = insight.numericEvidence.flatMap((evidence) => numericTokens(evidence.value));
    if (!impactNumbers.some((number) => evidenceNumbers.includes(number))) {
      findings.push(`aiInsights.${index}.impact: tie the impact to at least one cited numeric value and explain its decision consequence, rather than a generic possibility.`);
    }
    // Matching a number is only grounding of the quantity, not of its unit, direction, causal
    // interpretation or usefulness. Those claims are independently judged by the semantic reviewer.
    const citedMagnitudes = new Set(evidenceNumbers.map((number) => number.replace(/^-/, "")));
    for (const field of ["title", "observation", "impact", "recommendedAction"] as const) {
      const text = insight[field].normalize("NFKC").replaceAll("−", "-")
        // Embedded version/protocol tokens are labels, not measured quantities (IPv4, TLS1.2).
        .replace(/\b[A-Za-z][A-Za-z._/-]*\d+[A-Za-z\d._/-]*\b/gu, "");
      if (numericTokens(text).some((number) => !citedMagnitudes.has(number.replace(/^-/, "")))) {
        findings.push(`aiInsights.${index}.${field}: every numeric claim in prose must be present in this insight's numericEvidence. Omit unsupported numbers or add their actual scalar sources; do not invent savings, durations, thresholds or derived totals.`);
      }
    }
    if (sources.size > 0 && [...sources].every((source) => source.startsWith("advisor.")) &&
        (insight.route !== "/security" || /信頼性ダッシュボード/u.test(insight.recommendedAction))) {
      findings.push(`aiInsights.${index}.route: Advisor category/impact counts are displayed only at /security. Direct the reader to the security dashboard's Advisor category selector, not the reliability dashboard.`);
    }
    if (sources.size > 0 && [...sources].every((source) => source.startsWith("cost.")) &&
        /使用量|利用量|使用状況|利用状況/u.test(insight.recommendedAction)) {
      findings.push(`aiInsights.${index}.recommendedAction: this snapshot has category shares and cost changes, not usage data. Recommend comparing the named category with overall and other category changes to decide review priority; do not ask the dashboard to determine usage causes.`);
    }
    return findings;
  });
}

export function validateInsightQuality(insights: readonly AiInsight[]): void {
  const findings = insightQualityFindings(insights);
  if (findings.length) throw new Error(`Insight quality gate failed:\n${findings.join("\n")}`);
}
