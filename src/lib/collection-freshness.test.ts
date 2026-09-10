import { describe, expect, it } from "vitest";
import { collectionFreshness } from "./collection-freshness";

const freshness = {
  state: "fresh" as const, ageMinutes: 0,
  lastSuccessfulCollection: "2026-09-10T21:05:00.000Z",
  nextScheduledCollection: "Tuesday / Friday 06:00 JST"
};

describe("Scheduled collection freshness", () => {
  it("does not expire the four-day Friday to Tuesday interval at 72 hours", () => {
    expect(collectionFreshness(freshness, Date.parse("2026-09-14T10:00:00Z"))).toEqual({
      label: "次回更新前", severity: "info", nextScheduledAt: "2026-09-14T21:00:00.000Z"
    });
  });
  it("flags a passed scheduled run without claiming that the pipeline failed", () => {
    expect(collectionFreshness(freshness, Date.parse("2026-09-14T21:00:00Z")).label).toBe("更新予定を経過");
  });
  it("finds Friday after Tuesday and crosses year boundaries", () => {
    expect(collectionFreshness({ ...freshness, lastSuccessfulCollection: "2026-09-07T21:00:00Z" }).nextScheduledAt)
      .toBe("2026-09-10T21:00:00.000Z");
    expect(collectionFreshness({ ...freshness, lastSuccessfulCollection: "2026-12-31T22:00:00Z" }).nextScheduledAt)
      .toBe("2027-01-04T21:00:00.000Z");
  });
  it("uses timestamp metadata and leaves unknown schedules unclassified", () => {
    expect(collectionFreshness({ ...freshness, nextScheduledCollection: "2026-09-15T01:00:00Z" }).nextScheduledAt)
      .toBe("2026-09-15T01:00:00.000Z");
    expect(collectionFreshness({ ...freshness, nextScheduledCollection: "unknown schedule" }).label).toBe("更新予定未確認");
    expect(collectionFreshness({ ...freshness, lastSuccessfulCollection: "invalid" }).label).toBe("更新予定未確認");
  });
  it("does not upgrade an explicitly stale snapshot", () => {
    expect(collectionFreshness({ ...freshness, state: "stale" }, Date.parse("2026-09-11T00:00:00Z")).label)
      .toBe("更新確認が必要");
  });
});
