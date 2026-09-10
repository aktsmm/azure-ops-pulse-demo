import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { HashRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDemoSnapshot } from "../scripts/build-demo-snapshot";
import App from "./App";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", window.location.pathname);
});

describe("AI analysis and deterministic collection scope", () => {
  it.each([true, false])("separates collection scope when insights exist: %s", async (hasInsights) => {
    const snapshot = buildDemoSnapshot();
    if (!hasInsights) snapshot.aiInsights = [];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot }));
    window.history.replaceState(null, "", "#/ai-insights");
    render(<HashRouter><App /></HashRouter>);

    expect(await screen.findByText("収集範囲・制約（自動集計）")).toBeInTheDocument();
    expect(screen.getByText(/対象外は障害や監視設定の不備を意味しません/)).toBeInTheDocument();
    const outOfScope = screen.getByText("Resource Health 対象外").closest("article")!;
    expect(within(outOfScope).getByText(`${snapshot.reliability.coverage.notApplicableResources} 件`)).toBeInTheDocument();
    expect(outOfScope.closest(".insight-card")).toBeNull();
    expect(screen.getByText(/推論の正しさを保証/)).toBeInTheDocument();
    if (hasInsights) {
      expect(screen.getAllByText(snapshot.aiInsights[0]!.title).length).toBeGreaterThan(0);
    } else {
      expect(screen.getByText("公開できる AI インサイトはありません")).toBeInTheDocument();
    }
  });
});
