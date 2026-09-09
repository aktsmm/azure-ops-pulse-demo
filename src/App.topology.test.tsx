import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HashRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicSnapshotV1 } from "./data/contracts";
import { publishedSnapshot } from "./test/reliability-fixtures";
import { publicSnapshotSchema } from "../scripts/public-schema";
import App from "./App";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", window.location.pathname);
});

function mount(route: string, snapshot: PublicSnapshotV1) {
  publicSnapshotSchema.parse(snapshot);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot }));
  window.history.replaceState(null, "", `#${route}`);
  render(<HashRouter><App /></HashRouter>);
}

describe("Optional collection data reaches the dashboard", () => {
  it("shows a collected VNet relationship and opens the matching inventory resource", async () => {
    const vnet = publishedSnapshot.inventory.resources.find((resource) => resource.type === "microsoft.network/virtualnetworks")!;
    const snapshot: PublicSnapshotV1 = {
      ...publishedSnapshot,
      sources: [...publishedSnapshot.sources, { source: "Network topology", availability: "partial", message: "Collected topology." }],
      network: {
        ...publishedSnapshot.network,
        topology: {
          availability: "partial", message: "Collected topology.", truncated: false,
          nodes: [
            { id: vnet.id, type: vnet.type, region: vnet.region, referenceOnly: false, scope: "inventory" },
            { id: "res-00000001", type: "microsoft.network/virtualnetworks/subnets", referenceOnly: true, scope: "uncollected" }
          ],
          edges: [{ source: vnet.id, target: "res-00000001", kind: "contains" }]
        }
      }
    };
    mount("/network", snapshot);
    const node = await screen.findByRole("button", { name: `仮想ネットワーク (VNet) ${vnet.name}の関連を表示` });
    expect(document.querySelectorAll(".topology-lines path")).toHaveLength(1);
    fireEvent.click(node);
    fireEvent.click(screen.getByRole("button", { name: "リソース詳細" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(vnet.name);
  });
  it("displays Advisor even when Defender is unavailable", async () => {
    mount("/security", {
      ...publishedSnapshot,
      sources: [...publishedSnapshot.sources, { source: "Azure Advisor", availability: "available", message: "Collected Advisor." }],
      advisor: {
        availability: "available", message: "Collected Advisor.",
        recommendations: [{ category: "Security", impact: "High", count: 3 }]
      }
    });
    expect(await screen.findByText("該当する推奨事項 3 件")).toBeInTheDocument();
    expect(screen.getByText("Defender for Cloud は未収集です")).toBeInTheDocument();
  });
  it("does not turn a failed assessments subquery into zero recommendations", async () => {
    mount("/security", {
      ...publishedSnapshot,
      sources: publishedSnapshot.sources.map((source) => source.source === "Defender for Cloud" ? { ...source, availability: "partial" } : source),
      security: {
        ...publishedSnapshot.security,
        secureScore: 55,
        activeAlerts: null,
        recommendations: [],
        fieldAvailability: { secureScore: "available", assessments: "unavailable", activeAlerts: "unavailable" }
      }
    });
    expect(await screen.findByText("55%")).toBeInTheDocument();
    expect(screen.getByText("未解決の推奨事項").closest("article")).toHaveTextContent("未収集");
    expect(screen.getByText("Defender 推奨事項は未収集です")).toBeInTheDocument();
  });
});
