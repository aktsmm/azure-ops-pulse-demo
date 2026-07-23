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
import { describeCostDelta } from "./lib/cost-delta";
import {
  availabilityLabelJa,
  costDeltaLabelJa,
  formatAgeJa,
  formatDateTimeJa,
  formatPercentDeltaJa,
  modeLabelJa,
  networkFlowStatusLabelJa,
  networkFlowStatusSeverity,
  recommendationStatusLabelJa,
  regionLabelJa,
  resourceStatusLabelJa,
  resourceStatusSeverity,
  severityLabelJa
} from "./lib/format";
import {
  buildActionQueue,
  resourceStatusCoverage,
  sourceCoverageSummary,
  type ActionQueueItem,
  type SourceCoverageSummary
} from "./lib/overview";

const NAV_ITEMS = [
  { path: "/overview", label: "概要", icon: Gauge },
  { path: "/cost", label: "コスト", icon: Coins },
  { path: "/resources", label: "リソース", icon: Boxes },
  { path: "/reliability", label: "信頼性", icon: Activity },
  { path: "/security", label: "セキュリティ", icon: ShieldCheck },
  { path: "/network", label: "ネットワーク", icon: Network },
  { path: "/ai-insights", label: "AI インサイト", icon: Sparkles }
];

const TITLES: Record<string, { title: string; subtitle: string }> = {
  "/overview": {
    title: "運用概要",
    subtitle: "コスト・信頼性・セキュリティ・変更を横断した収集状況と要確認事項"
  },
  "/cost": {
    title: "コスト分析",
    subtitle: "公開安全性のために丸めた概算コストと変動の方向性"
  },
  "/resources": {
    title: "リソース一覧",
    subtitle: "サニタイズ済みのリソース状況と保有者情報"
  },
  "/reliability": {
    title: "信頼性",
    subtitle: "サービス目標・エラーバジェット・収集時点の運用状況"
  },
  "/security": {
    title: "セキュリティ体制",
    subtitle: "資産名・脆弱性詳細を含まないDefenderの集計シグナル"
  },
  "/network": {
    title: "ネットワーク",
    subtitle: "マスク済みのフロー状況・レイテンシ・スループット・ポリシー結果"
  },
  "/ai-insights": {
    title: "AI インサイト",
    subtitle: "サニタイズ済み運用スナップショットに基づく根拠付き分析（読み取り専用）"
  }
};

function Sparkline({ points, severity }: { points: number[]; severity: Severity }) {
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
      aria-label={`${points.length}件の収集値による推移`}
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
          {metric.points.length > 0 ? (
            <Sparkline points={metric.points} severity={metric.severity} />
          ) : (
            <span className="sparkline-empty">収集時点の値のみ</span>
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

function StatusBar({
  data,
  sourceCoverage
}: {
  data: PublicSnapshotV1;
  sourceCoverage: SourceCoverageSummary;
}) {
  return (
    <div className="status-bar">
      <div className="status-bar-item">
        <span className="eyebrow">スコープ</span>
        <strong>{data.scope.displayName}</strong>
      </div>
      <div className="status-bar-item">
        <span className="eyebrow">最終収集</span>
        <strong>{formatDateTimeJa(data.freshness.lastSuccessfulCollection)}</strong>
        <small>{formatAgeJa(data.freshness.ageMinutes)}</small>
      </div>
      <div className="status-bar-item">
        <span className="eyebrow">次回収集予定</span>
        <strong>{data.freshness.nextScheduledCollection}</strong>
      </div>
      <div className="status-bar-item">
        <span className="eyebrow">モード</span>
        <strong>{modeLabelJa(data.mode)}</strong>
      </div>
      <div className="status-bar-item">
        <span className="eyebrow">鮮度</span>
        <StatusBadge severity={data.freshness.state === "fresh" ? "healthy" : "warning"}>
          {data.freshness.state === "fresh" ? "最新" : "古い"}
        </StatusBadge>
      </div>
      <div className="status-bar-item">
        <span className="eyebrow">データソース網羅</span>
        <strong>
          {sourceCoverage.available}/{sourceCoverage.total} 件が利用可能
        </strong>
        {(sourceCoverage.partial > 0 || sourceCoverage.unavailable > 0) && (
          <small>
            部分的 {sourceCoverage.partial}件・取得不可 {sourceCoverage.unavailable}件
          </small>
        )}
      </div>
    </div>
  );
}

function ActionQueuePanel({ items }: { items: ActionQueueItem[] }) {
  const navigate = useNavigate();
  return (
    <Panel
      title="要確認アクション"
      action={<ListChecks size={18} aria-hidden="true" />}
      className="action-panel"
    >
      {items.length ? (
        <div className="action-list">
          {items.map((item) => (
            <button className="action-row" key={item.id} onClick={() => navigate(item.route)}>
              <StatusBadge severity={item.severity}>{severityLabelJa(item.severity)}</StatusBadge>
              <div>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
              </div>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : (
        <EmptyState
          title="要確認事項なし"
          detail="根拠となる大きなコスト変動・未検証インサイト・未取得データソースは検出されていません。"
        />
      )}
    </Panel>
  );
}

function OverviewPage({ data }: { data: PublicSnapshotV1 }) {
  const navigate = useNavigate();
  const coverage = useMemo(
    () => resourceStatusCoverage(data.inventory.resources),
    [data.inventory.resources]
  );
  const sourceCoverage = useMemo(() => sourceCoverageSummary(data.sources), [data.sources]);
  const actionQueue = useMemo(() => buildActionQueue(data), [data]);

  const costValue = data.cost.current.approximateAmount ?? "取得不可";
  const costDetail =
    data.cost.current.availability !== "available"
      ? "現在期間のコストは未取得"
      : data.cost.deltaPercent === null
        ? "比較可能な前期データが未取得"
        : formatPercentDeltaJa(data.cost.deltaPercent);
  const costSeverity: Severity =
    data.cost.current.availability !== "available"
      ? "info"
      : data.cost.deltaPercent !== null && Math.abs(data.cost.deltaPercent) >= 20
        ? "warning"
        : "healthy";

  const openRecommendations = data.security.recommendations.filter(
    (item) => item.status !== "Resolved"
  ).length;

  const topServices = data.cost.categories
    .slice()
    .sort((a, b) => b.sharePercent - a.sharePercent)
    .slice(0, 6);

  return (
    <div className="page-stack">
      <StatusBar data={data} sourceCoverage={sourceCoverage} />
      <div className="overview-kpi-grid">
        <article className="kpi-card">
          <p className="eyebrow">現在のコスト</p>
          <strong>{costValue}</strong>
          <span className={`metric-change severity-${costSeverity}`}>{costDetail}</span>
        </article>
        <article className="kpi-card">
          <p className="eyebrow">リソース数</p>
          <strong>{data.inventory.total}</strong>
          <span className="metric-change">
            正常 {coverage.healthy}・低下 {coverage.degraded}・取得不可 {coverage.unavailable}
            ・不明 {coverage.unknown}
          </span>
        </article>
        <article className="kpi-card">
          <p className="eyebrow">Defender シグナル</p>
          <strong>Secure Score {data.security.secureScore}</strong>
          <span
            className={`metric-change severity-${
              data.security.activeAlerts > 0 ? "warning" : "healthy"
            }`}
          >
            未対応アラート {data.security.activeAlerts}件・未解決の推奨事項 {openRecommendations}
            件
          </span>
        </article>
        <article className="kpi-card">
          <p className="eyebrow">ネットワーク在庫</p>
          <strong>{data.network.inventory.total} 件</strong>
          <span
            className={`metric-change severity-${
              data.network.telemetry.availability === "available" ? "healthy" : "info"
            }`}
          >
            テレメトリ: {availabilityLabelJa(data.network.telemetry.availability)}
          </span>
        </article>
        <article className="kpi-card">
          <p className="eyebrow">AI インサイト</p>
          <strong>{data.aiInsights.length} 件</strong>
          <span className={`metric-change severity-${data.aiInsights.length ? "warning" : "info"}`}>
            {data.aiInsights.length ? "確認が必要な根拠付きインサイトあり" : "検証済みインサイトなし"}
          </span>
        </article>
      </div>
      <ActionQueuePanel items={actionQueue} />
      <div className="bento-grid overview-bento">
        <Panel
          title="コスト上位サービス"
          action={
            <button className="text-button" onClick={() => navigate("/cost")}>
              コストを見る <ChevronRight size={15} aria-hidden="true" />
            </button>
          }
        >
          {topServices.length ? (
            <div className="ranked-list">
              {topServices.map((category) => (
                <div className="ranked-row" key={category.name}>
                  <div>
                    <strong>{category.name}</strong>
                    <small>
                      {category.deltaPercent === null
                        ? "前期データ未取得"
                        : formatPercentDeltaJa(category.deltaPercent)}
                    </small>
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
              title="コスト内訳が未取得"
              detail="サービス別のコスト構成はまだ収集されていません。"
            />
          )}
        </Panel>
        <Panel title="リソース種別の分布">
          {data.inventory.byType.length ? (
            <div className="ranked-list">
              {data.inventory.byType.map((item) => (
                <div className="ranked-row" key={item.label}>
                  <strong>{item.label}</strong>
                  <span>{item.count} 件</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="種別データなし" detail="リソースの種別集計は未取得です。" />
          )}
        </Panel>
        <Panel title="地域別の分布">
          {data.inventory.byRegion.length ? (
            <div className="ranked-list">
              {data.inventory.byRegion.map((item) => {
                const health = data.overview.regionalHealth.find(
                  (region) => region.region === item.label
                );
                return (
                  <div className="ranked-row" key={item.label}>
                    <strong>{regionLabelJa(item.label)}</strong>
                    <span>{item.count} 件</span>
                    {health ? (
                      <StatusBadge severity={health.status}>
                        {health.coverage === "unknown" ? "健全性未取得" : `${health.score}%`}
                      </StatusBadge>
                    ) : (
                      <span className="muted-cell">—</span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState title="地域データなし" detail="リソースの地域集計は未取得です。" />
          )}
        </Panel>
        <Panel title="データソース網羅状況">
          <div className="source-list">
            {data.sources.map((source) => (
              <div className="source-row" key={source.source}>
                {source.availability === "available" ? (
                  <CircleCheck className="severity-healthy" size={18} aria-hidden="true" />
                ) : (
                  <CircleAlert
                    className={
                      source.availability === "partial" ? "severity-warning" : "severity-critical"
                    }
                    size={18}
                    aria-hidden="true"
                  />
                )}
                <div>
                  <strong>{source.source}</strong>
                  <p>{source.message}</p>
                </div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="アクティビティタイムライン" className="timeline-panel">
          {data.overview.eventTimeline.length ? (
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
          ) : (
            <EmptyState
              title="アクティビティなし"
              detail="直近のアクティビティイベントは記録されていません。"
            />
          )}
        </Panel>
        <Panel
          title="AI インサイトの概要"
          action={
            <button className="text-button" onClick={() => navigate("/ai-insights")}>
              詳細を見る <ChevronRight size={15} aria-hidden="true" />
            </button>
          }
        >
          {data.aiInsights.length ? (
            <div className="ranked-list">
              {data.aiInsights.map((insight) => (
                <div className="ranked-row" key={insight.id}>
                  <StatusBadge severity={insight.severity}>
                    {severityLabelJa(insight.severity)}
                  </StatusBadge>
                  <div>
                    <strong>{insight.title}</strong>
                    <small>{insight.period}</small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="検証済みインサイトなし"
              detail="直近の分析では公開ゲートを通過した根拠は生成されませんでした。"
            />
          )}
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
      label: "現在の期間",
      value: data.cost.current.approximateAmount ?? "取得不可",
      change: delta === null ? "前期データ未取得" : `${delta > 0 ? "+" : ""}${delta}%`,
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
      value: data.cost.forecast.approximateAmount ?? "取得不可",
      change:
        data.cost.forecast.availability === "available" ? "月末見込みを収集済み" : "未収集",
      direction: "flat",
      severity: "info",
      points: data.cost.forecast.availability === "available" ? data.cost.normalizedTrend : []
    },
    {
      label: "予算消化率",
      value: budgetUsed === null ? "取得不可" : `${budgetUsed}%`,
      change: budgetUsed === null ? "予算が未収集" : "設定予算に対する消化率",
      direction: "flat",
      severity: budgetUsed === null ? "info" : budgetUsed > 85 ? "warning" : "healthy",
      points: budgetUsed === null ? [] : [budgetUsed, budgetUsed]
    }
  ];
  return (
    <div className="page-stack">
      <div className="notice">
        <Coins size={18} aria-hidden="true" />
        <span>金額は公開安全性のために丸めた概算値です。Azureの正確なコストは保存されません。</span>
      </div>
      <KpiStrip metrics={metrics} />
      <div className="bento-grid">
        <Panel title="正規化した支出傾向" className="wide-panel">
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
              title="傾向データ未取得"
              detail="コレクターはAzureコストの合成時系列を生成しません。"
            />
          )}
        </Panel>
        <Panel title="サービス別構成比">
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
                  const movement = describeCostDelta(category.deltaPercent);
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
                        <p>{costDeltaLabelJa(movement.label)}（前期比）</p>
                      </div>
                      <StatusBadge severity={category.deltaPercent > 8 ? "warning" : "healthy"}>
                        {category.deltaPercent > 0 ? "+" : ""}
                        {category.deltaPercent}%
                      </StatusBadge>
                    </div>
                  );
                })}
            </div>
          ) : (
            <EmptyState
              title="変動要因が未取得"
              detail="サービス別の変動を公開するには比較可能な前期データが必要です。"
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
            <dd>{regionLabelJa(resource.region)}</dd>
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
          <p>名前・保有者・識別子・タグは公開用サニタイズ境界を通過済みです。</p>
        </div>
      </aside>
    </div>
  );
}

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
              placeholder="リソース名・種別・リージョンで検索"
            />
          </label>
          <label className="select-label">
            <span>状態</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="All">すべて</option>
              <option value="Healthy">正常</option>
              <option value="Degraded">低下</option>
              <option value="Unavailable">取得不可</option>
              <option value="Unknown">不明</option>
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
                  <th>種別</th>
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
                    <td>{regionLabelJa(resource.region)}</td>
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
            detail="検索キーワードや状態フィルターを調整してください。"
          />
        )}
      </Panel>
      <ResourceDrawer resource={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function ReliabilityPage({ data }: { data: PublicSnapshotV1 }) {
  const metrics: TrendMetric[] = [
    {
      label: "可用性",
      value: data.reliability.availability,
      change: "収集時点の値",
      direction: "flat",
      severity: "info",
      points: []
    },
    {
      label: "アクティブなインシデント",
      value: String(data.reliability.incidents),
      change: "収集時点の件数",
      direction: "flat",
      severity: data.reliability.incidents > 1 ? "warning" : "healthy",
      points: []
    },
    {
      label: "平均復旧時間 (MTTR)",
      value: data.reliability.meanTimeToRecover,
      change: "収集時点の値",
      direction: "flat",
      severity: "info",
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
                    <dt>目標値</dt>
                    <dd>{service.objective}</dd>
                  </div>
                  <div>
                    <dt>実測値</dt>
                    <dd>{service.actual}</dd>
                  </div>
                  <div>
                    <dt>インシデント件数</dt>
                    <dd>{service.incidents}</dd>
                  </div>
                </dl>
                <ProgressBar value={service.budgetRemainingPercent} label="残エラーバジェット" />
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="サービス目標データなし"
            detail="今回のスナップショットにはサービスレベル目標の集計が含まれていません。次回収集時に取得できるかを確認してください。"
          />
        )}
      </Panel>
    </div>
  );
}

function SecurityPage({ data }: { data: PublicSnapshotV1 }) {
  const openRecommendations = data.security.recommendations.filter(
    (item) => item.status !== "Resolved"
  ).length;
  const metrics: TrendMetric[] = [
    {
      label: "Secure Score",
      value: `${data.security.secureScore}%`,
      change: "収集時点の値",
      direction: "flat",
      severity: "info",
      points: []
    },
    {
      label: "アクティブなアラート",
      value: String(data.security.activeAlerts),
      change: "集計値のみ",
      direction: "flat",
      severity: data.security.activeAlerts > 3 ? "warning" : "healthy",
      points: []
    },
    {
      label: "未解決の推奨事項",
      value: String(openRecommendations),
      change: "保護対象全体での件数",
      direction: "flat",
      severity: "info",
      points: []
    }
  ];
  return (
    <div className="page-stack">
      <KpiStrip metrics={metrics} />
      <div className="bento-grid">
        <Panel title="Defenderの推奨事項" className="wide-panel">
          {data.security.recommendations.length ? (
            <div className="recommendation-list">
              {data.security.recommendations.map((item) => (
                <div className="recommendation-row" key={item.title}>
                  <span className={`priority-line severity-${item.severity}`} />
                  <div>
                    <strong>{item.title}</strong>
                    <p>対象リソース {item.affectedCount} 件・集計表示のみ</p>
                  </div>
                  <StatusBadge severity={item.severity}>
                    {recommendationStatusLabelJa(item.status)}
                  </StatusBadge>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="推奨事項が未取得"
              detail="Defenderの推奨事項はこのスナップショットに含まれていません。"
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
              title="コンプライアンスデータなし"
              detail="規制コンプライアンスの集計は未取得です。"
            />
          )}
        </Panel>
        <Panel title="公開時の詳細レベル">
          <div className="privacy-card">
            <ShieldCheck size={28} aria-hidden="true" />
            <strong>既定で集計表示</strong>
            <p>
              推奨事項のタイトルと件数のみを表示します。資産名・脆弱性の詳細・攻撃手法・ID情報は公開前に除去されています。
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}

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
          <span>リソース種別数</span>
          <strong>{data.network.inventory.byType.length}</strong>
        </div>
        <div>
          <span>リージョン数</span>
          <strong>{data.network.inventory.byRegion.length}</strong>
        </div>
        <div>
          <span>エンドポイントポリシー</span>
          <strong>マスク済み</strong>
        </div>
      </div>
      <div className="bento-grid">
        <Panel title="ネットワーク在庫">
          {data.network.inventory.byType.length ? (
            <div className="ranked-list">
              {data.network.inventory.byType.map((item) => (
                <div className="ranked-row" key={item.label}>
                  <strong>{item.label}</strong>
                  <span>{item.count} 件</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="ネットワーク在庫がありません"
              detail="このスナップショットでは対応するネットワークリソースが返されませんでした。"
            />
          )}
        </Panel>
        <Panel title="フローテレメトリの状況">
          <div className="privacy-card">
            <Network size={28} aria-hidden="true" />
            <strong>
              {telemetry.availability === "unavailable"
                ? "取得不可"
                : `正常な接続 ${telemetry.healthyConnections ?? 0} 件`}
            </strong>
            <p>{telemetry.message}</p>
          </div>
        </Panel>
      </div>
      <Panel
        title="観測されたフローテレメトリ"
        action={
          <label className="select-label compact">
            <span className="sr-only">フロー状態</span>
            <select value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option value="All">すべて</option>
              <option value="Allowed">許可</option>
              <option value="Degraded">低下</option>
              <option value="Blocked">遮断</option>
            </select>
          </label>
        }
      >
        {telemetry.availability === "unavailable" ? (
          <EmptyState
            title="フローテレメトリが未取得"
            detail="ネットワークリソースは在庫として収集されていますが、リソースの存在自体を接続の健全性とは判断していません。"
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
                <StatusBadge severity={networkFlowStatusSeverity(flow.status)}>
                  {networkFlowStatusLabelJa(flow.status)}
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

function insightDomainLabel(route: string): string {
  const segment = route.split("/").filter(Boolean)[0] ?? "overview";
  const domainLabels: Record<string, string> = {
    overview: "概要",
    cost: "コスト",
    resources: "リソース",
    reliability: "信頼性",
    security: "セキュリティ",
    network: "ネットワーク",
    "ai-insights": "AI インサイト"
  };
  return domainLabels[segment] ?? segment;
}

function InsightCard({ insight }: { insight: AiInsight }) {
  const navigate = useNavigate();
  return (
    <article className="insight-card">
      <header>
        <StatusBadge severity={insight.severity}>{severityLabelJa(insight.severity)}</StatusBadge>
        <span className="confidence">確信度 {Math.round(insight.confidence * 100)}%</span>
      </header>
      <h2>{insight.title}</h2>
      <div className="insight-block">
        <strong>観測事実</strong>
        <p>{insight.observation}</p>
      </div>
      <div className="insight-block insight-impact">
        <strong>想定される影響</strong>
        <p>{insight.impact}</p>
      </div>
      <div className="evidence-list">
        {insight.numericEvidence.map((evidence) => (
          <span key={`${evidence.source}-${evidence.value}`}>
            <strong>{evidence.label}</strong> {evidence.value}
            <small>（出典: {evidence.source}）</small>
          </span>
        ))}
      </div>
      <footer>
        <div>
          <small>推奨対応</small>
          <strong>{insight.recommendedAction}</strong>
        </div>
        <button className="secondary-button" onClick={() => navigate(insight.route)}>
          関連データを見る <ExternalLink size={15} aria-hidden="true" />
        </button>
      </footer>
    </article>
  );
}

function AiInsightsPage({ data }: { data: PublicSnapshotV1 }) {
  const insights = data.aiInsights;
  const navigate = useNavigate();
  const warningCount = insights.filter(
    (insight) => insight.severity === "warning" || insight.severity === "critical"
  ).length;
  const domains = useMemo(
    () => new Set(insights.map((insight) => insightDomainLabel(insight.route))),
    [insights]
  );
  const latestPeriod = insights[0]?.period ?? "期間データなし";
  const priorityBoard = useMemo(() => {
    const rank: Record<Severity, number> = { critical: 0, warning: 1, info: 2, healthy: 3 };
    return insights.slice().sort((a, b) => rank[a.severity] - rank[b.severity]);
  }, [insights]);

  return (
    <div className="page-stack">
      <div className="ai-banner">
        <span className="ai-icon">
          <Bot size={22} aria-hidden="true" />
        </span>
        <div>
          <strong>根拠に基づく読み取り専用の分析</strong>
          <p>
            分析はサニタイズ済みの構造化データのみを使用します。推奨事項はAzureへの変更操作を一切行いません。
          </p>
        </div>
        <span>対象期間: {latestPeriod}</span>
      </div>
      <div className="ai-summary-grid">
        <article className="kpi-card">
          <p className="eyebrow">検証済みインサイト</p>
          <strong>{insights.length} 件</strong>
        </article>
        <article className="kpi-card">
          <p className="eyebrow">要注意インサイト</p>
          <strong>{warningCount} 件</strong>
        </article>
        <article className="kpi-card">
          <p className="eyebrow">対象ドメイン数</p>
          <strong>{domains.size} 件</strong>
        </article>
        <article className="kpi-card">
          <p className="eyebrow">最終更新</p>
          <strong>{formatDateTimeJa(data.generatedAt)}</strong>
        </article>
      </div>
      {insights.length ? (
        <>
          <Panel title="優先度アクションボード">
            <div className="action-list">
              {priorityBoard.map((insight) => (
                <button
                  className="action-row"
                  key={`priority-${insight.id}`}
                  onClick={() => navigate(insight.route)}
                >
                  <StatusBadge severity={insight.severity}>
                    {severityLabelJa(insight.severity)}
                  </StatusBadge>
                  <div>
                    <strong>{insight.title}</strong>
                    <p>{insight.recommendedAction}</p>
                  </div>
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
          title="検証済みインサイトなし"
          detail="直近の分析では公開ゲートを通過する根拠が生成されませんでした。"
        />
      )}
      <div className="privacy-card ai-gate-card">
        <ShieldCheck size={24} aria-hidden="true" />
        <div>
          <strong>スキーマ・根拠・プライバシーゲート</strong>
          <p>
            すべてのインサイトは公開スキーマ検証・数値根拠の裏付け確認・匿名化プライバシースキャンを通過したものだけを表示しています。読み取り専用であり、Azureへの操作は行いません。
          </p>
        </div>
      </div>
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
      <h2>運用スナップショットを取得できません</h2>
      <p>{error}</p>
      <small>収集に失敗した場合でも、直前に取得できた正常なスナップショットは上書きされません。</small>
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
  const fresh = ageMinutes <= 4_320;
  const footerNote =
    data.mode === "DEMO"
      ? "既定では合成データを使用します。Azure接続は不要です。"
      : "匿名化済みのAzure収集データを表示しています。";

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="brand">
          <span className="brand-mark">
            <Cloud size={22} aria-hidden="true" />
          </span>
          <span>
            <strong>Azure Ops Pulse</strong>
            <small>公開運用デモ</small>
          </span>
          <button className="mobile-close" onClick={() => setMenuOpen(false)} aria-label="メニューを閉じる">
            <X size={20} />
          </button>
        </div>
        <nav aria-label="プライマリナビゲーション">
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
          <p>{footerNote}</p>
          <a href="https://github.com/aktsmm/azure-ops-pulse-demo">
            リポジトリを見る <ExternalLink size={13} aria-hidden="true" />
          </a>
        </div>
      </aside>
      {menuOpen && (
        <button className="nav-scrim" onClick={() => setMenuOpen(false)} aria-label="ナビゲーションを閉じる" />
      )}
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
              <strong>{fresh ? "最新" : "古い"}</strong>
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
