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
    return findings;
  });
}

export function validateInsightQuality(insights: readonly AiInsight[]): void {
  const findings = insightQualityFindings(insights);
  if (findings.length) throw new Error(`Insight quality gate failed:\n${findings.join("\n")}`);
}
