import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { HashRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicSnapshotV1 } from "./data/contracts";
import { publicSnapshotSchema } from "../scripts/public-schema";
import {
  fixtureTypes,
  publishedSnapshot,
  reliabilityFixture,
  withDefenderUnavailable
} from "./test/reliability-fixtures";
import App from "./App";

function renderAt(route: string, snapshot: PublicSnapshotV1) {
  // Rendering a snapshot the pipeline would reject proves nothing, so every fixture (including any
  // hand-tweaked one) has to satisfy the published contract before the UI ever sees it.
  publicSnapshotSchema.parse(snapshot);
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
 * Behavioural assertions build their own reliability state (see ./test/reliability-fixtures) because
 * the published snapshot is rewritten by every scheduled collection. Only assertions that stay true
 * for any collection read `publishedSnapshot` directly.
 */
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
    renderAt("/reliability", reliabilityFixture({ supported: 14, evaluated: 0, notApplicable: 48 }));

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
    renderAt("/reliability", reliabilityFixture({ supported: 4, evaluated: 2, notApplicable: 6 }));

    expect(await screen.findByText("リソース種別ごとの監視カバレッジ")).toBeInTheDocument();
    expect(screen.getByText(fixtureTypes.notApplicable)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "対応リソース種別の一覧（Microsoft Learn）" })
    ).toHaveAttribute(
      "href",
      "https://learn.microsoft.com/azure/service-health/resource-health-checks-resource-types"
    );
  });

  it("groups regions by monitored footprint instead of hiding unevaluated ones", async () => {
    // The fixture puts every unevaluated resource in koreacentral, so a region with nothing
    // evaluated must still be listed for the blind spot to be honest.
    renderAt("/reliability", reliabilityFixture({ supported: 6, evaluated: 4, notApplicable: 3 }));

    expect(await screen.findByText("リージョン別の監視カバレッジ")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("未評価だけのリージョンは表示しません");
    expect(screen.getByText("koreacentral")).toBeInTheDocument();
    expect(document.querySelectorAll(".coverage-region-row").length).toBeGreaterThan(1);
  });

  it("reports the real failure count once resources have been evaluated", async () => {
    renderAt(
      "/reliability",
      reliabilityFixture({ supported: 14, evaluated: 10, degraded: 2, notApplicable: 48 })
    );

    const failureCard = (await screen.findByText("確認された障害")).closest(".metric-card");
    if (!failureCard) throw new Error("Failure metric card was not rendered");

    expect(screen.queryByText("判定前")).not.toBeInTheDocument();
    expect(failureCard.textContent).toContain("2 件");
    expect(failureCard.textContent).toContain("低下 2 件・利用不可 0 件");
    expect(screen.getByText("10/14 件")).toBeInTheDocument();
  });
});

describe("Overview page", () => {
  /**
   * The overview used to translate the collected metrics through an exact-match table and drop
   * anything the table did not name, so a metric the collector added went missing with nothing to
   * say so. The page now prints what the snapshot holds. The fixture supplies its own labels rather
   * than reading the published ones: a published label is rewritten by every collection, and a test
   * that pins one fails on success rather than on a defect.
   */
  it("publishes the collected trend metrics verbatim instead of dropping them", async () => {
    const base = reliabilityFixture({ supported: 14, evaluated: 10, notApplicable: 48 });
    const snapshot: PublicSnapshotV1 = {
      ...base,
      overview: {
        ...base.overview,
        metrics: [
          {
            label: "収集した独自の指標",
            value: "42%",
            change: "前回の収集から +4 pt",
            direction: "up",
            severity: "healthy",
            points: [1, 2, 3]
          }
        ]
      }
    };

    renderAt("/overview", snapshot);

    expect(await screen.findByText("公開指標")).toBeInTheDocument();
    expect(screen.getByText("収集した独自の指標")).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.getByText("前回の収集から +4 pt")).toBeInTheDocument();
  });
});

describe("Network page", () => {
  it("pairs the blind-spot count with a total from the same inventory scope", async () => {
    // The blind-spot card is the fallback rendered while Azure Monitor metrics are unavailable.
    renderAt(
      "/network",
      reliabilityFixture({
        supported: 4,
        evaluated: 4,
        notApplicable: 2,
        networkNotApplicable: 6,
        metricCoverage: null
      })
    );

    const card = (await screen.findByText("Resource Health 対象外")).closest("article");
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("6/6 件");
  });

  it("drops the ratio when the two inventory scopes disagree instead of showing conflicting totals", async () => {
    const snapshot = reliabilityFixture({
      supported: 4,
      evaluated: 4,
      notApplicable: 2,
      networkNotApplicable: 6,
      metricCoverage: null
    });
    snapshot.network.inventory.total += 3;
    renderAt("/network", snapshot);

    const card = (await screen.findByText("Resource Health 対象外")).closest("article");
    expect(card?.textContent).toContain("6 件");
    expect(card?.textContent).not.toContain("/6 件");
  });

  it("reports the Azure Monitor probe result once metrics were collected", async () => {
    renderAt(
      "/network",
      reliabilityFixture({
        supported: 4,
        evaluated: 4,
        networkNotApplicable: 10,
        metricCoverage: {
          inventoryTotal: 10,
          sampledResources: 10,
          metricCapableResources: 3,
          metricSeries: 5,
          notApplicableResources: 7,
          failedResources: 0
        }
      })
    );

    const card = (await screen.findByText("3/10 件")).closest("article");
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("メトリック取得済み");
    expect(card?.textContent).toContain("合計 5 系列を Azure Monitor から取得");
    expect(screen.queryByText("Resource Health 対象外")).not.toBeInTheDocument();
  });
});

describe("Security page", () => {
  it("explains the disabled Defender plans rather than showing four empty metrics", async () => {
    renderAt("/security", withDefenderUnavailable(reliabilityFixture({ supported: 4, evaluated: 4 })));

    expect(await screen.findByText("Defender for Cloud は未収集です")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Defender for Cloud のプランを有効にする/ })
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("未実装");
  });
});
