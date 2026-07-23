import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { HashRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import snapshot from "../public/data/snapshot.json";
import App from "./App";
import type { PublicSnapshotV1 } from "./data/contracts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", window.location.pathname);
});

function renderSnapshot(data: PublicSnapshotV1, route: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => data
    })
  );
  window.history.replaceState(null, "", `#${route}`);
  render(
    <HashRouter>
      <App />
    </HashRouter>
  );
}

describe("Overview automation CTA", () => {
  it("scrolls to the pipeline without changing the HashRouter route", async () => {
    renderSnapshot(structuredClone(snapshot) as PublicSnapshotV1, "/overview");

    const cta = await screen.findByRole("button", { name: "自動更新パイプラインへ移動" });
    const pipeline = document.getElementById("automation-pipeline");
    if (!pipeline) throw new Error("Automation pipeline was not rendered");
    const scrollIntoView = vi.fn();
    pipeline.scrollIntoView = scrollIntoView;
    const hashBeforeClick = window.location.hash;

    fireEvent.click(cta);

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(window.location.hash).toBe(hashBeforeClick);
    expect(window.location.hash).toBe("#/overview");
  });
});

describe("Defender display semantics", () => {
  it("shows completed API queries with a missing Secure Score as partially unavailable", async () => {
    renderSnapshot(structuredClone(snapshot) as PublicSnapshotV1, "/security");

    expect(await screen.findByText("一部未取得")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Defender for Cloud のAPI照会は完了しました。Secure Scoreは今回のスナップショットでは未取得です。"
      )
    ).toBeInTheDocument();

    const alertsCard = screen
      .getByText("アクティブ アラート")
      .closest<HTMLElement>(".metric-card");
    if (!alertsCard) throw new Error("Active alerts metric card was not rendered");
    expect(within(alertsCard).getByText("0 件")).toBeInTheDocument();
    expect(within(alertsCard).getByText("集計件数のみ。0 件は安全を意味しません。")).toBeInTheDocument();
    expect(screen.getAllByText("公開可能な結果なし")).toHaveLength(2);
  });

  it("shows query complete when all nullable Defender signals contain real zeros", async () => {
    const data = structuredClone(snapshot) as PublicSnapshotV1;
    data.security.secureScore = 0;
    data.security.activeAlerts = 0;
    renderSnapshot(data, "/security");

    expect(await screen.findByText("照会完了")).toBeInTheDocument();
    expect(screen.getByText("Defender for Cloud のAPI照会は完了しました。")).toBeInTheDocument();

    const scoreCard = screen.getByText("Secure score").closest<HTMLElement>(".metric-card");
    if (!scoreCard) throw new Error("Secure Score metric card was not rendered");
    expect(within(scoreCard).getByText("0%")).toBeInTheDocument();
  });
});
