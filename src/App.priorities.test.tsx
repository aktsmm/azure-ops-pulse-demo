import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HashRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import published from "../public/data/snapshot.json";
import type { PublicSnapshotV1 } from "./data/contracts";
import App from "./App";

const snapshot = published as PublicSnapshotV1;
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", window.location.pathname);
});

function mount(route = "/overview", data = snapshot) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => data }));
  window.history.replaceState(null, "", `#${route}`);
  return render(<HashRouter><App /></HashRouter>);
}

describe("Decision-first overview pilot", () => {
  it("shows published observation, impact and action before secondary automation", async () => {
    mount();
    const priorities = await screen.findByRole("region", { name: "優先確認アクション" });
    const cards = within(priorities).getAllByRole("article");
    const high = snapshot.aiInsights.find((item) =>
      item.numericEvidence.some((evidence) => evidence.source.endsWith(".impacts.High")))!;
    expect(cards[0]).toHaveTextContent(high.title);
    expect(cards[0]).toHaveTextContent(high.observation);
    expect(cards[0]).toHaveTextContent(high.impact);
    expect(cards[0]).toHaveTextContent(high.recommendedAction);
    expect(within(cards[0]!).getByText(high.impact)).toBeVisible();
    expect(within(cards[0]!).getByText(high.recommendedAction)).toBeVisible();
    expect(within(cards[0]!).getByText(high.observation).closest("details")).not.toHaveAttribute("open");
    expect(priorities.compareDocumentPosition(document.getElementById("automation-pipeline")!) &
      Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.getElementById("automation-details")).not.toHaveAttribute("open");
    expect(cards).toHaveLength(snapshot.aiInsights.length);
  });

  it("opens the exact evidence-referenced group, not every Storage group", async () => {
    mount();
    const priorities = await screen.findByRole("region", { name: "優先確認アクション" });
    const insight = snapshot.aiInsights.find((item) =>
      item.numericEvidence.some((evidence) => evidence.source === "advisor.details.groups.0.affectedResourceCount"))!;
    const card = within(priorities).getByRole("heading", { name: insight.title }).closest("article")!;
    const group = snapshot.advisor!.details!.groups[0]!;
    document.documentElement.scrollTop = 1531;
    document.body.scrollTop = 1531;
    fireEvent.click(within(card).getByRole("link", { name: "関連する確認ガイドを開く" }));
    await waitFor(() => expect(window.location.hash).toBe(`#/recommendations?group=${group.id}`));
    const selected = screen.getByRole("region", { name: "選択中の確認ガイド" });
    expect(within(selected).getByRole("heading", { name: group.title })).toBeInTheDocument();
    expect(within(selected).getAllByRole("article")).toHaveLength(1);
    expect(selected).toHaveTextContent("ルールベース");
    expect(document.documentElement.scrollTop).toBe(0);
    expect(document.body.scrollTop).toBe(0);
    expect(screen.getByRole("main")).toHaveFocus();
    window.history.back();
    expect(await screen.findByRole("region", { name: "優先確認アクション" }, { timeout: 5_000 })).toBeInTheDocument();
    window.history.forward();
    expect(await screen.findByRole("region", { name: "選択中の確認ガイド" }, { timeout: 5_000 })).toHaveTextContent(group.title);
  });

  it("restores a group from the URL and clears group and filter selections", async () => {
    const group = snapshot.advisor!.details!.groups[0]!;
    mount(`/recommendations?group=${group.id}&category=Cost`);
    const selected = await screen.findByRole("region", { name: "選択中の確認ガイド" });
    expect(selected).toHaveTextContent(group.title);
    fireEvent.click(within(selected).getByRole("button", { name: "選択を解除して全件を見る" }));
    await waitFor(() => expect(window.location.hash).toBe("#/recommendations"));
    expect(screen.queryByRole("region", { name: "選択中の確認ガイド" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Advisor カテゴリ" })).toHaveValue("all");
  });

  it("explains an unknown group without substituting another recommendation", async () => {
    mount("/recommendations?group=missing-group");
    expect(await screen.findByText("指定された確認ガイドは見つかりません")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "選択中の確認ガイド" })).not.toBeInTheDocument();
  });

  it("does not fill an empty AI result with rule-based recommendations", async () => {
    mount("/overview", { ...snapshot, aiInsights: [] });
    const priorities = await screen.findByRole("region", { name: "優先確認アクション" });
    expect(priorities).toHaveTextContent("公開済みの AI 分析はありません");
    expect(priorities).toHaveTextContent("問題なしを意味しません");
    expect(within(priorities).queryAllByRole("article")).toHaveLength(0);
  });

  it("opens an individual AI analysis with a reloadable URL and exact guide link", async () => {
    const insight = snapshot.aiInsights.find((item) => item.route === "/recommendations")!;
    mount(`/ai-insights?insight=${insight.id}`);
    expect(await screen.findByRole("heading", { name: insight.title })).toBeInTheDocument();
    expect(document.querySelectorAll(".insight-card")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "関連する確認ガイドを開く" })).toHaveAttribute(
      "href", `#/recommendations?group=${snapshot.advisor!.details!.groups[0]!.id}`);
    fireEvent.click(screen.getByRole("button", { name: "分析の選択を解除" }));
    await waitFor(() => expect(window.location.hash).toBe("#/ai-insights"));
    expect(document.querySelectorAll(".insight-card")).toHaveLength(snapshot.aiInsights.length);
  });

  it("keeps collection age and schedule details in the header", async () => {
    mount();
    const freshness = await screen.findByLabelText(/データ鮮度:/);
    expect(freshness).toHaveTextContent(/次回更新前|更新予定を経過|更新確認が必要/);
    fireEvent.click(freshness.querySelector("summary")!);
    expect(freshness).toHaveAttribute("open");
    expect(freshness).toHaveTextContent("最終収集:");
    expect(freshness).toHaveTextContent("実行・公開の完了を保証しません");
  });
  it("keeps long multiple-target CTAs intact within the single-track mobile footer layout", async () => {
    const data = structuredClone(snapshot);
    const groups = data.advisor!.details!.groups;
    groups[0]!.title = "長い確認ガイド名".repeat(12);
    groups[1]!.title = "long-guide-without-spaces".repeat(12);
    data.aiInsights = [{
      ...data.aiInsights[0]!,
      numericEvidence: [0, 1].map((index) => ({
        label: `対象 ${index}`, value: String(groups[index]!.count), source: `advisor.details.groups.${index}.count`
      }))
    }];
    mount("/ai-insights", data);
    await screen.findByRole("heading", { name: data.aiInsights[0]!.title });
    for (const group of groups.slice(0, 2)) {
      expect(screen.getByRole("link", { name: `確認ガイド: ${group.title}` })).toHaveAttribute(
        "href", `#/recommendations?group=${group.id}`);
    }
    // JSDOM does not measure layout; guard the CSS contract and leave pixel verification to the browser.
    const styles = readFileSync("src/styles.css", "utf8");
    const mobileStyles = styles.slice(styles.indexOf("@media (max-width: 680px)"));
    expect(mobileStyles).toMatch(/\.insight-card > footer\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(mobileStyles).toMatch(/\.insight-card > footer \.secondary-button\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/);
  });
});
