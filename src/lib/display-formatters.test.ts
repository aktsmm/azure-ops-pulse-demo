import { describe, expect, it } from "vitest";
import {
  defenderDisplayStatus,
  formatDateTimeJa,
  formatEventTimestamp,
  metricWhenSourceAvailable,
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

  it("shows source metrics only when available while preserving a real zero", () => {
    expect(
      metricWhenSourceAvailable(
        { source: "Defender for Cloud", availability: "available", message: "Collected." },
        0
      )
    ).toBe(0);
    expect(
      metricWhenSourceAvailable(
        { source: "Defender for Cloud", availability: "partial", message: "Partial." },
        0
      )
    ).toBeNull();
    expect(
      metricWhenSourceAvailable(
        { source: "Defender for Cloud", availability: "unavailable", message: "Unavailable." },
        0
      )
    ).toBeNull();
  });

  it("treats a completed Defender query with a missing Secure Score as partial data", () => {
    expect(
      defenderDisplayStatus(
        { source: "Defender for Cloud", availability: "available", message: "Completed." },
        { secureScore: null, activeAlerts: 0 }
      )
    ).toEqual({
      label: "一部未取得",
      message:
        "Defender for Cloud のAPI照会は完了しました。Secure Scoreは今回のスナップショットでは未取得です。",
      severity: "warning"
    });
  });

  it("treats real Defender zeros as completed query results", () => {
    expect(
      defenderDisplayStatus(
        { source: "Defender for Cloud", availability: "available", message: "Completed." },
        { secureScore: 0, activeAlerts: 0 }
      )
    ).toEqual({
      label: "照会完了",
      message: "Defender for Cloud のAPI照会は完了しました。",
      severity: "healthy"
    });
  });

  it("preserves partial and unavailable Defender source semantics", () => {
    expect(
      defenderDisplayStatus(
        { source: "Defender for Cloud", availability: "partial", message: "Partial." },
        { secureScore: 50, activeAlerts: 0 }
      )
    ).toMatchObject({
      label: "一部未取得",
      message: "Defender for Cloud のAPI照会は一部のみ完了しました。",
      severity: "warning"
    });
    expect(
      defenderDisplayStatus(
        { source: "Defender for Cloud", availability: "unavailable", message: "Unavailable." },
        { secureScore: 50, activeAlerts: 0 }
      )
    ).toMatchObject({
      label: "取得不可",
      message: "Defender for Cloud のAPI照会を完了できませんでした。",
      severity: "info"
    });
  });
});
