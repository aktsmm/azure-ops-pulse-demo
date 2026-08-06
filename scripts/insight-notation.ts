/**
 * Notation repairs for the machine-checked fields the analysis writes.
 *
 * `period` was the first field this pipeline took away from the model, because the snapshot already
 * decided it. These fields are different: the model does decide them, but the *spelling* it has to
 * use is decided by a schema it never sees. When the prompt leaves a spelling unstated, each run is
 * a fresh draw.
 *
 * Run 31071772340 drew badly. The prompt said `source` must be "an exact dot path" and said nothing
 * about array elements, so the analysis wrote `cost.categories[0].sharePercent` — the notation every
 * JSON and JavaScript habit points at — and three of ten evidence paths failed
 * `^(overview|cost|...)(\.[A-Za-z0-9_-]+)+$` before any other gate ran. The values behind them were
 * real and correct; `cost.categories.0.sharePercent` is the same pointer written the other way. The
 * run before it had happened not to cite an array element at all, which is why the pipeline had
 * looked fine.
 *
 * So this module rewrites notation, and only notation. Every repair here obeys the same rule: apply
 * the canonical spelling, and keep it only if the result lands exactly on a value the schema already
 * allows. Anything else is left exactly as the analysis wrote it, so the schema still rejects it and
 * the run still says so. A repair that had to choose between meanings would be inventing analysis —
 * `"confidence": 78` could be 78% or a plain mistake, and this module refuses to decide.
 *
 * Nothing here weakens a gate. `validatePublicJsonSchema` still applies the same pattern, and
 * `validateNumericEvidence` still resolves every path and compares it against the scalar it finds,
 * so a rewritten path that points nowhere — or somewhere else — fails exactly as it did before.
 */

/** Mirrors `numericEvidence[].source` in the published JSON Schema; `insight-notation.test.ts` fails if they drift apart. */
export const EVIDENCE_SOURCE_PATTERN =
  /^(overview|cost|inventory|reliability|security|network)(\.[A-Za-z0-9_-]+)+$/;

/** Mirrors the `severity` enum in the published JSON Schema. */
export const INSIGHT_SEVERITIES = ["critical", "warning", "healthy", "info"] as const;

/** Mirrors the `route` enum in the published JSON Schema. */
export const INSIGHT_ROUTES = [
  "/overview",
  "/cost",
  "/resources",
  "/reliability",
  "/security",
  "/network",
  "/ai-insights"
] as const;

export interface InsightNotationCounts {
  evidenceSources: number;
  severities: number;
  routes: number;
  confidences: number;
  evidenceValues: number;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `cost.categories[0].sharePercent` -> `cost.categories.0.sharePercent`.
 *
 * Returns `null` — meaning "leave it alone" — for anything that is not purely a spelling difference:
 *
 * - `cost.categories[first]` keeps a name inside brackets. There is no index to move, and guessing
 *   which element was meant would publish a citation nobody wrote.
 * - `cost.categories[0][1]` indexes an index. Nothing in this snapshot is an array of arrays, so the
 *   shape is unexpected rather than misspelled, and an unexpected shape should surface as a failure.
 * - `[0].cost` and other rewrites that still miss the pattern are returned unchanged, so the schema
 *   reports the path the analysis actually wrote instead of a half-repaired one.
 */
export function normalizeEvidenceSourceNotation(source: string): string | null {
  if (/\]\s*\[/.test(source)) return null;
  const rewritten = source.replace(/\[(\d+)\]/g, ".$1");
  if (rewritten === source) return null;
  return EVIDENCE_SOURCE_PATTERN.test(rewritten) ? rewritten : null;
}

/**
 * `Critical` -> `critical`. Case is the only difference this accepts: it folds case and then
 * requires the result to be one of the four values the schema lists. `high`, `medium` and `low` come
 * from a severity scale this dashboard does not have, so they are left to fail — mapping them onto
 * these four would be picking a severity the analysis did not pick.
 */
export function normalizeSeverityNotation(severity: string): string | null {
  const canonical = severity.trim().toLowerCase();
  if (canonical === severity) return null;
  return (INSIGHT_SEVERITIES as readonly string[]).includes(canonical) ? canonical : null;
}

/**
 * `/Cost`, `cost` and `/cost/` all name the one route `/cost`. A route that is not on the list after
 * that — `/costs`, `/dashboard` — is a page this dashboard does not serve, so it is left to fail
 * rather than redirected to whichever route looks closest.
 */
export function normalizeRouteNotation(route: string): string | null {
  const trimmed = route.trim().toLowerCase().replace(/\/+$/, "");
  const canonical = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (canonical === route) return null;
  return (INSIGHT_ROUTES as readonly string[]).includes(canonical) ? canonical : null;
}

/**
 * `"0.78"` -> `0.78`. JSON has a number type and the model sometimes quotes it anyway; the digits
 * are identical either way.
 *
 * `78` and `"78%"` are not repaired. Both plainly mean "78 percent" to a reader, and that is exactly
 * the problem: turning them into `0.78` is a second opinion about what the analysis meant, and it
 * would be indistinguishable from a run that genuinely reported a confidence of 78 on a 0-1 scale.
 * The schema rejects them and the run says which insight did it.
 */
export function normalizeConfidenceNotation(confidence: unknown): number | null {
  if (typeof confidence !== "string") return null;
  const trimmed = confidence.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null;
}

/**
 * `72.7` -> `"72.7"`. `value` is the rendered citation, so the schema types it as a string, but a
 * model reading a number out of the snapshot has an obvious reason to hand back a number. The digits
 * survive the conversion untouched, and `validateNumericEvidence` still has to match them against
 * the scalar at `source`.
 */
export function normalizeEvidenceValueNotation(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}

/**
 * Applies every notation repair to a raw parsed snapshot, in place, and reports what it had to
 * change. Runs before schema validation, because the whole point is that these values do not satisfy
 * the schema yet.
 */
export function normalizeAiInsightNotation(snapshot: unknown): InsightNotationCounts {
  if (!isRecord(snapshot) || !Array.isArray(snapshot.aiInsights)) {
    throw new Error("Snapshot must contain an aiInsights array.");
  }

  const counts: InsightNotationCounts = {
    evidenceSources: 0,
    severities: 0,
    routes: 0,
    confidences: 0,
    evidenceValues: 0
  };

  for (const [index, insight] of snapshot.aiInsights.entries()) {
    if (!isRecord(insight)) {
      throw new Error(`aiInsights.${index} must be an insight object.`);
    }

    if (typeof insight.severity === "string") {
      const severity = normalizeSeverityNotation(insight.severity);
      if (severity !== null) {
        insight.severity = severity;
        counts.severities += 1;
      }
    }

    if (typeof insight.route === "string") {
      const route = normalizeRouteNotation(insight.route);
      if (route !== null) {
        insight.route = route;
        counts.routes += 1;
      }
    }

    const confidence = normalizeConfidenceNotation(insight.confidence);
    if (confidence !== null) {
      insight.confidence = confidence;
      counts.confidences += 1;
    }

    if (!Array.isArray(insight.numericEvidence)) continue;
    for (const evidence of insight.numericEvidence) {
      if (!isRecord(evidence)) continue;

      if (typeof evidence.source === "string") {
        const source = normalizeEvidenceSourceNotation(evidence.source);
        if (source !== null) {
          evidence.source = source;
          counts.evidenceSources += 1;
        }
      }

      const value = normalizeEvidenceValueNotation(evidence.value);
      if (value !== null) {
        evidence.value = value;
        counts.evidenceValues += 1;
      }
    }
  }

  return counts;
}

export function totalNotationRepairs(counts: InsightNotationCounts): number {
  return Object.values(counts).reduce((total, count) => total + count, 0);
}

export function describeNotationRepairs(counts: InsightNotationCounts): string {
  return [
    `${counts.evidenceSources} evidence path(s)`,
    `${counts.evidenceValues} evidence value(s)`,
    `${counts.severities} severity value(s)`,
    `${counts.routes} route(s)`,
    `${counts.confidences} confidence value(s)`
  ].join(", ");
}
