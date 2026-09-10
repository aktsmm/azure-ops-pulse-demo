import type { AiInsight, PublicSnapshotV1 } from "../src/data/contracts";

export function valueAtPath(root: unknown, path: string): unknown {
  let current = root;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function numericTokens(value: unknown): string[] {
  return (String(value).match(/[+-]?\d[\d,]*(?:\.\d+)?/g) ?? []).map((token) => {
    const compact = token.replaceAll(",", "");
    const negative = compact.startsWith("-");
    const unsigned = compact.replace(/^[+-]/, "");
    const [integerPart = "0", fractionalPart = ""] = unsigned.split(".");
    const integer = integerPart.replace(/^0+(?=\d)/, "");
    const fractional = fractionalPart.replace(/0+$/, "");
    const canonical = fractional ? `${integer}.${fractional}` : integer;
    return negative && !/^0(?:\.0+)?$/.test(canonical) ? `-${canonical}` : canonical;
  });
}

function requireAvailableEvidenceSource(snapshot: unknown, sourcePath: string): void {
  if (snapshot === null || typeof snapshot !== "object") return;
  if (sourcePath.startsWith("security.vulnerabilities.")) {
    // Subassessment collection is independent of score, assessment and alert collection.
    if (!["available", "partial"].includes(String(valueAtPath(snapshot, "security.vulnerabilities.availability")))) {
      throw new Error(`Vulnerability observations are not available for ${sourcePath}`);
    }
    return;
  }
  const sources = (snapshot as { sources?: unknown }).sources;
  if (!Array.isArray(sources)) return;

  if (sourcePath.startsWith("network.telemetry.") &&
      valueAtPath(snapshot, "network.telemetry.availability") !== "available") {
    throw new Error(`Flow telemetry is not available for ${sourcePath}`);
  }
  const requiredSource = sourcePath.startsWith("security.")
    ? "Defender for Cloud"
    : sourcePath.startsWith("advisor.")
      ? "Azure Advisor"
      : sourcePath.startsWith("network.topology.")
        ? "Network topology"
    : sourcePath.startsWith("reliability.coverage.") ||
      sourcePath === "overview.postureScore" || sourcePath === "reliability.incidents"
      ? "Resource Health"
      : null;
  if (!requiredSource) return;

  const status = sources.find(
    (source): source is { source: string; availability: string } =>
      source !== null &&
      typeof source === "object" &&
      (source as { source?: unknown }).source === requiredSource &&
      typeof (source as { availability?: unknown }).availability === "string"
  );
  const defenderField = /^security\.(?:recommendations|assessmentCoverage)\./u.test(sourcePath)
    ? "assessments" : (sourcePath.split(".")[1] ?? "");
  const observedUnhealthyAssessmentCount =
    /^security\.(?:recommendations\.\d+\.affectedCount|assessmentCoverage\.unhealthyAssessments)$/u.test(sourcePath) &&
    valueAtPath(snapshot, "security.fieldAvailability.assessments") === "partial" &&
    typeof valueAtPath(snapshot, sourcePath) === "number" && Number(valueAtPath(snapshot, sourcePath)) > 0;
  const individuallyAvailable = sourcePath.startsWith("security.") &&
    (valueAtPath(snapshot, `security.fieldAvailability.${defenderField}`) === "available" ||
      observedUnhealthyAssessmentCount);
  const observedHealthCount = /^reliability\.coverage\.(?:degradedResources|unavailableResources)$/u.test(sourcePath) &&
    typeof valueAtPath(snapshot, sourcePath) === "number" && Number(valueAtPath(snapshot, sourcePath)) > 0;
  if (status?.availability !== "available" &&
      !(status?.availability === "partial" && (individuallyAvailable || observedHealthCount))) {
    throw new Error(`Evidence source ${requiredSource} is not available for ${sourcePath}`);
  }
  if (sourcePath.startsWith("security.")) {
    const security = (snapshot as { security?: { fieldAvailability?: Record<string, string> } }).security;
    if (security?.fieldAvailability && security.fieldAvailability[defenderField] !== "available" &&
        !observedUnhealthyAssessmentCount) {
      throw new Error(`Defender field is not available for ${sourcePath}`);
    }
  }
  if ((sourcePath.startsWith("advisor.") && valueAtPath(snapshot, "advisor.availability") !== "available") ||
      (sourcePath.startsWith("network.topology.") && valueAtPath(snapshot, "network.topology.availability") !== "available")) {
    throw new Error(`Collection is not available for ${sourcePath}`);
  }
  if (sourcePath.startsWith("advisor.details.")) {
    const detailAvailability = valueAtPath(snapshot, "advisor.details.availability");
    if (detailAvailability !== "available" && detailAvailability !== "partial") {
      throw new Error(`Advisor detail collection is not available for ${sourcePath}`);
    }
  }
  if (
    sourcePath === "reliability.incidents" &&
    (snapshot as { reliability?: { incidentAvailability?: unknown } }).reliability
      ?.incidentAvailability !== "available"
  ) {
    throw new Error(`Incident observations are not available for ${sourcePath}`);
  }
}

export function validateEvidenceItem(
  snapshot: unknown,
  insightTitle: string,
  evidence: AiInsight["numericEvidence"][number]
): void {
  if (/^(?:inventory\.resources\.\d+\.id|network\.topology\.nodes\.\d+\.id)$|\.(?:resourceRefs|targets)\.|\.network\.(?:privateIpv4|privateCidrs|publicIpv4Masked)\./u.test(evidence.source)) {
    throw new Error(`Target references and addresses are context, not numeric evidence: ${evidence.source}`);
  }
  requireAvailableEvidenceSource(snapshot, evidence.source);
  const sourceValue = valueAtPath(snapshot, evidence.source);
  if (sourceValue === undefined || (typeof sourceValue !== "string" && typeof sourceValue !== "number")) {
    throw new Error(`Insight "${insightTitle}" cites an invalid scalar source: ${evidence.source}`);
  }

  const citedNumbers = numericTokens(evidence.value);
  const sourceNumbers = numericTokens(sourceValue);
  if (
    citedNumbers.length !== 1 ||
    sourceNumbers.length !== 1 ||
    citedNumbers[0] !== sourceNumbers[0]
  ) {
    throw new Error(
      `Insight "${insightTitle}" cites ${evidence.value} but ${evidence.source} contains ${String(sourceValue)}`
    );
  }
}

export function validateNumericEvidence(snapshot: PublicSnapshotV1): void {
  for (const insight of snapshot.aiInsights) {
    for (const evidence of insight.numericEvidence) {
      validateEvidenceItem(snapshot, insight.title, evidence);
    }
  }
}
