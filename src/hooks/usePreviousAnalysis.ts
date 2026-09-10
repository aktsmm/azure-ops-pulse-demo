import { useEffect, useState } from "react";
import type { PublicSnapshotV1 } from "../data/contracts";
import { readArchivedAnalysis } from "../lib/archived-analysis";
import { fetchAnalysisContinuity } from "../lib/analysis-continuity";

export type PreviousAnalysisState =
  | { status: "idle" | "loading" | "missing" | "unavailable"; data: null }
  | { status: "ready"; data: PublicSnapshotV1 };

export function usePreviousAnalysis(current: PublicSnapshotV1): PreviousAnalysisState {
  const [entry, setEntry] = useState<{ current: PublicSnapshotV1; state: PreviousAnalysisState } | null>(null);
  const eligible = current.mode === "AZURE" && current.aiInsights.length === 0;

  useEffect(() => {
    if (!eligible) return;
    const controller = new AbortController();
    let cancelled = false;
    const setState = (state: PreviousAnalysisState) => setEntry({ current, state });
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    setState({ status: "loading", data: null });
    fetch(`${import.meta.env.BASE_URL}data/last-analysis.json`, {
      signal: controller.signal, cache: "no-cache"
    }).then(async (response) => {
      if (response.status === 404) {
        if (!cancelled) setState({ status: "missing", data: null });
        return;
      }
      if (!response.ok) throw new Error("Previous analysis unavailable");
      const data = await readArchivedAnalysis(response, current,
        (archive, snapshot) => fetchAnalysisContinuity(archive, snapshot, controller.signal));
      if (!cancelled) setState({ status: "ready", data });
    }).catch(() => {
      if (!cancelled) setState({ status: "unavailable", data: null });
    }).finally(() => window.clearTimeout(timeout));
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [current, eligible]);

  return eligible
    ? entry?.current === current ? entry.state : { status: "loading", data: null }
    : { status: "idle", data: null };
}
