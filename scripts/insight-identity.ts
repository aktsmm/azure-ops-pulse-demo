import { stableHash } from "../src/lib/sanitize";
import type { AiInsight } from "../src/data/contracts";

/**
 * `id` is the second field this pipeline takes back from the analysis, for the same reason as
 * `period`: nothing about it is an analytical judgement.
 *
 * The schema asks for `insight-` followed by exactly eight lowercase hexadecimal characters. That is
 * a request for eight random characters in a spelling the model has no way to check, and the run
 * decides whether it obliges: `insight-A3C1F2E4`, `insight-cost-spike` and a seven-character id are
 * all natural outputs and all rejected. Worse, the one property the dashboard actually depends on is
 * the one the schema cannot express. `src/App.tsx` renders insight cards with `key={insight.id}`, so
 * two insights that happen to draw the same eight characters collapse into one card — a published
 * page that silently shows less than it was given, which is exactly the failure this repository has
 * spent thirty-odd fixes removing.
 *
 * The repository already treats an insight id as derived rather than authored: `sanitize.ts` rewrites
 * every collector-side id as `insight-${stableHash(...)}`. Only the analysis path, which edits the
 * already-sanitized snapshot directly, ever kept a model-written id. This closes that gap by deriving
 * the id from the insight's own content, which makes the format automatic and uniqueness structural:
 * two ids can only collide if two insights say the same thing, and that is a defect worth seeing
 * rather than a spelling to repair.
 *
 * `period` and `id` are excluded from the hash. Both are derived, so including them would make the
 * identity depend on the clock or on itself.
 */
const CONTENT_FIELDS = [
  "severity",
  "title",
  "observation",
  "impact",
  "recommendedAction",
  "confidence",
  "route"
] as const;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Serializes the analysis content in a fixed order, so the identity depends on what the insight
 * says and never on the order the fields happened to be written in.
 */
function insightContent(insight: unknown): string {
  const record = isRecord(insight) ? insight : {};
  const evidence = Array.isArray(record.numericEvidence)
    ? record.numericEvidence.map((item) =>
        isRecord(item) ? [item.label ?? null, item.value ?? null, item.source ?? null] : (item ?? null)
      )
    : null;
  return JSON.stringify([...CONTENT_FIELDS.map((field) => record[field] ?? null), evidence]);
}

export function deriveInsightId(insight: unknown): string {
  return `insight-${stableHash(insightContent(insight))}`;
}

/**
 * Rewrites every `id` to the value the insight's own content determines, and reports how many it had
 * to replace. Runs on the raw JSON before schema validation, so an insight that omitted `id`, or
 * wrote it in a spelling the schema rejects, is completed here instead of failing.
 *
 * Two insights deriving the same id is not repaired. It means the analysis published the same
 * finding twice — or, at odds of about one in four billion per pair, that the hash collided — and
 * either way the dashboard would have rendered one card where it was handed two. Renaming one of
 * them would publish that as if it were fine.
 */
export function applyDeterministicInsightIds(snapshot: unknown): number {
  if (!isRecord(snapshot) || !Array.isArray(snapshot.aiInsights)) {
    throw new Error("Snapshot must contain an aiInsights array.");
  }

  const firstIndexById = new Map<string, number>();
  let rewritten = 0;
  for (const [index, insight] of snapshot.aiInsights.entries()) {
    if (!isRecord(insight)) {
      throw new Error(`aiInsights.${index} must be an insight object.`);
    }

    const id = deriveInsightId(insight);
    const duplicateOf = firstIndexById.get(id);
    if (duplicateOf !== undefined) {
      throw new Error(
        `aiInsights.${index} derives the same identifier as aiInsights.${duplicateOf} (${id}), so the two insights carry the same content. The dashboard keys insight cards by id, so publishing both would render one card and drop the other.`
      );
    }
    firstIndexById.set(id, index);

    if (insight.id === id) continue;
    insight.id = id;
    rewritten += 1;
  }

  return rewritten;
}

/**
 * The trusted-side half of the rule, mirroring `validateInsightPeriods`. `publish-ai-insights.yml`
 * derives the ids from a fresh checkout of the default branch and then runs this, so a candidate
 * carrying ids the analysis wrote fails before it reaches the site.
 *
 * The uniqueness check is not redundant behind the derivation check: distinct content can still hash
 * to one id, and that case has to fail on the property the dashboard needs rather than on the
 * property the schema happens to describe.
 */
export function validateInsightIds(snapshot: { aiInsights: AiInsight[] }): void {
  const seen = new Set<string>();
  for (const insight of snapshot.aiInsights) {
    const expected = deriveInsightId(insight);
    if (insight.id !== expected) {
      throw new Error(
        `Insight "${insight.id}" field id must be "${expected}", derived from the insight's own content. id identifies an insight and is derived from the snapshot, not written by the analysis.`
      );
    }
    if (seen.has(insight.id)) {
      throw new Error(
        `Insight id "${insight.id}" appears more than once. The dashboard keys insight cards by id, so publishing both would render one card and drop the other.`
      );
    }
    seen.add(insight.id);
  }
}
