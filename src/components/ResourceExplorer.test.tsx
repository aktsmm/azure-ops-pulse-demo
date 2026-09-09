import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResourceExplorer } from "./ResourceExplorer";
import type { ResourceItem } from "../data/contracts";

const resources: ResourceItem[] = [
  { id: "res-vm", name: "resource-vm", type: "microsoft.compute/virtualmachines", region: "japaneast", resourceGroup: "rg-east", status: "Healthy", owner: "team", tags: {}, change: "" },
  { id: "res-nw", name: "resource-nw", type: "microsoft.network/virtualnetworks", region: "westus", resourceGroup: "rg-west", status: "NotApplicable", owner: "team", tags: {}, change: "" },
  { id: "res-db", name: "resource-db", type: "microsoft.documentdb/databaseaccounts", region: "japaneast", resourceGroup: "rg-east", status: "Unknown", owner: "team", tags: {}, change: "" }
];
afterEach(cleanup);

describe("Resource explorer", () => {
  it("combines general-name search and filters and resets empty results", () => {
    render(<ResourceExplorer resources={resources} onSelect={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "リソースを検索" }), { target: { value: "ＶＭ" } });
    expect(screen.getByRole("status")).toHaveTextContent("1 / 3 件");
    expect(screen.getByText("仮想マシン (VM)", { selector: "strong" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "リージョン" }), { target: { value: "westus" } });
    expect(screen.getByText("条件に一致するリソースはありません")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "条件をクリア" }));
    expect(screen.getByRole("status")).toHaveTextContent("3 / 3 件");
  });
  it("supports category buttons, grouping and resource selection", () => {
    const select = vi.fn();
    render(<ResourceExplorer resources={resources} onSelect={select} />);
    fireEvent.click(screen.getByRole("button", { name: "ネットワーク 1" }));
    expect(screen.getByRole("status")).toHaveTextContent("1 / 3 件");
    fireEvent.change(screen.getByRole("combobox", { name: "グループ化" }), { target: { value: "resourceGroup" } });
    expect(screen.getByText("rg-west", { selector: "summary" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "resource-nwの詳細を開く" }));
    expect(select).toHaveBeenCalledWith(resources[1]);
  });
  it("paginates and resets to the first page after filtering", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...resources[0]!, id: `res-${i}`, name: `resource-${i}` }));
    render(<ResourceExplorer resources={many} onSelect={vi.fn()} />);
    expect(screen.getAllByRole("button", { name: /の詳細を開く/ })).toHaveLength(25);
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    expect(screen.getAllByRole("button", { name: /の詳細を開く/ })).toHaveLength(5);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "resource-29" } });
    expect(screen.getAllByRole("button", { name: /の詳細を開く/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "前へ" })).toBeDisabled();
  });
});
