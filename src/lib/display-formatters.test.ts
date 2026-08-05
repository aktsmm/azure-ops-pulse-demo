import { describe, expect, it } from "vitest";
import {
  formatDateTimeJa,
  formatEventTimestamp,
  metricWhenSourcePublished,
  resourceStatusLabel,
  resourceStatusSeverity,
  summarizeResourceHealth
} from "./display-formatters";

describe("Japanese display formatters", () => {
  it("keeps Unknown informational instead of treating it as unhealthy", () => {
    expect(resourceStatusLabel("Unknown")).toBe("未評価");
    expect(resourceStatusSeverity("Unknown")).toBe("info");
  });

  it("computes evaluation coverage while separating NotApplicable from Unknown", () => {
    const resources = [
      { status: "Healthy" },
      { status: "Unknown" },
      { status: "Degraded" },
      { status: "Unknown" },
      { status: "NotApplicable" },
      { status: "NotApplicable" }
    ] as Parameters<typeof summarizeResourceHealth>[0];

    expect(summarizeResourceHealth(resources)).toMatchObject({
      total: 6,
      supported: 4,
      evaluated: 2,
      healthy: 1,
      degraded: 1,
      unknown: 2,
      notApplicable: 2,
      coveragePercent: 50
    });
  });

  it("labels NotApplicable as 対象外 so it is not confused with 未評価", () => {
    expect(resourceStatusLabel("NotApplicable")).toBe("対象外");
    expect(resourceStatusSeverity("NotApplicable")).toBe("info");
  });

  it("formats snapshot timestamps in ja-JP and handles collection labels", () => {
    expect(formatDateTimeJa("2026-07-23T05:27:06.878Z")).toContain("2026");
    expect(formatEventTimestamp("Current snapshot")).toBe("現在のスナップショット");
  });

  it("shows source metrics whenever the source published data, preserving a real zero", () => {
    expect(
      metricWhenSourcePublished(
        { source: "Defender for Cloud", availability: "available", message: "Collected." },
        0
      )
    ).toBe(0);
    expect(
      metricWhenSourcePublished(
        { source: "Defender for Cloud", availability: "partial", message: "Partial." },
        0
      )
    ).toBe(0);
    expect(
      metricWhenSourcePublished(
        { source: "Defender for Cloud", availability: "unavailable", message: "Unavailable." },
        0
      )
    ).toBeNull();
    expect(metricWhenSourcePublished(undefined, 0)).toBeNull();
  });
});
