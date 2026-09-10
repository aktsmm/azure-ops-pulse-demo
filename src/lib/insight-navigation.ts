import type { AiInsight, PublicSnapshotV1, Severity } from "../data/contracts";

export function insightAdvisorGroups(insight: AiInsight, data: PublicSnapshotV1) {
  const details = data.advisor?.details;
  if (data.advisor?.availability === "unavailable" || !details || details.availability === "unavailable") return [];
  const indices = new Set<number>();
  for (const evidence of insight.numericEvidence) {
    const match = /^advisor\.details\.groups\.(0|[1-9]\d*)\.(?:count|affectedResourceCount|impacts\.(?:High|Medium|Low|Unknown)|resourceTypes\.(?:0|[1-9]\d*)\.count)$/.exec(evidence.source);
    if (match) indices.add(Number(match[1]));
  }
  return [...indices].flatMap((index) => details.groups[index] ? [details.groups[index]!] : []);
}

export function insightTargets(insight: AiInsight, data: PublicSnapshotV1, basePath = "") {
  const groups = insightAdvisorGroups(insight, data);
  return groups.length
    ? groups.map((group) => ({
      href: `${basePath}/recommendations?group=${encodeURIComponent(group.id)}`,
      label: groups.length === 1 ? "関連する確認ガイドを開く" : `確認ガイド: ${group.title}`
    }))
    : [{ href: `${basePath}${insight.route}`, label: "関連するデータを開く" }];
}

export function prioritizeInsights(data: PublicSnapshotV1): AiInsight[] {
  const ranks: Record<Severity, number> = { critical: 3, warning: 2, info: 1, healthy: 0 };
  const impactRank = (insight: AiInsight) => Math.max(0, ...insightAdvisorGroups(insight, data).map((group) =>
    group.impacts.High > 0 ? 3 : group.impacts.Medium > 0 ? 2 : group.impacts.Low > 0 ? 1 : 0));
  return [...data.aiInsights].sort((a, b) =>
    ranks[b.severity] - ranks[a.severity] || impactRank(b) - impactRank(a));
}
