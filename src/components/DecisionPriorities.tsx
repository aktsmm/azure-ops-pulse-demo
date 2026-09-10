import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { PublicSnapshotV1 } from "../data/contracts";
import { routeLabel, severityLabel } from "../lib/display-formatters";
import { insightTargets, prioritizeInsights } from "../lib/insight-navigation";

export function DecisionPriorities({ data, basePath = "" }: { data: PublicSnapshotV1; basePath?: string }) {
  const insights = prioritizeInsights(data).slice(0, 3);
  return (
    <section className="decision-priorities" aria-labelledby="decision-title">
      <header className="decision-heading">
        <div>
          <p className="eyebrow">公開スナップショットから、次に確認すること</p>
          <h2 id="decision-title">優先確認アクション</h2>
          <details className="decision-order">
            <summary>表示順の基準</summary>
            <p>AI 分析の重要度、同順位は根拠の Advisor 影響度順。変更は人が判断します。</p>
          </details>
        </div>
      </header>
      {insights.length ? (
        <div className="decision-grid">
          {insights.map((insight, index) => (
            <article className={`decision-card decision-${insight.severity}`} key={insight.id}>
              <div className="badge-row">
                <span className="decision-rank">{index + 1}</span>
                <span className={`status-badge severity-${insight.severity}`}>{severityLabel(insight.severity)}</span>
                <span className="decision-domain">AI 分析 · {routeLabel(insight.route)}</span>
              </div>
              <h3>{insight.title}</h3>
              <div className="decision-primary-links">
                {insightTargets(insight, data, basePath).map((target) =>
                  <Link key={target.href} className="text-button" to={target.href}>{target.label} <ChevronRight size={15} aria-hidden="true" /></Link>
                )}
              </div>
              <div className="decision-reason"><strong>確認する理由 · 想定される影響</strong><p>{insight.impact}</p></div>
              <div className="decision-action"><strong>次の確認</strong><p>{insight.recommendedAction}</p></div>
              <details className="decision-impact">
                <summary>観測の詳細</summary>
                <p>{insight.observation}</p>
              </details>
              <footer>
                <Link className="decision-evidence-link" to={`${basePath}/ai-insights?insight=${encodeURIComponent(insight.id)}`}>分析と数値根拠</Link>
              </footer>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <strong>公開済みの AI 分析はありません</strong>
          <p>公開条件を満たす分析がないため、優先アクションを生成していません。問題なしを意味しません。</p>
          <Link to={`${basePath}/recommendations`}>ルールベースの確認ガイドを見る</Link>
        </div>
      )}
      <Link className="text-button decision-all-link" to={`${basePath}/ai-insights`}>AI 分析をすべて見る <ChevronRight size={15} aria-hidden="true" /></Link>
    </section>
  );
}
