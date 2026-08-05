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
  Info,
  Layers,
  MapPin,
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
  Severity,
  SourceStatus
} from "./data/contracts";
import { ThemeToggle } from "./components/ThemeToggle";
import { useSnapshot } from "./hooks/useSnapshot";
import {
  availabilityLabel,
  availabilitySeverity,
  flowStatusLabel,
  flowStatusSeverity,
  formatActivityTitle,
  formatCostDelta,
  formatDateTimeJa,
  formatEndpointLabel,
  formatEventTimestamp,
  formatSnapshotAge,
  formatSourceMessage,
  formatSourceName,
  metricWhenSourcePublished,
  modeLabel,
  publishedCostDeltaPercent,
  recommendationStatusLabel,
  resourceStatusLabel,
  resourceStatusSeverity,
  routeLabel,
  severityLabel
} from "./lib/display-formatters";
import { WITHHELD_JPY_AMOUNT_LABEL, isWithheldJpyAmount } from "./lib/jpy-disclosure";
import {
  blindSpotSummary,
  confirmedFailures,
  coverageSegments,
  summarizeCoverageByRegion,
  summarizeCoverageByType,
  supportedSharePercent,
  type CoverageSegment,
  type ResourceTypeCoverageRow
} from "./lib/reliability-view";

const RESOURCE_HEALTH_TYPES_DOC =
  "https://learn.microsoft.com/azure/service-health/resource-health-checks-resource-types";
const RESOURCE_HEALTH_OVERVIEW_DOC =
  "https://learn.microsoft.com/azure/service-health/resource-health-overview";
const DEFENDER_PLANS_DOC =
  "https://learn.microsoft.com/azure/defender-for-cloud/enable-all-plans";

const NAV_ITEMS = [
  { path: "/overview", label: "概要", icon: Gauge },
  { path: "/cost", label: "コスト", icon: Coins },
  { path: "/resources", label: "リソース", icon: Boxes },
  { path: "/reliability", label: "信頼性", icon: Activity },
  { path: "/security", label: "セキュリティ", icon: ShieldCheck },
  { path: "/network", label: "ネットワーク", icon: Network },
  { path: "/ai-insights", label: "AI 分析", icon: Sparkles }
];

const RELATED_DEMOS = [
  {
    label: "M365 Message Center Dashboard",
    href: "https://aktsmm.github.io/m365-message-center-dashboard/"
  },
  {
    label: "M365 Copilot Update Digest",
    href: "https://aktsmm.github.io/m365-copilot-update-digest/"
  },
  {
    label: "Daily Dev Byte",
    href: "https://aktsmm.github.io/daily-dev-byte/"
  },
  {
    label: "VS Code Copilot Digest",
    href: "https://aktsmm.github.io/vscode-copilot-digest/index.html"
  }
];

const TITLES: Record<string, { title: string; subtitle: string }> = {
  "/overview": {
    title: "運用概要",
    subtitle: "収集できた事実と、まだ収集していない範囲を分けて表示します。"
  },
  "/cost": {
    title: "コスト",
    subtitle: "公開用に丸めた概算額と、比較できる前期間・サービス別の内訳です。"
  },
  "/resources": {
    title: "リソース インベントリ",
    subtitle: "サニタイズ済みの名前・種別・リージョンと、Resource Health の状態を確認できます。"
  },
  "/reliability": {
    title: "信頼性",
    subtitle: "Azure Resource Health で監視できる範囲と、監視の死角を可視化します。"
  },
  "/security": {
    title: "セキュリティ",
    subtitle: "Defender for Cloud の集計値だけを表示し、資産や脆弱性の詳細は公開しません。"
  },
  "/network": {
    title: "ネットワーク",
    subtitle: "インベントリとメトリック取得状況を分け、未収集の接続状態は推定しません。"
  },
  "/ai-insights": {
    title: "AI 分析",
    subtitle: "スキーマ検証と数値根拠の照合を通過した、読み取り専用の分析だけを公開します。"
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
  id,
  title,
  description,
  action,
  className = "",
  children
}: {
  id?: string;
  title?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`panel ${className}`} id={id}>
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

/**
 * Uncollected data is not a failure, so the neutral tone is the default; `alert` is reserved for
 * states the visitor is expected to act on.
 */
function EmptyState({
  title,
  detail,
  tone = "info"
}: {
  title: string;
  detail: string;
  tone?: "info" | "alert";
}) {
  return (
    <div className="state-card">
      {tone === "alert" ? (
        <CircleAlert size={26} aria-hidden="true" />
      ) : (
        <Info size={26} aria-hidden="true" />
      )}
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

function LearnLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="learn-link" href={href} target="_blank" rel="noreferrer">
      {children} <ExternalLink size={13} aria-hidden="true" />
    </a>
  );
}

/** Collection status belongs in a footnote, not in a headline card. */
function SourceFootnote({ sources }: { sources: SourceStatus[] }) {
  if (!sources.length) return null;
  return (
    <p className="source-footnote">
      <Info size={14} aria-hidden="true" />
      <span>
        {sources
          .map((source) => `${formatSourceName(source.source)}: ${formatSourceMessage(source)}`)
          .join(" ")}
      </span>
    </p>
  );
}

/**
 * Stacked view of every inventoried resource by Resource Health outcome. It stays readable when
 * nothing has been evaluated yet, because "未評価" and "対象外" are segments rather than blanks.
 */
function CoverageBar({
  segments,
  total,
  label
}: {
  segments: CoverageSegment[];
  total: number;
  label: string;
}) {
  if (!total || !segments.length) return null;
  return (
    <div className="coverage-bar-wrap">
      <div className="coverage-bar" role="img" aria-label={`${label}: ${segments
        .map((segment) => `${segment.label} ${segment.count} 件`)
        .join("、")}`}>
        {segments.map((segment) => (
          <span
            key={segment.key}
            className={`coverage-segment severity-${segment.severity}`}
            style={{ width: `${(segment.count / total) * 100}%` }}
          />
        ))}
      </div>
      <ul className="coverage-legend">
        {segments.map((segment) => (
          <li key={segment.key}>
            <span className={`health-dot severity-${segment.severity}`} aria-hidden="true" />
            <strong>{segment.label}</strong>
            <span>{numberFormatter.format(segment.count)} 件</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TypeCoverageRow({ row }: { row: ResourceTypeCoverageRow }) {
  const detail = row.supported
    ? row.evaluated
      ? `正常 ${row.healthy} 件・低下 ${row.degraded} 件・利用不可 ${row.unavailable} 件・未評価 ${row.unevaluated} 件`
      : `評価待ち ${row.unevaluated} 件`
    : "Azure が状態を公開しない種別";
  return (
    <div className="coverage-type-row">
      <div>
        <strong>{row.type}</strong>
        <small>{detail}</small>
      </div>
      <span className="coverage-type-count">{numberFormatter.format(row.total)} 件</span>
      <StatusBadge severity={row.supported ? (row.evaluated ? "healthy" : "warning") : "info"}>
        {row.supported ? (row.evaluated ? "評価済み" : "対応・評価待ち") : "対象外"}
      </StatusBadge>
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
            <strong>{formatSourceName(source.source)}</strong>
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
  const scrollToAutomationPipeline = () => {
    document.getElementById("automation-pipeline")?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  };
  const coverage = data.reliability.coverage;
  const defenderSource = data.sources.find((source) => source.source === "Defender for Cloud");
  const defenderRecommendationCount = metricWhenSourcePublished(
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
            <button
              type="button"
              className="primary-cta"
              aria-label="自動更新パイプラインへ移動"
              aria-controls="automation-pipeline"
              onClick={scrollToAutomationPipeline}
            >
              自動化の仕組みを見る <ChevronRight size={16} aria-hidden="true" />
            </button>
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
            {coverage.evaluatedResources}/{coverage.supportedResources} 件
          </strong>
          <small>
            未評価 {coverage.unevaluatedResources} 件・対象外 {coverage.notApplicableResources}{" "}
            件は正常・異常に含めません
          </small>
        </div>
      </section>

      <Panel
        id="automation-pipeline"
        title="自動更新パイプライン"
        description={`構成として有効な処理を示しています。現在の公開スナップショットの最終収集は ${formatDateTimeJa(data.freshness.lastSuccessfulCollection)} です。`}
        className="automation-panel"
      >
        <div className="pipeline-steps">
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
          note={formatCostDelta(publishedCostDeltaPercent(data.cost))}
        />
        <MetricCard
          label="Defender 推奨事項"
          value={
            defenderRecommendationCount === null
              ? "未収集"
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
          note={
            data.aiInsights.length
              ? "数値根拠とソース パスを照合済み"
              : "公開ゲートを通過した分析がまだありません"
          }
          severity={data.aiInsights.length ? "healthy" : "info"}
        />
      </section>

      <Panel
        title="公開指標"
        description="公開スナップショットに記録され、AI 分析が数値根拠として参照する指標です。"
      >
        {data.overview.metrics.length ? (
          <div className="published-metric-list">
            {data.overview.metrics.map((metric) => (
              <article key={metric.label}>
                <p>{metric.label}</p>
                <strong>{metric.value}</strong>
                <span className={`metric-note severity-${metric.severity}`}>
                  {metric.change}
                </span>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="公開指標はありません"
            detail="この収集ウィンドウでは、公開できる指標が記録されませんでした。"
          />
        )}
      </Panel>

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
              <dd>{formatCostDelta(publishedCostDeltaPercent(data.cost))}</dd>
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
                    <p>{event.detail}</p>
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

        {data.aiInsights.length ? (
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
        ) : null}
      </div>
    </div>
  );
}

function CostPage({ data }: { data: PublicSnapshotV1 }) {
  // The browser never revalidates snapshot.json, so a change is only rendered when the amount it was
  // measured against is itself published. The other two buckets are named in a footnote rather than
  // dropped silently, so a missing percentage reads as a stated rule instead of a gap.
  const comparableCategories = data.cost.categories.filter(
    (category) =>
      category.deltaPercent !== null && !isWithheldJpyAmount(category.approximateAmount)
  );
  const belowFloorCategories = data.cost.categories.filter((category) =>
    isWithheldJpyAmount(category.approximateAmount)
  );
  const noBaselineCategories = data.cost.categories.filter(
    (category) =>
      category.deltaPercent === null && !isWithheldJpyAmount(category.approximateAmount)
  );
  // The snapshot carries no prior-period amount per service, so a missing percentage can mean "no
  // prior record", "the prior amount was below the publication floor", or "the periods sat on
  // opposite sides of zero". The copy below therefore states only the comparability gap itself,
  // never a claim about what the prior period contained.
  const totalDeltaPercent = publishedCostDeltaPercent(data.cost);
  const changeNotes = [
    belowFloorCategories.length
      ? `金額が ${WITHHELD_JPY_AMOUNT_LABEL}の ${belowFloorCategories.length} サービスは変化率を出していません。公開する金額に満たないため、比率の根拠を示せないからです。`
      : null,
    noBaselineCategories.length
      ? `${noBaselineCategories.map((category) => category.name).join("・")}は前期間と比較できる公開値がそろわないため、変化率を出していません。`
      : null
  ].filter((note): note is string => note !== null);
  const canShowTrend = data.mode === "AZURE" && data.cost.normalizedTrend.length > 1;
  const uncollected = [
    data.cost.forecast.availability === "available" ? null : "予測",
    data.cost.budget.availability === "available" ? null : "予算使用率"
  ].filter((label): label is string => label !== null);

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
          value={data.cost.current.approximateAmount ?? "未収集"}
          note={formatCostDelta(totalDeltaPercent)}
        />
        <MetricCard
          label="前期間"
          value={data.cost.previous.approximateAmount ?? "未収集"}
          note="現在期間と同じ日数で比較した概算値"
        />
        <MetricCard
          label="期間差"
          value={
            totalDeltaPercent === null
              ? "比較不可"
              : `${totalDeltaPercent > 0 ? "+" : ""}${numberFormatter.format(totalDeltaPercent)}%`
          }
          note={
            totalDeltaPercent === null
              ? "比較できる前期間のデータがありません"
              : "同じ日数の前期間との比較"
          }
          severity={totalDeltaPercent !== null && totalDeltaPercent > 0 ? "warning" : "info"}
        />
        <MetricCard
          label="対象サービス"
          value={`${numberFormatter.format(data.cost.categories.length)} 件`}
          note="概算額を公開できたサービス数"
        />
      </section>
      <div className="content-grid">
        <Panel
          title="サービス別コスト構成"
          description="サービス名と構成比は公開スナップショットの値です。"
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
              title="サービス別コストは未収集"
              detail="公開できるサービス別コストがこの収集ウィンドウにはありません。"
            />
          )}
        </Panel>
        <Panel
          title="前期間からの変化"
          description="当期・前期とも金額を公開できたサービスだけを、変化の大きい順に並べています。"
          className="span-5"
        >
          {comparableCategories.length ? (
            <div className="delta-list">
              {comparableCategories
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
              title="比較できるサービスがありません"
              detail={`金額が ${WITHHELD_JPY_AMOUNT_LABEL}のサービスと、前期間と比較できる公開値がそろわないサービスは変化率を出しません。`}
            />
          )}
          {changeNotes.length > 0 && (
            <p className="source-footnote">
              <Info size={14} aria-hidden="true" />
              <span>{changeNotes.join(" ")}</span>
            </p>
          )}
        </Panel>
        {canShowTrend && (
          <Panel
            title="正規化済み支出系列"
            description="Azure 収集で公開された実測系列です。"
            className="span-12"
          >
            <div className="chart-shell" aria-label="正規化済み支出系列">
              {data.cost.normalizedTrend.map((value, index) => (
                <div className="chart-column" key={`${value}-${index}`}>
                  <span style={{ height: `${Math.min(100, Math.max(0, value))}%` }} />
                  <small>{index + 1}</small>
                </div>
              ))}
            </div>
          </Panel>
        )}
      </div>
      {(uncollected.length > 0 || !canShowTrend) && (
        <p className="source-footnote">
          <Info size={14} aria-hidden="true" />
          <span>
            {uncollected.length
              ? `${uncollected.join("・")}は、このスナップショットでは収集していないため表示していません。`
              : ""}
            {canShowTrend
              ? ""
              : data.mode === "AZURE"
                ? "単一期間の合計から時系列や予測を合成しないため、実測の支出系列も表示していません。"
                : "デモ モードの支出系列は合成値のため、実測の系列としては表示していません。"}
          </span>
        </p>
      )}
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
  const coverage = data.reliability.coverage;
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
          value={`${numberFormatter.format(data.inventory.total)} 件`}
          note={`${numberFormatter.format(data.inventory.byType.length)} 種別・${numberFormatter.format(data.inventory.byRegion.length)} リージョン`}
        />
        <MetricCard
          label="Resource Health 対応"
          value={`${numberFormatter.format(coverage.supportedResources)} 件`}
          note="Azure が可用性を公開する種別"
        />
        <MetricCard
          label="対象外"
          value={`${numberFormatter.format(coverage.notApplicableResources)} 件`}
          note="Resource Health が評価しない種別。異常ではありません"
        />
        <MetricCard
          label="最も多い種別"
          value={
            data.inventory.byType.length
              ? `${numberFormatter.format(
                  [...data.inventory.byType].sort((a, b) => b.count - a.count)[0]!.count
                )} 件`
              : "未収集"
          }
          note={
            data.inventory.byType.length
              ? [...data.inventory.byType].sort((a, b) => b.count - a.count)[0]!.label
              : "公開できるリソース種別がありません"
          }
        />
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
              <option value="NotApplicable">対象外</option>
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
  const navigate = useNavigate();
  const coverage = data.reliability.coverage;
  const serviceHealth = data.reliability.serviceHealth;
  const resourceHealthSource = data.sources.find((source) => source.source === "Resource Health");
  const serviceHealthSource = data.sources.find((source) => source.source === "Service Health");
  const activityLogSource = data.sources.find((source) => source.source === "Activity Log");
  const typeRows = useMemo(
    () => summarizeCoverageByType(data.inventory.resources),
    [data.inventory.resources]
  );
  const regionRows = useMemo(
    () => summarizeCoverageByRegion(data.inventory.resources),
    [data.inventory.resources]
  );
  const supportedTypeRows = typeRows.filter((row) => row.supported);
  const blindSpots = blindSpotSummary(typeRows, 6);
  const segments = coverageSegments(coverage);
  const supportedShare = supportedSharePercent(coverage);
  const failures = confirmedFailures(coverage);
  const healthyRate = data.overview.postureScore;
  const reliabilitySources = [
    resourceHealthSource,
    serviceHealthSource,
    activityLogSource
  ].filter((source): source is SourceStatus => source !== undefined);
  const reliabilityEvents = data.overview.eventTimeline.filter(
    (event) => event.route === "/reliability" || event.route === "/overview"
  );

  return (
    <div className="page-stack">
      <section className="coverage-hero" aria-labelledby="coverage-hero-title">
        <div>
          <p className="eyebrow">Azure Resource Health</p>
          <h2 id="coverage-hero-title">
            {numberFormatter.format(coverage.totalResources)} 件のうち{" "}
            {numberFormatter.format(coverage.supportedResources)} 件が Resource Health で監視できます
          </h2>
          <p>
            Azure は種別ごとに可用性を公開します。残り{" "}
            {numberFormatter.format(coverage.notApplicableResources)} 件（
            {numberFormatter.format(blindSpots.types)} 種別）は Azure
            が状態を公開しない「対象外」で、異常ではありません。ここが Azure Monitor
            のメトリックやアラートで補うべき監視の死角です。
          </p>
          <LearnLink href={RESOURCE_HEALTH_TYPES_DOC}>
            対応リソース種別の一覧（Microsoft Learn）
          </LearnLink>
        </div>
        <CoverageBar
          segments={segments}
          total={coverage.totalResources}
          label="Resource Health の内訳"
        />
      </section>

      <section className="metric-grid four" aria-label="Resource Health サマリー">
        <MetricCard
          label="監視できる範囲"
          value={`${numberFormatter.format(coverage.supportedResources)}/${numberFormatter.format(coverage.totalResources)} 件`}
          note={
            supportedShare === null
              ? "公開スナップショットにリソースがありません"
              : `インベントリの ${supportedShare}% が Resource Health の対応種別`
          }
          severity={supportedShare && supportedShare >= 50 ? "healthy" : "info"}
        />
        <MetricCard
          label="状態を取得できた数"
          value={`${numberFormatter.format(coverage.evaluatedResources)}/${numberFormatter.format(coverage.supportedResources)} 件`}
          note={
            coverage.supportedCoveragePercent === null
              ? "Resource Health の対応リソースがありません"
              : `対応リソースの ${coverage.supportedCoveragePercent}% を評価済み${
                  healthyRate === null ? "" : `・うち正常 ${healthyRate}%`
                }`
          }
          severity={coverage.evaluatedResources ? "healthy" : "warning"}
        />
        <MetricCard
          label="監視の死角"
          value={`${numberFormatter.format(blindSpots.resources)} 件`}
          note={`${numberFormatter.format(blindSpots.types)} 種別が Resource Health の対象外。Azure Monitor での代替監視が必要です`}
        />
        <MetricCard
          label="確認された障害"
          value={failures === null ? "判定前" : `${numberFormatter.format(failures)} 件`}
          note={
            failures === null
              ? "評価済みが 0 件のため、障害の有無は判定していません（0 件とは表示しません）"
              : `低下 ${coverage.degradedResources} 件・利用不可 ${coverage.unavailableResources} 件`
          }
          severity={failures ? "warning" : "info"}
        />
      </section>

      <div className="content-grid">
        <Panel
          title="リソース種別ごとの監視カバレッジ"
          description="Azure Resource Health が状態を公開する種別と、公開しない種別を分けて集計しています。"
          className="span-7"
          action={
            <button type="button" className="text-button" onClick={() => navigate("/resources")}>
              インベントリを開く <ChevronRight size={15} aria-hidden="true" />
            </button>
          }
        >
          {typeRows.length ? (
            <>
              <h3 className="coverage-subhead">
                <Server size={15} aria-hidden="true" />
                Resource Health 対応（{numberFormatter.format(supportedTypeRows.length)} 種別・
                {numberFormatter.format(coverage.supportedResources)} 件）
              </h3>
              {supportedTypeRows.length ? (
                <div className="coverage-type-list">
                  {supportedTypeRows.map((row) => (
                    <TypeCoverageRow key={row.type} row={row} />
                  ))}
                </div>
              ) : (
                <p className="muted">
                  このスナップショットには Resource Health 対応種別のリソースがありません。
                </p>
              )}
              <h3 className="coverage-subhead">
                <Layers size={15} aria-hidden="true" />
                対象外（{numberFormatter.format(blindSpots.types)} 種別・
                {numberFormatter.format(blindSpots.resources)} 件）
              </h3>
              {blindSpots.topTypes.length ? (
                <div className="coverage-type-list">
                  {blindSpots.topTypes.map((row) => (
                    <TypeCoverageRow key={row.type} row={row} />
                  ))}
                  {blindSpots.types > blindSpots.topTypes.length && (
                    <p className="muted">
                      ほか {numberFormatter.format(blindSpots.types - blindSpots.topTypes.length)}{" "}
                      種別も対象外です。
                    </p>
                  )}
                </div>
              ) : (
                <p className="muted">対象外の種別はありません。</p>
              )}
            </>
          ) : (
            <EmptyState
              title="インベントリが空です"
              detail="公開スナップショットにリソースが含まれていないため、カバレッジを集計できません。"
            />
          )}
        </Panel>

        <Panel
          title="リージョン別の監視カバレッジ"
          description="リージョンごとに、Resource Health の対応・評価済み・対象外の件数を表示します。"
          className="span-5"
        >
          {regionRows.length ? (
            <div className="region-list">
              {regionRows.map((row) => (
                <div className="coverage-region-row" key={row.region}>
                  <span className="region-icon" aria-hidden="true">
                    <MapPin size={15} />
                  </span>
                  <div>
                    <strong>{row.region}</strong>
                    <small>
                      対応 {row.supported} 件・評価済み {row.evaluated} 件・対象外{" "}
                      {row.notApplicable} 件
                    </small>
                  </div>
                  <span className="coverage-type-count">
                    {numberFormatter.format(row.total)} 件
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="リージョン情報がありません"
              detail="公開スナップショットにリージョン付きのリソースがありません。"
            />
          )}
        </Panel>

        <Panel
          title="監視の死角をどう埋めるか"
          description="対象外の種別は Resource Health では監視できないため、別のシグナルで補います。"
          className="span-12"
        >
          <div className="boundary-grid">
            <article>
              <Gauge size={22} aria-hidden="true" />
              <strong>Azure Monitor のメトリック</strong>
              <p>
                プラットフォーム メトリックを持つ種別は、しきい値アラートで可用性の代替監視ができます。
                収集済みの取得状況はネットワーク ページで確認できます。
              </p>
            </article>
            <article>
              <Activity size={22} aria-hidden="true" />
              <strong>Activity Log とサービス正常性アラート</strong>
              <p>
                管理操作とプラットフォーム側の障害は Activity Log と Service Health
                で検知します。どちらもこのスナップショットの収集対象です。
              </p>
            </article>
            <article>
              <Info size={22} aria-hidden="true" />
              <strong>対象種別の確認</strong>
              <p>
                どの種別が Resource Health の対象かは公式ドキュメントで確認できます。
              </p>
              <LearnLink href={RESOURCE_HEALTH_OVERVIEW_DOC}>
                Resource Health の状態定義
              </LearnLink>
            </article>
          </div>
        </Panel>

        {serviceHealth.availability !== "unavailable" ? (
          <Panel
            title="Service Health イベント"
            description="サブスクリプションやリソースの詳細を除いた、サービス単位の集計だけを表示します。"
            className="span-7"
          >
            <section className="metric-grid two" aria-label="Service Health サマリー">
              <MetricCard
                label="継続中のイベント"
                value={`${numberFormatter.format(serviceHealth.activeEvents ?? 0)} 件`}
                note="収集ウィンドウ内で継続中と報告されたイベント"
                severity={serviceHealth.activeEvents ? "warning" : "healthy"}
              />
              <MetricCard
                label="解決済みのイベント"
                value={`${numberFormatter.format(serviceHealth.resolvedEvents ?? 0)} 件`}
                note="収集ウィンドウ内で解決済みと報告されたイベント"
              />
            </section>
            {serviceHealth.categories.length ? (
              <div className="region-list">
                {serviceHealth.categories.map((category) => (
                  <div className="region-row" key={category.label}>
                    <strong>{category.label}</strong>
                    <span>{numberFormatter.format(category.count)} 件</span>
                  </div>
                ))}
              </div>
            ) : null}
          </Panel>
        ) : null}

        <Panel
          title="直近の運用イベント"
          description="Activity Log から収集したイベントです。実行者と対象リソースの詳細は公開前に削除しています。"
          className={serviceHealth.availability === "unavailable" ? "span-12" : "span-5"}
        >
          {reliabilityEvents.length ? (
            <div className="timeline">
              {reliabilityEvents.slice(0, 5).map((event) => (
                <div className="timeline-item static" key={event.id}>
                  <span
                    className={`timeline-marker severity-${event.severity}`}
                    aria-hidden="true"
                  />
                  <span>
                    <small>{formatEventTimestamp(event.timestamp)}</small>
                    <strong>{formatActivityTitle(event.title)}</strong>
                    <p>{event.detail}</p>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="公開可能な運用イベントはありません"
              detail="この収集ウィンドウでは、公開できる Activity Log イベントがありませんでした。"
            />
          )}
        </Panel>

        {data.reliability.services.length ? (
          <Panel
            title="公開済みサービス目標"
            description="スナップショットに明示された目標・実績・エラー バジェットだけを表示します。"
            className="span-12"
          >
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
          </Panel>
        ) : null}

        <Panel
          title="このページの収集ソース"
          description="可用性はデータの取得範囲を表すもので、サービスが正常かどうかの判定ではありません。"
          className="span-12"
        >
          <div className="source-list">
            {reliabilitySources.map((source) => (
              <article className="source-row" key={source.source}>
                <span
                  className={`source-icon severity-${availabilitySeverity(source.availability)}`}
                  aria-hidden="true"
                >
                  {source.availability === "available" ? (
                    <CircleCheck size={17} />
                  ) : (
                    <Info size={17} />
                  )}
                </span>
                <div>
                  <strong>{formatSourceName(source.source)}</strong>
                  <p>{formatSourceMessage(source)}</p>
                </div>
                <StatusBadge severity={availabilitySeverity(source.availability)}>
                  {availabilityLabel(source.availability)}
                </StatusBadge>
              </article>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function SecurityPage({ data }: { data: PublicSnapshotV1 }) {
  const defenderSource = data.sources.find((source) => source.source === "Defender for Cloud");
  const defenderPublished = defenderSource !== undefined && defenderSource.availability !== "unavailable";
  const secureScore = metricWhenSourcePublished(defenderSource, data.security.secureScore);
  const activeAlerts = metricWhenSourcePublished(defenderSource, data.security.activeAlerts);
  const openRecommendations = metricWhenSourcePublished(
    defenderSource,
    data.security.recommendations.filter((item) => item.status !== "Resolved").length
  );
  const complianceCount = metricWhenSourcePublished(
    defenderSource,
    data.security.compliance.length
  );
  const unavailableNote = defenderSource
    ? formatSourceMessage(defenderSource)
    : "Defender for Cloud のソース状態が公開されていません。";
  const activityLogSource = data.sources.find((source) => source.source === "Activity Log");
  const managementEvents = data.overview.eventTimeline.filter(
    (event) => event.id !== "collection-complete"
  );

  if (!defenderPublished) {
    return (
      <div className="page-stack">
        <div className="notice muted">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>{unavailableNote}</span>
          {defenderSource && (
            <StatusBadge severity={availabilitySeverity(defenderSource.availability)}>
              {availabilityLabel(defenderSource.availability)}
            </StatusBadge>
          )}
        </div>
        <Panel
          title="Defender for Cloud は未収集です"
          description="このサブスクリプションでは Defender のプランが有効ではないため、集計値を公開していません。0 件や 0% として表示することはしません。"
        >
          <div className="pending-metric-grid" aria-label="有効化すると公開される指標">
            {[
              { label: "Secure score", detail: "推奨事項の達成率（0〜100）" },
              { label: "アクティブ アラート", detail: "未解決のセキュリティ アラート件数" },
              { label: "未解決の推奨事項", detail: "対応が必要な推奨事項の集計件数" },
              { label: "コンプライアンス集計", detail: "規制コンプライアンスのスコア集計" }
            ].map((item) => (
              <article key={item.label}>
                <p>{item.label}</p>
                <strong>未収集</strong>
                <span>{item.detail}</span>
              </article>
            ))}
          </div>
          <p className="source-footnote">
            <Info size={14} aria-hidden="true" />
            <span>
              Defender for Cloud のプランを有効にすると、次回の収集からこれらの集計値が公開されます。
            </span>
          </p>
          <LearnLink href={DEFENDER_PLANS_DOC}>
            Defender for Cloud のプランを有効にする（Microsoft Learn）
          </LearnLink>
        </Panel>
        <Panel
          title="収集できているセキュリティ関連シグナル"
          description="Defender が未収集でも、管理操作の可視化は Activity Log から収集しています。"
        >
          {activityLogSource && (
            <div className="source-list">
              <article className="source-row">
                <span
                  className={`source-icon severity-${availabilitySeverity(activityLogSource.availability)}`}
                  aria-hidden="true"
                >
                  {activityLogSource.availability === "available" ? (
                    <CircleCheck size={17} />
                  ) : (
                    <Info size={17} />
                  )}
                </span>
                <div>
                  <strong>{formatSourceName(activityLogSource.source)}</strong>
                  <p>{formatSourceMessage(activityLogSource)}</p>
                </div>
                <StatusBadge severity={availabilitySeverity(activityLogSource.availability)}>
                  {availabilityLabel(activityLogSource.availability)}
                </StatusBadge>
              </article>
            </div>
          )}
          {managementEvents.length ? (
            <div className="timeline">
              {managementEvents.slice(0, 5).map((event) => (
                <div className="timeline-item static" key={event.id}>
                  <span
                    className={`timeline-marker severity-${event.severity}`}
                    aria-hidden="true"
                  />
                  <span>
                    <small>{formatEventTimestamp(event.timestamp)}</small>
                    <strong>{formatActivityTitle(event.title)}</strong>
                    <p>{event.detail}</p>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="公開できる管理操作イベントはありません"
              detail="この収集ウィンドウでは、公開できる Activity Log イベントがありませんでした。"
            />
          )}
        </Panel>
        <Panel title="公開データ ポリシー">
          <div className="privacy-card horizontal">
            <ShieldCheck size={28} aria-hidden="true" />
            <div>
              <strong>集計を前提に公開</strong>
              <p>
                資産名、脆弱性の詳細、悪用情報、識別子は公開しません。Secure score
                はソースが値を公開した場合だけ表示し、実測の 0 と未収集を区別します。
              </p>
            </div>
          </div>
        </Panel>
      </div>
    );
  }

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
          value={secureScore === null ? "未収集" : `${secureScore}%`}
          note={
            secureScore === null
              ? "このスナップショットに Secure score は含まれていません"
              : "推奨事項の達成率（公開スナップショット値）"
          }
          severity={secureScore !== null && secureScore >= 70 ? "healthy" : "info"}
        />
        <MetricCard
          label="アクティブ アラート"
          value={activeAlerts === null ? "未収集" : `${numberFormatter.format(activeAlerts)} 件`}
          note={activeAlerts === null ? unavailableNote : "未解決のアラート件数のみ"}
          severity={activeAlerts ? "warning" : "info"}
        />
        <MetricCard
          label="未解決の推奨事項"
          value={
            openRecommendations === null
              ? "未収集"
              : `${numberFormatter.format(openRecommendations)} 件`
          }
          note={openRecommendations === null ? unavailableNote : "資産の詳細は除外して集計"}
        />
        <MetricCard
          label="コンプライアンス集計"
          value={
            complianceCount === null ? "未収集" : `${numberFormatter.format(complianceCount)} 件`
          }
          note={complianceCount === null ? unavailableNote : "収集できたフレームワーク数"}
        />
      </section>
      <div className="content-grid">
        <Panel
          title="Defender for Cloud 推奨事項"
          description="タイトル、重要度、影響件数、対応状態だけを公開します。"
          className="span-8"
        >
          {data.security.recommendations.length ? (
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
              title="公開できる推奨事項はありません"
              detail="推奨事項が 0 件でも安全だとは判断しません。この収集ウィンドウで公開できる推奨事項がなかった状態です。"
            />
          )}
        </Panel>
        <Panel
          title="コンプライアンス集計"
          description="収集できたスコアだけを表示します。"
          className="span-4"
        >
          {data.security.compliance.length ? (
            <div className="compliance-list">
              {data.security.compliance.map((item) => (
                <ProgressBar key={item.framework} value={item.score} label={item.framework} />
              ))}
            </div>
          ) : (
            <EmptyState
              title="コンプライアンス集計は未収集"
              detail="フレームワーク別のスコアはこのスナップショットに含まれていません。"
            />
          )}
        </Panel>
        <Panel title="公開データ ポリシー" className="span-12">
          <div className="privacy-card horizontal">
            <ShieldCheck size={28} aria-hidden="true" />
            <div>
              <strong>集計を前提に公開</strong>
              <p>
                資産名、脆弱性の詳細、悪用情報、識別子は公開しません。Secure score
                はソースが値を公開した場合だけ表示し、実測の 0 と未収集を区別します。
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
  const metricCoverage = data.network.metricCoverage;
  const networkSource = data.sources.find(
    (source) => source.source === "Network inventory and metrics"
  );
  const rows = telemetry.flows.filter((flow) => filter === "all" || flow.status === filter);
  const telemetryPublished = telemetry.availability !== "unavailable";
  const networkResources = data.inventory.resources.filter((resource) =>
    resource.type.startsWith("microsoft.network/")
  );
  const networkInInventory = networkResources.length;
  const networkBlindSpot = networkResources.filter(
    (resource) => resource.status === "NotApplicable"
  ).length;
  const networkTotalsAgree = networkInInventory === data.network.inventory.total;
  const telemetryMessage =
    telemetry.availability === "partial"
      ? "フロー テレメトリは一部のみ収集されています。範囲外の接続は評価しません。"
      : "収集済みフロー テレメトリの集計値です。";

  return (
    <div className="page-stack">
      <section className="metric-grid four" aria-label="ネットワーク サマリー">
        <MetricCard
          label="ネットワーク リソース"
          value={`${numberFormatter.format(data.network.inventory.total)} 件`}
          note="Azure Resource Graph から収集したインベントリ"
        />
        <MetricCard
          label="リソース種別"
          value={`${numberFormatter.format(data.network.inventory.byType.length)} 件`}
          note="Azure のリソース種別名をそのまま保持"
        />
        <MetricCard
          label="リージョン"
          value={`${numberFormatter.format(data.network.inventory.byRegion.length)} 件`}
          note="ネットワーク リソースが存在するリージョン数"
        />
        {metricCoverage ? (
          <MetricCard
            label="メトリック取得済み"
            value={`${numberFormatter.format(metricCoverage.metricCapableResources)}/${numberFormatter.format(metricCoverage.sampledResources)} 件`}
            note={`合計 ${numberFormatter.format(metricCoverage.metricSeries)} 系列を Azure Monitor から取得`}
            severity={metricCoverage.metricCapableResources ? "healthy" : "info"}
          />
        ) : (
          <MetricCard
            label="Resource Health 対象外"
            value={
              networkTotalsAgree
                ? `${numberFormatter.format(networkBlindSpot)}/${numberFormatter.format(networkInInventory)} 件`
                : `${numberFormatter.format(networkBlindSpot)} 件`
            }
            note="ネットワーク種別のうち Azure が可用性を公開しない件数。Azure Monitor での代替監視が必要です"
          />
        )}
      </section>
      <div className="content-grid">
        <Panel
          title="ネットワーク リソース種別"
          description="Azure のリソース種別名は原文のまま表示します。"
          className="span-6"
        >
          <DistributionList
            items={data.network.inventory.byType}
            emptyTitle="ネットワーク インベントリは未収集"
            emptyDetail="対応するネットワーク リソースは収集されていません。"
          />
        </Panel>
        <Panel
          title="ネットワーク リージョン"
          description="リージョンごとのネットワーク リソース数です。"
          className="span-6"
        >
          <DistributionList
            items={data.network.inventory.byRegion}
            emptyTitle="リージョン情報は未収集"
            emptyDetail="ネットワーク リソースのリージョン情報は収集されていません。"
          />
        </Panel>
        {metricCoverage ? (
          <Panel
            title="Azure Monitor メトリック取得状況"
            description="プラットフォーム メトリックを持たない種別は「対象外」であり、取得失敗ではありません。"
            className="span-12"
          >
            <section className="metric-grid four" aria-label="メトリック取得状況">
              <MetricCard
                label="サンプリング対象"
                value={`${numberFormatter.format(metricCoverage.sampledResources)}/${numberFormatter.format(metricCoverage.inventoryTotal)} 件`}
                note="収集ごとにサンプリングするネットワーク リソース数"
              />
              <MetricCard
                label="メトリック取得済み"
                value={`${numberFormatter.format(metricCoverage.metricCapableResources)} 件`}
                note={`合計 ${numberFormatter.format(metricCoverage.metricSeries)} 系列`}
                severity={metricCoverage.metricCapableResources ? "healthy" : "info"}
              />
              <MetricCard
                label="対象外"
                value={`${numberFormatter.format(metricCoverage.notApplicableResources)} 件`}
                note="プラットフォーム メトリックの名前空間を持たない種別"
              />
              <MetricCard
                label="取得失敗"
                value={`${numberFormatter.format(metricCoverage.failedResources)} 件`}
                note="対象外とは区別した実際の取得エラー"
                severity={metricCoverage.failedResources ? "warning" : "info"}
              />
            </section>
          </Panel>
        ) : null}
        {telemetryPublished && (
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
            {rows.length ? (
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
                      <strong>{formatEndpointLabel(flow.destination)}</strong>
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
        )}
      </div>
      {!metricCoverage && (
        <p className="source-footnote">
          <Info size={14} aria-hidden="true" />
          <span>
            Azure Monitor
            のメトリック取得状況（サンプリング数・取得系列・対象外・取得失敗）は、このスナップショットを生成した収集では記録されていません。次回の収集から公開されます。
          </span>
        </p>
      )}
      {!telemetryPublished && (
        <p className="source-footnote">
          <Info size={14} aria-hidden="true" />
          <span>
            フロー テレメトリ（正常接続・低下接続・ブロック フロー）は未収集のため表示していません。ネットワーク
            リソースが存在することを接続の正常性とは解釈しません。
          </span>
        </p>
      )}
      <SourceFootnote sources={networkSource ? [networkSource] : []} />
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
        <span>基準時点: {insight.period}</span>
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
  const evidenceCount = data.aiInsights.reduce(
    (count, insight) => count + insight.numericEvidence.length,
    0
  );

  if (!data.aiInsights.length) {
    return (
      <div className="page-stack">
        <div className="ai-banner">
          <span className="ai-icon">
            <Bot size={22} aria-hidden="true" />
          </span>
          <div>
            <strong>検証済み・読み取り専用の分析</strong>
            <p>サニタイズ済みの構造化データだけを使用し、Azure の変更や修復は実行しません。</p>
          </div>
          <StatusBadge severity="info">公開 0 件</StatusBadge>
        </div>
        <Panel
          title="公開済みの分析はまだありません"
          description="分析は、記載されたすべての数値が公開スナップショットの値と一致した場合だけ公開されます。条件を満たさない候補は破棄されるため、ここが空になることがあります。"
        >
          <div className="boundary-grid">
            <article>
              <Bot size={22} aria-hidden="true" />
              <strong>1. 分析候補を生成</strong>
              <p>スナップショットの公開 JSON だけを読み、観測・影響・推奨アクションを作成します。</p>
            </article>
            <article>
              <CircleCheck size={22} aria-hidden="true" />
              <strong>2. 数値根拠を照合</strong>
              <p>各数値がスナップショット内のスカラー値と一致するかを検証し、一致しない候補は破棄します。</p>
            </article>
            <article>
              <ShieldCheck size={22} aria-hidden="true" />
              <strong>3. 人がレビューして公開</strong>
              <p>Pull Request でレビューされた分析だけが、このページに公開されます。</p>
            </article>
          </div>
          <p className="source-footnote">
            <Info size={14} aria-hidden="true" />
            <span>
              最終収集は {formatDateTimeJa(data.generatedAt)}（{formatSnapshotAge(data.generatedAt)}
              ）です。次回の分析ワークフローで候補が作成されます。
            </span>
          </p>
        </Panel>
      </div>
    );
  }

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
          value={`${numberFormatter.format(data.aiInsights.length)} 件`}
          note={`数値根拠 ${numberFormatter.format(evidenceCount)} 件を照合済み`}
          severity="healthy"
        />
        <MetricCard
          label="要確認"
          value={`${numberFormatter.format(warnings)} 件`}
          note="重大または要確認の分析"
          severity={warnings ? "warning" : "info"}
        />
        <MetricCard
          label="対象領域"
          value={`${numberFormatter.format(domains.size)} 件`}
          note={[...domains].join("、")}
        />
        <MetricCard
          label="更新"
          value={formatSnapshotAge(data.generatedAt)}
          note={formatDateTimeJa(data.generatedAt)}
        />
      </section>

      <Panel
        title="分析の基準時点"
        description="各分析が参照したスナップショットの収集時点です。分析対象の集計期間そのものではありません。"
      >
        <div className="chip-list">
          {periods.map((period) => (
            <span key={period}>{period}</span>
          ))}
        </div>
      </Panel>

      <Panel
        title="優先アクション"
        description="推奨は人による確認を前提とし、自動実行されません。"
      >
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
      </Panel>

      <div className="insight-grid">
        {data.aiInsights.map((insight) => (
          <InsightCard insight={insight} key={insight.id} />
        ))}
      </div>

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
        <nav className="demo-navigation" aria-label="関連デモ">
          <span className="demo-navigation-label">デモ</span>
          <span className="demo-navigation-current" aria-current="page">
            Azure Ops Pulse
            <span className="sr-only">（現在のページ）</span>
          </span>
          {RELATED_DEMOS.map((demo) => (
            <a href={demo.href} key={demo.href}>
              {demo.label}
            </a>
          ))}
        </nav>
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
