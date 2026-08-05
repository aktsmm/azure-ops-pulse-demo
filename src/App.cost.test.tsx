import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { HashRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publicSnapshotSchema } from "../scripts/public-schema";
import type { PublicSnapshotV1 } from "./data/contracts";
import { JPY_DISCLOSURE_FLOOR, WITHHELD_JPY_AMOUNT_LABEL } from "./lib/jpy-disclosure";
import { costFixture, withUnroundedChange, withUnroundedPortfolioChange } from "./test/cost-fixtures";
import App from "./App";

function mount(snapshot: PublicSnapshotV1) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => snapshot
    })
  );
  window.history.replaceState(null, "", "#/cost");
  render(
    <HashRouter>
      <App />
    </HashRouter>
  );
}

/** Fixtures that the current contract must accept are validated before the UI ever sees them. */
function renderCost(snapshot: PublicSnapshotV1) {
  publicSnapshotSchema.parse(snapshot);
  mount(snapshot);
}

/** Renders a snapshot the current contract rejects, to prove the dashboard defends itself. */
function renderLegacyCost(snapshot: PublicSnapshotV1) {
  expect(() => publicSnapshotSchema.parse(snapshot)).toThrow();
  mount(snapshot);
}

const ABOVE_FLOOR = 140_000;
const BELOW_FLOOR = JPY_DISCLOSURE_FLOOR - 1;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", window.location.pathname);
});

describe("Cost page period-over-period change", () => {
  it("shows the change for services whose amount is published", async () => {
    renderCost(
      costFixture([
        { name: "Search", amountJpy: ABOVE_FLOOR, previousAmountJpy: ABOVE_FLOOR / 2 },
        { name: "Registry", amountJpy: ABOVE_FLOOR / 2, previousAmountJpy: ABOVE_FLOOR / 4 }
      ])
    );

    expect(await screen.findByText("前期間からの変化")).toBeInTheDocument();
    const rows = [...document.querySelectorAll(".delta-row")].map((row) => row.textContent);
    expect(rows).toEqual(["Search+100%", "Registry+100%"]);
    expect(document.querySelector(".source-footnote")?.textContent).not.toContain(
      WITHHELD_JPY_AMOUNT_LABEL
    );
  });

  it("withholds the change for a service whose amount is below the rounding unit", async () => {
    renderCost(
      costFixture([
        { name: "Search", amountJpy: ABOVE_FLOOR, previousAmountJpy: ABOVE_FLOOR / 2 },
        { name: "Storage", amountJpy: BELOW_FLOOR, previousAmountJpy: 1 }
      ])
    );

    expect(await screen.findByText("前期間からの変化")).toBeInTheDocument();
    const rows = [...document.querySelectorAll(".delta-row")].map((row) => row.textContent);
    expect(rows).toEqual(["Search+100%"]);
    expect(document.body.textContent).toContain(
      `金額が ${WITHHELD_JPY_AMOUNT_LABEL}の 1 サービスは変化率を出していません`
    );
  });

  it("never prints a change taken from an amount it withholds, even from an older snapshot", async () => {
    // The +38,537.8% that a real collection produced for a service reported as 約¥1千未満.
    renderLegacyCost(
      withUnroundedChange(
        costFixture([
          { name: "Search", amountJpy: ABOVE_FLOOR, previousAmountJpy: ABOVE_FLOOR / 2 },
          { name: "Storage", amountJpy: BELOW_FLOOR, previousAmountJpy: 1 }
        ]),
        "Storage",
        38_537.8
      )
    );

    expect(await screen.findByText("前期間からの変化")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("38537.8");
    expect(document.body.textContent).not.toContain("38,537.8");
    const rows = [...document.querySelectorAll(".delta-row")].map((row) => row.textContent);
    expect(rows).toEqual(["Search+100%"]);
  });

  it("names the services that simply have no comparable prior period", async () => {
    renderCost(
      costFixture([
        { name: "Search", amountJpy: ABOVE_FLOOR, previousAmountJpy: ABOVE_FLOOR / 2 },
        { name: "New workload", amountJpy: ABOVE_FLOOR / 2 }
      ])
    );

    expect(await screen.findByText("前期間からの変化")).toBeInTheDocument();
    expect(document.body.textContent).toContain(
      "New workloadは前期間と比較できる公開値がそろわないため、変化率を出していません"
    );
    const rows = [...document.querySelectorAll(".delta-row")].map((row) => row.textContent);
    expect(rows).toEqual(["Search+100%"]);
  });

  it("does not claim a prior period was missing when it was only below the rounding unit", async () => {
    // ¥900 → ¥140,000: there *was* a prior period, it was just too small to publish. The panel must
    // not name this service as having no prior record, because that would be untrue.
    renderCost(
      costFixture([
        { name: "Search", amountJpy: ABOVE_FLOOR, previousAmountJpy: ABOVE_FLOOR / 2 },
        { name: "Ramped up", amountJpy: ABOVE_FLOOR, previousAmountJpy: BELOW_FLOOR }
      ])
    );

    expect(await screen.findByText("前期間からの変化")).toBeInTheDocument();
    const rows = [...document.querySelectorAll(".delta-row")].map((row) => row.textContent);
    expect(rows).toEqual(["Search+100%"]);
    expect(document.body.textContent).not.toContain("前期間の実績がない");
    expect(document.body.textContent).not.toContain("前期間に公開できる金額がない");
    expect(document.body.textContent).toContain(
      "Ramped upは前期間と比較できる公開値がそろわないため、変化率を出していません"
    );
  });

  it("does not claim a prior period was missing when the periods sat on opposite sides of zero", async () => {
    // A ¥50,000 credit followed by ¥50,000 of charges: both periods are publishable, so the reason
    // is the sign flip, not an absent prior figure. The note must not assert the latter.
    renderCost(
      costFixture([
        { name: "Search", amountJpy: ABOVE_FLOOR, previousAmountJpy: ABOVE_FLOOR / 2 },
        { name: "Refunded", amountJpy: 50_000, previousAmountJpy: -50_000 }
      ])
    );

    expect(await screen.findByText("前期間からの変化")).toBeInTheDocument();
    const rows = [...document.querySelectorAll(".delta-row")].map((row) => row.textContent);
    expect(rows).toEqual(["Search+100%"]);
    expect(document.body.textContent).not.toContain("前期間の実績がない");
    expect(document.body.textContent).not.toContain("前期間に公開できる金額がない");
    expect(document.body.textContent).toContain(
      "Refundedは前期間と比較できる公開値がそろわないため、変化率を出していません"
    );
  });

  it("explains the rule instead of leaving the panel blank when nothing is comparable", async () => {
    renderCost(costFixture([{ name: "Storage", amountJpy: BELOW_FLOOR, previousAmountJpy: 1 }]));

    expect(await screen.findByText("比較できるサービスがありません")).toBeInTheDocument();
    expect(document.querySelectorAll(".delta-row")).toHaveLength(0);
    expect(document.body.textContent).toContain(
      `金額が ${WITHHELD_JPY_AMOUNT_LABEL}のサービスと、前期間と比較できる公開値がそろわないサービスは変化率を出しません`
    );
  });

  it("withholds the portfolio change while the period totals are below the rounding unit", async () => {
    renderCost(costFixture([{ name: "Storage", amountJpy: BELOW_FLOOR, previousAmountJpy: 1 }]));

    expect(await screen.findByText("期間差")).toBeInTheDocument();
    const card = screen.getByText("期間差").closest(".metric-card");
    expect(card).toHaveTextContent("比較不可");
    expect(card).toHaveTextContent("比較できる前期間のデータがありません");
  });

  it("keeps the portfolio change once both period totals are published", async () => {
    renderCost(
      costFixture([{ name: "Search", amountJpy: ABOVE_FLOOR, previousAmountJpy: ABOVE_FLOOR / 2 }])
    );

    expect(await screen.findByText("期間差")).toBeInTheDocument();
    expect(screen.getByText("期間差").closest(".metric-card")).toHaveTextContent("+100%");
  });

  it("never prints a portfolio change measured against withheld totals, even from an older snapshot", async () => {
    renderLegacyCost(
      withUnroundedPortfolioChange(
        costFixture([{ name: "Storage", amountJpy: BELOW_FLOOR, previousAmountJpy: 1 }]),
        38_537.8
      )
    );

    expect(await screen.findByText("期間差")).toBeInTheDocument();
    const card = screen.getByText("期間差").closest(".metric-card");
    expect(card).toHaveTextContent("比較不可");
    expect(document.body.textContent).not.toContain("38537.8");
    expect(document.body.textContent).not.toContain("38,537.8");
  });

  it("withholds the portfolio change when only the prior total is below the rounding unit", async () => {
    // Current total is publishable, so nothing but the prior total makes this incomparable.
    const snapshot = costFixture([
      { name: "Ramped up", amountJpy: ABOVE_FLOOR, previousAmountJpy: BELOW_FLOOR }
    ]);
    expect(snapshot.cost.current.approximateAmount).not.toBe(WITHHELD_JPY_AMOUNT_LABEL);
    expect(snapshot.cost.previous.approximateAmount).toBe(WITHHELD_JPY_AMOUNT_LABEL);

    renderLegacyCost(withUnroundedPortfolioChange(snapshot, 13_913.9));

    expect(await screen.findByText("期間差")).toBeInTheDocument();
    expect(screen.getByText("期間差").closest(".metric-card")).toHaveTextContent("比較不可");
    expect(document.body.textContent).not.toContain("13913.9");
    expect(document.body.textContent).not.toContain("13,913.9");
  });
});
