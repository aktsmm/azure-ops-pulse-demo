import type { AdvisorRecommendationGroup, ResourceItem } from "../data/contracts";
import { resourceTypeLabel } from "../lib/resource-catalog";

export function AdvisorTargetResources({ group, resources, onSelect }: {
  group: AdvisorRecommendationGroup;
  resources: ResourceItem[];
  onSelect?: (resource: ResourceItem) => void;
}) {
  const refs = group.resourceRefs;
  const inventory = new Map(resources.map((resource) => [resource.id, resource]));
  const metadata = new Map(group.targets?.map((target) => [target.resourceRef, target]) ?? []);
  return (
    <details className="advisor-target-resources">
      <summary>{refs === undefined ? "対象リソースの対応付けは未収集" : `対象リソースの公開参照 ${refs.length} 件を見る`}</summary>
      {refs === undefined ? (
        <p>この公開データでは対象リソースの個別の対応付けを確認できません。同じ種別のインベントリを対象と推定せず、Azure portal で対象を確認してください。</p>
      ) : (
        <>
          {group.targetCoverage && (
            <p>識別できた対象 {group.targetCoverage.totalResources} 件 / 公開参照 {group.targetCoverage.publishedResources} 件 / 収集インベントリとの対応未確認 {group.targetCoverage.unresolvedResources} 件。
              {group.targetCoverage.truncated && " 公開件数の上限により一部を省略しています。"}</p>
          )}
          {refs.length ? (
            <ul>
              {refs.map((ref) => {
                const resource = inventory.get(ref);
                const target = metadata.get(ref);
                return (
                  <li key={ref}>
                    {resource && onSelect ? (
                      <button type="button" className="text-button" onClick={() => onSelect(resource)}>{resource.name}の詳細を開く</button>
                    ) : <strong>{resource?.name ?? ref}</strong>}
                    <span>{resource ? `${resourceTypeLabel(resource.type)} · ${resource.region}`
                      : `インベントリ詳細なし${target?.type ? ` · ${resourceTypeLabel(target.type)}` : ""}${target?.region ? ` · ${target.region}` : ""}`}</span>
                  </li>
                );
              })}
            </ul>
          ) : group.scopeCounts && group.scopeCounts.subscription > 0 &&
            group.scopeCounts.resource === 0 && group.scopeCounts.unknown === 0 &&
            !group.targetCoverage?.unresolvedResources ? (
              <p>サブスクリプション単位の推奨です。個別リソースの参照を持たないため、この一覧からリソース詳細は開けません。</p>
            ) : <p>公開できる対象参照はありません。対象リソースがないことや対応不要を意味しません。</p>}
          <p>公開 ID が一致する対象だけを関連付けています。種別・リージョンが同じだけのリソースは含めません。</p>
        </>
      )}
      {group.scopeCounts && <p>推奨レコードの対象スコープ: リソース {group.scopeCounts.resource} 件 / サブスクリプション {group.scopeCounts.subscription} 件 / 不明 {group.scopeCounts.unknown} 件。リソースの重複排除件数とは異なります。</p>}
    </details>
  );
}
