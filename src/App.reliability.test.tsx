import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { HashRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import baseSnapshot from "../public/data/snapshot.json";
import type { PublicSnapshotV1, ResourceHealthStatus } from "./data/contracts";
import App from "./App";

const publishedSnapshot = baseSnapshot as unknown as PublicSnapshotV1;

function renderAt(route: string, snapshot: PublicSnapshotV1) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => snapshot
    })
  );
  window.history.replaceState(null, "", `#${route}`);
  render(
    <HashRouter>
      <App />
    </HashRouter>
  );
}

/**
 * Promotes the first `count` unevaluated resources to Healthy/Degraded so the reliability page can
 * be asserted in the state it will reach once a scheduled collection publishes real statuses.
 */
function withEvaluatedResources(count: number, degraded: number): PublicSnapshotV1 {
  const snapshot = structuredClone(publishedSnapshot);
  let promoted = 0;
  let markedDegraded = 0;
  for (const resource of snapshot.inventory.resources) {
    if (promoted >= count) break;
    if (resource.status !== "Unknown") continue;
    const next: ResourceHealthStatus = markedDegraded < degraded ? "Degraded" : "Healthy";
    if (next === "Degraded") markedDegraded += 1;
    resource.status = next;
    promoted += 1;
  }
  const healthy = promoted - markedDegraded;
  const coverage = snapshot.reliability.coverage;
  coverage.evaluatedResources = promoted;
  coverage.unevaluatedResources = coverage.supportedResources - promoted;
  coverage.healthyResources = healthy;
  coverage.degradedResources = markedDegraded;
  coverage.unavailableResources = 0;
  coverage.supportedCoveragePercent = Math.round((promoted / coverage.supportedResources) * 100);
  snapshot.overview.postureScore = Math.round((healthy / promoted) * 100);
  const resourceHealth = snapshot.sources.find((source) => source.source === "Resource Health");
  if (resourceHealth) {
    resourceHealth.availability = "available";
    resourceHealth.message = `Resource Health returned availability for ${promoted} resources.`;
  }
  return snapshot;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", window.location.pathname);
});

describe("Reliability page", () => {
  it("leads with how much of the estate Resource Health can evaluate", async () => {
    renderAt("/reliability", publishedSnapshot);
    const coverage = publishedSnapshot.reliability.coverage;

    const heading = await screen.findByRole("heading", {
      name: `${coverage.totalResources} 件のうち ${coverage.supportedResources} 件が Resource Health で監視できます`
    });

    expect(heading).toBeInTheDocument();
    expect(
      screen.getByText(`${coverage.supportedResources}/${coverage.totalResources} 件`)
    ).toBeInTheDocument();
  });

  it("says failures are not judged yet instead of reporting zero incidents", async () => {
    renderAt("/reliability", publishedSnapshot);

    expect(await screen.findByText("確認された障害")).toBeInTheDocument();
    expect(screen.getByText("判定前")).toBeInTheDocument();
    expect(
      screen.getByText(
        "評価済みが 0 件のため、障害の有無は判定していません（0 件とは表示しません）"
      )
    ).toBeInTheDocument();
  });

  it("never tells visitors that a collection source is unimplemented", async () => {
    renderAt("/reliability", publishedSnapshot);
    await screen.findByRole("heading", { name: /Resource Health で監視できます$/ });

    expect(document.body.textContent).not.toContain("未実装");
    expect(document.body.textContent).not.toContain("Unavailable from public snapshot");
  });

  it("breaks the blind spot down by resource type with a Learn reference", async () => {
    renderAt("/reliability", publishedSnapshot);

    expect(await screen.findByText("リソース種別ごとの監視カバレッジ")).toBeInTheDocument();
    expect(screen.getByText("microsoft.logic/workflows")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "対応リソース種別の一覧（Microsoft Learn）" })
    ).toHaveAttribute(
      "href",
      "https://learn.microsoft.com/azure/service-health/resource-health-checks-resource-types"
    );
  });

  it("groups regions by monitored footprint instead of hiding unevaluated ones", async () => {
    renderAt("/reliability", publishedSnapshot);

    expect(await screen.findByText("リージョン別の監視カバレッジ")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("未評価だけのリージョンは表示しません");
    expect(document.querySelectorAll(".coverage-region-row").length).toBeGreaterThan(0);
  });

  it("reports the real failure count once resources have been evaluated", async () => {
    const snapshot = withEvaluatedResources(10, 2);
    renderAt("/reliability", snapshot);

    const failureCard = (await screen.findByText("確認された障害")).closest(".metric-card");
    if (!failureCard) throw new Error("Failure metric card was not rendered");

    expect(screen.queryByText("判定前")).not.toBeInTheDocument();
    expect(failureCard.textContent).toContain("2 件");
    expect(failureCard.textContent).toContain("低下 2 件・利用不可 0 件");
    expect(screen.getByText("10/14 件")).toBeInTheDocument();
  });
});

describe("Overview page", () => {
  it("publishes the collected trend metrics in Japanese instead of dropping them", async () => {
    renderAt("/overview", publishedSnapshot);

    expect(await screen.findByText("公開指標")).toBeInTheDocument();
    expect(screen.getByText("Resource Health の評価範囲")).toBeInTheDocument();
    expect(screen.getByText("対応 14 件中 0 件を評価済み（対象外 48 件）")).toBeInTheDocument();
    expect(screen.getByText("利用不可のソース")).toBeInTheDocument();
  });
});

describe("Network page", () => {
  it("pairs the blind-spot count with a total from the same inventory scope", async () => {
    renderAt("/network", publishedSnapshot);

    const networkResources = publishedSnapshot.inventory.resources.filter((resource) =>
      resource.type.startsWith("microsoft.network/")
    );
    const blindSpot = networkResources.filter(
      (resource) => resource.status === "NotApplicable"
    ).length;

    const card = (await screen.findByText("Resource Health 対象外")).closest("article");
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain(
      `${blindSpot}/${networkResources.length} 件`
    );
    expect(networkResources.length).toBe(publishedSnapshot.network.inventory.total);
  });

  it("drops the ratio when the two inventory scopes disagree instead of showing conflicting totals", async () => {
    const snapshot = structuredClone(publishedSnapshot);
    snapshot.network.inventory.total += 3;
    renderAt("/network", snapshot);

    const networkResources = snapshot.inventory.resources.filter((resource) =>
      resource.type.startsWith("microsoft.network/")
    );
    const blindSpot = networkResources.filter(
      (resource) => resource.status === "NotApplicable"
    ).length;

    const card = (await screen.findByText("Resource Health 対象外")).closest("article");
    expect(card?.textContent).toContain(`${blindSpot} 件`);
    expect(card?.textContent).not.toContain(`/${networkResources.length} 件`);
  });
});

describe("Security page", () => {
  it("explains the disabled Defender plans rather than showing four empty metrics", async () => {
    renderAt("/security", publishedSnapshot);

    expect(await screen.findByText("Defender for Cloud は未収集です")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Defender for Cloud のプランを有効にする/ })
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("未実装");
  });
});
