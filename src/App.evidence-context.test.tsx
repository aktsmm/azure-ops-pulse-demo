import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { HashRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import published from "../public/data/snapshot.json";
import type { PublicSnapshotV1 } from "./data/contracts";
import App from "./App";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", window.location.pathname);
});
function mount(route: string, data: PublicSnapshotV1) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(data))));
  window.history.replaceState(null, "", `#${route}`);
  render(<HashRouter><App /></HashRouter>);
}

describe("Optional evidence reaches exact frontend context", () => {
  it("opens only the explicitly referenced Advisor resource", async () => {
    const data = structuredClone(published) as PublicSnapshotV1;
    const storage = data.inventory.resources.filter((resource) => resource.type === "microsoft.storage/storageaccounts");
    const group = data.advisor!.details!.groups[0]!;
    group.resourceRefs = [storage[0]!.id];
    group.targets = [{ resourceRef: storage[0]!.id, type: storage[0]!.type }];
    group.targetCoverage = { totalResources: 7, publishedResources: 1, unresolvedResources: 6, truncated: false };
    mount(`/recommendations?group=${group.id}`, data);
    fireEvent.click(await screen.findByText("対象リソースの公開参照 1 件を見る"));
    expect(screen.getByText(/収集インベントリとの対応未確認 6 件/)).toBeInTheDocument();
    expect(screen.queryByText(/個別の対応付けを確認できません/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: `${storage[0]!.name}の詳細を開く` }));
    expect(screen.getByRole("dialog")).toHaveTextContent(storage[0]!.name);
    expect(screen.getByRole("dialog")).not.toHaveTextContent(storage[1]!.name);
  });
  it("shows collected topology addresses, then the same resource's detail addresses", async () => {
    const data = structuredClone(published) as PublicSnapshotV1;
    const vnet = data.inventory.resources.find((resource) => resource.type === "microsoft.network/virtualnetworks")!;
    vnet.network = { privateIpv4: [], privateCidrs: ["10.0.0.0/16"], publicIpv4Masked: ["203.0.*.*"], truncated: false };
    data.network.topology = {
      availability: "available", message: "Collected.", truncated: false,
      nodes: [{ id: vnet.id, type: vnet.type, region: vnet.region, scope: "inventory", referenceOnly: false, network: vnet.network }],
      edges: []
    };
    mount("/network", data);
    fireEvent.click(await screen.findByRole("button", { name: `仮想ネットワーク (VNet) ${vnet.name}の関連を表示` }));
    const addresses = screen.getByRole("region", { name: "ネットワーク構成のアドレス情報" });
    expect(addresses).toHaveTextContent("10.0.0.0/16");
    expect(addresses).toHaveTextContent("203.0.*.*");
    fireEvent.click(screen.getByRole("button", { name: "リソース詳細" }));
    const drawer = screen.getByRole("dialog");
    expect(within(drawer).getByText("10.0.0.0/16")).toBeInTheDocument();
    expect(within(drawer).getByText("203.0.*.*")).toBeInTheDocument();
  });
  it("does not label an unevaluated-only Defender group as remediation in progress", async () => {
    const data = structuredClone(published) as PublicSnapshotV1;
    data.sources = data.sources.map((source) => source.source === "Defender for Cloud" ? { ...source, availability: "available" } : source);
    data.security.fieldAvailability = { assessments: "available", secureScore: "unavailable", activeAlerts: "unavailable" };
    data.security.recommendations = [{ title: "状態未評価の公開グループ", severity: "info", affectedCount: 0, unknownCount: 3, status: "In progress" }];
    mount("/security", data);
    const article = (await screen.findByText("状態未評価の公開グループ")).closest("article")!;
    expect(article).toHaveTextContent("未解決の評価レコード 0 件 / 未評価 3 件");
    expect(within(article).getByText("未評価")).toBeInTheDocument();
    expect(article).not.toHaveTextContent("対応中");
  });
  it.each([
    { scope: "inventory" as const, referenceOnly: true },
    { scope: "external" as const, referenceOnly: false },
    { scope: "uncollected" as const, referenceOnly: false }
  ])("does not borrow inventory context for a reference node: $scope/$referenceOnly", async (scope) => {
    const data = structuredClone(published) as PublicSnapshotV1;
    const vnet = data.inventory.resources.find((resource) => resource.type === "microsoft.network/virtualnetworks")!;
    vnet.network = { privateIpv4: [], privateCidrs: ["10.0.0.0/16"], publicIpv4Masked: [], truncated: false };
    data.network.topology = {
      availability: "partial", message: "Collected.", truncated: false,
      nodes: [{ id: vnet.id, type: vnet.type, ...scope }], edges: []
    };
    mount("/network", data);
    fireEvent.click(await screen.findByRole("button", { name: `仮想ネットワーク (VNet) ${vnet.id}の関連を表示` }));
    expect(screen.queryByRole("button", { name: "リソース詳細" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "ネットワーク構成のアドレス情報" })).not.toHaveTextContent("10.0.0.0/16");
  });
  it("renders independently collected CVEs even when aggregate Defender queries failed", async () => {
    const data = structuredClone(published) as PublicSnapshotV1;
    data.sources = data.sources.map((source) => source.source === "Defender for Cloud" ? { ...source, availability: "unavailable" } : source);
    const resource = data.inventory.resources[0]!;
    data.security.vulnerabilities = {
      availability: "available", message: "DO NOT RENDER CVE DIAGNOSTIC", totalSubAssessments: 1,
      unhealthySubAssessments: 1, unmappedSubAssessments: 0, unknownStatusSubAssessments: 0, totalFindings: 1, truncated: false,
      findings: [{ cve: "CVE-2025-12345", severity: "High", resourceRefs: [resource.id] }]
    };
    mount("/security", data);
    expect(await screen.findByRole("heading", { name: "CVE-2025-12345" })).toBeInTheDocument();
    expect(screen.getByText("Defender の集約指標は未収集です")).toBeInTheDocument();
    fireEvent.click(screen.getByText("対象リソースの公開参照 1 件"));
    fireEvent.click(screen.getByRole("button", { name: `${resource.name}の詳細を開く` }));
    expect(screen.getByRole("dialog")).toHaveTextContent(resource.name);
    expect(document.body).not.toHaveTextContent("DO NOT RENDER CVE DIAGNOSTIC");
  });
  it("uses explicit assessment coverage instead of claiming the total is unknown", async () => {
    const data = structuredClone(published) as PublicSnapshotV1;
    data.sources = data.sources.map((source) => source.source === "Defender for Cloud" ? { ...source, availability: "available" } : source);
    data.security.fieldAvailability = { assessments: "available", secureScore: "unavailable", activeAlerts: "unavailable" };
    data.security.assessmentCoverage = { totalAssessments: 4, unhealthyAssessments: 1, healthyAssessments: 1, notApplicableAssessments: 1, unknownAssessments: 1, totalGroups: 3, publishedGroups: 0, truncated: true };
    data.security.recommendations = [];
    mount("/security", data);
    fireEvent.click(await screen.findByText("評価レコードの収集範囲を見る · 4 件"));
    expect(screen.getByText("状態未確認").parentElement).toHaveTextContent("1 件");
    expect(screen.getByText(/0\/3 グループを公開・評価レコード 4 件/)).toBeInTheDocument();
    expect(screen.getByText(/評価レコード 4 件の収集結果はあります/)).toBeInTheDocument();
  });
});
