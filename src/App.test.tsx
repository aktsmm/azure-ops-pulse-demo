import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
