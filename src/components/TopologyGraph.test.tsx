import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TopologyGraph, type TopologyNodeView, type TopologyEdgeView } from "./TopologyGraph";

const nodes: TopologyNodeView[] = [
  { id: "vnet", type: "microsoft.network/virtualnetworks", label: "resource-vnet", region: "japaneast", referenceOnly: false },
  { id: "subnet", type: "microsoft.network/virtualnetworks/subnets", label: "resource-subnet", region: "japaneast", referenceOnly: true },
  { id: "nic", type: "microsoft.network/networkinterfaces", label: "resource-nic", region: "japaneast", referenceOnly: false },
  { id: "vm", type: "microsoft.compute/virtualmachines", label: "resource-vm", region: "japaneast", referenceOnly: false },
  { id: "other", type: "microsoft.network/virtualnetworks", label: "resource-other", region: "westus", referenceOnly: false }
];
const edges: TopologyEdgeView[] = [
  { source: "vnet", target: "subnet", label: "サブネットを含む" },
  { source: "nic", target: "subnet", label: "サブネット参照" },
  { source: "nic", target: "vm", label: "仮想マシン参照" }
];
afterEach(cleanup);

describe("Topology graph", () => {
  it("renders explicit relationships, generic labels and reference-only nodes", () => {
    render(<TopologyGraph nodes={nodes} edges={edges} partial onSelect={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("5 ノード・3 関連");
    expect(document.querySelectorAll(".topology-lines path")).toHaveLength(3);
    expect(document.querySelectorAll(".reference-only")).toHaveLength(1);
    expect(screen.getByText("一部収集")).toBeInTheDocument();
    expect(screen.getByText(/通信経路・通信の許可・正常性を表しません/)).toBeInTheDocument();
  });
  it("filters a related component and highlights only direct edges of the selected node", () => {
    const onSelect = vi.fn();
    render(<TopologyGraph nodes={nodes} edges={edges} partial={false} onSelect={onSelect} />);
    fireEvent.change(screen.getByRole("combobox", { name: "VNet の関連範囲" }), { target: { value: "vnet" } });
    expect(document.querySelectorAll(".topology-node")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "ネットワーク インターフェイス (NIC) resource-nicの関連を表示" }));
    expect(document.querySelectorAll(".topology-lines .highlighted")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "リソース詳細" }));
    expect(onSelect).toHaveBeenCalledWith("nic");
  });
  it("never offers details for a reference-only node or invents edges for isolated nodes", () => {
    render(<TopologyGraph nodes={nodes} edges={edges} partial={false} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "サブネット resource-subnetの関連を表示" }));
    expect(screen.queryByRole("button", { name: "リソース詳細" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "VNet の関連範囲" }), { target: { value: "other" } });
    expect(document.querySelectorAll(".topology-node")).toHaveLength(1);
    expect(document.querySelectorAll(".topology-lines path")).toHaveLength(0);
  });
});
