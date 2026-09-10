import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HashRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicSnapshotV1 } from "./data/contracts";
import { buildDemoSnapshot } from "../scripts/build-demo-snapshot";
import App from "./App";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", window.location.pathname);
});

function fixture(): PublicSnapshotV1 {
  const data = buildDemoSnapshot("2026-09-09T00:00:00.000Z");
  data.advisor = {
    availability: "available", message: "Collected.",
    recommendations: [
      { category: "HighAvailability", impact: "High", count: 21 },
      { category: "HighAvailability", impact: "Medium", count: 27 },
      { category: "Security", impact: "High", count: 2 },
      { category: "Cost", impact: "Low", count: 1 }
    ]
  };
  return data;
}

function mount(route: string, data = fixture()) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => data }));
  window.history.replaceState(null, "", `#${route}`);
  render(<HashRouter><App /></HashRouter>);
}

describe("Recommendation routes", () => {
  it("opens the dedicated all-category route and explains legacy detail absence", async () => {
    mount("/recommendations");
    expect(await screen.findByRole("heading", { level: 1, name: "推奨事項" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Advisor カテゴリ" })).toHaveValue("all");
    expect(screen.getByText("内容詳細は未収集です")).toBeInTheDocument();
    const reliabilityRow = screen.getByRole("row", { name: /信頼性/ });
    expect(reliabilityRow).toHaveTextContent("48");
    expect(reliabilityRow).toHaveTextContent("21");
    expect(reliabilityRow).toHaveTextContent("27");
    expect(screen.getAllByRole("row", { name: /信頼性/ })).toHaveLength(1);
  });

  it("keeps security scoped and links to all recommendations", async () => {
    mount("/security");
    const advisor = await screen.findByRole("region", { name: "Azure Advisor の推奨事項" });
    expect(within(advisor).getByText("推奨事項レコード 2 件")).toBeInTheDocument();
    expect(within(advisor).queryByRole("combobox", { name: "Advisor カテゴリ" })).not.toBeInTheDocument();
    expect(within(advisor).queryByRole("row", { name: /信頼性/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "すべてのカテゴリの推奨事項を確認" })).toHaveAttribute("href", "#/recommendations");
  });

  it.each(["/recommendations", "/security"])("passes safe content details through %s", async (route) => {
    const data = fixture();
    data.advisor!.recommendations = [{ category: "Security", impact: "High", count: 2 }];
    data.advisor!.details = {
      availability: "available", message: "Never render this diagnostic.",
      mappedRecommendationCount: 2, withheldRecommendationCount: 0, excludedRecommendationCount: 0,
      lifecycleUnknownCount: 0, affectedResourceCount: 1,
      groups: [{
        id: "test-security", category: "Security", contentStatus: "mapped",
        count: 2, impacts: { High: 2, Medium: 0, Low: 0, Unknown: 0 }, affectedResourceCount: 1,
        resourceTypes: [], title: "UI 接続テストの確認ガイド",
        description: "テスト用の確認理由", recommendedAction: "テスト用の次の確認",
        deferWhen: "テスト用の保留条件", caveat: "テスト用の未確認事項",
        sourceUrl: "https://learn.microsoft.com/ja-jp/azure/advisor/advisor-overview"
      }]
    };
    mount(route, data);
    expect(await screen.findByRole("heading", { name: "UI 接続テストの確認ガイド" })).toBeInTheDocument();
    expect(screen.getByText("テスト用の次の確認")).toBeInTheDocument();
    const deferral = screen.getByText("テスト用の保留条件").closest("details")!;
    expect(deferral).not.toHaveAttribute("open");
    fireEvent.click(within(deferral).getByText("デモ用途での保留判断・前提を見る"));
    expect(deferral).toHaveAttribute("open");
    expect(screen.queryByText("内容詳細は未収集です")).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("Never render this diagnostic");
  });

  it.each(["Cost", "HighAvailability"])("honors category query %s", async (category) => {
    mount(`/recommendations?category=${category}`);
    expect(await screen.findByRole("combobox", { name: "Advisor カテゴリ" })).toHaveValue(category);
    expect(screen.getAllByRole("row")).toHaveLength(2);
  });

  it("keeps category selection in the URL and falls back safely for an unknown query", async () => {
    mount("/recommendations?category=unrecognized");
    const category = await screen.findByRole("combobox", { name: "Advisor カテゴリ" });
    expect(category).toHaveValue("all");
    fireEvent.change(category, { target: { value: "Cost" } });
    await waitFor(() => expect(window.location.hash).toBe("#/recommendations?category=Cost"));
    expect(screen.getAllByRole("row")).toHaveLength(2);
    fireEvent.change(category, { target: { value: "all" } });
    await waitFor(() => expect(window.location.hash).toBe("#/recommendations"));
    expect(screen.getAllByRole("row")).toHaveLength(4);
  });

  it.each([
    ["/cost", "コストの推奨事項を確認", "Cost"],
    ["/reliability", "信頼性の推奨事項を確認", "HighAvailability"]
  ])("links %s to its category", async (route, label, category) => {
    mount(route);
    expect(await screen.findByRole("link", { name: label })).toHaveAttribute("href", `#/recommendations?category=${category}`);
  });
});

describe("Bounded operational labels", () => {
  it("explains a successful empty Defender collection instead of implying content was hidden", async () => {
    const data = fixture();
    data.sources = [...data.sources.filter((source) => source.source !== "Defender for Cloud"),
      { source: "Defender for Cloud", availability: "partial", message: "Collected." }];
    data.security = {
      fieldAvailability: { secureScore: "unavailable", activeAlerts: "available", assessments: "available" },
      secureScore: null, activeAlerts: 0, recommendations: [], compliance: []
    };
    mount("/security", data);
    expect(await screen.findByText(/タイトルを隠したための空表示ではありません/)).toBeInTheDocument();
  });

  it("distinguishes published Defender groups from assessment records and never grades a score", async () => {
    const data = fixture();
    data.sources = [...data.sources.filter((source) => source.source !== "Defender for Cloud"),
      { source: "Defender for Cloud", availability: "available", message: "Collected." }];
    data.security = {
      secureScore: 95, activeAlerts: 0, compliance: [],
      recommendations: [
        { title: "公開評価グループ A", severity: "warning", status: "Open", affectedCount: 15 },
        { title: "公開評価グループ B", severity: "info", status: "Resolved", affectedCount: 0 }
      ]
    };
    mount("/security", data);
    const groups = (await screen.findByText("公開中の評価グループ")).closest("article")!;
    expect(groups).toHaveTextContent("2 件");
    expect(groups).toHaveTextContent("最大 12 グループ");
    expect(screen.getByText("未解決・未評価の評価レコード 15 件（リソースの重複排除なし）")).toBeInTheDocument();
    const score = screen.getByText("Secure score").closest("article")!;
    expect(score).toHaveTextContent("95%");
    expect(score.querySelector(".severity-healthy")).toBeNull();
    expect(document.body.textContent).not.toContain("影響を受けるリソース 15");
    expect(document.body.textContent).not.toContain("未解決の推奨事項");
  });

  it("does not infer monitoring gaps from Resource Health coverage or outages from event counts", async () => {
    const data = fixture();
    data.reliability.serviceHealth = {
      availability: "partial", activeEvents: null, resolvedEvents: 0, categories: [], message: "Partial."
    };
    mount("/reliability", data);
    const coverage = (await screen.findByText("Resource Health 評価対象")).closest("article")!;
    expect(coverage.querySelector(".severity-healthy")).toBeNull();
    const active = screen.getByText("継続中のイベント").closest("article")!;
    expect(active).toHaveTextContent("未確認");
    expect(active).not.toHaveTextContent("0 件");
    expect(screen.getByText(/影響リソース数や障害件数ではありません/)).toBeInTheDocument();
    expect(document.body.textContent).toContain("既存監視の有無は未確認");
    expect(document.body.textContent).not.toContain("監視の死角");
    expect(document.body.textContent).not.toContain("代替監視が必要");
  });

  it("describes independent AI review and automated publication rather than fictional human approval", async () => {
    mount("/overview");
    const pipeline = (await screen.findByText("自動更新パイプライン")).closest("section")!;
    expect(pipeline).toHaveTextContent("独立したAI内容審査");
    expect(pipeline).toHaveTextContent("検証・審査後に自動");
    expect(pipeline).toHaveTextContent("Azure の構成変更・修復の要否と実施");
    expect(pipeline).not.toHaveTextContent("必須: 人がmerge");
    expect(pipeline).not.toHaveTextContent("AI draft PR");
  });
});
