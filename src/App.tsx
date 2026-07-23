import { useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  Bell,
  Bot,
  Boxes,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock3,
  Cloud,
  Coins,
  ExternalLink,
  Gauge,
  ListChecks,
  Menu,
  Minus,
  Network,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
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
  TrendMetric
} from "./data/contracts";
import { useSnapshot } from "./hooks/useSnapshot";
import { buildActionQueue } from "./lib/action-queue";
import {
  availabilityLabelJa,
  costMovementJa,
  directionAriaJa,
  flowStatusLabelJa,
  formatDateTimeJa,
  formatRelativeAgeJa,
  formatSignedPercentJa,
  freshnessLabelJa,
  modeLabelJa,
  recommendationStatusLabelJa,
  resourceStatusLabelJa,
  resourceStatusSeverity,
  severityLabelJa
} from "./lib/format-ja";

const NAV_ITEMS = [
  { path: "/overview", label: "概要", icon: Gauge },
  { path: "/cost", label: "コスト", icon: Coins },
  { path: "/resources", label: "リソース", icon: Boxes },
  { path: "/reliability", label: "信頼性", icon: Activity },
  { path: "/security", label: "セキュリティ", icon: ShieldCheck },
  { path: "/network", label: "ネットワーク", icon: Network },
  { path: "/ai-insights", label: "AIインサイト", icon: Sparkles }
];

const TITLES: Record<string, { title: string; subtitle: string }> = {
  "/overview": {
    title: "運用概要",
    subtitle: "コスト、信頼性、セキュリティ、変更を横断した統合ビュー"
  },
  "/cost": {
    title: "コストインテリジェンス",
    subtitle: "概算の公開安全な支出指標と変動の方向性"
  },
  "/resources": {
    title: "リソースインベントリ",
    subtitle: "オーナーと健全性情報を含む、サニタイズ済みの構成一覧"
  },
  "/reliability": {
    title: "信頼性",
    subtitle: "サービス目標、エラーバジェット、運用上の健全性"
  },
  "/security": {
    title: "セキュリティ体制",
    subtitle: "資産や攻撃詳細を含まない Defender の集計信号"
  },
  "/network": {
    title: "ネットワーク",
    subtitle: "マスクされたフローの健全性、レイテンシ、スループット、ポリシー結果"
  },
  "/ai-insights": {
    title: "AIインサイト",
    subtitle: "サニタイズ済み運用スナップショットに基づく根拠付き分析"
  }
};

/** Priority ranking shared by the Overview action queue and the AI insight board — critical
 * items sort first, healthy/verified items last. */
const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
  healthy: 3
};

function Sparkline({
  points,
  severity,
  direction
}: {
  points: number[];
  severity: Severity;
  direction: "up" | "down" | "flat";
}) {
  const width = 112;
  const height = 40;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = Math.max(1, max - min);
  const path = points
    .map((point, index) => {
      const x = (index / Math.max(1, points.length - 1)) * width;
      const y = height - ((point - min) / range) * (height - 6) - 3;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      className={`sparkline severity-${severity}`}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${directionAriaJa(direction)}の推移（${points.length} 件のデータ）`}
    >
      <path d={path} fill="none" stroke="var(--cp-accent)" strokeWidth="2.5" />
    </svg>
  );
}

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
  action,
  className = "",
  children
}: {
  title?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || action) && (
        <header className="panel-header">
          {title && <h2>{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

function KpiStrip({ metrics }: { metrics: TrendMetric[] }) {
  return (
    <div className="kpi-grid">
      {metrics.map((metric) => (
        <article className="kpi-card" key={metric.label}>
          <div>
            <p className="eyebrow">{metric.label}</p>
            <strong>{metric.value}</strong>
            <span className={`metric-change severity-${metric.severity}`}>
              {metric.direction === "up" ? (
                <TrendingUp size={14} aria-hidden="true" />
              ) : metric.direction === "down" ? (
                <TrendingDown size={14} aria-hidden="true" />
              ) : (
                <Activity size={14} aria-hidden="true" />
              )}
              {metric.change}
            </span>
          </div>
          {metric.points.length > 0 && (
            <Sparkline points={metric.points} severity={metric.severity} direction={metric.direction} />
          )}
        </article>
      ))}
    </div>
  );
}

function ProgressBar({ value, label }: { value: number; label: string }) {
  return (
    <div className="progress-wrap">
      <div className="progress-label">
        <span>{label}</span>
        <strong>{value}%</strong>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-label={label}
      >
        <span style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="state-card">
      <Search size={28} aria-hidden="true" />
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

/** Grounded KPI card for Overview — deliberately has no invented trend or sparkline; every value
 * and caption is derived directly from concrete snapshot fields. */
function OverviewKpiCard({
  label,
  value,
  caption,
  severity,
  icon: Icon
}: {
  label: string;
  value: string;
  caption: string;
  severity: Severity;
  icon: typeof Coins;
}) {
  return (
    <article className="kpi-card">
      <div>
        <p className="eyebrow">{label}</p>
        <strong>{value}</strong>
        <span className={`metric-change severity-${severity}`}>{caption}</span>
      </div>
      <span className="icon-tile" aria-hidden="true">
        <Icon size={20} />
      </span>
    </article>
  );
}

/** Ranks distribution items by count and derives a bar width relative to the largest count in
 * the visible set — never implies a percentage of the whole estate. */
function topDistribution(
  items: Array<{ label: string; count: number }>,
  limit = 6
): Array<{ label: string; count: number; percent: number }> {
  const sorted = [...items].sort((a, b) => b.count - a.count).slice(0, limit);
  const max = Math.max(1, ...sorted.map((item) => item.count));
  return sorted.map((item) => ({ ...item, percent: Math.round((item.count / max) * 100) }));
}

function OverviewPage({ data }: { data: PublicSnapshotV1 }) {
  const navigate = useNavigate();
  const actionItems = useMemo(() => buildActionQueue(data), [data]);

  const statusCounts = useMemo(() => {
    const counts: Record<ResourceItem["status"], number> = {
      Healthy: 0,
      Degraded: 0,
      Unavailable: 0,
      Unknown: 0
    };
    for (const resource of data.inventory.resources) counts[resource.status] += 1;
    return counts;
  }, [data.inventory.resources]);

  const costMovement = costMovementJa(data.cost.deltaPercent);
  const costSeverity: Severity =
    data.cost.current.availability === "unavailable"
      ? "info"
      : data.cost.deltaPercent !== null && data.cost.deltaPercent > 15
        ? "warning"
        : "healthy";
  const costCaption =
    data.cost.deltaPercent === null
      ? costMovement.label
      : `${costMovement.label}（${formatSignedPercentJa(data.cost.deltaPercent)}）`;

  const knownHealthCount = statusCounts.Healthy + statusCounts.Degraded + statusCounts.Unavailable;
  const resourceSeverity: Severity =
    statusCounts.Unavailable > 0
      ? "critical"
      : statusCounts.Degraded > 0
        ? "warning"
        : knownHealthCount === 0
          ? "info"
          : "healthy";
  const resourceCaption = `正常 ${statusCounts.Healthy} / 劣化 ${statusCounts.Degraded} / 利用不可 ${statusCounts.Unavailable} / 不明 ${statusCounts.Unknown}`;

  const openRecommendations = data.security.recommendations.filter(
    (item) => item.status !== "Resolved"
  );
  const hasDefenderSignal = data.security.activeAlerts > 0 || data.security.recommendations.length > 0;
  const securitySeverity: Severity = openRecommendations.some((item) => item.severity === "critical")
    ? "critical"
    : data.security.activeAlerts > 0 || openRecommendations.length > 0
      ? "warning"
      : hasDefenderSignal
        ? "healthy"
        : "info";
  const securityCaption = hasDefenderSignal
    ? `アクティブアラート ${data.security.activeAlerts} / 未対応の推奨事項 ${openRecommendations.length}`
    : "Defender の詳細データはまだありません";

  const telemetry = data.network.telemetry;
  const networkSeverity: Severity =
    telemetry.availability === "unavailable"
      ? "info"
      : (telemetry.blockedFlows ?? 0) > 0
        ? "critical"
        : (telemetry.degradedConnections ?? 0) > 0
          ? "warning"
          : "healthy";
  const networkCaption =
    telemetry.availability === "unavailable"
      ? "フローテレメトリは未収集"
      : `健全 ${telemetry.healthyConnections ?? 0} / 劣化 ${telemetry.degradedConnections ?? 0} / 遮断 ${telemetry.blockedFlows ?? 0}`;

  const criticalInsightCount = data.aiInsights.filter((item) => item.severity === "critical").length;
  const warningInsightCount = data.aiInsights.filter((item) => item.severity === "warning").length;
  const aiSeverity: Severity = criticalInsightCount
    ? "critical"
    : warningInsightCount
      ? "warning"
      : data.aiInsights.length
        ? "healthy"
        : "info";
  const aiCaption = data.aiInsights.length
    ? `重大 ${criticalInsightCount} / 警告 ${warningInsightCount}`
    : "検証済みのインサイトはまだありません";

  const unavailableSourceCount = data.sources.filter((s) => s.availability !== "available").length;
  const typeDistribution = topDistribution(data.inventory.byType);
  const regionDistribution = topDistribution(data.inventory.byRegion);
  const topCostServices = data.cost.categories.slice().sort((a, b) => b.sharePercent - a.sharePercent).slice(0, 5);

  return (
    <div className="page-stack">
      <dl className="status-strip" aria-label="収集状況とスコープ">
        <div>
          <dt>スコープ</dt>
          <dd>{data.scope.displayName}</dd>
        </div>
        <div>
          <dt>モード</dt>
          <dd>{modeLabelJa(data.mode)}</dd>
        </div>
        <div>
          <dt>最終収集</dt>
          <dd>
            {formatDateTimeJa(data.freshness.lastSuccessfulCollection)}
            <small>{formatRelativeAgeJa(data.freshness.ageMinutes)}</small>
          </dd>
        </div>
        <div>
          <dt>次回収集予定</dt>
          <dd>{data.freshness.nextScheduledCollection}</dd>
        </div>
        <div>
          <dt>データの新しさ</dt>
          <dd className={`severity-${data.freshness.state === "fresh" ? "healthy" : "warning"}`}>
            {freshnessLabelJa(data.freshness.state)}
          </dd>
        </div>
        <div>
          <dt>データソース</dt>
          <dd>
            {data.sources.length - unavailableSourceCount} / {data.sources.length} 件が利用可能
          </dd>
        </div>
      </dl>

      <div className="kpi-grid">
        <OverviewKpiCard
          label="コスト（前期比）"
          value={data.cost.current.approximateAmount ?? "不明"}
          caption={costCaption}
          severity={costSeverity}
          icon={Coins}
        />
        <OverviewKpiCard
          label="リソース"
          value={`${data.inventory.total} 件`}
          caption={resourceCaption}
          severity={resourceSeverity}
          icon={Boxes}
        />
        <OverviewKpiCard
          label="Defender 集計"
          value={`Secure Score ${data.security.secureScore}%`}
          caption={securityCaption}
          severity={securitySeverity}
          icon={ShieldCheck}
        />
        <OverviewKpiCard
          label="ネットワーク"
          value={`${data.network.inventory.total} 件のリソース`}
          caption={networkCaption}
          severity={networkSeverity}
          icon={Network}
        />
        <OverviewKpiCard
          label="AIインサイト"
          value={`${data.aiInsights.length} 件`}
          caption={aiCaption}
          severity={aiSeverity}
          icon={Sparkles}
        />
      </div>

      <div className="overview-grid">
        <Panel
          title="対応が必要な項目"
          className="span-2"
          action={<ListChecks size={18} aria-hidden="true" />}
        >
          {actionItems.length ? (
            <div className="timeline">
              {actionItems.map((item) => (
                <button className="timeline-item" key={item.id} onClick={() => navigate(item.route)}>
                  <span className={`timeline-marker severity-${item.severity}`} />
                  <span>
                    <strong>{item.title}</strong>
                    <p>{item.detail}</p>
                  </span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              title="対応が必要な項目はありません"
              detail="現在の収集データから、明確な対応が必要な項目は検出されていません。"
            />
          )}
        </Panel>

        <Panel
          title="コスト上位サービス"
          className="span-2"
          action={
            <button className="text-button" onClick={() => navigate("/cost")}>
              コストを見る <ChevronRight size={15} aria-hidden="true" />
            </button>
          }
        >
          {topCostServices.length ? (
            <div className="ranked-list">
              {topCostServices.map((category) => (
                <div className="ranked-row" key={category.name}>
                  <div>
                    <strong>{category.name}</strong>
                    <small>{category.approximateAmount}</small>
                  </div>
                  <div className="bar-track">
                    <span style={{ width: `${category.sharePercent}%` }} />
                  </div>
                  <span>{category.sharePercent}%</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="コストの内訳がありません"
              detail="サービス別のコスト内訳はまだ収集されていません。"
            />
          )}
        </Panel>

        <Panel title="リソースの種類">
          {typeDistribution.length ? (
            <div className="ranked-list">
              {typeDistribution.map((item) => (
                <div className="ranked-row" key={item.label}>
                  <strong>{item.label}</strong>
                  <div className="bar-track">
                    <span style={{ width: `${item.percent}%` }} />
                  </div>
                  <span>{item.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="リソースがありません" detail="インベントリの種類別集計はまだありません。" />
          )}
        </Panel>

        <Panel title="リージョン">
          {regionDistribution.length ? (
            <div className="ranked-list">
              {regionDistribution.map((item) => (
                <div className="ranked-row" key={item.label}>
                  <strong>{item.label}</strong>
                  <div className="bar-track">
                    <span style={{ width: `${item.percent}%` }} />
                  </div>
                  <span>{item.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="リージョンがありません" detail="インベントリのリージョン別集計はまだありません。" />
          )}
        </Panel>

        <Panel title="データソースの状況">
          <div className="source-list">
            {data.sources.map((source) => (
              <div className="source-row" key={source.source}>
                {source.availability === "available" ? (
                  <CircleCheck className="severity-healthy" size={18} aria-hidden="true" />
                ) : (
                  <CircleAlert className="severity-warning" size={18} aria-hidden="true" />
                )}
                <div>
                  <strong>{source.source}</strong>
                  <p>{source.message}</p>
                </div>
                <StatusBadge severity={source.availability === "available" ? "healthy" : "warning"}>
                  {availabilityLabelJa(source.availability)}
                </StatusBadge>
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          title="AIインサイトの概要"
          action={
            <button className="text-button" onClick={() => navigate("/ai-insights")}>
              すべて見る <ChevronRight size={15} aria-hidden="true" />
            </button>
          }
        >
          <dl className="mini-stats">
            <div>
              <dt>重大</dt>
              <dd>{criticalInsightCount}</dd>
            </div>
            <div>
              <dt>警告</dt>
              <dd>{warningInsightCount}</dd>
            </div>
            <div>
              <dt>情報・正常</dt>
              <dd>{Math.max(0, data.aiInsights.length - criticalInsightCount - warningInsightCount)}</dd>
            </div>
          </dl>
          {data.aiInsights[0] ? (
            <p className="insight-context">{data.aiInsights[0].title}</p>
          ) : (
            <p className="insight-context">検証済みのインサイトはまだありません。</p>
          )}
        </Panel>

        <Panel title="アクティビティ" className="span-4">
          <div className="timeline">
            {data.overview.eventTimeline.map((event) => (
              <button
                className="timeline-item"
                key={event.id}
                onClick={() => navigate(event.route)}
              >
                <span className={`timeline-marker severity-${event.severity}`} />
                <span>
                  <small>{formatDateTimeJa(event.timestamp)}</small>
                  <strong>{event.title}</strong>
                  <p>{event.detail}</p>
                </span>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function CostPage({ data }: { data: PublicSnapshotV1 }) {
  const delta = data.cost.deltaPercent;
  const budgetUsed = data.cost.budget.usedPercent;
  const changeDrivers = data.cost.categories.flatMap((category) =>
    category.deltaPercent === null ? [] : [{ ...category, deltaPercent: category.deltaPercent }]
  );
  const metrics: TrendMetric[] = [
    {
      label: "今回期間",
      value: data.cost.current.approximateAmount ?? "不明",
      change: delta === null ? "比較対象期間なし" : formatSignedPercentJa(delta),
      direction: delta === null ? "flat" : delta > 0 ? "up" : delta < 0 ? "down" : "flat",
      severity:
        data.cost.current.availability === "unavailable"
          ? "info"
          : delta !== null && delta > 5
            ? "warning"
            : "healthy",
      points: data.cost.normalizedTrend
    },
    {
      label: "予測",
      value: data.cost.forecast.approximateAmount ?? "不明",
      change:
        data.cost.forecast.availability === "available" ? "月末時点の推定値を収集済み" : "未収集",
      direction: "flat",
      severity: "info",
      points: data.cost.forecast.availability === "available" ? data.cost.normalizedTrend : []
    },
    {
      label: "予算使用率",
      value: budgetUsed === null ? "不明" : `${budgetUsed}%`,
      change: budgetUsed === null ? "予算は未収集" : "設定済み予算に対する使用率",
      direction: "flat",
      severity: budgetUsed === null ? "info" : budgetUsed > 85 ? "warning" : "healthy",
      points: budgetUsed === null ? [] : [budgetUsed, budgetUsed]
    }
  ];
  return (
    <div className="page-stack">
      <div className="notice">
        <Coins size={18} aria-hidden="true" />
        <span>金額は概算の公開安全な近似値です。正確な Azure コストは保存されません。</span>
      </div>
      <KpiStrip metrics={metrics} />
      <div className="bento-grid">
        <Panel title="正規化した支出の推移" className="wide-panel">
          {data.cost.normalizedTrend.length ? (
            <div className="chart-shell">
              {data.cost.normalizedTrend.map((value, index) => (
                <div className="chart-column" key={`${value}-${index}`}>
                  <span style={{ height: `${value}%` }} />
                  <small>{index + 1}週目</small>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="推移データはありません"
              detail="このコレクターは Azure コストの時系列データを提供していません。"
            />
          )}
        </Panel>
        <Panel title="サービス別内訳">
          <div className="ranked-list">
            {data.cost.categories.map((category) => (
              <div className="ranked-row" key={category.name}>
                <div>
                  <strong>{category.name}</strong>
                  <small>{category.approximateAmount}</small>
                </div>
                <div className="bar-track">
                  <span style={{ width: `${category.sharePercent}%` }} />
                </div>
                <span>{category.sharePercent}%</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="変動要因">
          {changeDrivers.length ? (
            <div className="driver-list">
              {changeDrivers
                .slice()
                .sort((a, b) => Math.abs(b.deltaPercent) - Math.abs(a.deltaPercent))
                .map((category) => {
                  const movement = costMovementJa(category.deltaPercent);
                  return (
                    <div className="driver-row" key={category.name}>
                      <span className="icon-tile">
                        {movement.direction === "up" ? (
                          <TrendingUp size={18} aria-hidden="true" />
                        ) : movement.direction === "down" ? (
                          <TrendingDown size={18} aria-hidden="true" />
                        ) : (
                          <Minus size={18} aria-hidden="true" />
                        )}
                      </span>
                      <div>
                        <strong>{category.name}</strong>
                        <p>前期比で{movement.label}</p>
                      </div>
                      <StatusBadge severity={category.deltaPercent > 8 ? "warning" : "healthy"}>
                        {formatSignedPercentJa(category.deltaPercent)}
                      </StatusBadge>
                    </div>
                  );
                })}
            </div>
          ) : (
            <EmptyState
              title="変動要因はまだありません"
              detail="サービス別の変動を公開するには、比較可能な直前期間のデータが必要です。"
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
          <button className="icon-button" onClick={onClose} aria-label="詳細パネルを閉じる">
            <X size={20} />
          </button>
        </header>
        <div className="drawer-status">
          <StatusBadge severity={resourceStatusSeverity(resource.status)}>
            {resourceStatusLabelJa(resource.status)}
          </StatusBadge>
          <span>{resource.type}</span>
        </div>
        <dl className="detail-list">
          <div>
            <dt>リソースグループ</dt>
            <dd>{resource.resourceGroup}</dd>
          </div>
          <div>
            <dt>リージョン</dt>
            <dd>{resource.region}</dd>
          </div>
          <div>
            <dt>オーナー</dt>
            <dd>{resource.owner}</dd>
          </div>
          <div>
            <dt>直近の変更</dt>
            <dd>{resource.change}</dd>
          </div>
        </dl>
        <div>
          <h3>許可されたタグ</h3>
          <div className="tag-list">
            {Object.entries(resource.tags).map(([key, value]) => (
              <span className="tag" key={key}>
                {key}: {value}
              </span>
            ))}
          </div>
        </div>
        <div className="drawer-callout">
          <ShieldCheck size={20} aria-hidden="true" />
          <p>名前・オーナー・識別子・タグは公開用のサニタイズ処理を通過しています。</p>
        </div>
      </aside>
    </div>
  );
}

const RESOURCE_STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "All", label: "すべて" },
  { value: "Healthy", label: resourceStatusLabelJa("Healthy") },
  { value: "Degraded", label: resourceStatusLabelJa("Degraded") },
  { value: "Unavailable", label: resourceStatusLabelJa("Unavailable") },
  { value: "Unknown", label: resourceStatusLabelJa("Unknown") }
];

function ResourcesPage({ data }: { data: PublicSnapshotV1 }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All");
  const [selected, setSelected] = useState<ResourceItem | null>(null);
  const filtered = useMemo(
    () =>
      data.inventory.resources.filter(
        (resource) =>
          (status === "All" || resource.status === status) &&
          `${resource.name} ${resource.type} ${resource.region}`
            .toLowerCase()
            .includes(query.toLowerCase())
      ),
    [data.inventory.resources, query, status]
  );

  return (
    <div className="page-stack">
      <div className="inventory-strip">
        <div>
          <span>リソース総数</span>
          <strong>{data.inventory.total}</strong>
        </div>
        {data.inventory.byType.slice(0, 4).map((item) => (
          <div key={item.label}>
            <span>{item.label}</span>
            <strong>{item.count}</strong>
          </div>
        ))}
      </div>
      <Panel>
        <div className="table-toolbar">
          <label className="search-control">
            <Search size={17} aria-hidden="true" />
            <span className="sr-only">リソースを検索</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="リソース名・種類・リージョンで検索"
            />
          </label>
          <label className="select-label">
            <span>状態</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              {RESOURCE_STATUS_FILTERS.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <span className="result-count">{filtered.length} 件</span>
        </div>
        {filtered.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>名前</th>
                  <th>種類</th>
                  <th>リージョン</th>
                  <th>状態</th>
                  <th>オーナー</th>
                  <th aria-label="詳細を開く" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((resource) => (
                  <tr key={resource.id}>
                    <td>
                      <button
                        className="resource-link"
                        onClick={() => setSelected(resource)}
                        aria-label={`${resource.name} の詳細を開く`}
                      >
                        <strong>{resource.name}</strong>
                        <small>{resource.resourceGroup}</small>
                      </button>
                    </td>
                    <td>{resource.type}</td>
                    <td>{resource.region}</td>
                    <td>
                      <StatusBadge severity={resourceStatusSeverity(resource.status)}>
                        {resourceStatusLabelJa(resource.status)}
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
            title="該当するリソースがありません"
            detail="検索キーワードまたは状態フィルターを変更してください。"
          />
        )}
      </Panel>
      <ResourceDrawer resource={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function ReliabilityPage({ data }: { data: PublicSnapshotV1 }) {
  const totalResources = data.inventory.total;
  const unknownResources = data.inventory.resources.filter(
    (resource) => resource.status === "Unknown"
  ).length;
  const noHealthSignal = totalResources > 0 && unknownResources === totalResources;
  const availabilityPercent = Number.parseFloat(data.reliability.availability);
  const availabilitySeverity: Severity = noHealthSignal
    ? "info"
    : Number.isFinite(availabilityPercent) && availabilityPercent >= 90
      ? "healthy"
      : "warning";
  const mttrUnavailable = /利用できません|Unavailable/i.test(data.reliability.meanTimeToRecover);

  const metrics: TrendMetric[] = [
    {
      label: "可用性",
      value: data.reliability.availability,
      change: noHealthSignal
        ? "リソースの健全性データが十分に収集されていないため参考値"
        : "収集時点のリソース健全性比率",
      direction: "flat",
      severity: availabilitySeverity,
      points: []
    },
    {
      label: "検知件数",
      value: String(data.reliability.incidents),
      change: "収集時点の検知件数",
      direction: "flat",
      severity: data.reliability.incidents > 0 ? "warning" : "healthy",
      points: []
    },
    {
      label: "平均復旧時間（MTTR）",
      value: data.reliability.meanTimeToRecover,
      change: mttrUnavailable ? "このスナップショットには含まれていません" : "直近インシデントの実測値",
      direction: "flat",
      severity: mttrUnavailable ? "info" : "healthy",
      points: []
    }
  ];
  return (
    <div className="page-stack">
      <KpiStrip metrics={metrics} />
      <Panel title="サービス目標">
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
                  <StatusBadge severity={service.status}>{severityLabelJa(service.status)}</StatusBadge>
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
                  <div>
                    <dt>検知件数</dt>
                    <dd>{service.incidents}</dd>
                  </div>
                </dl>
                <ProgressBar value={service.budgetRemainingPercent} label="残エラーバジェット" />
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="SLO対象サービスがありません"
            detail="このスナップショットには、サービスレベル目標を追跡しているサービスが含まれていません。Resource Health または Service Health の収集状況を確認してください。"
          />
        )}
      </Panel>
    </div>
  );
}

function SecurityPage({ data }: { data: PublicSnapshotV1 }) {
  const openRecommendations = data.security.recommendations.filter(
    (item) => item.status !== "Resolved"
  );
  const hasDefenderSignal = data.security.activeAlerts > 0 || data.security.recommendations.length > 0;
  const secureScoreSeverity: Severity = !hasDefenderSignal
    ? "info"
    : data.security.secureScore >= 70
      ? "healthy"
      : "warning";
  const metrics: TrendMetric[] = [
    {
      label: "Secure Score",
      value: `${data.security.secureScore}%`,
      change: hasDefenderSignal ? "現在の集計値" : "Defender の詳細データはまだありません",
      direction: "flat",
      severity: secureScoreSeverity,
      points: []
    },
    {
      label: "アクティブアラート",
      value: String(data.security.activeAlerts),
      change: "集計のみ（個別のアラート内容は非公開）",
      direction: "flat",
      severity: data.security.activeAlerts > 0 ? "warning" : "healthy",
      points: []
    },
    {
      label: "未対応の推奨事項",
      value: String(openRecommendations.length),
      change: "保護対象の estate 全体における件数",
      direction: "flat",
      severity: openRecommendations.some((item) => item.severity === "critical") ? "critical" : "info",
      points: []
    }
  ];
  return (
    <div className="page-stack">
      <KpiStrip metrics={metrics} />
      <div className="bento-grid">
        <Panel title="Defender の推奨事項" className="wide-panel">
          {data.security.recommendations.length ? (
            <div className="recommendation-list">
              {data.security.recommendations.map((item) => (
                <div className="recommendation-row" key={item.title}>
                  <span className={`priority-line severity-${item.severity}`} />
                  <div>
                    <strong>{item.title}</strong>
                    <p>影響を受けるリソース {item.affectedCount} 件・集計のみ</p>
                  </div>
                  <StatusBadge severity={item.severity}>
                    {recommendationStatusLabelJa(item.status)}
                  </StatusBadge>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="推奨事項のデータがありません"
              detail="現在のスナップショットには開いている Defender の推奨事項がありません。すべて解決済み、またはまだ収集されていない可能性があります。"
            />
          )}
        </Panel>
        <Panel title="コンプライアンス状況">
          {data.security.compliance.length ? (
            <div className="compliance-list">
              {data.security.compliance.map((item) => (
                <ProgressBar key={item.framework} value={item.score} label={item.framework} />
              ))}
            </div>
          ) : (
            <EmptyState
              title="コンプライアンス項目がありません"
              detail="現在のスナップショットにはコンプライアンスフレームワークの集計が含まれていません。"
            />
          )}
        </Panel>
        <Panel title="公開情報の取り扱い方針">
          <div className="privacy-card">
            <ShieldCheck size={28} aria-hidden="true" />
            <strong>集計情報のみを公開する設計</strong>
            <p>
              推奨事項のタイトルと件数のみを表示します。資産名、脆弱性の詳細、攻撃手法、アイデンティティは公開前に取り除かれます。
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}

const FLOW_STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "All", label: "すべて" },
  { value: "Allowed", label: flowStatusLabelJa("Allowed") },
  { value: "Degraded", label: flowStatusLabelJa("Degraded") },
  { value: "Blocked", label: flowStatusLabelJa("Blocked") }
];

function NetworkPage({ data }: { data: PublicSnapshotV1 }) {
  const [filter, setFilter] = useState("All");
  const telemetry = data.network.telemetry;
  const rows = telemetry.flows.filter((flow) => filter === "All" || flow.status === filter);
  return (
    <div className="page-stack">
      <div className="inventory-strip">
        <div>
          <span>ネットワークリソース</span>
          <strong>{data.network.inventory.total}</strong>
        </div>
        <div>
          <span>リソースの種類</span>
          <strong>{data.network.inventory.byType.length}</strong>
        </div>
        <div>
          <span>リージョン</span>
          <strong>{data.network.inventory.byRegion.length}</strong>
        </div>
        <div>
          <span>エンドポイントの扱い</span>
          <strong>マスク済み</strong>
        </div>
      </div>
      <div className="bento-grid">
        <Panel title="ネットワークインベントリ">
          {data.network.inventory.byType.length ? (
            <div className="ranked-list">
              {data.network.inventory.byType.map((item) => (
                <div className="ranked-row" key={item.label}>
                  <strong>{item.label}</strong>
                  <span>{item.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="ネットワークインベントリはありません"
              detail="このスナップショットには対応するネットワークリソースが含まれていません。"
            />
          )}
        </Panel>
        <Panel title="フローテレメトリの状況">
          <div className="privacy-card">
            <Network size={28} aria-hidden="true" />
            <strong>
              {telemetry.availability === "unavailable"
                ? availabilityLabelJa("unavailable")
                : `健全な接続 ${telemetry.healthyConnections ?? 0} 件`}
            </strong>
            <p>{telemetry.message}</p>
          </div>
        </Panel>
      </div>
      <Panel
        title="観測されたフローテレメトリ"
        action={
          <label className="select-label compact">
            <span className="sr-only">フローの状態</span>
            <select value={filter} onChange={(event) => setFilter(event.target.value)}>
              {FLOW_STATUS_FILTERS.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        }
      >
        {telemetry.availability === "unavailable" ? (
          <EmptyState
            title="フローテレメトリは利用できません"
            detail="ネットワークリソースは収集されていますが、リソースの存在自体を接続の健全性として扱うことはありません。"
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
                  <small>宛先</small>
                  <strong>{flow.destination}</strong>
                </div>
                <div className="flow-stat">
                  <small>プロトコル</small>
                  <strong>{flow.protocol}</strong>
                </div>
                <div className="flow-stat">
                  <small>レイテンシ</small>
                  <strong>{flow.latency}</strong>
                </div>
                <div className="flow-stat">
                  <small>スループット</small>
                  <strong>{flow.throughput}</strong>
                </div>
                <StatusBadge
                  severity={
                    flow.status === "Allowed"
                      ? "healthy"
                      : flow.status === "Degraded"
                        ? "warning"
                        : "critical"
                  }
                >
                  {flowStatusLabelJa(flow.status)}
                </StatusBadge>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="該当するフローがありません" detail="別のフロー状態フィルターを選択してください。" />
        )}
      </Panel>
    </div>
  );
}

function InsightCard({ insight }: { insight: AiInsight }) {
  const navigate = useNavigate();
  const pageLabel = TITLES[insight.route]?.title ?? insight.route;
  return (
    <article className="insight-card">
      <header>
        <StatusBadge severity={insight.severity}>{severityLabelJa(insight.severity)}</StatusBadge>
        <span className="confidence">信頼度 {Math.round(insight.confidence * 100)}%</span>
      </header>
      <h2>{insight.title}</h2>
      <p>{insight.observation}</p>
      <div className="insight-impact">
        <strong>想定される影響</strong>
        <p>{insight.impact}</p>
      </div>
      <div className="evidence-list">
        {insight.numericEvidence.map((evidence) => (
          <span key={`${evidence.source}-${evidence.value}`}>
            <strong>
              {evidence.label}: {evidence.value}
            </strong>
            <small>{evidence.source}</small>
          </span>
        ))}
      </div>
      <p className="insight-context">
        対象期間: {insight.period} ・ 関連ページ: {pageLabel}
      </p>
      <footer>
        <div>
          <small>推奨アクション</small>
          <strong>{insight.recommendedAction}</strong>
        </div>
        <button className="secondary-button" onClick={() => navigate(insight.route)}>
          詳細を見る <ExternalLink size={15} aria-hidden="true" />
        </button>
      </footer>
    </article>
  );
}

function AiInsightsPage({ data }: { data: PublicSnapshotV1 }) {
  const navigate = useNavigate();
  const insights = data.aiInsights;
  const verifiedCount = insights.filter(
    (insight) => insight.severity === "healthy" || insight.severity === "info"
  ).length;
  const attentionCount = insights.length - verifiedCount;
  const domains = [...new Set(insights.map((insight) => TITLES[insight.route]?.title ?? insight.route))];
  const periods = [...new Set(insights.map((insight) => insight.period))];
  const board = insights.slice().sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  return (
    <div className="page-stack">
      <div className="ai-banner">
        <span className="ai-icon">
          <Bot size={22} aria-hidden="true" />
        </span>
        <div>
          <strong>読み取り専用・匿名化データのみを分析</strong>
          <p>
            このエージェントは、公開済みでサニタイズ済みの運用スナップショットのみを分析します。Azure
            への接続や変更操作は一切行いません。
          </p>
        </div>
        <span>更新: {formatDateTimeJa(data.generatedAt)}</span>
      </div>

      <dl className="status-strip" aria-label="AIインサイトの概要">
        <div>
          <dt>検証済み（正常・情報）</dt>
          <dd>{verifiedCount} 件</dd>
        </div>
        <div>
          <dt>注意が必要（警告・重大）</dt>
          <dd>{attentionCount} 件</dd>
        </div>
        <div>
          <dt>対象領域</dt>
          <dd>{domains.length ? domains.join("、") : "―"}</dd>
        </div>
        <div>
          <dt>対象期間</dt>
          <dd>{periods.length ? periods.join("、") : "―"}</dd>
        </div>
        <div>
          <dt>更新</dt>
          <dd>{formatDateTimeJa(data.generatedAt)}</dd>
        </div>
      </dl>

      {insights.length ? (
        <>
          <Panel title="優先度の高い対応項目">
            <div className="timeline">
              {board.map((insight) => (
                <button
                  className="timeline-item"
                  key={`board-${insight.id}`}
                  onClick={() => navigate(insight.route)}
                >
                  <span className={`timeline-marker severity-${insight.severity}`} />
                  <span>
                    <small>
                      {severityLabelJa(insight.severity)} ・ 信頼度 {Math.round(insight.confidence * 100)}%
                    </small>
                    <strong>{insight.title}</strong>
                    <p>{insight.recommendedAction}</p>
                  </span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              ))}
            </div>
          </Panel>

          <div className="insight-grid">
            {insights.map((insight) => (
              <InsightCard insight={insight} key={insight.id} />
            ))}
          </div>
        </>
      ) : (
        <EmptyState
          title="検証済みのインサイトはまだありません"
          detail="直近の分析では、公開基準を満たす根拠が得られませんでした。次回の分析結果をお待ちください。"
        />
      )}

      <Panel title="このページの仕組み">
        <div className="privacy-card">
          <ShieldCheck size={28} aria-hidden="true" />
          <strong>読み取り専用・エビデンス限定の分析</strong>
          <p>
            公開済みでサニタイズ済みのスナップショットのみを対象とし、Azure や秘密情報へは一切アクセスしません。
          </p>
          <p>
            スキーマ検証、数値根拠の厳密な一致確認、プライバシースキャンをすべて通過した内容だけが公開されます。
          </p>
        </div>
      </Panel>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="loading-grid" aria-label="運用スナップショットを読み込み中">
      {[1, 2, 3, 4, 5, 6].map((item) => (
        <div className="skeleton" key={item} />
      ))}
    </div>
  );
}

function ErrorState({ error }: { error: string }) {
  return (
    <div className="error-state" role="alert">
      <CircleAlert size={32} aria-hidden="true" />
      <h2>運用スナップショットを利用できません</h2>
      <p>詳細: {error}</p>
      <small>収集に失敗した場合でも、最後に正常収集できたスナップショットは保持されます。</small>
    </div>
  );
}

function AppShell({ data }: { data: PublicSnapshotV1 }) {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const page = TITLES[location.pathname] ?? TITLES["/overview"]!;
  const fresh = data.freshness.state === "fresh";

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="brand">
          <span className="brand-mark">
            <Cloud size={22} aria-hidden="true" />
          </span>
          <span>
            <strong>Azure Ops Pulse</strong>
            <small>パブリック運用デモ</small>
          </span>
          <button className="mobile-close" onClick={() => setMenuOpen(false)} aria-label="メニューを閉じる">
            <X size={20} />
          </button>
        </div>
        <nav aria-label="メインナビゲーション">
          <span className="nav-section">ワークスペース</span>
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
          <div className="demo-badge">{modeLabelJa(data.mode)}</div>
          <p>
            {data.mode === "DEMO"
              ? "既定では合成データを使用します。Azure への接続は不要です。"
              : "サニタイズ済みの実際の Azure データを表示しています。"}
          </p>
          <a href="https://github.com/aktsmm/azure-ops-pulse-demo">
            リポジトリを見る <ExternalLink size={13} aria-hidden="true" />
          </a>
        </div>
      </aside>
      {menuOpen && <button className="nav-scrim" onClick={() => setMenuOpen(false)} aria-label="ナビゲーションを閉じる" />}
      <div className="main-column">
        <header className="topbar">
          <button className="menu-button" onClick={() => setMenuOpen(true)} aria-label="ナビゲーションを開く">
            <Menu size={20} />
          </button>
          <label className="scope-control">
            <span>スコープ</span>
            <select aria-label="サブスクリプションスコープ" defaultValue="current">
              <option value="current">{data.scope.displayName}</option>
            </select>
          </label>
          <label className="scope-control time-control">
            <Clock3 size={16} aria-hidden="true" />
            <select aria-label="期間" defaultValue="30d">
              <option value="24h">過去24時間</option>
              <option value="7d">過去7日間</option>
              <option value="30d">過去30日間</option>
              <option value="90d">過去90日間</option>
            </select>
          </label>
          <div className="topbar-spacer" />
          <div className="freshness">
            <span className={`health-dot severity-${fresh ? "healthy" : "warning"}`} />
            <span>
              <strong>{freshnessLabelJa(data.freshness.state)}</strong>
              <small>{formatDateTimeJa(data.generatedAt)}</small>
            </span>
          </div>
          <button className="icon-button" aria-label="通知">
            <Bell size={19} />
            <span className="notification-dot" />
          </button>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <p className="breadcrumb">運用 / {page.title}</p>
              <h1>{page.title}</h1>
              <p>{page.subtitle}</p>
            </div>
            <div className="mode-chip">
              <span>{modeLabelJa(data.mode)}</span>
              <small>スキーマ {data.schemaVersion}</small>
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
