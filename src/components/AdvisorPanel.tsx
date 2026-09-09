import { useState } from "react";
import { ExternalLink, Info, ShieldCheck } from "lucide-react";
import type { Availability } from "../data/contracts";

export interface AdvisorRecommendationView {
  category: string;
  impact: string;
  count: number;
}

const CATEGORIES: Record<string, string> = {
  Security: "セキュリティ", Cost: "コスト", HighAvailability: "信頼性",
  Performance: "パフォーマンス", OperationalExcellence: "オペレーショナル エクセレンス",
  Other: "その他"
};
const IMPACTS: Record<string, string> = { High: "高", Medium: "中", Low: "低", Unknown: "不明" };
const IMPACT_ORDER: Record<string, number> = { High: 0, Medium: 1, Low: 2, Unknown: 3 };

export function AdvisorPanel({ availability, recommendations = [], diagnosis }: {
  availability?: Availability;
  recommendations?: AdvisorRecommendationView[];
  diagnosis?: string;
}) {
  const [category, setCategory] = useState("Security");
  const available = availability !== undefined && availability !== "unavailable";
  const filtered = recommendations.filter((item) => category === "all" || item.category === category)
    .sort((a, b) => (IMPACT_ORDER[a.impact] ?? 4) - (IMPACT_ORDER[b.impact] ?? 4) || b.count - a.count);
  const total = recommendations.reduce((sum, item) => sum + item.count, 0);
  const security = recommendations.filter((item) => item.category === "Security").reduce((sum, item) => sum + item.count, 0);
  const high = recommendations.filter((item) => item.impact === "High").reduce((sum, item) => sum + item.count, 0);
  return (
    <section className="panel advisor-panel" aria-labelledby="advisor-title">
      <header className="panel-header">
        <div><h2 id="advisor-title">Azure Advisor の推奨事項</h2><p>カテゴリと影響度別の集計です。Defender とは別の収集結果として表示し、件数を合算しません。</p></div>
        <span className="status-badge">{availability === "available" ? "収集済み" : availability === "partial" ? "一部収集" : "未収集"}</span>
      </header>
      {available ? (
        <>
          <div className="advisor-metrics">
            {[["推奨事項の合計", total], ["セキュリティ", security], ["影響度「高」（全カテゴリ）", high]].map(([label, count]) => (
              <article key={label}><small>{label}</small><strong>{count} 件</strong></article>
            ))}
          </div>
          <div className="table-toolbar">
            <label className="select-label">
              <span>Advisor カテゴリ</span>
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="all">すべて</option>
                {Object.entries(CATEGORIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            <span className="result-count">{filtered.reduce((sum, item) => sum + item.count, 0)} 件{availability === "partial" ? "（取得できた範囲）" : ""}</span>
          </div>
          {filtered.length ? (
            <div className="recommendation-list">
              {filtered.map((item) => (
                <article className="recommendation-row" key={`${item.category}-${item.impact}`}>
                  <ShieldCheck size={20} aria-hidden="true" />
                  <div><strong>{CATEGORIES[item.category] ?? "その他"}</strong><p>該当する推奨事項 {item.count} 件</p></div>
                  <span className={`status-badge severity-${item.impact === "High" ? "warning" : "info"}`}>影響度 {IMPACTS[item.impact] ?? "不明"}</span>
                </article>
              ))}
            </div>
          ) : (
            <p className="source-footnote"><Info size={16} aria-hidden="true" /><span>このカテゴリで収集された推奨事項は 0 件です。安全性の保証ではなく、取得できた範囲の結果です。</span></p>
          )}
          <p className="advisor-footnote">集計件数は推奨事項レコード数であり、対象リソースの重複を除いた件数ではありません。具体的な推奨内容・対象・例外は Azure portal の Advisor で確認してください。</p>
        </>
      ) : (
        <div className="advisor-unavailable">
          <Info size={20} aria-hidden="true" />
          <div><strong>Advisor の推奨事項は未収集です</strong><p>{diagnosis ?? "このスナップショットには Advisor の集計が含まれていません。新しい収集処理が実行されるまで、推奨事項なしとは判断できません。"}</p></div>
        </div>
      )}
      <a className="text-button" href="https://aka.ms/azureadvisordashboard" target="_blank" rel="noreferrer">
        Azure portal で Advisor を確認 <ExternalLink size={14} aria-hidden="true" />
      </a>
    </section>
  );
}
