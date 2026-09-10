import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { snapshotFixture } from "../test/snapshot-fixtures";
import type { PublicSnapshotV1 } from "../data/contracts";
import { usePreviousAnalysis } from "./usePreviousAnalysis";
import { analysisDigest } from "../lib/analysis-continuity";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("Previous analysis request ownership", () => {
  it("does not reuse a previous response against a newly loaded current snapshot", async () => {
    const archive = snapshotFixture();
    vi.stubGlobal("crypto", webcrypto);
    const current: PublicSnapshotV1 = { ...archive, generatedAt: "2026-09-11T00:00:00Z", aiInsights: [] };
    const sourceScopeSha256 = "a".repeat(64);
    const binding = {
      kind: "azure-ops-pulse-analysis-continuity", version: 1, sourceScopeSha256,
      archiveSha256: await analysisDigest(archive),
      currentEvidenceSha256: await analysisDigest({ sourceScopeSha256, evidence: { ...current, aiInsights: [] } })
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(archive)))
      .mockResolvedValueOnce(new Response(JSON.stringify(binding)))
      .mockResolvedValueOnce(new Response("", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(({ data }) => usePreviousAnalysis(data), { initialProps: { data: current } });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ data: { ...current, generatedAt: "2026-09-12T00:00:00Z" } });
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("missing"));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
