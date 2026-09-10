import { Link } from "react-router-dom";
import type { PublicSnapshotV1 } from "../data/contracts";
import type { PreviousAnalysisState } from "../hooks/usePreviousAnalysis";
import { formatDateTimeJa } from "../lib/display-formatters";

export function PreviousAnalysisNotice({ current, archive }: {
  current: PublicSnapshotV1; archive: PublicSnapshotV1;
}) {
  return (
    <aside className="previous-analysis-notice" aria-label="前回の公開分析の時点">
      <strong>前回の公開分析 · 根拠時点 {formatDateTimeJa(archive.generatedAt)} JST</strong>
      <p>最新の収集: {formatDateTimeJa(current.freshness.lastSuccessfulCollection)} JST。その収集に対応する公開分析は 0 件です。</p>
      <p>以下の分析と詳細は当時のデータです。現在の状態と混ぜずに表示しています。生成・審査の実行状態は未確認です。</p>
      {(archive.scope.subscriptionId !== current.scope.subscriptionId || archive.scope.tenantId !== current.scope.tenantId) && (
        <details>
          <summary>公開スコープの匿名化方式について</summary>
          <p>公開 ID の匿名化方式が異なるため、この画面の ID から同一スコープを再照合することはできません。保持された前回の公開分析として表示しています。</p>
        </details>
      )}
      <Link to="/overview">現在の収集結果へ</Link>
    </aside>
  );
}

export function PreviousAnalysisAvailability({ state }: { state: PreviousAnalysisState }) {
  if (state.status === "idle" || state.status === "ready") return null;
  return (
    <p className="previous-analysis-availability" role="status">
      {state.status === "loading" ? "前回の公開分析ファイルを読み込んでいます。AI の生成中を示す表示ではありません。"
        : state.status === "missing" ? "前回の公開分析ファイルはありません。"
          : "前回の公開分析は取得または検証ができないため表示していません。現在の収集結果はそのまま確認できます。"}
    </p>
  );
}
