import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const KANA_CHARACTER = /[ぁ-ゟ゠-ヿ]/u;
const FALLBACK_LABEL = "公開スナップショットの指標";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeAiInsightEvidenceLabels(snapshot: unknown): number {
  if (!isRecord(snapshot) || !Array.isArray(snapshot.aiInsights)) {
    throw new Error("Snapshot must contain an aiInsights array.");
  }

  let normalized = 0;
  for (const [insightIndex, insight] of snapshot.aiInsights.entries()) {
    if (!isRecord(insight) || !Array.isArray(insight.numericEvidence)) {
      throw new Error(`aiInsights.${insightIndex} must contain a numericEvidence array.`);
    }

    for (const [evidenceIndex, evidence] of insight.numericEvidence.entries()) {
      if (!isRecord(evidence) || typeof evidence.label !== "string") {
        throw new Error(`aiInsights.${insightIndex}.numericEvidence.${evidenceIndex}.label must be text.`);
      }

      if (!KANA_CHARACTER.test(evidence.label)) {
        evidence.label = FALLBACK_LABEL;
        normalized += 1;
      }
    }
  }

  return normalized;
}

async function main(): Promise<void> {
  const path = resolve(process.argv[2] ?? "public/data/snapshot.json");
  const snapshot = JSON.parse(await readFile(path, "utf8")) as unknown;
  const normalized = normalizeAiInsightEvidenceLabels(snapshot);

  if (normalized > 0) {
    await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  }

  console.log(`Normalized ${normalized} AI insight evidence label(s).`);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  await main();
}
