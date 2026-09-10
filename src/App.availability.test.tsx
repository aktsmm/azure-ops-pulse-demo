import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { HashRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publishedSnapshot } from "./test/reliability-fixtures";
import App from "./App";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", window.location.pathname);
});

function mount(route: string) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      ...publishedSnapshot,
      aiInsights: [],
      cost: {
        ...publishedSnapshot.cost,
        current: { availability: "unavailable", approximateAmount: null },
        previous: { availability: "unavailable", approximateAmount: null },
        deltaPercent: null, categories: []
      }
    })
  }));
  window.history.replaceState(null, "", `#${route}`);
  render(<HashRouter><App /></HashRouter>);
}

describe("Unavailable data is explained rather than invented", () => {
  it("shows collection diagnostics instead of implying there are no billed services", async () => {
    mount("/cost");
    expect(await screen.findByText("コストが表示されない理由")).toBeInTheDocument();
    const services = screen.getByText("対象サービス").closest("article")!;
    expect(within(services).getByText("未収集")).toBeInTheDocument();
    expect(services).not.toHaveTextContent("0 件");
    expect(screen.getByRole("link", { name: /収集ワークフローの結果を確認/ })).toHaveAttribute(
      "href", "https://github.com/aktsmm/azure-ops-pulse-demo/actions/workflows/collect-azure.yml"
    );
  });
  it("separates deterministic snapshot facts from AI and links to actual run results", async () => {
    mount("/ai-insights");
    expect(await screen.findByText("公開できる AI インサイトはありません")).toBeInTheDocument();
    expect(screen.getByText("収集範囲・制約（自動集計）")).toBeInTheDocument();
    expect(screen.getByText(/0 件は問題なしの証明ではありません/)).toBeInTheDocument();
    expect(screen.getByText(/AI が生成した分析ではありません/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /AI 分析ワークフローの実行結果を確認/ })).toHaveAttribute(
      "href", "https://github.com/aktsmm/azure-ops-pulse-demo/actions/workflows/ai-insights.lock.yml"
    );
    expect(document.body.textContent).not.toContain("Pull Request でレビューされた");
    expect(document.body.textContent).not.toContain("次回の分析ワークフローで候補が作成されます");
  });
});
