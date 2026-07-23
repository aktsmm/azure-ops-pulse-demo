import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  Bot,
  Boxes,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Cloud,
  Coins,
  ExternalLink,
  Gauge,
  Menu,
  Network,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Workflow,
  X
} from "lucide-react";
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate
} from "react-router-dom";
import type {
  AiInsight,
  PublicSnapshotV1,
  ResourceItem,
  Severity
} from "./data/contracts";
import { ThemeToggle } from "./components/ThemeToggle";
import { useSnapshot } from "./hooks/useSnapshot";
import {
  availabilityLabel,
  availabilitySeverity,
  flowStatusLabel,
  flowStatusSeverity,
  formatActivityDetail,
  formatActivityTitle,
  formatCostDelta,
  formatDateTimeJa,
  formatEventTimestamp,
  formatSnapshotAge,
  formatSourceMessage,
  metricWhenSourceAvailable,
  modeLabel,
  recommendationStatusLabel,
  resourceStatusLabel,
  resourceStatusSeverity,
  routeLabel,
  severityLabel,
  summarizeResourceHealth
} from "./lib/display-formatters";

const NAV_ITEMS = [
  { path: "/overview", label: "概要", icon: Gauge },
  { path: "/cost", label: "コスト", icon: Coins },
  { path: "/resources", label: "リソース", icon: Boxes },
  { path: "/reliability", label: "信頼性", icon: Activity },
  { path: "/security", label: "セキュリティ", icon: ShieldCheck },
  { path: "/network", label: "ネットワーク", icon: Network },
  { path: "/ai-insights", label: "AI 分析", icon: Sparkles }
];

const TITLES: Record<string, { title: string; subtitle: string }> = {
  "/overview": {
    title: "運用概要",
    subtitle: "公開スナップショットで確認できる事実と、未収集の範囲を分けて表示します。"
  },
  "/cost": {
    title: "コスト",
    subtitle: "丸められた概算額と、比較可能な期間・サービス別の公開値です。"
  },
  "/resources": {
    title: "リソース インベントリ",
    subtitle: "サニタイズ済みの名前、リソース タイプ、リージョン、収集済み状態を確認します。"
  },
  "/reliability": {
    title: "信頼性",
    subtitle: "Resource Health の評価範囲を明示し、未評価の状態を異常として扱いません。"
  },
  "/security": {
    title: "セキュリティ",
    subtitle: "Defender for Cloud の集計値のみを表示し、資産や脆弱性の詳細は公開しません。"
  },
  "/network": {
    title: "ネットワーク",
    subtitle: "インベントリとフロー テレメトリを分離し、未収集の接続状態を推定しません。"
  },
  "/ai-insights": {
    title: "AI 分析",
    subtitle: "スキーマと数値根拠を通過した、読み取り専用のサニタイズ済み分析です。"
  }
};

const numberFormatter = new Intl.NumberFormat("ja-JP");

function StatusBadge({
  severity,
  children
}: {
  severity: Severity;
  children: ReactNode;
}) {
  return <span className={`status-badge severity-${severity}`}>{children}</span>;
}

function Panel({
  title,
  description,
  action,
  className = "",
  children
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || description || action) && (
        <header className="panel-header">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

function MetricCard({
  label,
  value,
  note,
  severity = "info"
}: {
  label: string;
  value: string;
  note: string;
  severity?: Severity;
}) {
  return (
    <article className="metric-card">
      <p>{label}</p>
      <strong>{value}</strong>
      <span className={`metric-note severity-${severity}`}>{note}</span>
    </article>
  );
}

function ProgressBar({ value, label }: { value: number; label: string }) {
  const bounded = Math.min(100, Math.max(0, value));
  return (
    <div className="progress-wrap">
      <div className="progress-label">
        <span>{label}</span>
        <strong>{numberFormatter.format(value)}%</strong>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={bounded}
        aria-label={label}
      >
        <span style={{ width: `${bounded}%` }} />
      </div>
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="state-card">
      <CircleAlert size={26} aria-hidden="true" />
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

function DistributionList({
  items,
  emptyTitle,
  emptyDetail
}: {
  items: Array<{ label: string; count: number }>;
  emptyTitle: string;
  emptyDetail: string;
}) {
  const max = Math.max(1, ...items.map((item) => item.count));
  if (!items.length) return <EmptyState title={emptyTitle} detail={emptyDetail} />;
  return (
    <div className="distribution-list">
      {items.map((item) => (
        <div className="distribution-row" key={item.label}>
          <div>
            <strong>{item.label}</strong>
            <span>{numberFormatter.format(item.count)} 件</span>
          </div>
          <div className="bar-track" aria-hidden="true">
            <span style={{ width: `${Math.max(4, (item.count / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function SourceList({ data }: { data: PublicSnapshotV1 }) {
  return (
    <div className="source-list">
      {data.sources.map((source) => (
        <article className="source-row" key={source.source}>
          <span
            className={`source-icon severity-${availabilitySeverity(source.availability)}`}
            aria-hidden="true"
          >
            {source.availability === "available" ? (
              <CircleCheck size={17} />
            ) : (
              <CircleAlert size={17} />
            )}
          </span>
          <div>
            <strong>{source.source}</strong>
            <p>{formatSourceMessage(source)}</p>
          </div>
          <StatusBadge severity={availabilitySeverity(source.availability)}>
            {availabilityLabel(source.availability)}
          </StatusBadge>
        </article>
      ))}
    </div>
  );
}

function OverviewPage({ data }: { data: PublicSnapshotV1 }) {
  const navigate = useNavigate();
  const health = summarizeResourceHealth(data.inventory.resources);
  const defenderSource = data.sources.find((source) => source.source === "Defender for Cloud");
  const defenderRecommendationCount = metricWhenSourceAvailable(
    defenderSource,
    data.security.recommendations.length
  );
  const availableSources = data.sources.filter(
    (source) => source.availability === "available"
  ).length;
  const partialSources = data.sources.filter((source) => source.availability === "partial").length;
  const unavailableSources = data.sources.filter(
    (source) => source.availability === "unavailable"
  ).length;
  const priorityInsights = data.aiInsights
    .slice()
    .sort((a, b) => {
      const rank: Record<Severity, number> = { critical: 3, warning: 2, info: 1, healthy: 0 };
      return rank[b.severity] - rank[a.severity];
    })
    .slice(0, 3);

  return (
    <div className="page-stack">
      <section className="mission-hero" aria-labelledby="mission-title">
        <div className="mission-copy">
          <p className="eyebrow">GitHubでつなぐ Azure 運用</p>
          <h2 id="mission-title">Azure運用を、収集からAI分析・公開までシンプルに。</h2>
          <p>
            読み取り専用の収集、公開前検証、根拠付き分析、人のレビュー、GitHub Pages
            公開までを、監査できるワークフローとしてつなぎます。
          </p>
          <div className="hero-actions">
            <a className="primary-cta" href="#automation-pipeline">
              自動化の仕組みを見る <ChevronRight size={16} aria-hidden="true" />
            </a>
            <a
              className="secondary-link"
              href="https://github.com/aktsmm/azure-ops-pulse-demo"
              target="_blank"
              rel="noreferrer"
            >
              GitHubで実装を見る <ExternalLink size={14} aria-hidden="true" />
            </a>
          </div>
        </div>
        <div className="mission-chips" aria-label="デモの特徴">
          <span>
            <ExternalLink size={15} aria-hidden="true" />
            Live site
          </span>
          <span>
            <Workflow size={15} aria-hidden="true" />
            火・金 自動更新
          </span>
          <span>
            <ShieldCheck size={15} aria-hidden="true" />
            レビュー保護
          </span>
        </div>
      </section>

      <section className="status-strip" aria-label="スナップショット状態">
        <div>
          <span>公開モード</span>
          <strong>{modeLabel(data.mode)}</strong>
          <small>スキーマ {data.schemaVersion}</small>
        </div>
        <div>
          <span>最終更新</span>
          <strong>{formatSnapshotAge(data.generatedAt)}</strong>
          <small>{formatDateTimeJa(data.generatedAt)}</small>
        </div>
        <div>
          <span>ソース収集範囲</span>
          <strong>
            {availableSources}/{data.sources.length} 収集済み
          </strong>
          <small>
            一部 {partialSources}・利用不可 {unavailableSources}
          </small>
        </div>
        <div>
          <span>Resource Health 評価範囲</span>
          <strong>
            {health.evaluated}/{health.total} 件
          </strong>
          <small>未評価 {health.unknown} 件は正常・異常に含めません</small>
        </div>
      </section>

      <Panel
        title="自動更新パイプライン"
        description={`構成として有効な処理を示しています。現在の公開スナップショットの最終収集は ${formatDateTimeJa(data.freshness.lastSuccessfulCollection)} です。`}
        className="automation-panel"
      >
        <div className="pipeline-steps" id="automation-pipeline">
          <article>
            <span className="pipeline-number">1</span>
            <Cloud size={21} aria-hidden="true" />
            <h3>Azureから収集</h3>
            <p>読み取り専用で運用シグナルを取得</p>
            <strong>構成: 火・金 06:00 JST</strong>
            <small>GitHub Actions / OIDC</small>
          </article>
          <article>
            <span className="pipeline-number">2</span>
            <ShieldCheck size={21} aria-hidden="true" />
            <h3>公開前検証</h3>
            <p>匿名化・Schema・Privacyを確認</p>
            <strong>構成: PR作成前に必須</strong>
            <small>TypeScript / JSON Schema</small>
          </article>
          <article>
            <span className="pipeline-number">3</span>
            <Bot size={21} aria-hidden="true" />
            <h3>根拠付きAI分析</h3>
            <p>公開JSONだけから分析候補を作成</p>
            <strong>構成: snapshot merge後</strong>
            <small>gh-aw / Copilot</small>
          </article>
          <article>
            <span className="pipeline-number">4</span>
            <CircleCheck size={21} aria-hidden="true" />
            <h3>人間レビュー</h3>
            <p>差分と根拠を確認して公開を判断</p>
            <strong>必須: 人がmerge</strong>
            <small>Pull Request</small>
          </article>
          <article>
            <span className="pipeline-number">5</span>
            <ExternalLink size={21} aria-hidden="true" />
            <h3>Pagesへ公開</h3>
            <p>承認済みのmainから静的サイトを配信</p>
            <strong>構成: merge後に自動</strong>
            <small>GitHub Pages</small>
          </article>
        </div>
        <div className="approval-boundary">
          <div>
            <Bot size={18} aria-hidden="true" />
            <span>
              <strong>自動で行うこと</strong>
              <small>収集・匿名化・検証・AI分析・PR作成・merge後のPages公開</small>
            </span>
          </div>
          <div>
            <ShieldCheck size={18} aria-hidden="true" />
            <span>
              <strong>人間が承認すること</strong>
              <small>snapshot PRとAI draft PRの内容確認・merge判断</small>
            </span>
          </div>
        </div>
      </Panel>

      <section className="metric-grid four" aria-label="主要指標">
        <MetricCard
          label="公開リソース"
          value={`${numberFormatter.format(data.inventory.total)} 件`}
          note="サニタイズ済みインベントリ"
        />
        <MetricCard
          label="現在期間の概算コスト"
          value={data.cost.current.approximateAmount ?? "利用不可"}
          note={formatCostDelta(data.cost.deltaPercent)}
        />
        <MetricCard
          label="Defender 推奨事項"
          value={
            defenderRecommendationCount === null
              ? "未取得"
              : `${numberFormatter.format(defenderRecommendationCount)} 件`
          }
          note={
            defenderRecommendationCount === null && defenderSource
              ? formatSourceMessage(defenderSource)
              : "公開済みの集計タイトルのみ"
          }
        />
        <MetricCard
          label="検証済み AI 分析"
          value={`${numberFormatter.format(data.aiInsights.length)} 件`}
          note="数値根拠とソース パスを確認済み"
        />
      </section>

      <div className="overview-grid">
        <Panel
          title="優先確認アクション"
          description="公開済み AI 分析の推奨アクションです。Azure への変更は実行しません。"
          className="span-7"
          action={
            <button
              type="button"
              className="text-button"
              onClick={() => navigate("/ai-insights")}
            >
              AI 分析を開く <ChevronRight size={15} aria-hidden="true" />
            </button>
          }
        >
          {priorityInsights.length ? (
            <div className="action-list">
              {priorityInsights.map((insight) => (
                <button
                  type="button"
                  className="action-row"
                  key={insight.id}
                  onClick={() => navigate(insight.route)}
                  aria-label={`${insight.title}の関連画面を開く`}
                >
                  <span className={`priority-line severity-${insight.severity}`} />
                  <span>
                    <small>
                      {routeLabel(insight.route)}・信頼度{" "}
                      {numberFormatter.format(Math.round(insight.confidence * 100))}%
                    </small>
                    <strong>{insight.title}</strong>
                    <p>{insight.recommendedAction}</p>
                  </span>
                  <ChevronRight size={17} aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              title="公開済みの AI 分析はありません"
              detail="数値根拠と公開ゲートを通過した分析がないため、アクションを表示していません。"
            />
          )}
        </Panel>

        <Panel
          title="コスト サマリー"
          description="正確な請求額ではなく、公開用に丸めた値です。"
          className="span-5"
          action={
            <button type="button" className="text-button" onClick={() => navigate("/cost")}>
              詳細 <ChevronRight size={15} aria-hidden="true" />
            </button>
          }
        >
          <dl className="summary-list">
            <div>
              <dt>現在期間</dt>
              <dd>{data.cost.current.approximateAmount ?? "利用不可"}</dd>
            </div>
            <div>
              <dt>前期間</dt>
              <dd>{data.cost.previous.approximateAmount ?? "利用不可"}</dd>
            </div>
            <div>
              <dt>期間差</dt>
              <dd>{formatCostDelta(data.cost.deltaPercent)}</dd>
            </div>
            <div>
              <dt>予測 / 予算</dt>
              <dd>
                {data.cost.forecast.availability === "available" ? "収集済み" : "未収集"} /{" "}
                {data.cost.budget.availability === "available" ? "収集済み" : "未収集"}
              </dd>
            </div>
          </dl>
        </Panel>

        <Panel
          title="リソース タイプ分布"
          description="Azure のリソース タイプ名は原文のまま保持します。"
          className="span-6"
        >
          <DistributionList
            items={data.inventory.byType.slice(0, 8)}
            emptyTitle="リソース タイプなし"
            emptyDetail="このスナップショットに公開可能なリソース タイプはありません。"
          />
        </Panel>

        <Panel
          title="リージョン分布"
          description="リージョン名と件数のみを表示し、状態は推定しません。"
          className="span-6"
        >
          <DistributionList
            items={data.inventory.byRegion.slice(0, 8)}
            emptyTitle="リージョン情報なし"
            emptyDetail="このスナップショットに公開可能なリージョン情報はありません。"
          />
        </Panel>

        <Panel
          title="データ ソース収集状況"
          description="一部収集や利用不可は、正常・異常の判定ではなくデータ範囲を示します。"
          className="span-6"
        >
          <SourceList data={data} />
        </Panel>

        <Panel
          title="最近の収集アクティビティ"
          description="実行者・対象リソース・識別子は公開前に除外しています。"
          className="span-6"
        >
          {data.overview.eventTimeline.length ? (
            <div className="timeline">
              {data.overview.eventTimeline.map((event) => (
                <button
                  type="button"
                  className="timeline-item"
                  key={event.id}
                  onClick={() => navigate(event.route)}
                  aria-label={`${formatActivityTitle(event.title)}の関連画面を開く`}
                >
                  <span className={`timeline-marker severity-${event.severity}`} aria-hidden="true" />
                  <span>
                    <small>{formatEventTimestamp(event.timestamp)}</small>
                    <strong>{formatActivityTitle(event.title)}</strong>
                    <p>{formatActivityDetail(event.detail)}</p>
                  </span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              title="公開可能なアクティビティなし"
              detail="この収集期間に公開可能なイベントはありません。"
            />
          )}
        </Panel>

        <Panel
          title="AI 分析サマリー"
          description="観測、影響、数値根拠、推奨アクションを公開スナップショット内で完結させています。"
          className="span-12"
        >
          <div className="ai-summary">
            <div>
              <Bot size={24} aria-hidden="true" />
              <strong>{data.aiInsights.length} 件の検証済み分析</strong>
              <p>読み取り専用・匿名化済み・自動修復なし</p>
            </div>
            <div className="evidence-summary">
              <span>
                数値根拠{" "}
                {data.aiInsights.reduce(
                  (count, insight) => count + insight.numericEvidence.length,
                  0
                )}{" "}
                件
              </span>
              <span>
                対象領域 {new Set(data.aiInsights.map((insight) => insight.route)).size} 件
              </span>
              <span>更新 {formatDateTimeJa(data.generatedAt)}</span>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function CostPage({ data }: { data: PublicSnapshotV1 }) {
  const categoriesWithDelta = data.cost.categories.filter(
    (category) => category.deltaPercent !== null
  );
  const canShowTrend = data.mode === "AZURE" && data.cost.normalizedTrend.length > 1;

  return (
    <div className="page-stack">
      <div className="notice">
        <Coins size={18} aria-hidden="true" />
        <span>
          金額は公開用に丸めた概算値です。正確な Azure 請求額、未収集の予測、未収集の予算は推定しません。
        </span>
      </div>
      <section className="metric-grid four" aria-label="コスト指標">
        <MetricCard
          label="現在期間"
          value={data.cost.current.approximateAmount ?? "利用不可"}
          note={formatCostDelta(data.cost.deltaPercent)}
        />
        <MetricCard
          label="前期間"
          value={data.cost.previous.approximateAmount ?? "利用不可"}
          note="比較可能な前期間の概算値"
        />
        <MetricCard
          label="予測"
          value={data.cost.forecast.approximateAmount ?? "未収集"}
          note="権威ある予測値のみ表示"
        />
        <MetricCard
          label="予算使用率"
          value={
            data.cost.budget.usedPercent === null ? "未収集" : `${data.cost.budget.usedPercent}%`
          }
          note="設定済み予算を収集できた場合のみ表示"
        />
      </section>
      <div className="content-grid">
        <Panel
          title="サービス別コスト構成"
          description="サービス名と構成比は公開スナップショット値です。"
          className="span-7"
        >
          {data.cost.categories.length ? (
            <div className="cost-category-list">
              {data.cost.categories.map((category) => (
                <article className="cost-category-row" key={category.name}>
                  <div>
                    <strong>{category.name}</strong>
                    <span>{category.approximateAmount}</span>
                  </div>
                  <div className="bar-track" aria-hidden="true">
                    <span style={{ width: `${Math.max(2, category.sharePercent)}%` }} />
                  </div>
                  <strong>{category.sharePercent}%</strong>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              title="サービス別コストなし"
              detail="公開可能なサービス別コストが収集されていません。"
            />
          )}
        </Panel>
        <Panel
          title="前期間からの変化"
          description="比較可能なサービスのみを表示します。値の良否は推定しません。"
          className="span-5"
        >
          {categoriesWithDelta.length ? (
            <div className="delta-list">
              {categoriesWithDelta
                .slice()
                .sort(
                  (a, b) =>
                    Math.abs(b.deltaPercent ?? 0) - Math.abs(a.deltaPercent ?? 0)
                )
                .map((category) => (
                  <div className="delta-row" key={category.name}>
                    <span>{category.name}</span>
                    <strong>
                      {(category.deltaPercent ?? 0) > 0 ? "+" : ""}
                      {category.deltaPercent}%
                    </strong>
                  </div>
                ))}
            </div>
          ) : (
            <EmptyState
              title="比較データなし"
              detail="比較可能な前期間がないため、サービス別の変化は表示していません。"
            />
          )}
        </Panel>
        <Panel
          title="正規化済み支出系列"
          description="Azure 収集で公開された実測系列がある場合のみ表示します。"
          className="span-12"
        >
          {canShowTrend ? (
            <div className="chart-shell" aria-label="正規化済み支出系列">
              {data.cost.normalizedTrend.map((value, index) => (
                <div className="chart-column" key={`${value}-${index}`}>
                  <span style={{ height: `${Math.min(100, Math.max(0, value))}%` }} />
                  <small>{index + 1}</small>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="実測の時系列は未収集"
              detail="単一期間の合計から時系列や予測を合成していません。"
            />
          )}
        </Panel>
      </div>
    </div>
  );
}

function ResourceDrawer({
  resource,
  onClose
}: {
  resource: ResourceItem | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!resource) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, resource]);

  if (!resource) return null;
  return (
    <div className="drawer-layer" role="presentation" onMouseDown={onClose}>
      <aside
        className="detail-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="resource-drawer-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">サニタイズ済みリソース詳細</p>
            <h2 id="resource-drawer-title">{resource.name}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="リソース詳細を閉じる"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div className="drawer-status">
          <StatusBadge severity={resourceStatusSeverity(resource.status)}>
            {resourceStatusLabel(resource.status)}
          </StatusBadge>
          <span>{resource.type}</span>
        </div>
        <dl className="detail-list">
          <div>
            <dt>リソース グループ</dt>
            <dd>{resource.resourceGroup}</dd>
          </div>
          <div>
            <dt>リージョン</dt>
            <dd>{resource.region}</dd>
          </div>
          <div>
            <dt>所有者エイリアス</dt>
            <dd>{resource.owner}</dd>
          </div>
          <div>
            <dt>収集済み変更情報</dt>
            <dd>{resource.change}</dd>
          </div>
        </dl>
        <section>
          <h3>公開可能なタグ</h3>
          {Object.keys(resource.tags).length ? (
            <div className="tag-list">
              {Object.entries(resource.tags).map(([key, value]) => (
                <span className="tag" key={key}>
                  {key}: {value}
                </span>
              ))}
            </div>
          ) : (
            <p className="muted">許可リストを通過したタグはありません。</p>
          )}
        </section>
        <div className="drawer-callout">
          <ShieldCheck size={20} aria-hidden="true" />
          <p>
            名前、所有者、識別子、タグは公開サニタイズ境界を通過した値です。元の値は表示しません。
          </p>
        </div>
      </aside>
    </div>
  );
}

function ResourcesPage({ data }: { data: PublicSnapshotV1 }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | ResourceItem["status"]>("all");
  const [selected, setSelected] = useState<ResourceItem | null>(null);
  const filtered = useMemo(
    () =>
      data.inventory.resources.filter(
        (resource) =>
          (status === "all" || resource.status === status) &&
          `${resource.name} ${resource.type} ${resource.region} ${resource.resourceGroup}`
            .toLocaleLowerCase("ja-JP")
            .includes(query.toLocaleLowerCase("ja-JP"))
      ),
    [data.inventory.resources, query, status]
  );

  return (
    <div className="page-stack">
      <section className="metric-grid four" aria-label="インベントリ サマリー">
        <MetricCard
          label="合計"
          value={`${data.inventory.total} 件`}
          note="公開スナップショット内"
        />
        {data.inventory.byType.slice(0, 3).map((item) => (
          <MetricCard
            key={item.label}
            label={item.label}
            value={`${item.count} 件`}
            note="リソース タイプ"
          />
        ))}
      </section>
      <Panel
        title="リソース一覧"
        description="フィルターは表示中のサニタイズ済みデータだけに適用されます。"
      >
        <div className="table-toolbar">
          <label className="search-control">
            <Search size={17} aria-hidden="true" />
            <span className="sr-only">リソースを検索</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="名前、タイプ、リージョンで検索"
            />
          </label>
          <label className="select-label">
            <span>Resource Health 状態</span>
            <select
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as "all" | ResourceItem["status"])
              }
            >
              <option value="all">すべて</option>
              <option value="Healthy">正常</option>
              <option value="Degraded">低下</option>
              <option value="Unavailable">利用不可</option>
              <option value="Unknown">未評価</option>
            </select>
          </label>
          <span className="result-count" aria-live="polite">
            {filtered.length} 件
          </span>
        </div>
        {filtered.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>名前</th>
                  <th>タイプ</th>
                  <th>リージョン</th>
                  <th>Resource Health</th>
                  <th>所有者</th>
                  <th aria-label="詳細を開く" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((resource) => (
                  <tr key={resource.id}>
                    <td>
                      <button
                        type="button"
                        className="resource-link"
                        onClick={() => setSelected(resource)}
                        aria-label={`${resource.name}の詳細を開く`}
                      >
                        <strong>{resource.name}</strong>
                        <small>{resource.resourceGroup}</small>
                      </button>
                    </td>
                    <td>{resource.type}</td>
                    <td>{resource.region}</td>
                    <td>
                      <StatusBadge severity={resourceStatusSeverity(resource.status)}>
                        {resourceStatusLabel(resource.status)}
                      </StatusBadge>
                    </td>
                    <td>{resource.owner}</td>
                    <td aria-hidden="true">
                      <ChevronRight size={17} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="条件に一致するリソースはありません"
            detail="検索文字列または Resource Health 状態フィルターを変更してください。"
          />
        )}
      </Panel>
      <ResourceDrawer resource={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function ReliabilityPage({ data }: { data: PublicSnapshotV1 }) {
  const health = summarizeResourceHealth(data.inventory.resources);
  const resourceHealthSource = data.sources.find((source) => source.source === "Resource Health");
  const serviceHealthSource = data.sources.find((source) => source.source === "Service Health");
  const observedIncidents = metricWhenSourceAvailable(
    resourceHealthSource,
    data.reliability.incidentAvailability === "available" ? data.reliability.incidents : null
  );
  const reliabilitySources = [resourceHealthSource, serviceHealthSource].filter(
    (source): source is NonNullable<typeof source> => source !== undefined
  );

  return (
    <div className="page-stack">
      <div className="notice">
        <Activity size={18} aria-hidden="true" />
        <span>
          「未評価」は正常率の分母や障害件数には含めず、収集できた状態だけを表示します。
        </span>
      </div>
      <section className="metric-grid four" aria-label="Resource Health サマリー">
        <MetricCard
          label="評価済み"
          value={`${health.evaluated}/${health.total} 件`}
          note={`評価範囲 ${health.coveragePercent}%`}
        />
        <MetricCard
          label="正常"
          value={`${health.healthy} 件`}
          note="Resource Health 状態が「正常」の収集値"
          severity={health.healthy > 0 ? "healthy" : "info"}
        />
        <MetricCard
          label="観測中の障害"
          value={observedIncidents === null ? "未取得" : `${observedIncidents} 件`}
          note={
            observedIncidents === null
              ? resourceHealthSource?.availability === "available"
                ? "障害件数を取得する観測ソースは未実装です"
                : resourceHealthSource
                  ? formatSourceMessage(resourceHealthSource)
                  : "Resource Health のソース状態がありません"
              : `低下 ${health.degraded} 件・利用不可 ${health.unavailable} 件`
          }
          severity={observedIncidents ? "warning" : "info"}
        />
        <MetricCard
          label="未評価"
          value={`${health.unknown} 件`}
          note="正常・異常を推定しません"
        />
      </section>
      <div className="content-grid">
        <Panel
          title="収集ソース"
          description="可用性はデータ取得範囲を表し、サービス状態の判定ではありません。"
          className="span-5"
        >
          <div className="source-list">
            {reliabilitySources.map((source) => (
              <article className="source-row" key={source.source}>
                <span className="source-icon" aria-hidden="true">
                  <Server size={17} />
                </span>
                <div>
                  <strong>{source.source}</strong>
                  <p>{formatSourceMessage(source)}</p>
                </div>
                <StatusBadge severity={availabilitySeverity(source.availability)}>
                  {availabilityLabel(source.availability)}
                </StatusBadge>
              </article>
            ))}
          </div>
        </Panel>
        <Panel
          title="リージョン別の評価済み状態"
          description="未評価だけのリージョンは表示しません。"
          className="span-7"
        >
          {data.overview.regionalHealth.length ? (
            <div className="region-list">
              {data.overview.regionalHealth.map((region) => (
                <div className="region-row" key={region.region}>
                  <span className={`health-dot severity-${region.status}`} aria-hidden="true" />
                  <strong>{region.region}</strong>
                  <span>正常 {region.score}%</span>
                  <StatusBadge severity={region.status}>{severityLabel(region.status)}</StatusBadge>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="リージョン別状態は未評価"
              detail="Resource Health が未評価のため、0% や警告として表示していません。"
            />
          )}
        </Panel>
        <Panel
          title="公開済みサービス目標"
          description="スナップショットに明示された目標・実績・エラー バジェットのみを表示します。"
          className="span-12"
        >
          {data.reliability.services.length ? (
            <div className="service-grid">
              {data.reliability.services.map((service) => (
                <article className="service-card" key={service.name}>
                  <div className="service-heading">
                    <div>
                      <span className="service-icon">
                        <Server size={18} aria-hidden="true" />
                      </span>
                      <strong>{service.name}</strong>
                    </div>
                    <StatusBadge severity={service.status}>
                      {severityLabel(service.status)}
                    </StatusBadge>
                  </div>
                  <dl className="mini-stats">
                    <div>
                      <dt>目標</dt>
                      <dd>{service.objective}</dd>
                    </div>
                    <div>
                      <dt>実績</dt>
                      <dd>{service.actual}</dd>
                    </div>
                  </dl>
                  <ProgressBar
                    value={service.budgetRemainingPercent}
                    label="エラー バジェット残量"
                  />
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              title="サービス目標は未収集"
              detail="公開スナップショットにサービス目標や実績がないため、可用性や復旧時間を合成していません。"
            />
          )}
        </Panel>
      </div>
    </div>
  );
}

function SecurityPage({ data }: { data: PublicSnapshotV1 }) {
  const defenderSource = data.sources.find((source) => source.source === "Defender for Cloud");
  const secureScore = metricWhenSourceAvailable(defenderSource, data.security.secureScore);
  const activeAlerts = metricWhenSourceAvailable(defenderSource, data.security.activeAlerts);
  const openRecommendations = metricWhenSourceAvailable(
    defenderSource,
    data.security.recommendations.filter((item) => item.status !== "Resolved").length
  );
  const complianceCount = metricWhenSourceAvailable(
    defenderSource,
    data.security.compliance.length
  );
  const unavailableNote = defenderSource
    ? formatSourceMessage(defenderSource)
    : "Defender for Cloud のソース状態が公開されていません。";

  return (
    <div className="page-stack">
      {defenderSource && (
        <div className="notice">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>{formatSourceMessage(defenderSource)}</span>
          <StatusBadge severity={availabilitySeverity(defenderSource.availability)}>
            {availabilityLabel(defenderSource.availability)}
          </StatusBadge>
        </div>
      )}
      <section className="metric-grid four" aria-label="セキュリティ サマリー">
        <MetricCard
          label="Secure score"
          value={secureScore === null ? "未取得" : `${secureScore}%`}
          note={
            secureScore === null
              ? defenderSource?.availability === "available"
                ? "現在のスナップショットに Secure score はありません。"
                : unavailableNote
              : "公開スナップショット値・傾向は未収集"
          }
        />
        <MetricCard
          label="アクティブ アラート"
          value={activeAlerts === null ? "未取得" : `${activeAlerts} 件`}
          note={activeAlerts === null ? unavailableNote : "集計件数のみ"}
        />
        <MetricCard
          label="未解決の推奨事項"
          value={openRecommendations === null ? "未取得" : `${openRecommendations} 件`}
          note={openRecommendations === null ? unavailableNote : "資産詳細を除外"}
        />
        <MetricCard
          label="コンプライアンス集計"
          value={complianceCount === null ? "未取得" : `${complianceCount} 件`}
          note={complianceCount === null ? unavailableNote : "収集済みフレームワーク"}
        />
      </section>
      <div className="content-grid">
        <Panel
          title="Defender for Cloud 推奨事項"
          description="タイトル、重要度、影響件数、対応状態だけを公開します。"
          className="span-8"
        >
          {defenderSource?.availability !== "available" ? (
            <EmptyState title="Defender データは未取得" detail={unavailableNote} />
          ) : data.security.recommendations.length ? (
            <div className="recommendation-list">
              {data.security.recommendations.map((item) => (
                <article className="recommendation-row" key={item.title}>
                  <span className={`priority-line severity-${item.severity}`} aria-hidden="true" />
                  <div>
                    <strong>{item.title}</strong>
                    <p>影響を受けるリソース {item.affectedCount} 件・集計表示</p>
                  </div>
                  <StatusBadge severity={item.severity}>
                    {recommendationStatusLabel(item.status)}
                  </StatusBadge>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              title="公開可能な推奨事項なし"
              detail="0 件が安全を意味するとは推定しません。現在の公開スナップショットに推奨事項がない状態です。"
            />
          )}
        </Panel>
        <Panel
          title="コンプライアンス集計"
          description="収集されたスコアのみを表示します。"
          className="span-4"
        >
          {defenderSource?.availability !== "available" ? (
            <EmptyState title="コンプライアンス集計は未取得" detail={unavailableNote} />
          ) : data.security.compliance.length ? (
            <div className="compliance-list">
              {data.security.compliance.map((item) => (
                <ProgressBar key={item.framework} value={item.score} label={item.framework} />
              ))}
            </div>
          ) : (
            <EmptyState
              title="コンプライアンス集計なし"
              detail="フレームワーク別スコアは収集されていません。"
            />
          )}
        </Panel>
        <Panel title="公開データ ポリシー" className="span-12">
          <div className="privacy-card horizontal">
            <ShieldCheck size={28} aria-hidden="true" />
            <div>
              <strong>集計を前提に公開</strong>
              <p>
                資産名、脆弱性詳細、悪用情報、ID は公開しません。Secure score
                はソースが収集済みで値が存在する場合だけ表示し、実測 0 と未取得を区別します。
              </p>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function NetworkPage({ data }: { data: PublicSnapshotV1 }) {
  const [filter, setFilter] = useState<"all" | "Allowed" | "Degraded" | "Blocked">("all");
  const telemetry = data.network.telemetry;
  const rows = telemetry.flows.filter((flow) => filter === "all" || flow.status === filter);
  const telemetryMessage =
    telemetry.availability === "unavailable"
      ? "フロー テレメトリは未収集です。ネットワーク リソースの存在から接続状態を推定しません。"
      : telemetry.availability === "partial"
        ? "フロー テレメトリは一部のみ収集されています。表示値の範囲外は評価しません。"
        : "収集済みフロー テレメトリの集計値です。";

  return (
    <div className="page-stack">
      <section className="metric-grid four" aria-label="ネットワーク サマリー">
        <MetricCard
          label="ネットワーク リソース"
          value={`${data.network.inventory.total} 件`}
          note="インベントリのみ"
        />
        <MetricCard
          label="リソース タイプ"
          value={`${data.network.inventory.byType.length} 件`}
          note="Azure タイプ名を保持"
        />
        <MetricCard
          label="リージョン"
          value={`${data.network.inventory.byRegion.length} 件`}
          note="インベントリ分布"
        />
        <MetricCard
          label="フロー テレメトリ"
          value={availabilityLabel(telemetry.availability)}
          note="インベントリとは別の収集状態"
          severity={availabilitySeverity(telemetry.availability)}
        />
      </section>
      <div className="content-grid">
        <Panel title="ネットワーク リソース タイプ" className="span-6">
          <DistributionList
            items={data.network.inventory.byType}
            emptyTitle="ネットワーク インベントリなし"
            emptyDetail="対応するネットワーク リソースは収集されていません。"
          />
        </Panel>
        <Panel title="ネットワーク リージョン" className="span-6">
          <DistributionList
            items={data.network.inventory.byRegion}
            emptyTitle="リージョン情報なし"
            emptyDetail="ネットワーク リソースのリージョン情報は収集されていません。"
          />
        </Panel>
        <Panel
          title="フロー テレメトリ"
          description={telemetryMessage}
          className="span-12"
          action={
            <label className="select-label compact">
              <span>状態フィルター</span>
              <select
                value={filter}
                onChange={(event) =>
                  setFilter(
                    event.target.value as "all" | "Allowed" | "Degraded" | "Blocked"
                  )
                }
              >
                <option value="all">すべて</option>
                <option value="Allowed">許可</option>
                <option value="Degraded">低下</option>
                <option value="Blocked">ブロック</option>
              </select>
            </label>
          }
        >
          {telemetry.availability === "unavailable" ? (
            <EmptyState
              title="フロー テレメトリは利用不可"
              detail="正常接続、低下接続、ブロック フローは 0 件ではなく未収集です。"
            />
          ) : rows.length ? (
            <div className="flow-list">
              {rows.map((flow) => (
                <article className="flow-row" key={flow.id}>
                  <span className="flow-icon">
                    <Network size={18} aria-hidden="true" />
                  </span>
                  <div className="flow-endpoint">
                    <small>送信元</small>
                    <strong>{flow.source}</strong>
                  </div>
                  <ChevronRight size={18} aria-hidden="true" />
                  <div className="flow-endpoint">
                    <small>送信先</small>
                    <strong>{flow.destination}</strong>
                  </div>
                  <div className="flow-stat">
                    <small>プロトコル</small>
                    <strong>{flow.protocol}</strong>
                  </div>
                  <div className="flow-stat">
                    <small>遅延</small>
                    <strong>{flow.latency}</strong>
                  </div>
                  <div className="flow-stat">
                    <small>スループット</small>
                    <strong>{flow.throughput}</strong>
                  </div>
                  <StatusBadge severity={flowStatusSeverity(flow.status)}>
                    {flowStatusLabel(flow.status)}
                  </StatusBadge>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              title="この状態のフローはありません"
              detail="別の状態フィルターを選択してください。"
            />
          )}
        </Panel>
      </div>
    </div>
  );
}

function InsightCard({ insight }: { insight: AiInsight }) {
  const navigate = useNavigate();
  return (
    <article className="insight-card">
      <header>
        <div className="badge-row">
          <StatusBadge severity={insight.severity}>{severityLabel(insight.severity)}</StatusBadge>
          <span className="verified-badge">
            <CircleCheck size={13} aria-hidden="true" />
            根拠検証済み
          </span>
        </div>
        <span className="confidence">
          信頼度 {numberFormatter.format(Math.round(insight.confidence * 100))}%
        </span>
      </header>
      <div className="insight-context">
        <span>領域: {routeLabel(insight.route)}</span>
        <span>期間: {insight.period}</span>
      </div>
      <h2>{insight.title}</h2>
      <section>
        <h3>観測</h3>
        <p>{insight.observation}</p>
      </section>
      <section className="insight-impact">
        <h3>想定される影響</h3>
        <p>{insight.impact}</p>
      </section>
      <section>
        <h3>数値根拠</h3>
        <div className="evidence-table">
          {insight.numericEvidence.map((evidence) => (
            <div key={`${evidence.source}-${evidence.value}`}>
              <span>{evidence.label}</span>
              <strong>{evidence.value}</strong>
              <code>{evidence.source}</code>
            </div>
          ))}
        </div>
      </section>
      <footer>
        <div>
          <small>推奨アクション</small>
          <strong>{insight.recommendedAction}</strong>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={() => navigate(insight.route)}
        >
          {routeLabel(insight.route)}を開く <ChevronRight size={15} aria-hidden="true" />
        </button>
      </footer>
    </article>
  );
}

function AiInsightsPage({ data }: { data: PublicSnapshotV1 }) {
  const warnings = data.aiInsights.filter(
    (insight) => insight.severity === "critical" || insight.severity === "warning"
  ).length;
  const domains = new Set(data.aiInsights.map((insight) => routeLabel(insight.route)));
  const periods = [...new Set(data.aiInsights.map((insight) => insight.period))];

  return (
    <div className="page-stack">
      <div className="ai-banner">
        <span className="ai-icon">
          <Bot size={22} aria-hidden="true" />
        </span>
        <div>
          <strong>検証済み・読み取り専用の分析</strong>
          <p>
            サニタイズ済みの構造化データだけを使用し、Azure の変更や修復は実行しません。
          </p>
        </div>
        <StatusBadge severity={warnings ? "warning" : "info"}>
          要確認 {warnings} 件
        </StatusBadge>
      </div>

      <section className="metric-grid four" aria-label="AI 分析サマリー">
        <MetricCard
          label="検証済み"
          value={`${data.aiInsights.length} 件`}
          note="スキーマ・数値根拠・プライバシー ゲート"
          severity="healthy"
        />
        <MetricCard
          label="要確認"
          value={`${warnings} 件`}
          note="重大または要確認の分析"
          severity={warnings ? "warning" : "info"}
        />
        <MetricCard
          label="対象領域"
          value={`${domains.size} 件`}
          note={[...domains].join("、") || "対象なし"}
        />
        <MetricCard
          label="更新"
          value={formatSnapshotAge(data.generatedAt)}
          note={formatDateTimeJa(data.generatedAt)}
        />
      </section>

      <Panel
        title="分析期間"
        description="各分析に記録された期間ラベルです。期間外の傾向は推定しません。"
      >
        <div className="chip-list">
          {periods.length ? periods.map((period) => <span key={period}>{period}</span>) : <span>なし</span>}
        </div>
      </Panel>

      <Panel
        title="優先アクション"
        description="推奨は人による確認を前提とし、自動実行されません。"
      >
        {data.aiInsights.length ? (
          <div className="priority-action-grid">
            {data.aiInsights.map((insight) => (
              <article key={insight.id}>
                <StatusBadge severity={insight.severity}>
                  {severityLabel(insight.severity)}
                </StatusBadge>
                <strong>{insight.title}</strong>
                <p>{insight.recommendedAction}</p>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="検証済みアクションなし"
            detail="公開ゲートを通過した分析がないため、推奨アクションを表示していません。"
          />
        )}
      </Panel>

      {data.aiInsights.length ? (
        <div className="insight-grid">
          {data.aiInsights.map((insight) => (
            <InsightCard insight={insight} key={insight.id} />
          ))}
        </div>
      ) : (
        <EmptyState
          title="検証済み AI 分析なし"
          detail="直近の分析では、公開ゲートを通過する数値根拠がありませんでした。"
        />
      )}

      <Panel title="分析の境界">
        <div className="boundary-grid">
          <article>
            <ShieldCheck size={22} aria-hidden="true" />
            <strong>匿名化済み</strong>
            <p>識別子、所有者、エンドポイント、正確なコストは公開前にマスクまたは丸めています。</p>
          </article>
          <article>
            <CircleCheck size={22} aria-hidden="true" />
            <strong>スキーマと根拠を検証</strong>
            <p>各数値は表示されたソース パスのスカラー値と一致する必要があります。</p>
          </article>
          <article>
            <Bot size={22} aria-hidden="true" />
            <strong>読み取り専用</strong>
            <p>AI は公開 JSON のみを読み、Azure、シークレット、ログ、外部サービスへ接続しません。</p>
          </article>
        </div>
      </Panel>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <Cloud size={28} aria-hidden="true" />
      <strong>公開スナップショットを読み込んでいます</strong>
      <span>サニタイズ済みデータを準備中です。</span>
    </div>
  );
}

function ErrorState({ error }: { error: string }) {
  return (
    <div className="error-state" role="alert">
      <CircleAlert size={32} aria-hidden="true" />
      <h2>公開スナップショットを読み込めません</h2>
      <p>{error}</p>
      <small>収集失敗時は、最後に検証済みのスナップショットを置き換えません。</small>
    </div>
  );
}

function AppShell({ data }: { data: PublicSnapshotV1 }) {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const page = TITLES[location.pathname] ?? TITLES["/overview"]!;
  const ageMinutes = Math.max(
    0,
    Math.round((Date.now() - new Date(data.generatedAt).getTime()) / 60_000)
  );
  const fresh = data.freshness.state === "fresh" && ageMinutes <= 4_320;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="brand">
          <span className="brand-mark">
            <Cloud size={22} aria-hidden="true" />
          </span>
          <span>
            <strong>Azure Ops Pulse</strong>
            <small>Azure運用自動化デモ</small>
          </span>
          <button
            type="button"
            className="mobile-close"
            onClick={() => setMenuOpen(false)}
            aria-label="メニューを閉じる"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <nav aria-label="メイン ナビゲーション">
          <span className="nav-section">公開運用ビュー</span>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                to={item.path}
                key={item.path}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) => (isActive ? "active" : "")}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="demo-badge">{modeLabel(data.mode)}</div>
          <p>
            {data.mode === "DEMO"
              ? "開発用の合成データで安全な公開フローを確認できます。"
              : "承認済みのAzure公開スナップショットを表示しています。"}
          </p>
          <a
            href="https://github.com/aktsmm/azure-ops-pulse-demo"
            target="_blank"
            rel="noreferrer"
          >
            リポジトリを開く <ExternalLink size={13} aria-hidden="true" />
          </a>
        </div>
      </aside>
      {menuOpen && (
        <button
          type="button"
          className="nav-scrim"
          onClick={() => setMenuOpen(false)}
          aria-label="ナビゲーションを閉じる"
        />
      )}
      <div className="main-column">
        <header className="topbar">
          <button
            type="button"
            className="menu-button"
            onClick={() => setMenuOpen(true)}
            aria-label="ナビゲーションを開く"
          >
            <Menu size={20} aria-hidden="true" />
          </button>
          <label className="scope-control">
            <span>スコープ</span>
            <select aria-label="サブスクリプション スコープ" defaultValue="current">
              <option value="current">{data.scope.displayName}</option>
            </select>
          </label>
          <div className="topbar-spacer" />
          <ThemeToggle />
          <div className="freshness" aria-label={`データ鮮度: ${fresh ? "最新" : "期限超過"}`}>
            <span
              className={`health-dot severity-${fresh ? "healthy" : "warning"}`}
              aria-hidden="true"
            />
            <span>
              <strong>{fresh ? "最新" : "期限超過"}</strong>
              <small>{formatSnapshotAge(data.generatedAt)}</small>
            </span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <p className="breadcrumb">運用 / {page.title}</p>
              <h1>{page.title}</h1>
              <p>{page.subtitle}</p>
            </div>
            <div className="mode-chip">
              <span>{modeLabel(data.mode)}</span>
              <small>schema {data.schemaVersion}</small>
            </div>
          </div>
          <Routes>
            <Route path="/overview" element={<OverviewPage data={data} />} />
            <Route path="/cost" element={<CostPage data={data} />} />
            <Route path="/resources" element={<ResourcesPage data={data} />} />
            <Route path="/reliability" element={<ReliabilityPage data={data} />} />
            <Route path="/security" element={<SecurityPage data={data} />} />
            <Route path="/network" element={<NetworkPage data={data} />} />
            <Route path="/ai-insights" element={<AiInsightsPage data={data} />} />
            <Route path="*" element={<Navigate to="/overview" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const snapshot = useSnapshot();
  if (snapshot.status === "loading") return <LoadingState />;
  if (snapshot.status === "error") return <ErrorState error={snapshot.error} />;
  return <AppShell data={snapshot.data} />;
}
