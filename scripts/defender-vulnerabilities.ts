import type { RawResource, VulnerabilityEvidence } from "../src/data/contracts";
import { resourceRef, normalizeResourceId } from "../src/lib/sanitize";
import { CollectionError } from "./collection-diagnostics";

// Unlike assessment severity, subassessment severity is documented under status.
// REST shape: 2019-01-01-preview; ARG collection does not call the preview REST endpoint.
// https://learn.microsoft.com/ja-jp/rest/api/defenderforcloud/sub-assessments/list-all?view=rest-defenderforcloud-2019-01-01-preview
export const VULNERABILITY_QUERY = "SecurityResources | where type =~ 'microsoft.security/assessments/subassessments' | project id, properties | order by id asc";
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function unavailableVulnerabilities(): VulnerabilityEvidence {
  return {
    availability: "unavailable", message: "脆弱性のサブ評価は取得できませんでした。ゼロ件・安全とは判定していません。",
    totalSubAssessments: null, unhealthySubAssessments: null, unmappedSubAssessments: null,
    unmappedTargetSubAssessments: null,
    unknownStatusSubAssessments: null, totalFindings: null, truncated: false, findings: []
  };
}

export function collectVulnerabilities(
  query: <T>(query: string) => T[],
  inventory: readonly RawResource[]
): VulnerabilityEvidence {
  try {
    const rows = query<{ id?: unknown; properties?: unknown }>(VULNERABILITY_QUERY);
    const known = new Map(inventory.map((item) => [normalizeResourceId(item.id), item]));
    const seen = new Set<string>();
    const groups = new Map<string, { finding: VulnerabilityEvidence["findings"][number]; refs: Set<string>; patchable: boolean | undefined }>();
    let unhealthy = 0;
    let unknown = 0;
    let unmapped = 0;
    let missingTarget = 0;
    for (const row of rows) {
      if (typeof row?.id !== "string" || !row.id || !row.properties || typeof row.properties !== "object" || Array.isArray(row.properties) ||
          seen.has(row.id.toLowerCase())) throw new CollectionError("invalid-response");
      seen.add(row.id.toLowerCase());
      const p = object(row.properties);
      const status = object(p.status);
      if (!["Healthy", "Unhealthy", "NotApplicable"].includes(String(status.code))) { unknown += 1; continue; }
      if (status.code !== "Unhealthy") continue;
      unhealthy += 1;
      const data = object(p.additionalData);
      const cves = [...new Set((Array.isArray(data.cve) ? data.cve : [])
        .map((item) => object(item).title).filter((value): value is string => typeof value === "string" && /^CVE-\d{4}-\d{4,7}$/.test(value)))];
      if (!cves.length) { unmapped += 1; continue; }
      const details = object(p.resourceDetails);
      const target = details.source === "Azure" && typeof details.id === "string"
        ? known.get(normalizeResourceId(details.id)) : undefined;
      const ref = target ? resourceRef(target.id) : undefined;
      if (!target) missingTarget += 1;
      const severity = ["High", "Medium", "Low"].includes(String(status.severity))
        ? status.severity as "High" | "Medium" | "Low" : "Unknown";
      const cvss = object(data.cvss);
      const score = object(cvss["3.0"]).base ?? object(cvss["2.0"]).base;
      const validScore = typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 10 ? score : undefined;
      for (const cve of cves) {
        const key = `${cve}:${severity}`;
        const state = groups.get(key) ?? { finding: { cve, severity, resourceRefs: [] }, refs: new Set<string>(), patchable: typeof data.patchable === "boolean" ? data.patchable : undefined };
        if (ref) state.refs.add(ref);
        if (validScore !== undefined) state.finding.cvssScore = Math.max(state.finding.cvssScore ?? 0, validScore);
        if (typeof data.patchable !== "boolean" || state.patchable === undefined) state.patchable = undefined;
        else state.patchable = state.patchable && data.patchable;
        groups.set(key, state);
      }
    }
    const truncated = groups.size > 100 || [...groups.values()].some((group) => group.refs.size > 100);
    const rank = { High: 3, Medium: 2, Low: 1, Unknown: 0 };
    const findings = [...groups.values()].sort((a, b) => rank[b.finding.severity] - rank[a.finding.severity] || a.finding.cve.localeCompare(b.finding.cve))
      .slice(0, 100).map(({ finding, refs, patchable }) => ({
        ...finding, resourceRefs: [...refs].sort().slice(0, 100), ...(patchable !== undefined ? { patchable } : {})
      }));
    return {
      availability: truncated || unknown || unmapped || missingTarget ? "partial" : "available",
      message: "取得した Unhealthy サブ評価の CVE のみ表示します。非 CVE 評価・未取得の対象・未知の状態は収集範囲に含めます。ゼロ件は安全の証明ではありません。",
      totalSubAssessments: rows.length, unhealthySubAssessments: unhealthy, unmappedSubAssessments: unmapped,
      unmappedTargetSubAssessments: missingTarget,
      unknownStatusSubAssessments: unknown, totalFindings: groups.size, truncated, findings
    };
  } catch {
    return unavailableVulnerabilities();
  }
}
