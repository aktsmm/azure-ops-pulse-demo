import { useMemo, useState } from "react";
import { Boxes, ChevronRight, Database, Network, Search, Server, ShieldCheck, Activity, Sparkles, Globe, HardDrive } from "lucide-react";
import type { ResourceItem } from "../data/contracts";
import { RESOURCE_CATEGORIES, matchesResourceQuery, resourceTypeInfo, resourceTypeLabel, type ResourceCategory } from "../lib/resource-catalog";
import { resourceStatusLabel, resourceStatusSeverity } from "../lib/display-formatters";

const CATEGORY_ICONS = {
  "コンピューティング": Server, "ネットワーク": Network, "ストレージ": HardDrive,
  "データベース": Database, "Web・アプリ": Globe, "AI・検索": Sparkles,
  "監視・運用": Activity, "セキュリティ・ID": ShieldCheck, "その他": Boxes
};

export function ResourceIcon({ type }: { type: string }) {
  const Icon = CATEGORY_ICONS[resourceTypeInfo(type).category];
  return <Icon size={18} aria-hidden="true" />;
}

type Grouping = "category" | "type" | "region" | "resourceGroup" | "none";
const GROUPINGS: Record<Grouping, string> = {
  category: "カテゴリ", type: "リソース種別", region: "リージョン",
  resourceGroup: "リソース グループ", none: "グループ化なし"
};

function groupKey(resource: ResourceItem, grouping: Grouping): string {
  if (grouping === "category") return resourceTypeInfo(resource.type).category;
  if (grouping === "type") return resourceTypeLabel(resource.type);
  return grouping === "none" ? "すべてのリソース" : resource[grouping];
}

export function ResourceExplorer({ resources, onSelect }: {
  resources: ResourceItem[];
  onSelect: (resource: ResourceItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ResourceCategory | "all">("all");
  const [type, setType] = useState("all");
  const [region, setRegion] = useState("all");
  const [resourceGroup, setResourceGroup] = useState("all");
  const [status, setStatus] = useState("all");
  const [grouping, setGrouping] = useState<Grouping>("category");
  const [page, setPage] = useState(0);
  const pageSize = 25;
  const categories = RESOURCE_CATEGORIES.map((name) => ({
    name, count: resources.filter((resource) => resourceTypeInfo(resource.type).category === name).length
  })).filter(({ count }) => count > 0);
  const options = (key: "type" | "region" | "resourceGroup") =>
    [...new Set(resources.map((resource) => resource[key]))].sort();
  const filtered = useMemo(() => resources.filter((resource) =>
    (category === "all" || resourceTypeInfo(resource.type).category === category) &&
    (type === "all" || resource.type === type) &&
    (region === "all" || resource.region === region) &&
    (resourceGroup === "all" || resource.resourceGroup === resourceGroup) &&
    (status === "all" || resource.status === status) &&
    matchesResourceQuery(resource, query)
  ).sort((a, b) =>
    groupKey(a, grouping).localeCompare(groupKey(b, grouping), "ja") ||
    resourceTypeLabel(a.type).localeCompare(resourceTypeLabel(b.type), "ja") ||
    a.name.localeCompare(b.name, "ja")
  ), [resources, category, type, region, resourceGroup, status, query, grouping]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const groups = new Map<string, ResourceItem[]>();
  for (const resource of visible) {
    const key = groupKey(resource, grouping);
    const rows = groups.get(key) ?? [];
    rows.push(resource);
    groups.set(key, rows);
  }
  const filterCount = [category, type, region, resourceGroup, status].filter((value) => value !== "all").length;
  const reset = () => {
    setQuery(""); setCategory("all"); setType("all"); setRegion("all");
    setResourceGroup("all"); setStatus("all"); setPage(0);
  };

  return (
    <div className="resource-explorer">
      <div className="category-filters" aria-label="リソース カテゴリ">
        <button type="button" aria-pressed={category === "all"} onClick={() => { setCategory("all"); setPage(0); }}>
          <Boxes size={16} aria-hidden="true" />すべて <span>{resources.length}</span>
        </button>
        {categories.map(({ name, count }) => {
          const Icon = CATEGORY_ICONS[name];
          return (
            <button type="button" key={name} aria-pressed={category === name}
              onClick={() => { setCategory(name); setPage(0); }}>
              <Icon size={16} aria-hidden="true" />{name} <span>{count}</span>
            </button>
          );
        })}
      </div>
      <div className="table-toolbar resource-search-row">
        <label className="search-control">
          <Search size={17} aria-hidden="true" />
          <span className="sr-only">リソースを検索</span>
          <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }}
            placeholder="VM、NW、DB、一般名、ID、タグで検索" />
        </label>
        <label className="select-label">
          <span>グループ化</span>
          <select value={grouping} onChange={(event) => {
            const key = event.target.value;
            if (key in GROUPINGS) { setGrouping(key as Grouping); setPage(0); }
          }}>
            {Object.entries(GROUPINGS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
      </div>
      <details className="resource-filter-disclosure">
      <summary>詳細フィルター{filterCount ? ` · ${filterCount} 条件を選択中` : ""}</summary>
      <div className="resource-filters">
        {([
          ["リソース種別", type, setType, options("type"), true],
          ["リージョン", region, setRegion, options("region"), false],
          ["リソース グループ", resourceGroup, setResourceGroup, options("resourceGroup"), false]
        ] as const).map(([label, value, setValue, values, friendly]) => (
          <label className="select-label" key={label}>
            <span>{label}</span>
            <select value={value} onChange={(event) => { setValue(event.target.value); setPage(0); }}>
              <option value="all">すべて</option>
              {values.map((item) => <option key={item} value={item}>{friendly ? resourceTypeLabel(item) : item}</option>)}
            </select>
          </label>
        ))}
        <label className="select-label">
          <span>Resource Health 状態</span>
          <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); }}>
            <option value="all">すべて</option>
            {(["Healthy", "Degraded", "Unavailable", "Unknown", "NotApplicable"] as const).map((value) =>
              <option key={value} value={value}>{resourceStatusLabel(value)}</option>
            )}
          </select>
        </label>
      </div>
      </details>
      <div className="resource-results">
        <span role="status">{filtered.length} / {resources.length} 件{filterCount ? `・絞り込み ${filterCount} 条件` : ""}</span>
        <button type="button" className="text-button" disabled={!filterCount && !query} onClick={reset}>条件をクリア</button>
      </div>
      {filtered.length ? (
        <>
          {[...groups].map(([name, rows]) => (
            <details className="resource-group" key={`${grouping}-${name}`} open>
              <summary>{name}<span>{filtered.filter((resource) => groupKey(resource, grouping) === name).length} 件</span></summary>
              <div className="table-scroll">
                <table className="resource-table">
                  <caption className="sr-only">{name}のリソース一覧</caption>
                  <thead><tr><th scope="col">リソース / 種別</th><th scope="col">リージョン</th><th scope="col">Resource Health</th><th scope="col">リソース グループ</th><th scope="col"><span className="sr-only">詳細</span></th></tr></thead>
                  <tbody>{rows.map((resource) => (
                    <tr key={resource.id}>
                      <td>
                        <button type="button" className="resource-link resource-identity" onClick={() => onSelect(resource)}
                          aria-label={`${resource.name}の詳細を開く`}>
                          <span className="resource-type-icon"><ResourceIcon type={resource.type} /></span>
                          <span><strong>{resourceTypeLabel(resource.type)}</strong><small>{resource.name}</small></span>
                        </button>
                      </td>
                      <td data-label="リージョン">{resource.region}</td>
                      <td data-label="Resource Health"><span className={`status-badge severity-${resourceStatusSeverity(resource.status)}`}>{resourceStatusLabel(resource.status)}</span></td>
                      <td data-label="リソース グループ" className="resource-group-cell">{resource.resourceGroup}</td>
                      <td aria-hidden="true"><ChevronRight size={16} /></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </details>
          ))}
          <nav className="resource-pagination" aria-label="リソースのページ切り替え">
            <span>{currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, filtered.length)} / {filtered.length} 件</span>
            <button type="button" className="secondary-button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>前へ</button>
            <span>{currentPage + 1} / {pages}</span>
            <button type="button" className="secondary-button" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>次へ</button>
          </nav>
        </>
      ) : (
        <div className="empty-state">
          <Search size={24} aria-hidden="true" />
          <strong>条件に一致するリソースはありません</strong>
          <p>検索語を減らすか、カテゴリ・種別・リージョンなどの条件をクリアしてください。</p>
        </div>
      )}
    </div>
  );
}
