import type { PublicSnapshotV1 } from "../src/data/contracts";

export function valueAtPath(root: unknown, path: string): unknown {
  let current = root;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function normalizedNumericTokens(value: unknown): string[] {
  const matches = String(value).match(/[+-]?\d[\d,]*(?:\.\d+)?/g) ?? [];
  return matches.map((token) => {
    const normalized = Number(token.replaceAll(",", ""));
    return Number.isFinite(normalized) ? String(normalized) : token;
  });
}

export function validateNumericEvidence(snapshot: PublicSnapshotV1): void {
  for (const insight of snapshot.aiInsights) {
    for (const evidence of insight.numericEvidence) {
      const sourceValue = valueAtPath(snapshot, evidence.source);
      if (
        sourceValue === undefined ||
        (typeof sourceValue !== "string" && typeof sourceValue !== "number")
      ) {
        throw new Error(
          `Insight "${insight.title}" cites an invalid scalar source: ${evidence.source}`
        );
      }
      const citedNumbers = normalizedNumericTokens(evidence.value);
      const sourceNumbers = normalizedNumericTokens(sourceValue);
      if (
        !citedNumbers.length ||
        !citedNumbers.every((number) => sourceNumbers.includes(number))
      ) {
        throw new Error(
          `Insight "${insight.title}" cites ${evidence.value} but ${evidence.source} contains ${String(sourceValue)}`
        );
      }
    }
  }
}
