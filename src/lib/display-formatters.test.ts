import { describe, expect, it } from "vitest";
import {
  formatDateTimeJa,
  formatEventTimestamp,
  resourceStatusLabel,
  resourceStatusSeverity,
  summarizeResourceHealth
} from "./display-formatters";

describe("Japanese display formatters", () => {
  it("keeps Unknown informational instead of treating it as unhealthy", () => {
    expect(resourceStatusLabel("Unknown")).toBe("未評価");
    expect(resourceStatusSeverity("Unknown")).toBe("info");
  });

  it("computes evaluation coverage without counting Unknown as unhealthy", () => {
    const resources = [
      { status: "Healthy" },
      { status: "Unknown" },
      { status: "Degraded" },
      { status: "Unknown" }
    ] as Parameters<typeof summarizeResourceHealth>[0];

    expect(summarizeResourceHealth(resources)).toMatchObject({
      total: 4,
      evaluated: 2,
      healthy: 1,
      degraded: 1,
      unknown: 2,
      coveragePercent: 50
    });
  });

  it("formats snapshot timestamps in ja-JP and handles collection labels", () => {
    expect(formatDateTimeJa("2026-07-23T05:27:06.878Z")).toContain("2026");
    expect(formatEventTimestamp("Current snapshot")).toBe("現在のスナップショット");
  });
});
