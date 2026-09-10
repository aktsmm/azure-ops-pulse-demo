import type { AiInsight } from "../src/data/contracts";
import { numericTokens, valueAtPath } from "./evidence-validator";

// These values describe collection scope, not operational degradation. Actual degraded/unavailable
// resource counts remain eligible evidence, even though they share the coverage object.
const COLLECTION_ONLY_SOURCE =
  /^(?:network\.metricCoverage\.|network\.inventory\.total$|inventory\.total$|reliability\.coverage\.(?:totalResources|supportedResources|notApplicableResources|evaluatedResources|unevaluatedResources|supportedCoveragePercent)$)/u;

export function insightQualityFindings(insights: readonly AiInsight[], snapshot?: unknown): string[] {
  return insights.flatMap((insight, index) => {
    const sources = new Set(insight.numericEvidence.map((evidence) => evidence.source));
    const advisorSources = [...sources].filter((source) => source.startsWith("advisor."));
    const mappedAdvisorEvidence = advisorSources.some((source) => {
      const group = /^(advisor\.details\.groups\.\d+)\./u.exec(source)?.[1];
      return group !== undefined &&
        valueAtPath(snapshot, "advisor.availability") === "available" &&
        ["available", "partial"].includes(String(valueAtPath(snapshot, "advisor.details.availability"))) &&
        valueAtPath(snapshot, `${group}.contentStatus`) === "mapped";
    });
    const findings: string[] = [];
    const observedOperationalEvidence = [...sources].some((source) =>
      /^(?:security\.activeAlerts|reliability\.coverage\.(?:degradedResources|unavailableResources)|network\.telemetry\.(?:blockedFlows|degradedConnections))$/u.test(source) &&
      typeof valueAtPath(snapshot, source) === "number" && Number(valueAtPath(snapshot, source)) > 0);
    if (sources.size < 2 && !mappedAdvisorEvidence && !observedOperationalEvidence) {
      findings.push(`aiInsights.${index}: analytical claims require at least two distinct evidence paths; do not pad with duplicate evidence.`);
    }
    if (advisorSources.length && !mappedAdvisorEvidence) {
      findings.push(`aiInsights.${index}: Advisor prioritization requires a cited mapped recommendation content group, not category/impact counts alone or unknown content. Explain the actual concern and conditional decision.`);
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
    if (advisorSources.length === sources.size && sources.size > 0 &&
        insight.route !== "/recommendations") {
      findings.push(`aiInsights.${index}.route: Advisor content analysis belongs at /recommendations. Direct the reader to the concrete recommendation card and its confirmation guide.`);
    }
    return findings;
  });
}

export function validateInsightQuality(insights: readonly AiInsight[], snapshot?: unknown): void {
  const findings = insightQualityFindings(insights, snapshot);
  if (findings.length) throw new Error(`Insight quality gate failed:\n${findings.join("\n")}`);
}
