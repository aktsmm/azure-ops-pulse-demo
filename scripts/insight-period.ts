import type { AiInsight } from "../src/data/contracts";

/**
 * `period` marks when the snapshot an insight analyzed was collected. That is deliberately all it
 * means: unlike `title`, `observation`, `impact` and `recommendedAction` it carries no analysis, and
 * it is independent of the aggregation window of whichever source an insight cited — 30-day cost
 * totals, 7-day Activity Log counts, 24-hour network metrics all sit in the same snapshot. The
 * collection time is fixed exactly and identically for every insight in a run, so this field is
 * derived from `generatedAt` rather than written by the model.
 *
 * Letting the model write it bought variance without buying meaning, in both directions:
 *
 * - It broke publication. Run 31037073625 emitted `"period": "2026-08-05"`, failed the Japanese
 *   audit, retried with `"2026年8月5日 収集分"` — still no kana, because a natural Japanese date
 *   label has none — and the whole analysis was discarded. Zero insights reached the site.
 * - It published windows nothing checked. Earlier runs shipped `Last 30 days`, `Rolling 30 days` and
 *   `Last 24 hours`, and no gate compared any of them against the window of the source the insight
 *   actually cited.
 *
 * The date is the one the dashboard shows. Every timestamp on the page is rendered in `Asia/Tokyo`
 * (`formatDateTimeJa`), and collection runs at 21:00 UTC — 06:00 the next day in Japan — so slicing
 * the UTC date would print a period one day behind the collection time shown beside it.
 */
const collectionDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export function snapshotInsightPeriod(generatedAt: string): string {
  const collectedAt = new Date(generatedAt);
  if (Number.isNaN(collectedAt.getTime())) {
    throw new Error(
      `Cannot derive an insight period from an unreadable collection time: ${generatedAt}`
    );
  }
  const parts = collectionDateFormatter.formatToParts(collectedAt);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} スナップショット収集時点`;
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
        `Insight "${insight.id}" field period is "${insight.period}", but the snapshot it analyzed was collected at ${snapshot.generatedAt}, so period must be "${expected}". period marks the collection time and is derived from the snapshot, not written by the analysis.`
      );
    }
  }
}
