import type { AiInsight, PublicSnapshotV1 } from "../src/data/contracts";

function valueAtPath(root: unknown, path: string): unknown {
  let current = root;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function numericTokens(value: unknown): string[] {
  return (String(value).match(/[+-]?\d[\d,]*(?:\.\d+)?/g) ?? []).map((token) => {
    const compact = token.replaceAll(",", "");
    const negative = compact.startsWith("-");
    const unsigned = compact.replace(/^[+-]/, "");
    const [integerPart, fractionalPart = ""] = unsigned.split(".");
    const integer = integerPart.replace(/^0+(?=\d)/, "");
    const fractional = fractionalPart.replace(/0+$/, "");
    const canonical = fractional ? `${integer}.${fractional}` : integer;
    return negative && !/^0(?:\.0+)?$/.test(canonical) ? `-${canonical}` : canonical;
  });
}

export function validateEvidenceItem(
  snapshot: unknown,
  insightTitle: string,
  evidence: AiInsight["numericEvidence"][number]
): void {
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
