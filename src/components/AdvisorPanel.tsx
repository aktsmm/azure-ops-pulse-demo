import { useState } from "react";
import { ExternalLink, Info } from "lucide-react";
import type { AdvisorDetails, AdvisorRecommendationGroup, Availability } from "../data/contracts";
import { resourceTypeLabel } from "../lib/resource-catalog";

export interface AdvisorRecommendationView {
  category: string;
  impact: string;
  count: number;
}

const ADVISOR_CATEGORIES: Record<string, string> = {
  Security: "セキュリティ", Cost: "コスト", HighAvailability: "信頼性",
  Performance: "パフォーマンス", OperationalExcellence: "オペレーショナル エクセレンス",
  Other: "未分類"
};
const IMPACTS: Record<string, string> = { High: "高", Medium: "中", Low: "低", Unknown: "不明" };
const IMPACT_ORDER: Record<string, number> = { High: 0, Medium: 1, Low: 2, Unknown: 3 };
const PORTAL_URL = "https://aka.ms/azureadvisordashboard";

function groupImpactCount(group: AdvisorRecommendationGroup, impact: string): number {
  return impact === "all" ? group.count : group.impacts[impact as keyof typeof group.impacts] ?? 0;
}

function RecommendationCard({ group, impact }: { group: AdvisorRecommendationGroup; impact: string }) {
  const mapped = group.contentStatus === "mapped";
  return (
    <article className="advisor-detail-card">
      <header>
        <div>
          <p className="eyebrow">{ADVISOR_CATEGORIES[group.category] ?? "未分類"}</p>
          <h3>{mapped ? group.title : "未分類・内容未確認の推奨事項"}</h3>
        </div>
        <span className="status-badge">{mapped ? "内容を分類済み" : "内容未確認"}</span>
      </header>
      <div className="advisor-detail-counts">
        <strong>推奨事項レコード {group.count} 件</strong>
        {impact !== "all" && <span>選択した影響度に一致: {groupImpactCount(group, impact)} レコード</span>}
        <span>対象リソース（グループ内の重複を除く）: {group.affectedResourceCount === null ? "未確認" : `${group.affectedResourceCount} 件`}</span>
      </div>
      <div className="tag-list" aria-label="グループ全体の影響度内訳">
        {Object.entries(IMPACTS).filter(([key]) => groupImpactCount(group, key) > 0).map(([key, label]) => (
          <span key={key} className={`status-badge severity-${key === "High" ? "warning" : "info"}`}>影響度 {label} {groupImpactCount(group, key)} 件</span>
        ))}
      </div>
      {mapped ? (
        <>
          <p><strong>確認する理由: </strong>{group.description}</p>
          <dl className="advisor-guide">
            <div><dt>次の確認・アクション</dt><dd>{group.recommendedAction}</dd></div>
          </dl>
          <details className="advisor-rollup">
            <summary>デモ用途での保留判断・前提を見る</summary>
            <dl className="advisor-guide">
              <div><dt>条件付きで保留を検討する場合</dt><dd>{group.deferWhen}</dd></div>
              <div><dt>判断前の確認・制約</dt><dd>{group.caveat}</dd></div>
            </dl>
            <p className="advisor-footnote">保留条件はこの環境で確認されていません。デモ用途でも、残したいデータや停止を避けたい時間があるか確認して判断します。</p>
          </details>
        </>
      ) : (
        <p>公開可能なカタログに一致しないため、具体的な内容は未確認です。低リスクや対応不要とは扱いません。Azure portal で内容と対象を確認してください。</p>
      )}
      {group.resourceTypes.length > 0 && (
        <p className="advisor-footnote">リソース種別別のレコード数: {group.resourceTypes.map((item) => `${resourceTypeLabel(item.type)} ${item.count} 件`).join("・")}</p>
      )}
      <p className="advisor-footnote">件数と対象リソース数はグループ全体の値です。同じリソースが複数グループに含まれるため、グループ間のリソース数は合算できません。</p>
      <div className="advisor-detail-links">
        {mapped && <a className="text-button" href={group.sourceUrl} target="_blank" rel="noreferrer">確認ガイドの出典 <ExternalLink size={14} aria-hidden="true" /></a>}
        <a className="text-button" href={PORTAL_URL} target="_blank" rel="noreferrer">Azure portal で内容と対象を確認 <ExternalLink size={14} aria-hidden="true" /></a>
      </div>
    </article>
  );
}

export function AdvisorPanel({
  availability, recommendations = [], diagnosis, categoryScope, selectedCategory, onCategoryChange, details
}: {
  availability?: Availability;
  recommendations?: AdvisorRecommendationView[];
  diagnosis?: string;
  categoryScope?: string;
  selectedCategory?: string;
  onCategoryChange?: (category: string) => void;
  details?: AdvisorDetails;
}) {
  const [localCategory, setLocalCategory] = useState("all");
  const [impact, setImpact] = useState("all");
  const [search, setSearch] = useState("");
  const category = categoryScope ?? selectedCategory ?? localCategory;
  const available = availability !== undefined && availability !== "unavailable";
  const scoped = recommendations.filter((item) => !categoryScope || item.category === categoryScope);
  const filtered = scoped.filter((item) =>
    (category === "all" || item.category === category) && (impact === "all" || item.impact === impact));
  const total = scoped.reduce((sum, item) => sum + item.count, 0);
  const filteredTotal = filtered.reduce((sum, item) => sum + item.count, 0);
  const detailsAvailable = details !== undefined && details.availability !== "unavailable";
  const allGroups = detailsAvailable ? details.groups : [];
  const scopedGroups = allGroups.filter((group) => !categoryScope || group.category === categoryScope);
  const scopedGroupCount = scopedGroups.reduce((sum, group) => sum + group.count, 0);
  const mappedCount = scopedGroups.filter((group) => group.contentStatus === "mapped").reduce((sum, group) => sum + group.count, 0);
  const withheldCount = scopedGroups.filter((group) => group.contentStatus !== "mapped").reduce((sum, group) => sum + group.count, 0);
  const allCount = recommendations.reduce((sum, item) => sum + item.count, 0);
  const groupCount = allGroups.reduce((sum, group) => sum + group.count, 0);
  const totalsMatch = detailsAvailable &&
    groupCount + details.excludedRecommendationCount === allCount &&
    allGroups.filter((group) => group.contentStatus === "mapped").reduce((sum, group) => sum + group.count, 0) === details.mappedRecommendationCount &&
    allGroups.filter((group) => group.contentStatus === "withheld").reduce((sum, group) => sum + group.count, 0) === details.withheldRecommendationCount &&
    allGroups.every((group) => Object.values(group.impacts).reduce((sum, count) => sum + count, 0) === group.count) &&
    allGroups.every((group) => Object.keys(IMPACTS).every((level) =>
      allGroups.filter((item) => item.category === group.category).reduce((sum, item) => sum + groupImpactCount(item, level), 0) <=
      recommendations.filter((item) => item.category === group.category && item.impact === level).reduce((sum, item) => sum + item.count, 0)));
  const query = search.trim().toLocaleLowerCase("ja-JP");
  const filteredGroups = scopedGroups.filter((group) =>
    (category === "all" || group.category === category) && groupImpactCount(group, impact) > 0 &&
    (!query || [
      group.contentStatus === "mapped" ? group.title : "未分類 内容未確認",
      group.contentStatus === "mapped" ? `${group.description} ${group.recommendedAction} ${group.deferWhen} ${group.caveat}` : "",
      ADVISOR_CATEGORIES[group.category] ?? "未分類",
      ...group.resourceTypes.map((item) => resourceTypeLabel(item.type))
    ].join(" ").toLocaleLowerCase("ja-JP").includes(query))
  ).sort((a, b) => b.impacts.High - a.impacts.High || b.impacts.Medium - a.impacts.Medium || b.count - a.count || a.id.localeCompare(b.id));
  const rollup = [...new Set(filtered.map((item) => item.category))].map((key) => {
    const rows = filtered.filter((item) => item.category === key);
    return {
      category: key, total: rows.reduce((sum, item) => sum + item.count, 0),
      impacts: Object.keys(IMPACT_ORDER).map((level) =>
        rows.filter((item) => item.impact === level).reduce((sum, item) => sum + item.count, 0))
    };
  }).sort((a, b) => b.impacts[0]! - a.impacts[0]! || b.total - a.total);

  return (
    <section className="panel advisor-panel" aria-labelledby="advisor-title">
      <header className="panel-header">
        <div>
          <h2 id="advisor-title">Azure Advisor の推奨事項</h2>
          <p>{categoryScope ? `${ADVISOR_CATEGORIES[categoryScope] ?? "未分類"}カテゴリのみ。` : "全カテゴリの推奨内容を確認できます。"}Defender の評価とは別の収集結果で、件数を合算しません。</p>
        </div>
        <span className="status-badge">{availability === "available" ? "収集済み" : availability === "partial" ? "一部収集" : "未収集"}</span>
      </header>
      {available ? (
        <>
          <div className="advisor-metrics">
            {detailsAvailable ? (
              <>
                <article><small>完了・却下・延期を除いた確認候補</small><strong>{scopedGroupCount} レコード</strong><span>内容分類済み {mappedCount} / 内容未確認 {withheldCount}</span></article>
                <article><small>完了・却下・延期による除外</small><strong>{totalsMatch ? `${total - scopedGroupCount} レコード` : "照合が必要"}</strong><span>未解決の問題として数えません</span></article>
              </>
            ) : (
              <article><small>{categoryScope ? "このカテゴリの収集件数" : "全カテゴリの収集件数"}</small><strong>推奨事項レコード {total} 件</strong></article>
            )}
            {detailsAvailable && !categoryScope && (
              <article><small>詳細対象のリソース（全グループの重複を除く）</small><strong>{details.affectedResourceCount === null ? "未確認" : `${details.affectedResourceCount} 件`}</strong></article>
            )}
          </div>
          <p className="advisor-footnote">集計件数は推奨事項レコード数であり、対象リソースの重複を除いた件数ではありません。影響度は Advisor の分類で、業務上の優先順位や対応不要の判定ではありません。</p>
          <div className="table-toolbar">
            {!categoryScope && (
              <label className="select-label">
                <span>Advisor カテゴリ</span>
                <select value={category} onChange={(event) => {
                  setLocalCategory(event.target.value);
                  onCategoryChange?.(event.target.value);
                }}>
                  <option value="all">すべて</option>
                  {Object.entries(ADVISOR_CATEGORIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </label>
            )}
            <label className="select-label">
              <span>Advisor 影響度</span>
              <select value={impact} onChange={(event) => setImpact(event.target.value)}>
                <option value="all">すべて</option>
                {Object.entries(IMPACTS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            <span className="result-count" role="status">{detailsAvailable
              ? `${filteredGroups.reduce((sum, group) => sum + groupImpactCount(group, impact), 0)} 確認候補レコード`
              : `${filteredTotal} 全状態のレコード`}{availability === "partial" ? "（取得できた範囲）" : ""}</span>
          </div>
          <details className="advisor-rollup-disclosure" open={!detailsAvailable}>
            <summary>全状態のカテゴリ集計を見る — {filteredTotal} レコード（完了・却下・延期を含む）</summary>
            {rollup.length ? (
              <div className="advisor-table-scroll">
              <table className="advisor-rollup">
                <caption>カテゴリ別集計（カテゴリ・影響度の選択範囲）</caption>
                <thead><tr><th scope="col">カテゴリ</th><th scope="col">レコード数</th>{Object.entries(IMPACTS).map(([key, label]) => <th scope="col" key={key}>影響度 {label}</th>)}</tr></thead>
                <tbody>{rollup.map((row) => (
                  <tr key={row.category}>
                    <th scope="row">{ADVISOR_CATEGORIES[row.category] ?? "未分類"}</th>
                    <td>{row.total}</td>{row.impacts.map((count, index) => <td key={index}>{count}</td>)}
                  </tr>
                ))}</tbody>
              </table>
              </div>
            ) : (
              <p className="source-footnote"><Info size={16} aria-hidden="true" /><span>選択範囲で収集された推奨事項は 0 件です。安全性の保証ではなく、取得できた範囲の結果です。</span></p>
            )}
          </details>
          {detailsAvailable ? (
            <>
              <details className="advisor-detail-coverage" open={!totalsMatch}>
                <summary>内容詳細の公開範囲・件数照合{categoryScope ? "（このカテゴリ）" : "（全カテゴリ）"}</summary>
                <p>詳細: {details.availability === "available" ? "収集済み" : "収集済み（一部項目は未確認）"}。内容を分類済み {mappedCount} レコード / 内容未確認 {withheldCount} レコード / 詳細に掲載 {scopedGroupCount} レコード。</p>
                {!categoryScope && <p>完了・却下・延期により詳細から除外: {details.excludedRecommendationCount} レコード。ライフサイクル未確認のまま掲載: {details.lifecycleUnknownCount} レコード。</p>}
                <p className="advisor-footnote">上のカテゴリ集計は全状態を含み、下の内容一覧は完了・却下・延期を除きます。掲載は対応の必要性を断定するものではありません。内容未確認は 0 件や低リスクを意味しません。</p>
                {totalsMatch ? (
                  <p className="advisor-footnote">{categoryScope
                    ? `件数照合: このカテゴリの集計 ${total} = 詳細掲載 ${scopedGroupCount} + 詳細から除外 ${total - scopedGroupCount} レコード。`
                    : `件数照合: カテゴリ集計 ${allCount} = 内容分類済み ${details.mappedRecommendationCount} + 内容未確認 ${details.withheldRecommendationCount} + 詳細から除外 ${details.excludedRecommendationCount} レコード。`}</p>
                ) : (
                  <p className="notice" role="alert">集計と詳細の件数が一致しません。内容カバレッジや全件性は判断できません。Azure portal と収集結果を確認してください。</p>
                )}
              </details>
              <div className="notice muted">
                <Info size={18} aria-hidden="true" />
                <span>ルールベースの確認ガイド: 公式推奨に基づく説明です。この環境の比較・優先順位は「AI 分析」で確認できます。</span>
              </div>
              <div className="table-toolbar">
                <label className="advisor-search">
                  <span>推奨内容を検索</span>
                  <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="内容・アクション・保留条件・種別" />
                </label>
                <span className="result-count" role="status">{filteredGroups.length} 内容グループ / 検索・フィルターに一致 {filteredGroups.reduce((sum, group) => sum + groupImpactCount(group, impact), 0)} レコード</span>
              </div>
              <p className="advisor-footnote">検索は下の内容一覧に適用します。上のカテゴリ集計と公開範囲は検索では変わりません。</p>
              {filteredGroups.length ? (
                <div className="advisor-detail-list">
                  {filteredGroups.map((group) => <RecommendationCard key={`${group.category}-${group.id}`} group={group} impact={impact} />)}
                </div>
              ) : (
                <p className="source-footnote">検索・フィルターに一致する内容グループはありません。未収集・非公開の内容や、詳細から除外されたレコードは検索できません。対応不要の判断ではありません。</p>
              )}
            </>
          ) : (
            <div className="advisor-unavailable">
              <Info size={20} aria-hidden="true" />
              <div><strong>内容詳細は未収集です</strong><p>このスナップショットには内容別の詳細がありません。レコードの集計を推奨内容に置き換えず、Azure portal で内容・対象・例外を確認してください。重複を除いた対象リソース数も未確認です。</p></div>
            </div>
          )}
        </>
      ) : (
        <div className="advisor-unavailable">
          <Info size={20} aria-hidden="true" />
          <div><strong>Advisor の推奨事項は未収集です</strong><p>{diagnosis ?? "このスナップショットには Advisor の集計が含まれていません。新しい収集処理が実行されるまで、推奨事項なしとは判断できません。"}</p></div>
        </div>
      )}
      <a className="text-button" href={PORTAL_URL} target="_blank" rel="noreferrer">
        Azure portal で Advisor を確認 <ExternalLink size={14} aria-hidden="true" />
      </a>
    </section>
  );
}
