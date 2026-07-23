import { useEffect, useState } from "react";
import type { PublicSnapshotV1 } from "../data/contracts";

type SnapshotState =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: PublicSnapshotV1; error: null }
  | { status: "error"; data: null; error: string };

export function useSnapshot(): SnapshotState {
  const [state, setState] = useState<SnapshotState>({
    status: "loading",
    data: null,
    error: null
  });

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}data/snapshot.json`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`スナップショットの取得に失敗しました (${response.status})`);
        return response.json() as Promise<PublicSnapshotV1>;
      })
      .then((data) => setState({ status: "ready", data, error: null }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({
          status: "error",
          data: null,
          error: error instanceof Error ? error.message : "スナップショットを読み込めませんでした"
        });
      });
    return () => controller.abort();
  }, []);

  return state;
}
