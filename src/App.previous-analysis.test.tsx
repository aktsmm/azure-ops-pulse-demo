import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HashRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { snapshotFixture } from "./test/snapshot-fixtures";
import type { PublicSnapshotV1 } from "./data/contracts";
import { formatDateTimeJa } from "./lib/display-formatters";
import App from "./App";
import { analysisDigest } from "./lib/analysis-continuity";

const archive = snapshotFixture();
beforeEach(() => vi.stubGlobal("crypto", webcrypto));
function currentSnapshot(): PublicSnapshotV1 {
  const current = structuredClone(archive);
  current.generatedAt = "2026-09-11T04:17:04.906Z";
  current.freshness.lastSuccessfulCollection = current.generatedAt;
  current.aiInsights = [];
  current.advisor!.details!.groups.reverse();
  current.cost.current.approximateAmount = "約 99,999 円";
  return current;
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", window.location.pathname);
});
function mount(route: string, current = currentSnapshot(), archivedResponse = () => new Response(JSON.stringify(archive)),
  bindingResponse?: () => Response) {
  let servedArchive: unknown = archive;
  const fetchMock = vi.fn().mockImplementation(async (url: string) => {
    if (url.endsWith("/snapshot.json")) return new Response(JSON.stringify(current));
    if (url.endsWith("/analysis-continuity.json")) {
      if (bindingResponse) return bindingResponse();
      const sourceScopeSha256 = "a".repeat(64);
      return new Response(JSON.stringify({
        kind: "azure-ops-pulse-analysis-continuity", version: 1, sourceScopeSha256,
        archiveSha256: await analysisDigest(servedArchive),
        currentEvidenceSha256: await analysisDigest({ sourceScopeSha256, evidence: { ...current, aiInsights: [] } })
      }));
    }
    const response = archivedResponse();
    if (response.ok) servedArchive = await response.clone().json();
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState(null, "", `#${route}`);
  render(<HashRouter><App /></HashRouter>);
  return fetchMock;
}

describe("Previous approved analysis stays in its own evidence context", () => {
  it("does not fetch or show archived analysis when current analysis is published", async () => {
    const fetchMock = mount("/overview", archive);
    await screen.findByRole("region", { name: "優先確認アクション" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("前回の公開分析の時点")).not.toBeInTheDocument();
  });
  it("dates the prior analysis while retaining current collection metrics", async () => {
    mount("/overview");
    const banner = await screen.findByLabelText("前回の公開分析の時点");
    expect(banner).toHaveTextContent(formatDateTimeJa(archive.generatedAt));
    expect(banner).toHaveTextContent(formatDateTimeJa(currentSnapshot().generatedAt));
    expect(banner).toHaveTextContent("生成・審査の実行状態は未確認");
    expect(screen.getAllByText("約 99,999 円").length).toBeGreaterThan(0);
    expect(screen.getByText("検証済み AI 分析").closest("article")).toHaveTextContent("0 件");
    expect(screen.getByRole("link", { name: "AI 分析をすべて見る" })).toHaveAttribute("href", "#/previous-analysis/ai-insights");
  });
  it("rejects an anonymization migration without trusted scope binding", async () => {
    const current = currentSnapshot();
    current.scope = { displayName: "Azure subscription", subscriptionId: "subscription-anonymous", tenantId: "tenant-anonymous" };
    mount("/overview", current, undefined, () => new Response("", { status: 404 }));
    expect(await screen.findByText(/前回の公開分析は取得または検証ができないため/)).toBeInTheDocument();
    expect(screen.queryByLabelText("前回の公開分析の時点")).not.toBeInTheDocument();
  });
  it("rejects a deleted continuity sidecar even when both legacy scope masks match", async () => {
    mount("/overview", currentSnapshot(), undefined, () => new Response("", { status: 404 }));
    expect(await screen.findByText(/前回の公開分析は取得または検証ができないため/)).toBeInTheDocument();
    expect(screen.queryByLabelText("前回の公開分析の時点")).not.toBeInTheDocument();
  });
  it("verifies published continuity before opening the original guide after anonymization", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const current = currentSnapshot();
    current.scope = { displayName: "Azure subscription", subscriptionId: "subscription-anonymous", tenantId: "tenant-anonymous" };
    const binding = {
      kind: "azure-ops-pulse-analysis-continuity", version: 1,
      archiveSha256: await analysisDigest(archive),
      currentEvidenceSha256: await analysisDigest({ sourceScopeSha256: "a".repeat(64), evidence: { ...current, aiInsights: [] } }),
      sourceScopeSha256: "a".repeat(64)
    };
    const group = archive.advisor!.details!.groups[0]!;
    const fetchMock = mount(`/previous-analysis/recommendations?group=${group.id}`, current,
      () => new Response(JSON.stringify(archive)), () => new Response(JSON.stringify(binding)));
    const selected = await screen.findByRole("region", { name: "選択中の確認ガイド" });
    expect(selected).toHaveTextContent(group.title);
    expect(within(selected).getAllByRole("article")).toHaveLength(1);
    expect(screen.getByLabelText("前回の公開分析の時点")).toHaveTextContent(formatDateTimeJa(archive.generatedAt));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("opens the original Advisor group even when current group indices were reordered", async () => {
    mount("/overview");
    await screen.findByLabelText("前回の公開分析の時点");
    const insight = archive.aiInsights.find((item) => item.numericEvidence.some((fact) =>
      fact.source === "advisor.details.groups.0.affectedResourceCount"))!;
    const article = screen.getByRole("heading", { name: insight.title }).closest("article")!;
    fireEvent.click(within(article).getByRole("link", { name: "関連する確認ガイドを開く" }));
    const selected = await screen.findByRole("region", { name: "選択中の確認ガイド" });
    expect(window.location.hash).toBe(`#/previous-analysis/recommendations?group=${archive.advisor!.details!.groups[0]!.id}`);
    expect(selected).toHaveTextContent(archive.advisor!.details!.groups[0]!.title);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("前回の分析");
    fireEvent.click(within(selected).getByRole("button", { name: "選択を解除して全件を見る" }));
    await waitFor(() => expect(window.location.hash).toBe("#/previous-analysis/recommendations"));
    expect(screen.getByRole("link", { name: /この環境の比較・優先順位を AI 分析で見る/ }))
      .toHaveAttribute("href", "#/previous-analysis/ai-insights");
  });
  it("restores an archive cost deep link with archive values and archived recommendation links", async () => {
    mount("/previous-analysis/cost");
    await screen.findByLabelText("前回の公開分析の時点");
    expect(screen.queryByText("約 99,999 円")).not.toBeInTheDocument();
    expect(screen.getAllByText(archive.cost.current.approximateAmount!).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "コストの推奨事項を確認" })).toHaveAttribute(
      "href", "#/previous-analysis/recommendations?category=Cost");
  });
  it("keeps an archived CVE target linked to its archived resource details", async () => {
    const past = structuredClone(archive);
    const resource = past.inventory.resources[0]!;
    past.security.vulnerabilities = {
      availability: "available", message: "Archived collection.", totalSubAssessments: 1, unhealthySubAssessments: 1,
      unmappedSubAssessments: 0, unknownStatusSubAssessments: 0, totalFindings: 1, truncated: false,
      findings: [{ cve: "CVE-2025-12345", severity: "High", resourceRefs: [resource.id] }]
    };
    const current = currentSnapshot();
    current.inventory.resources[0]!.name = "最新側の別名";
    mount("/previous-analysis/security", current, () => new Response(JSON.stringify(past)));
    expect(await screen.findByRole("heading", { name: "CVE-2025-12345" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("対象リソースの公開参照 1 件"));
    fireEvent.click(screen.getByRole("button", { name: `${resource.name}の詳細を開く` }));
    expect(screen.getByRole("dialog")).toHaveTextContent(resource.name);
    expect(screen.getByRole("dialog")).not.toHaveTextContent("最新側の別名");
  });
  it.each([
    ["missing", () => new Response("", { status: 404 }), "前回の公開分析ファイルはありません。"],
    ["failed", () => new Response("", { status: 503 }), "前回の公開分析は取得または検証ができないため表示していません。"],
    ["empty", () => new Response(JSON.stringify({ ...archive, aiInsights: [] })), "前回の公開分析は取得または検証ができないため表示していません。"]
  ] as const)("keeps an honest current empty state when archive is %s", async (_name, response, message) => {
    mount("/ai-insights", currentSnapshot(), response);
    expect(await screen.findByText(message, { exact: false })).toBeInTheDocument();
    expect(screen.getByText("公開できる AI インサイトはありません")).toBeInTheDocument();
    expect(screen.queryByLabelText("前回の公開分析の時点")).not.toBeInTheDocument();
  });
  it("does not silently replace an old deep link with fresh data when current analysis returns", async () => {
    const fetchMock = mount("/previous-analysis/cost", archive);
    expect(await screen.findByText("前回の分析は表示していません")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("サービス別コスト構成")).not.toBeInTheDocument();
  });
});
