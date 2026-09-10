import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AdvisorPanel } from "./AdvisorPanel";
import type { AdvisorDetails, AdvisorSummary } from "../data/contracts";
afterEach(cleanup);

// Deliberately synthetic content: no expectations depend on the scheduled production snapshot.
function detailFixture(): AdvisorDetails {
  return {
    availability: "partial", message: "Do not render diagnostic content.",
    mappedRecommendationCount: 6, withheldRecommendationCount: 3,
    excludedRecommendationCount: 2, lifecycleUnknownCount: 1, affectedResourceCount: null,
    groups: [
      {
        id: "test-resilience", category: "HighAvailability", contentStatus: "mapped",
        count: 4, impacts: { High: 2, Medium: 2, Low: 0, Unknown: 0 }, affectedResourceCount: 2,
        resourceTypes: [{ type: "microsoft.compute/virtualmachines", count: 4 }],
        title: "テスト用: 復旧構成を確認", description: "停止時の復旧要件と構成を照合してください。",
        recommendedAction: "復旧目標と現在の冗長構成を確認します。",
        deferWhen: "非本番環境で停止許容の承認記録がある場合は保留を検討します。",
        caveat: "この環境の復旧目標と例外承認は未確認です。",
        sourceUrl: "https://learn.microsoft.com/ja-jp/azure/advisor/advisor-overview"
      },
      {
        id: "test-cost", category: "Cost", contentStatus: "mapped",
        count: 2, impacts: { High: 0, Medium: 0, Low: 2, Unknown: 0 }, affectedResourceCount: null,
        resourceTypes: [],
        title: "テスト用: 利用状況を確認", description: "利用状況を確認します。",
        recommendedAction: "利用期間を照合します。", deferWhen: "用途が未確認の場合は結論を保留します。",
        caveat: "対象と削減効果は未確認です。",
        sourceUrl: "https://learn.microsoft.com/ja-jp/azure/advisor/advisor-overview"
      },
      {
        id: "withheld-security", category: "Security", contentStatus: "withheld",
        count: 3, impacts: { High: 0, Medium: 0, Low: 0, Unknown: 3 }, affectedResourceCount: null,
        resourceTypes: [],
        title: "Not a verified title", description: "Unverified content", recommendedAction: "Unverified action",
        deferWhen: "Unverified exception", caveat: "Unverified caveat",
        sourceUrl: "https://aka.ms/azureadvisordashboard"
      }
    ]
  };
}

const detailRecommendations: AdvisorSummary["recommendations"] = [
  { category: "HighAvailability", impact: "High", count: 3 },
  { category: "HighAvailability", impact: "Medium", count: 2 },
  { category: "Cost", impact: "Low", count: 3 },
  { category: "Security", impact: "Unknown", count: 3 }
];

describe("Advisor panel", () => {
  it("distinguishes missing data from zero recommendations", () => {
    render(<AdvisorPanel />);
    expect(screen.getByText("Advisor の推奨事項は未収集です")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("0 件");
  });
  it("defaults to all categories and allows category filtering", () => {
    render(<AdvisorPanel availability="available" recommendations={[
      { category: "Security", impact: "High", count: 4 },
      { category: "Cost", impact: "Low", count: 7 }
    ]} />);
    expect(screen.getByText("推奨事項レコード 11 件")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(3);
    fireEvent.change(screen.getByRole("combobox", { name: "Advisor カテゴリ" }), { target: { value: "Security" } });
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByRole("status")).toHaveTextContent("4 全状態のレコード");
  });
  it("labels partial zero results without claiming a secure estate", () => {
    render(<AdvisorPanel availability="partial" categoryScope="Security" recommendations={[{ category: "Cost", impact: "High", count: 2 }]} />);
    expect(screen.getByText("一部収集")).toBeInTheDocument();
    expect(screen.getByText(/安全性の保証ではなく/)).toBeInTheDocument();
  });
});

describe("Advisor content and count semantics", () => {
  it("leads with eligible records and puts all-state totals behind an expandable breakdown", () => {
    render(<AdvisorPanel availability="available" recommendations={detailRecommendations} details={detailFixture()} />);
    expect(screen.getByText("9 レコード", { selector: ".advisor-metrics strong" })).toBeInTheDocument();
    expect(screen.getByText("2 レコード", { selector: ".advisor-metrics strong" })).toBeInTheDocument();
    const disclosure = screen.getByText(/全状態のカテゴリ集計を見る/).closest("details");
    expect(disclosure).not.toHaveAttribute("open");
    expect(disclosure?.textContent).toContain("11 レコード（完了・却下・延期を含む）");
    expect(screen.getByRole("heading", { name: "テスト用: 復旧構成を確認" })).toBeVisible();
  });

  it("shows curated rationale/actions/conditional deferral as non-AI guidance and reconciles lifecycle exclusions", () => {
    render(<AdvisorPanel availability="available" recommendations={detailRecommendations} details={detailFixture()} />);
    expect(screen.getByText(/ルールベースの確認ガイド/)).toHaveTextContent("公式推奨に基づく説明");
    expect(screen.getByText(/ルールベースの確認ガイド/)).toHaveTextContent("この環境の比較・優先順位は「AI 分析」");
    expect(screen.getByText(/件数照合: カテゴリ集計 11/)).toHaveTextContent("内容分類済み 6 + 内容未確認 3 + 詳細から除外 2");
    expect(screen.getByText(/ライフサイクル未確認のまま掲載: 1/)).toBeInTheDocument();
    const card = screen.getByRole("heading", { name: "テスト用: 復旧構成を確認" }).closest("article")!;
    expect(card).toHaveTextContent("確認する理由");
    expect(card).toHaveTextContent("復旧目標と現在の冗長構成を確認します");
    expect(card).toHaveTextContent("非本番環境で停止許容の承認記録がある場合");
    expect(card).toHaveTextContent("保留条件はこの環境で確認されていません");
    expect(card).toHaveTextContent("推奨事項レコード 4 件");
    expect(card).toHaveTextContent("対象リソース（グループ内の重複を除く）: 2 件");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Do not render diagnostic content");
  });

  it("does not sum group resource counts or turn null identities into zero", () => {
    render(<AdvisorPanel availability="available" recommendations={detailRecommendations} details={detailFixture()} />);
    const distinct = screen.getByText("詳細対象のリソース（全グループの重複を除く）").closest("article")!;
    expect(distinct).toHaveTextContent("未確認");
    expect(distinct).not.toHaveTextContent("0 件");
    const cost = screen.getByRole("heading", { name: "テスト用: 利用状況を確認" }).closest("article")!;
    expect(cost).toHaveTextContent("対象リソース（グループ内の重複を除く）: 未確認");
    expect(cost).toHaveTextContent("グループ間のリソース数は合算できません");
  });

  it("uses the exact distinct resource count when it is published", () => {
    const details = detailFixture();
    details.affectedResourceCount = 5;
    details.groups[1]!.affectedResourceCount = 1;
    details.groups[2]!.affectedResourceCount = 3;
    render(<AdvisorPanel availability="available" recommendations={detailRecommendations} details={details} />);
    expect(screen.getByText("詳細対象のリソース（全グループの重複を除く）").closest("article")).toHaveTextContent("5 件");
  });

  it("keeps withheld content explicitly unknown with a portal link and unknown impact", () => {
    render(<AdvisorPanel availability="available" recommendations={detailRecommendations} details={detailFixture()} />);
    const card = screen.getByRole("heading", { name: "未分類・内容未確認の推奨事項" }).closest("article")!;
    expect(card).toHaveTextContent("影響度 不明 3 件");
    expect(card).toHaveTextContent("低リスクや対応不要とは扱いません");
    expect(within(card).getByRole("link", { name: "Azure portal で内容と対象を確認" })).toHaveAttribute("href", "https://aka.ms/azureadvisordashboard");
    expect(document.body.textContent).not.toContain("Not a verified title");
    expect(document.body.textContent).not.toContain("Unverified action");
  });

  it("searches actions and deferral conditions without changing the category rollup", () => {
    render(<AdvisorPanel availability="available" recommendations={detailRecommendations} details={detailFixture()} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "推奨内容を検索" }), { target: { value: "非本番" } });
    expect(screen.getAllByRole("heading", { level: 3 }).filter((heading) => heading.closest(".advisor-detail-card"))).toHaveLength(1);
    expect(screen.getByText("1 内容グループ / 検索・フィルターに一致 4 レコード")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(4);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "存在しない条件" } });
    expect(screen.getByText(/検索・フィルターに一致する内容グループはありません/)).toHaveTextContent("対応不要の判断ではありません");
  });

  it("filters impacts without relabeling a group resource count as a filtered count", () => {
    render(<AdvisorPanel availability="available" recommendations={detailRecommendations} details={detailFixture()} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Advisor 影響度" }), { target: { value: "High" } });
    expect(screen.getByText("1 内容グループ / 検索・フィルターに一致 2 レコード")).toBeInTheDocument();
    const card = screen.getByRole("heading", { name: "テスト用: 復旧構成を確認" }).closest("article")!;
    expect(card).toHaveTextContent("推奨事項レコード 4 件");
    expect(card).toHaveTextContent("選択した影響度に一致: 2 レコード");
    expect(card).toHaveTextContent("件数と対象リソース数はグループ全体の値");
  });

  it("does not expose other category details or whole-estate metrics on the security subset", () => {
    render(<AdvisorPanel availability="available" categoryScope="Security" recommendations={detailRecommendations} details={detailFixture()} />);
    expect(screen.getByText("3 レコード", { selector: ".advisor-metrics strong" })).toBeInTheDocument();
    expect(screen.queryByText("テスト用: 復旧構成を確認")).not.toBeInTheDocument();
    expect(screen.queryByText("詳細対象のリソース（全グループの重複を除く）")).not.toBeInTheDocument();
    expect(screen.getByText(/件数照合: このカテゴリの集計 3/)).toBeInTheDocument();
  });

  it("warns about inconsistent totals instead of claiming complete coverage", () => {
    const details = detailFixture();
    details.excludedRecommendationCount = 0;
    render(<AdvisorPanel availability="available" recommendations={detailRecommendations} details={details} />);
    expect(screen.getByRole("alert")).toHaveTextContent("集計と詳細の件数が一致しません");
    expect(screen.queryByText(/件数照合:/)).not.toBeInTheDocument();
  });

  it("treats explicitly unavailable details as unavailable even if a stale group is present", () => {
    const details = detailFixture();
    details.availability = "unavailable";
    render(<AdvisorPanel availability="available" recommendations={detailRecommendations} details={details} />);
    expect(screen.getByText("内容詳細は未収集です")).toBeInTheDocument();
    expect(screen.queryByText("テスト用: 復旧構成を確認")).not.toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("does not disclose stale detail or summary counts when the Advisor source is unavailable", () => {
    render(<AdvisorPanel availability="unavailable" recommendations={detailRecommendations} details={detailFixture()} />);
    expect(screen.getByText("Advisor の推奨事項は未収集です")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("11 件");
    expect(screen.queryByText("テスト用: 復旧構成を確認")).not.toBeInTheDocument();
  });
});
