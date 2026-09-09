import { useState } from "react";
import { Info, Network } from "lucide-react";
import { ResourceIcon } from "./ResourceExplorer";
import { resourceTypeLabel } from "../lib/resource-catalog";

export interface TopologyNodeView {
  id: string;
  type: string;
  label: string;
  region: string;
  referenceOnly: boolean;
  scope?: "inventory" | "external" | "uncollected";
}
export interface TopologyEdgeView {
  source: string;
  target: string;
  label: string;
}

function column(type: string): number {
  const normalized = type.toLowerCase();
  if (normalized === "microsoft.network/virtualnetworks") return 0;
  if (normalized.endsWith("/subnets")) return 1;
  if (normalized === "microsoft.network/networkinterfaces") return 2;
  return 3;
}

export function TopologyGraph({ nodes, edges, partial, onSelect }: {
  nodes: TopologyNodeView[];
  edges: TopologyEdgeView[];
  partial: boolean;
  onSelect: (id: string) => void;
}) {
  const [vnet, setVnet] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const vnets = nodes.filter((node) => column(node.type) === 0);
  const connected = new Set(vnet === "all" ? nodes.map((node) => node.id) : [vnet]);
  if (vnet !== "all") {
    // A selection is an explicit-reference connected component, not an inferred containment tree.
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of edges) {
        if (!connected.has(edge.source) && !connected.has(edge.target)) continue;
        for (const id of [edge.source, edge.target]) {
          if (!connected.has(id)) { connected.add(id); changed = true; }
        }
      }
    }
  }
  const visibleNodes = nodes.filter((node) => connected.has(node.id));
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
  const columns = [0, 1, 2, 3].map((index) =>
    visibleNodes.filter((node) => column(node.type) === index).sort((a, b) => a.label.localeCompare(b.label))
  );
  const columnWidth = 272;
  const rowHeight = 112;
  const nodeWidth = 232;
  const nodeHeight = 88;
  const height = Math.max(220, Math.max(...columns.map((items) => items.length)) * rowHeight + 70);
  const positions = new Map(columns.flatMap((items, index) =>
    items.map((node, row) => [node.id, { x: index * columnWidth + 16, y: row * rowHeight + 54 }] as const)
  ));
  const selected = visibleNodes.find((node) => node.id === selectedId);
  const selectedEdges = visibleEdges.filter((edge) => edge.source === selectedId || edge.target === selectedId);
  const relatedIds = new Set(selectedEdges.flatMap((edge) => [edge.source, edge.target]));
  const nameById = new Map(nodes.map((node) => [node.id, `${resourceTypeLabel(node.type)} · ${node.label}`]));
  const relationKey = (edge: TopologyEdgeView) => `${edge.source}:${edge.target}:${edge.label}`;

  return (
    <section className="panel topology-panel" aria-labelledby="topology-title">
      <header className="panel-header">
        <div>
          <h2 id="topology-title">ネットワーク構成相関図</h2>
          <p>Azure の構成参照で確認できた関連だけを描画します。線は通信経路・通信の許可・正常性を表しません。</p>
        </div>
        <span className="status-badge">{partial ? "一部収集" : "収集済み"}</span>
      </header>
      <div className="table-toolbar">
        <label className="select-label">
          <span>VNet の関連範囲</span>
          <select value={vnet} onChange={(event) => { setVnet(event.target.value); setSelectedId(null); }}>
            <option value="all">すべて</option>
            {vnets.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
          </select>
        </label>
        <span className="result-count" role="status">{visibleNodes.length} ノード・{visibleEdges.length} 関連</span>
      </div>
      <p className="source-footnote"><Info size={14} aria-hidden="true" /><span>VNet を選ぶと、共有リソースやピアリング先を含む、直接・間接の関連範囲を表示します。点線枠は参照のみのノードです。ノードを選択すると関連を強調表示します。</span></p>
      {visibleNodes.length ? (
        <div className="topology-scroll" tabIndex={0} role="region" aria-label="ネットワーク構成図。横方向にスクロールできます">
          <div className="topology-stage" style={{ width: columnWidth * 4, height }}>
            {["VNet", "サブネット", "NIC", "関連リソース"].map((title, index) =>
              <div className="topology-column-title" key={title} style={{ left: index * columnWidth + 16 }}>{title}</div>
            )}
            <svg className="topology-lines" width={columnWidth * 4} height={height} aria-hidden="true">
              {visibleEdges.map((edge) => {
                const source = positions.get(edge.source)!;
                const target = positions.get(edge.target)!;
                const forward = source.x <= target.x;
                const x1 = source.x + (forward ? nodeWidth : 0);
                const x2 = target.x + (forward ? 0 : nodeWidth);
                const y1 = source.y + nodeHeight / 2;
                const y2 = target.y + nodeHeight / 2;
                const bend = source.x === target.x ? 24 : Math.max(30, Math.abs(x2 - x1) / 2);
                const d = source.x === target.x
                  ? `M ${source.x + nodeWidth} ${y1} C ${source.x + nodeWidth + bend} ${y1}, ${source.x + nodeWidth + bend} ${y2}, ${target.x + nodeWidth} ${y2}`
                  : `M ${x1} ${y1} C ${x1 + (forward ? bend : -bend)} ${y1}, ${x2 + (forward ? -bend : bend)} ${y2}, ${x2} ${y2}`;
                return <path key={relationKey(edge)} d={d} className={selectedId && (edge.source === selectedId || edge.target === selectedId) ? "highlighted" : ""} />;
              })}
            </svg>
            {visibleNodes.map((node) => {
              const position = positions.get(node.id)!;
              return (
                <button type="button" key={node.id}
                  className={`topology-node${node.referenceOnly ? " reference-only" : ""}${selectedId === node.id ? " selected" : ""}${selectedId && !relatedIds.has(node.id) && selectedId !== node.id ? " dimmed" : ""}`}
                  style={{ left: position.x, top: position.y, width: nodeWidth, height: nodeHeight }}
                  aria-pressed={selectedId === node.id}
                  aria-label={`${resourceTypeLabel(node.type)} ${node.label}の関連を表示`}
                  onClick={() => setSelectedId(selectedId === node.id ? null : node.id)}>
                  <ResourceIcon type={node.type} />
                  <span><strong>{resourceTypeLabel(node.type)}</strong><small>{node.label}</small><small>{node.scope === "external" ? "スコープ外への参照" : node.referenceOnly ? "参照のみ・詳細未収集" : node.region || "リージョン未収集"}</small></span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="empty-state"><Network size={24} aria-hidden="true" /><strong>構成図に表示できるノードはありません</strong><p>構成参照を確認できるリソースは今回の収集に含まれていません。</p></div>
      )}
      {selected && (
        <div className="topology-selection">
          <div><strong>{resourceTypeLabel(selected.type)} · {selected.label}</strong><p>{selectedEdges.length} 件の直接の関連。参照がないことは、未接続の証明ではありません。</p></div>
          {!selected.referenceOnly && <button type="button" className="secondary-button" onClick={() => onSelect(selected.id)}>リソース詳細</button>}
        </div>
      )}
      <details className="topology-relations">
        <summary>{selected ? "選択ノードの関連一覧" : "関連一覧を表で確認"}（{selected ? selectedEdges.length : visibleEdges.length} 件）</summary>
        <div className="table-scroll">
          <table>
            <caption className="sr-only">収集済み構成参照の一覧</caption>
            <thead><tr><th scope="col">参照元</th><th scope="col">関係</th><th scope="col">参照先</th></tr></thead>
            <tbody>{(selected ? selectedEdges : visibleEdges).map((edge) =>
              <tr key={relationKey(edge)}><td>{nameById.get(edge.source)}</td><td>{edge.label}</td><td>{nameById.get(edge.target)}</td></tr>
            )}</tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
