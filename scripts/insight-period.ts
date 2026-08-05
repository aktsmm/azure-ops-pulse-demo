import type { AiInsight } from "../src/data/contracts";

/**
 * `period` is the window an insight claims to describe, and unlike `title`, `observation`, `impact`
 * and `recommendedAction` it carries no analysis. The agent is given exactly one artifact — the
 * published snapshot as collected at `generatedAt` — and no history, so the window is the same for
 * every insight in a run and is fully determined by the snapshot itself. Nothing about which metric
 * an insight chose can change it.
 *
 * Letting the model write it therefore bought variance without buying meaning, in both directions:
 *
 * - It broke publication. Run 31037073625 emitted `"period": "2026-08-05"`, failed the Japanese
 *   audit, retried with `"2026年8月5日 収集分"` — still no kana, because a natural Japanese date
 *   label has none — and the whole analysis was discarded. Zero insights reached the site.
 * - It published claims the data never supported. Earlier runs shipped `Last 30 days`,
 *   `Rolling 30 days` and `Last 24 hours` beside insights computed from a single point-in-time
 *   snapshot: exactly the "display lies about state" class of bug this repository keeps closing.
 *
 * So the pipeline derives it. The model is told not to write it, a post-step overwrites whatever it
 * wrote anyway, and {@link validateInsightPeriods} re-derives it on the trusted side so a candidate
 * that skipped the overwrite is rejected loudly instead of published.
 */
export function snapshotInsightPeriod(generatedAt: string): string {
  const collectedAt = new Date(generatedAt);
  if (Number.isNaN(collectedAt.getTime())) {
    throw new Error(
      `Cannot derive an insight period from an unreadable collection time: ${generatedAt}`
    );
  }
  return `${collectedAt.toISOString().slice(0, 10)} スナップショット収集時点`;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Rewrites every `period` to the value the snapshot already determines, and reports how many it had
 * to replace. Runs on the raw JSON before schema validation, so an insight that omitted `period`
 * entirely is completed here rather than failing the schema.
 */
export function applyDeterministicInsightPeriods(snapshot: unknown): number {
  if (!isRecord(snapshot) || !Array.isArray(snapshot.aiInsights)) {
    throw new Error("Snapshot must contain an aiInsights array.");
  }
  if (typeof snapshot.generatedAt !== "string") {
    throw new Error("Snapshot must carry the collection time that determines the insight period.");
  }

  const period = snapshotInsightPeriod(snapshot.generatedAt);
  let rewritten = 0;
  for (const [index, insight] of snapshot.aiInsights.entries()) {
    if (!isRecord(insight)) {
      throw new Error(`aiInsights.${index} must be an insight object.`);
    }
    if (insight.period === period) continue;
    insight.period = period;
    rewritten += 1;
  }

  return rewritten;
}

/**
 * The trusted-side half of the rule. `publish-ai-insights.yml` re-runs this from a fresh checkout of
 * the default branch, so a candidate whose `period` did not come from `generatedAt` fails before it
 * reaches the site instead of quietly carrying the model's wording into publication.
 */
export function validateInsightPeriods(snapshot: {
  generatedAt: string;
  aiInsights: AiInsight[];
}): void {
  const expected = snapshotInsightPeriod(snapshot.generatedAt);
  for (const insight of snapshot.aiInsights) {
    if (insight.period !== expected) {
      throw new Error(
        `Insight "${insight.id}" field period is "${insight.period}", but the analysis reads one snapshot collected at ${snapshot.generatedAt}, so period must be "${expected}". period is derived from the snapshot, not written by the analysis.`
      );
    }
  }
}
