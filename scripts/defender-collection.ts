import type { PublicSnapshotV1, SourceStatus } from "../src/data/contracts";
import { assessmentCoverage, summarizeAssessments, type DefenderAssessmentRow } from "../src/lib/defender-recommendations";
import { CollectionError, collectionFailureReason, safeCollectionFailure, type CollectionFailure } from "./collection-diagnostics";

export function collectDefender(query: <T>(query: string) => T[]): {
  status: SourceStatus;
  security: PublicSnapshotV1["security"];
} {
  const failures: string[] = [];
  const failureReasons: CollectionFailure[] = [];
  const attempt = <T>(label: string, operation: () => T): T | null => {
    try { return operation(); }
    catch (error) {
      failures.push(`${label}: ${safeCollectionFailure(error)}`);
      failureReasons.push(collectionFailureReason(error));
      return null;
    }
  };
  const assessments = attempt("評価", () => {
    const rows = query<DefenderAssessmentRow>(
      "SecurityResources | where type =~ 'microsoft.security/assessments' | project properties"
    );
    if (rows.some((row) => !row || typeof row !== "object")) throw new CollectionError("invalid-response");
    return rows;
  });
  const secureScore = attempt("スコア", () => {
    const rows = query<{ percentageRatio?: unknown }>(
      "SecurityResources | where type =~ 'microsoft.security/securescores' | project percentageRatio=todouble(properties.score.percentage)"
    );
    if (rows.length === 0) return null;
    if (rows.length !== 1 || typeof rows[0]?.percentageRatio !== "number" ||
        !Number.isFinite(rows[0].percentageRatio) ||
        rows[0].percentageRatio < 0 || rows[0].percentageRatio > 1) {
      throw new CollectionError("invalid-response");
    }
    return Math.round(rows[0].percentageRatio * 100);
  });
  const activeAlerts = attempt("アラート", () => {
    const rows = query<{ count_?: unknown }>(
      "SecurityResources | where type =~ 'microsoft.security/locations/alerts' | where properties.Status =~ 'Active' | summarize count_ = count()"
    );
    if (rows.length !== 1 || !Number.isSafeInteger(rows[0]?.count_) || Number(rows[0]?.count_) < 0) {
      throw new CollectionError("invalid-response");
    }
    return Number(rows[0]!.count_);
  });
  const recommendations = summarizeAssessments(assessments ?? []);
  const coverage = assessments === null ? undefined : assessmentCoverage(assessments, recommendations.length);
  const fieldAvailability = {
    secureScore: secureScore === null ? "unavailable" as const : "available" as const,
    assessments: assessments === null ? "unavailable" as const : coverage?.unknownAssessments ? "partial" as const : "available" as const,
    activeAlerts: activeAlerts === null ? "unavailable" as const : "available" as const
  };
  const successes = Object.values(fieldAvailability).filter((value) => value !== "unavailable").length;
  return {
    status: {
      source: "Defender for Cloud",
      availability: successes === 3 && !coverage?.unknownAssessments ? "available" : successes ? "partial" : "unavailable",
      ...(failureReasons.length ? { reason: failureReasons[0] } : secureScore === null ? { reason: "empty" as const } : {}),
      message: [
        assessments === null ? "" : `評価の読み取り成功: ${assessments.length} 件。`,
        secureScore === null && !failures.some((value) => value.startsWith("スコア:"))
          ? "セキュア スコアは返されませんでした。" : "",
        activeAlerts === null ? "" : `アクティブなアラートの読み取り成功: ${activeAlerts} 件。`,
        ...failures,
        "空の結果から Defender プランの有効・無効は判定していません。"
      ].filter(Boolean).join(" ")
    },
    security: {
      fieldAvailability,
      secureScore,
      activeAlerts,
      recommendations,
      ...(coverage ? { assessmentCoverage: coverage } : {}),
      // Secure score is not a regulatory-compliance score; no proxy percentage is published.
      compliance: []
    }
  };
}
