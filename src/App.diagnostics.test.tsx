import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { HashRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicSnapshotV1 } from "./data/contracts";
import { publicSnapshotSchema } from "../scripts/public-schema";
import { buildDemoSnapshot } from "../scripts/build-demo-snapshot";
import { publishedSnapshot } from "./test/reliability-fixtures";
import { costFixture } from "./test/cost-fixtures";
import { ADVISOR_DETAILS_MESSAGE, advisorContent } from "./lib/advisor-catalog";
import App from "./App";

const ROUTES = [
  "/overview",
  "/cost",
  "/resources",
  "/reliability",
  "/security",
  "/recommendations",
  "/network",
  "/ai-insights"
];

/**
 * A string no collector can emit, so finding it in the DOM can only mean the field under test
 * reached the page.
 */
const SENTINEL = "SENTINELDIAGNOSTICSTRING";

/**
 * Raw diagnostic messages are for operators reading JSON. Advisor details additionally carry a
 * schema-fixed catalog message: validate its literal first, then inject a sentinel at the fetch
 * boundary to prove that even stale or unexpected runtime messages never reach the rendered tree.
 * The dashboard describes availability itself rather than printing these message properties.
 * Asserting `src/App.tsx` does not contain the property
 * names is not enough: destructuring the object, renaming the value or handing the whole source
 * record to a child component all keep the text on screen while the string search passes.
 */
const DIAGNOSTIC_FIELDS = [
  "advisor.details.message",
  "advisor.message",
  "network.telemetry.message",
  "network.topology.message",
  "reliability.serviceHealth.message",
  "security.vulnerabilities.message",
  "sources[].message"
] as const;

/**
 * Every `message` the published contract carries, addressed the way `DIAGNOSTIC_FIELDS` writes it.
 * Array positions collapse to `[]` so a longer fixture cannot change the answer.
 */
function messagePaths(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => messagePaths(entry, `${path}[]`));
  }
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const childPath = path ? `${path}.${key}` : key;
    return key === "message" && typeof child === "string"
      ? [childPath]
      : messagePaths(child, childPath);
  });
}

function withDiagnosticSentinels(snapshot: PublicSnapshotV1): PublicSnapshotV1 {
  return {
    ...snapshot,
    cost: { ...snapshot.cost },
    advisor: {
      availability: "unavailable", recommendations: [], message: SENTINEL,
      details: {
        availability: "unavailable", message: ADVISOR_DETAILS_MESSAGE, groups: [],
        mappedRecommendationCount: 0, withheldRecommendationCount: 0,
        excludedRecommendationCount: 0, lifecycleUnknownCount: 0, affectedResourceCount: null
      }
    },
    reliability: {
      ...snapshot.reliability,
      serviceHealth: { ...snapshot.reliability.serviceHealth, message: SENTINEL }
    },
    network: {
      ...snapshot.network,
      topology: { availability: "unavailable", message: SENTINEL, nodes: [], edges: [], truncated: false },
      telemetry: { ...snapshot.network.telemetry, message: SENTINEL }
    },
    security: {
      ...snapshot.security,
      vulnerabilities: {
        availability: "unavailable", message: SENTINEL, totalSubAssessments: null, unhealthySubAssessments: null,
        unmappedSubAssessments: null, unknownStatusSubAssessments: null, totalFindings: null, truncated: false, findings: []
      }
    },
    sources: [
      ...snapshot.sources.filter((source) => !["Azure Advisor", "Network topology"].includes(source.source)).map((source) => ({ ...source, message: SENTINEL })),
      { source: "Azure Advisor", availability: "unavailable", message: SENTINEL },
      { source: "Network topology", availability: "unavailable", message: SENTINEL }
    ]
  };
}

async function renderAt(route: string, snapshot: PublicSnapshotV1) {
  publicSnapshotSchema.parse(snapshot);
  const fetchedSnapshot = structuredClone(snapshot);
  if (fetchedSnapshot.advisor?.details) fetchedSnapshot.advisor.details.message = SENTINEL;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => fetchedSnapshot
    })
  );
  window.history.replaceState(null, "", `#${route}`);
  render(
    <HashRouter>
      <App />
    </HashRouter>
  );
  await waitFor(() => {
    expect(screen.queryByText("公開スナップショットを読み込んでいます")).toBeNull();
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", window.location.pathname);
});

describe("Operator diagnostics stay out of the rendered page", () => {
  it("shows separate cost-period reasons without exposing raw diagnostic text", async () => {
    const snapshot = withDiagnosticSentinels(costFixture([]));
    snapshot.cost.periodDiagnostics = {
      current: { availability: "unavailable", reason: "currency-mismatch" },
      previous: { availability: "unavailable", reason: "forbidden" }
    };
    await renderAt("/cost", snapshot);
    const panel = screen.getByText("コストが表示されない理由").closest("section")!;
    expect(within(panel).getByText(/通貨が公開対象の JPY と一致しません/)).toBeInTheDocument();
    expect(within(panel).getByText(/アクセスが拒否されました/)).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(SENTINEL);
    expect(document.body.innerHTML).not.toContain(ADVISOR_DETAILS_MESSAGE);
  });

  it("does not blame the current period for a previous-period failure", async () => {
    const snapshot = costFixture([{ name: "Compute", amountJpy: 140_000 }]);
    snapshot.cost.periodDiagnostics = {
      current: { availability: "available" },
      previous: { availability: "unavailable", reason: "forbidden" }
    };
    await renderAt("/cost", snapshot);
    const rows = screen.getByText("コストが表示されない理由").closest("section")!.querySelectorAll(".source-row");
    expect(rows[0]).toHaveTextContent("現在期間この期間の概算 JPY データを収集しました。");
    expect(rows[0]).not.toHaveTextContent("アクセスが拒否");
    expect(rows[1]).toHaveTextContent("アクセスが拒否");
  });

  it("does not infer a reason from an old snapshot without reason codes", async () => {
    const snapshot = costFixture([]);
    delete snapshot.cost.periodDiagnostics;
    await renderAt("/cost", snapshot);
    expect(screen.getAllByText(/具体的な理由は記録されていません/)).toHaveLength(2);
  });

  it.each(ROUTES)("does not print collector diagnostics on %s", async (route) => {
    await renderAt(route, withDiagnosticSentinels(publishedSnapshot));

    // The serialized tree rather than its text, so a diagnostic parked in `title`, `aria-label` or
    // any other attribute — read out by a screen reader, shown as a tooltip — counts as rendered.
    expect(document.body.innerHTML).not.toContain(SENTINEL);
    expect(document.body.innerHTML).not.toContain(ADVISOR_DETAILS_MESSAGE);
  });

  it.each(["available", "partial", "unavailable"] as const)(
    "hides details.message in the %s detail branch without hiding collected guide fields",
    async (availability) => {
      const snapshot = buildDemoSnapshot("2026-09-09T00:00:00.000Z");
      const content = advisorContent("storage-zone-redundancy", "HighAvailability");
      snapshot.sources = [
        ...snapshot.sources.filter((source) => source.source !== "Azure Advisor"),
        { source: "Azure Advisor", availability: "available", message: SENTINEL }
      ];
      snapshot.advisor = {
        availability: "available", message: SENTINEL,
        recommendations: [{ category: "HighAvailability", impact: "High", count: 1 }],
        details: {
          availability, message: ADVISOR_DETAILS_MESSAGE,
          mappedRecommendationCount: availability === "unavailable" ? 0 : 1,
          withheldRecommendationCount: 0, excludedRecommendationCount: 0,
          lifecycleUnknownCount: 0, affectedResourceCount: availability === "unavailable" ? null : 1,
          groups: availability === "unavailable" ? [] : [{
            ...content, count: 1, impacts: { High: 1, Medium: 0, Low: 0, Unknown: 0 },
            affectedResourceCount: 1, resourceTypes: [{ type: "microsoft.storage/storageaccounts", count: 1 }]
          }]
        }
      };
      await renderAt("/recommendations", snapshot);
      expect(document.body.innerHTML).not.toContain(SENTINEL);
      expect(document.body.innerHTML).not.toContain(ADVISOR_DETAILS_MESSAGE);
      if (availability === "unavailable") {
        expect(screen.getByText("内容詳細は未収集です")).toBeInTheDocument();
        expect(screen.queryByText(content.title)).not.toBeInTheDocument();
      } else {
        const card = screen.getByRole("heading", { name: content.title }).closest("article")!;
        for (const value of [content.description, content.recommendedAction, content.deferWhen, content.caveat]) {
          expect(card).toHaveTextContent(value);
        }
      }
    }
  );

  it("names every message the contract carries", () => {
    // `toHaveLength(3)` would restate the literal above and could never fail. Deriving the set means
    // a new diagnostic field is a red test until someone adds it here, and the sentinel sweep above
    // then has to prove that field stays off the page too. The demo snapshot is unioned in because
    // the published one only shows fields its last collection happened to populate: a `message` added
    // inside a collection that is empty in production would otherwise stay invisible here.
    const paths = [
      ...new Set([
        ...messagePaths(publishedSnapshot),
        ...messagePaths(withDiagnosticSentinels(publishedSnapshot)),
        ...messagePaths(buildDemoSnapshot("2026-08-05T13:00:00.000Z"))
      ])
    ].sort();

    expect(paths).toEqual([...DIAGNOSTIC_FIELDS]);
  });

  /**
   * A sentinel that never renders would also pass if the fixture stopped reaching the page at all,
   * so this proves the same routes do render snapshot-derived text. Asserting a length would pass on
   * static chrome alone, and asserting a specific published value would break whenever a source is
   * unavailable — cost and security publish nothing today. Two snapshots that differ only in
   * `generatedAt` must therefore render differently on every route, which no static markup can fake.
   */
  it("renders snapshot-derived text on every audited route", async () => {
    for (const route of ROUTES) {
      await renderAt(route, { ...publishedSnapshot, generatedAt: "2024-03-04T05:06:07.000Z" });
      const earlier = document.body.textContent ?? "";
      cleanup();

      await renderAt(route, { ...publishedSnapshot, generatedAt: "2025-11-12T13:14:15.000Z" });
      const later = document.body.textContent ?? "";
      cleanup();

      expect(earlier).not.toBe("");
      expect(later).not.toBe(earlier);
    }
  });
});
