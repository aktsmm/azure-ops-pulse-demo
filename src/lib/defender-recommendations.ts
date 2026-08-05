import type { SecurityRecommendation, Severity } from "../data/contracts";

export const WITHHELD_RECOMMENDATION_TITLE = "Defender の推奨事項（タイトル非公開）";

/**
 * A Defender assessment display name is the only free text the Azure collector ever receives that a
 * person outside Microsoft may have written. Operators create assessments through
 * `PUT /subscriptions/{id}/providers/Microsoft.Security/assessmentMetadata/{key}`, where both
 * `displayName` and `assessmentType` are caller-supplied request fields and `assessmentType`
 * accepts `BuiltIn`. Provenance therefore cannot be established from anything the API returns:
 * a custom assessment can claim to be Microsoft-authored and carry a project codename, a person's
 * name, or a hostname that appears nowhere else in the snapshot for a mask to recognise.
 *
 * https://learn.microsoft.com/rest/api/defenderforcloud/assessments-metadata/create-in-subscription
 *
 * So the collector publishes no Azure-authored title at all. Distinct assessments stay distinct
 * rows — severity and affected counts are still useful — but the label is a repository constant
 * plus an ordinal, which keeps the published alphabet closed by construction.
 *
 * Republishing the genuine Microsoft built-in titles would need a checked-in catalogue of reviewed
 * strings, published verbatim from the repository rather than echoed from the API. That is a
 * product decision with an ongoing maintenance cost, so it is left to the repository owner.
 */
export function withheldRecommendationTitle(ordinal: number): string {
  return `${WITHHELD_RECOMMENDATION_TITLE} #${ordinal}`;
}

export interface DefenderAssessmentRow {
  properties?: {
    displayName?: string;
    status?: { severity?: string; code?: string };
  };
}

type RecommendationSeverity = Extract<Severity, "info" | "warning" | "critical">;

const SEVERITY_RANK: Record<RecommendationSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2
};

interface AssessmentGroup {
  key: string;
  severity: RecommendationSeverity;
  affectedCount: number;
  open: boolean;
}

/**
 * `Healthy` and `NotApplicable` assessments are not findings, so they contribute a row without
 * inflating the affected count. Any other status code — including `Unknown` — is treated as open,
 * because reporting an unevaluated resource as resolved would be the same class of lie this
 * dashboard exists to avoid.
 */
function isOpenAssessment(code: string | undefined): boolean {
  return code !== "Healthy" && code !== "NotApplicable";
}

function assessmentSeverity(row: DefenderAssessmentRow, open: boolean): RecommendationSeverity {
  if (!open) return "info";
  const severity = row.properties?.status?.severity?.toLowerCase();
  if (severity === "high") return "critical";
  if (severity === "medium") return "warning";
  return "info";
}

/**
 * Groups assessment rows by their raw display name so that one recommendation stays one row, then
 * discards the name. The grouping key never leaves this function.
 */
export function summarizeAssessments(
  rows: readonly DefenderAssessmentRow[],
  limit = 12
): SecurityRecommendation[] {
  const groups = new Map<string, AssessmentGroup>();
  for (const row of rows) {
    const key = row.properties?.displayName?.trim() ?? "";
    const open = isOpenAssessment(row.properties?.status?.code);
    const severity = assessmentSeverity(row, open);
    const current = groups.get(key);
    if (!current) {
      groups.set(key, { key, severity, affectedCount: open ? 1 : 0, open });
      continue;
    }
    groups.set(key, {
      key,
      severity: SEVERITY_RANK[severity] > SEVERITY_RANK[current.severity] ? severity : current.severity,
      affectedCount: current.affectedCount + (open ? 1 : 0),
      open: current.open || open
    });
  }

  // Ordinals are positional, so the order has to be a total order or the published titles would
  // shuffle between runs on ties. The key is the final tiebreaker and is never published.
  return [...groups.values()]
    .sort(
      (a, b) =>
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        b.affectedCount - a.affectedCount ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
    )
    .slice(0, Math.max(0, limit))
    .map((group, index) => ({
      title: withheldRecommendationTitle(index + 1),
      severity: group.severity,
      affectedCount: group.affectedCount,
      status: group.open ? ("Open" as const) : ("Resolved" as const)
    }));
}
