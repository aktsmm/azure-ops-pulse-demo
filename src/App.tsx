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
  Menu,
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

const NAV_ITEMS = [
  { path: "/overview", label: "Overview", icon: Gauge },
  { path: "/cost", label: "Cost", icon: Coins },
  { path: "/resources", label: "Resources", icon: Boxes },
  { path: "/reliability", label: "Reliability", icon: Activity },
  { path: "/security", label: "Security", icon: ShieldCheck },
  { path: "/network", label: "Network", icon: Network },
  { path: "/ai-insights", label: "AI Insights", icon: Sparkles }
];

const TITLES: Record<string, { title: string; subtitle: string }> = {
  "/overview": {
    title: "Operations overview",
    subtitle: "A unified pulse across cost, reliability, security, and change."
  },
  "/cost": {
    title: "Cost intelligence",
    subtitle: "Approximate public-safe spend signals and directional movement."
  },
  "/resources": {
    title: "Resource inventory",
    subtitle: "Sanitized estate coverage with ownership and health context."
  },
  "/reliability": {
    title: "Reliability",
    subtitle: "Service objectives, error budgets, and operational health."
  },
  "/security": {
    title: "Security posture",
    subtitle: "Aggregate Defender signals without exposed asset or exploit detail."
  },
  "/network": {
    title: "Network",
    subtitle: "Masked flow health, latency, throughput, and policy outcomes."
  },
  "/ai-insights": {
    title: "AI insights",
    subtitle: "Evidence-bound analysis of the sanitized operational snapshot."
  }
};

function severityLabel(severity: Severity): string {
  if (severity === "critical") return "Critical";
  if (severity === "warning") return "Warning";
  if (severity === "healthy") return "Healthy";
  return "Info";
}

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
      aria-label={`Trend with ${points.length} observations`}
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
          <Sparkline points={metric.points} severity={metric.severity} />
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

function OverviewPage({ data }: { data: PublicSnapshotV1 }) {
  const navigate = useNavigate();
  return (
    <div className="page-stack">
      <KpiStrip metrics={data.overview.metrics} />
      <div className="bento-grid">
        <Panel
          title="Operational posture"
          action={
            <button className="text-button" onClick={() => navigate("/ai-insights")}>
              View insights <ChevronRight size={15} aria-hidden="true" />
            </button>
          }
          className="posture-panel"
        >
          <div className="score-row">
            <div className="score-block">
              <span>Composite score</span>
              <strong>{data.overview.postureScore}</strong>
              <small>of 100</small>
            </div>
            <div className="score-detail">
              <ProgressBar value={data.overview.postureScore} label="Overall posture" />
              <p>
                Stable service health with two cost and security signals requiring focused
                review.
              </p>
            </div>
          </div>
        </Panel>
        <Panel title="Regional health" className="regions-panel">
          <div className="region-list">
            {data.overview.regionalHealth.map((region) => (
              <div className="region-row" key={region.region}>
                <span className={`health-dot severity-${region.status}`} aria-hidden="true" />
                <strong>{region.region}</strong>
                <span>{region.score}%</span>
                <StatusBadge severity={region.status}>{severityLabel(region.status)}</StatusBadge>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Activity timeline" className="timeline-panel">
          <div className="timeline">
            {data.overview.eventTimeline.map((event) => (
              <button
                className="timeline-item"
                key={event.id}
                onClick={() => navigate(event.route)}
              >
                <span className={`timeline-marker severity-${event.severity}`} />
                <span>
                  <small>{event.timestamp}</small>
                  <strong>{event.title}</strong>
                  <p>{event.detail}</p>
                </span>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            ))}
          </div>
        </Panel>
        <Panel title="Data source coverage" className="sources-panel">
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
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function CostPage({ data }: { data: PublicSnapshotV1 }) {
  const metrics: TrendMetric[] = [
    {
      label: "Current period",
      value: data.cost.currentApproximate,
      change: `${data.cost.deltaPercent > 0 ? "+" : ""}${data.cost.deltaPercent}%`,
      direction: data.cost.deltaPercent > 0 ? "up" : "down",
      severity: data.cost.deltaPercent > 5 ? "warning" : "healthy",
      points: data.cost.normalizedTrend
    },
    {
      label: "Forecast",
      value: data.cost.forecastApproximate,
      change: "Month-end estimate",
      direction: "flat",
      severity: "info",
      points: [72, 74, 77, 78, 80, 83, 85, 88, 90, 92, 94, 96]
    },
    {
      label: "Budget used",
      value: `${data.cost.budgetUsedPercent}%`,
      change: "Within guardrail",
      direction: "flat",
      severity: data.cost.budgetUsedPercent > 85 ? "warning" : "healthy",
      points: [52, 55, 59, 62, 66, 70, 73, 77, 80, 83, 86, 88]
    }
  ];
  return (
    <div className="page-stack">
      <div className="notice">
        <Coins size={18} aria-hidden="true" />
        <span>Amounts are rounded public-safe approximations. Exact Azure cost is never stored.</span>
      </div>
      <KpiStrip metrics={metrics} />
      <div className="bento-grid">
        <Panel title="Normalized spend trend" className="wide-panel">
          <div className="chart-shell">
            {data.cost.normalizedTrend.map((value, index) => (
              <div className="chart-column" key={`${value}-${index}`}>
                <span style={{ height: `${value}%` }} />
                <small>W{index + 1}</small>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Service mix">
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
        <Panel title="Change drivers">
          <div className="driver-list">
            {data.cost.categories
              .slice()
              .sort((a, b) => Math.abs(b.deltaPercent) - Math.abs(a.deltaPercent))
              .map((category) => (
                <div className="driver-row" key={category.name}>
                  <span className="icon-tile">
                    {category.deltaPercent > 0 ? (
                      <TrendingUp size={18} aria-hidden="true" />
                    ) : (
                      <TrendingDown size={18} aria-hidden="true" />
                    )}
                  </span>
                  <div>
                    <strong>{category.name}</strong>
                    <p>{category.deltaPercent > 0 ? "Increased" : "Decreased"} versus prior period</p>
                  </div>
                  <StatusBadge severity={category.deltaPercent > 8 ? "warning" : "healthy"}>
                    {category.deltaPercent > 0 ? "+" : ""}
                    {category.deltaPercent}%
                  </StatusBadge>
                </div>
              ))}
          </div>
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
            <p className="eyebrow">Sanitized resource detail</p>
            <h2 id="resource-drawer-title">{resource.name}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close detail drawer">
            <X size={20} />
          </button>
        </header>
        <div className="drawer-status">
          <StatusBadge
            severity={
              resource.status === "Healthy"
                ? "healthy"
                : resource.status === "Degraded"
                  ? "warning"
                  : "critical"
            }
          >
            {resource.status}
          </StatusBadge>
          <span>{resource.type}</span>
        </div>
        <dl className="detail-list">
          <div>
            <dt>Resource group</dt>
            <dd>{resource.resourceGroup}</dd>
          </div>
          <div>
            <dt>Region</dt>
            <dd>{resource.region}</dd>
          </div>
          <div>
            <dt>Owner</dt>
            <dd>{resource.owner}</dd>
          </div>
          <div>
            <dt>Recent change</dt>
            <dd>{resource.change}</dd>
          </div>
        </dl>
        <div>
          <h3>Allowed tags</h3>
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
          <p>Names, ownership, identifiers, and tags have passed the public sanitization boundary.</p>
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
          <span>Total resources</span>
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
            <span className="sr-only">Search resources</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search resource, type, or region"
            />
          </label>
          <label className="select-label">
            <span>Status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option>All</option>
              <option>Healthy</option>
              <option>Degraded</option>
              <option>Unavailable</option>
              <option>Unknown</option>
            </select>
          </label>
          <span className="result-count">{filtered.length} results</span>
        </div>
        {filtered.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Region</th>
                  <th>Health</th>
                  <th>Owner</th>
                  <th aria-label="Open detail" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((resource) => (
                  <tr key={resource.id}>
                    <td>
                      <button
                        className="resource-link"
                        onClick={() => setSelected(resource)}
                        aria-label={`Open details for ${resource.name}`}
                      >
                        <strong>{resource.name}</strong>
                        <small>{resource.resourceGroup}</small>
                      </button>
                    </td>
                    <td>{resource.type}</td>
                    <td>{resource.region}</td>
                    <td>
                      <StatusBadge
                        severity={
                          resource.status === "Healthy"
                            ? "healthy"
                            : resource.status === "Degraded"
                              ? "warning"
                              : "critical"
                        }
                      >
                        {resource.status}
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
            title="No matching resources"
            detail="Adjust the search text or health filter to expand the result set."
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
      label: "Availability",
      value: data.reliability.availability,
      change: "Rolling 30 days",
      direction: "flat",
      severity: "healthy",
      points: [99.8, 99.9, 99.8, 99.95, 99.9, 99.92, 99.97, 99.94]
    },
    {
      label: "Active incidents",
      value: String(data.reliability.incidents),
      change: "1 requires attention",
      direction: "down",
      severity: data.reliability.incidents > 1 ? "warning" : "healthy",
      points: [4, 3, 3, 2, 4, 2, 2, 1]
    },
    {
      label: "Mean time to recover",
      value: data.reliability.meanTimeToRecover,
      change: "Down 18%",
      direction: "down",
      severity: "healthy",
      points: [64, 58, 61, 55, 49, 46, 42, 38]
    }
  ];
  return (
    <div className="page-stack">
      <KpiStrip metrics={metrics} />
      <Panel title="Service objectives">
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
                <StatusBadge severity={service.status}>{severityLabel(service.status)}</StatusBadge>
              </div>
              <dl className="mini-stats">
                <div>
                  <dt>Objective</dt>
                  <dd>{service.objective}</dd>
                </div>
                <div>
                  <dt>Actual</dt>
                  <dd>{service.actual}</dd>
                </div>
                <div>
                  <dt>Incidents</dt>
                  <dd>{service.incidents}</dd>
                </div>
              </dl>
              <ProgressBar
                value={service.budgetRemainingPercent}
                label="Error budget remaining"
              />
            </article>
          ))}
        </div>
      </Panel>
      <Panel title="Incident watch">
        <div className="incident-callout">
          <span className="icon-tile severity-warning">
            <CircleAlert size={20} aria-hidden="true" />
          </span>
          <div>
            <strong>Intermittent latency in a masked application tier</strong>
            <p>
              P95 response time exceeded the service target in 3 of 12 normalized intervals.
            </p>
          </div>
          <StatusBadge severity="warning">Investigating</StatusBadge>
        </div>
      </Panel>
    </div>
  );
}

function SecurityPage({ data }: { data: PublicSnapshotV1 }) {
  const metrics: TrendMetric[] = [
    {
      label: "Secure score",
      value: `${data.security.secureScore}%`,
      change: "+2.4 pts",
      direction: "up",
      severity: "healthy",
      points: [68, 69, 70, 69, 72, 74, 75, 77]
    },
    {
      label: "Active alerts",
      value: String(data.security.activeAlerts),
      change: "Aggregate only",
      direction: "down",
      severity: data.security.activeAlerts > 3 ? "warning" : "healthy",
      points: [8, 7, 7, 5, 6, 4, 3, 2]
    },
    {
      label: "Open recommendations",
      value: String(data.security.recommendations.filter((item) => item.status !== "Resolved").length),
      change: "Across protected estate",
      direction: "flat",
      severity: "info",
      points: [7, 7, 6, 6, 5, 5, 4, 4]
    }
  ];
  return (
    <div className="page-stack">
      <KpiStrip metrics={metrics} />
      <div className="bento-grid">
        <Panel title="Defender recommendations" className="wide-panel">
          <div className="recommendation-list">
            {data.security.recommendations.map((item) => (
              <div className="recommendation-row" key={item.title}>
                <span className={`priority-line severity-${item.severity}`} />
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.affectedCount} affected resources · aggregate view</p>
                </div>
                <StatusBadge severity={item.severity}>{item.status}</StatusBadge>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Compliance posture">
          <div className="compliance-list">
            {data.security.compliance.map((item) => (
              <ProgressBar key={item.framework} value={item.score} label={item.framework} />
            ))}
          </div>
        </Panel>
        <Panel title="Public detail policy">
          <div className="privacy-card">
            <ShieldCheck size={28} aria-hidden="true" />
            <strong>Aggregate by design</strong>
            <p>
              Recommendation titles and counts are shown. Asset names, vulnerability detail,
              exploits, and identities are removed before publication.
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function NetworkPage({ data }: { data: PublicSnapshotV1 }) {
  const [filter, setFilter] = useState("All");
  const rows = data.network.flows.filter((flow) => filter === "All" || flow.status === filter);
  return (
    <div className="page-stack">
      <div className="inventory-strip">
        <div>
          <span>Healthy connections</span>
          <strong>{data.network.healthyConnections}</strong>
        </div>
        <div>
          <span>Degraded</span>
          <strong>{data.network.degradedConnections}</strong>
        </div>
        <div>
          <span>Blocked flows</span>
          <strong>{data.network.blockedFlows}</strong>
        </div>
        <div>
          <span>Endpoint policy</span>
          <strong>Masked</strong>
        </div>
      </div>
      <Panel
        title="Flow health"
        action={
          <label className="select-label compact">
            <span className="sr-only">Flow status</span>
            <select value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option>All</option>
              <option>Allowed</option>
              <option>Degraded</option>
              <option>Blocked</option>
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
                  <small>Source</small>
                  <strong>{flow.source}</strong>
                </div>
                <ChevronRight size={18} aria-hidden="true" />
                <div className="flow-endpoint">
                  <small>Destination</small>
                  <strong>{flow.destination}</strong>
                </div>
                <div className="flow-stat">
                  <small>Protocol</small>
                  <strong>{flow.protocol}</strong>
                </div>
                <div className="flow-stat">
                  <small>Latency</small>
                  <strong>{flow.latency}</strong>
                </div>
                <div className="flow-stat">
                  <small>Throughput</small>
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
                  {flow.status}
                </StatusBadge>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="No flows in this state" detail="Choose another flow status filter." />
        )}
      </Panel>
    </div>
  );
}

function InsightCard({ insight }: { insight: AiInsight }) {
  const navigate = useNavigate();
  return (
    <article className="insight-card">
      <header>
        <StatusBadge severity={insight.severity}>{severityLabel(insight.severity)}</StatusBadge>
        <span className="confidence">{Math.round(insight.confidence * 100)}% confidence</span>
      </header>
      <h2>{insight.title}</h2>
      <p>{insight.observation}</p>
      <div className="insight-impact">
        <strong>Potential impact</strong>
        <p>{insight.impact}</p>
      </div>
      <div className="evidence-list">
        {insight.numericEvidence.map((evidence) => (
          <span key={`${evidence.source}-${evidence.value}`}>
            {evidence.label} {evidence.value}
          </span>
        ))}
      </div>
      <footer>
        <div>
          <small>Recommended action</small>
          <strong>{insight.recommendedAction}</strong>
        </div>
        <button className="secondary-button" onClick={() => navigate(insight.route)}>
          Open context <ExternalLink size={15} aria-hidden="true" />
        </button>
      </footer>
    </article>
  );
}

function AiInsightsPage({ data }: { data: PublicSnapshotV1 }) {
  return (
    <div className="page-stack">
      <div className="ai-banner">
        <span className="ai-icon">
          <Bot size={22} aria-hidden="true" />
        </span>
        <div>
          <strong>Evidence-bound, read-only analysis</strong>
          <p>
            Insights use sanitized structured data only. Recommendations never perform Azure
            remediation.
          </p>
        </div>
        <span>Period: {data.aiInsights[0]?.period ?? "No period"}</span>
      </div>
      {data.aiInsights.length ? (
        <div className="insight-grid">
          {data.aiInsights.map((insight) => (
            <InsightCard insight={insight} key={insight.id} />
          ))}
        </div>
      ) : (
        <EmptyState
          title="No validated insights"
          detail="The last analysis did not produce evidence that passed the publication gate."
        />
      )}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="loading-grid" aria-label="Loading operational snapshot">
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
      <h2>Operational snapshot unavailable</h2>
      <p>{error}</p>
      <small>Production collection failures never replace the last-known-good snapshot.</small>
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

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="brand">
          <span className="brand-mark">
            <Cloud size={22} aria-hidden="true" />
          </span>
          <span>
            <strong>Azure Ops Pulse</strong>
            <small>Public operations demo</small>
          </span>
          <button className="mobile-close" onClick={() => setMenuOpen(false)} aria-label="Close menu">
            <X size={20} />
          </button>
        </div>
        <nav aria-label="Primary navigation">
          <span className="nav-section">Workspace</span>
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
          <div className="demo-badge">DEMO</div>
          <p>Synthetic data by default. No Azure connection required.</p>
          <a href="https://github.com/aktsmm/azure-ops-pulse-demo">
            View repository <ExternalLink size={13} aria-hidden="true" />
          </a>
        </div>
      </aside>
      {menuOpen && <button className="nav-scrim" onClick={() => setMenuOpen(false)} aria-label="Close navigation" />}
      <div className="main-column">
        <header className="topbar">
          <button className="menu-button" onClick={() => setMenuOpen(true)} aria-label="Open navigation">
            <Menu size={20} />
          </button>
          <label className="scope-control">
            <span>Scope</span>
            <select aria-label="Subscription scope" defaultValue="current">
              <option value="current">{data.scope.displayName}</option>
            </select>
          </label>
          <label className="scope-control time-control">
            <Clock3 size={16} aria-hidden="true" />
            <select aria-label="Time range" defaultValue="30d">
              <option value="24h">Last 24 hours</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
            </select>
          </label>
          <div className="topbar-spacer" />
          <div className="freshness">
            <span className={`health-dot severity-${fresh ? "healthy" : "warning"}`} />
            <span>
              <strong>{fresh ? "Fresh" : "Stale"}</strong>
              <small>{new Date(data.generatedAt).toLocaleString()}</small>
            </span>
          </div>
          <button className="icon-button" aria-label="Notifications">
            <Bell size={19} />
            <span className="notification-dot" />
          </button>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <p className="breadcrumb">Operations / {page.title}</p>
              <h1>{page.title}</h1>
              <p>{page.subtitle}</p>
            </div>
            <div className="mode-chip">
              <span>{data.mode}</span>
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
