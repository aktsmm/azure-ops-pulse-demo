import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { HashRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import snapshot from "../public/data/snapshot.json";
import App from "./App";

describe("Overview automation CTA", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", window.location.pathname);
  });

  it("scrolls to the pipeline without changing the HashRouter route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => snapshot
      })
    );
    window.history.replaceState(null, "", "#/overview");

    render(
      <HashRouter>
        <App />
      </HashRouter>
    );

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

describe("Related demo navigation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", window.location.pathname);
  });

  it("identifies Azure Ops Pulse as current and links to the companion demos", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => snapshot
      })
    );
    window.history.replaceState(null, "", "#/overview");

    render(
      <HashRouter>
        <App />
      </HashRouter>
    );

    const demoNavigation = await screen.findByRole("navigation", { name: "関連デモ" });

    expect(within(demoNavigation).getByText("Azure Ops Pulse")).toHaveAttribute(
      "aria-current",
      "page"
    );
    const relatedDemos = [
      ["M365 Message Center Dashboard", "https://aktsmm.github.io/m365-message-center-dashboard/"],
      ["M365 Copilot Update Digest", "https://aktsmm.github.io/m365-copilot-update-digest/"],
      ["Daily Dev Byte", "https://aktsmm.github.io/daily-dev-byte/"],
      ["VS Code Copilot Digest", "https://aktsmm.github.io/vscode-copilot-digest/index.html"]
    ];

    for (const [name, href] of relatedDemos) {
      const link = within(demoNavigation).getByRole("link", { name });
      expect(link).toHaveAttribute("href", href);
      expect(link).not.toHaveAttribute("target");
    }
  });
});
