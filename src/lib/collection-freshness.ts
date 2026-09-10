import type { PublicSnapshotV1, Severity } from "../data/contracts";

/** The legacy snapshot stores a schedule description rather than the next run's timestamp. */
export function collectionFreshness(freshness: PublicSnapshotV1["freshness"], now = Date.now()): {
  label: string; severity: Severity; nextScheduledAt: string | null;
} {
  const collected = Date.parse(freshness.lastSuccessfulCollection);
  let scheduled = Date.parse(freshness.nextScheduledCollection);
  if (freshness.nextScheduledCollection === "Tuesday / Friday 06:00 JST" && Number.isFinite(collected)) {
    const date = new Date(collected);
    date.setUTCHours(21, 0, 0, 0);
    // Tuesday/Friday 06:00 JST are Monday/Thursday 21:00 UTC.
    while (date.getTime() <= collected || ![1, 4].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() + 1);
    scheduled = date.getTime();
  }
  const valid = Number.isFinite(collected) && Number.isFinite(scheduled) && scheduled > collected;
  const nextScheduledAt = valid ? new Date(scheduled).toISOString() : null;
  if (!valid) return { label: "更新予定未確認", severity: "info", nextScheduledAt };
  if (now >= scheduled) return { label: "更新予定を経過", severity: "warning", nextScheduledAt };
  if (freshness.state === "stale") return { label: "更新確認が必要", severity: "warning", nextScheduledAt };
  return { label: "次回更新前", severity: "info", nextScheduledAt };
}
