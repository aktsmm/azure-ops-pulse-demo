import { describe, expect, it } from "vitest";
import {
  formatDateTimeJa,
  formatEventTimestamp,
  formatSourceMessage,
  formatSourceName,
  formatTrendMetricChange,
  formatTrendMetricLabel,
  formatTrendMetricValue,
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

describe("source presentation", () => {
  it("translates descriptive source identifiers but keeps Azure product names", () => {
    expect(formatSourceName("Network inventory and metrics")).toBe(
      "ネットワーク インベントリとメトリック"
    );
    expect(formatSourceName("Defender for Cloud")).toBe("Defender for Cloud");
    expect(formatSourceName("Resource Health")).toBe("Resource Health");
  });

  it("never claims flow telemetry is missing from a partial network collection", () => {
    const message = formatSourceMessage({
      source: "Network inventory and metrics",
      availability: "partial",
      message: "Endpoints are masked or reduced to service classification."
    });

    expect(message).not.toContain("フロー テレメトリは未収集");
    expect(message).toContain("インベントリは収集済み");
  });
});

describe("trend metric translation", () => {  it("translates the published metric labels used by overview.metrics", () => {
    expect(formatTrendMetricLabel("Resource Health coverage")).toBe("Resource Health の評価範囲");
    expect(formatTrendMetricLabel("Unavailable sources")).toBe("利用不可のソース");
  });

  it("passes unknown labels and values through instead of hiding them", () => {
    expect(formatTrendMetricLabel("Brand new metric")).toBe("Brand new metric");
    expect(formatTrendMetricValue("42%")).toBe("42%");
    expect(formatTrendMetricChange("Something new")).toBe("Something new");
  });

  it("translates the coverage change sentence without changing the numbers", () => {
    expect(
      formatTrendMetricChange("0 of 14 supported resources evaluated (48 out of scope)")
    ).toBe("対応 14 件中 0 件を評価済み（対象外 48 件）");
    expect(
      formatTrendMetricChange("9 of 14 supported resources evaluated (48 out of scope)")
    ).toBe("対応 14 件中 9 件を評価済み（対象外 48 件）");
  });

  it("translates availability words used as metric values", () => {
    expect(formatTrendMetricValue("Available")).toBe("収集済み");
    expect(formatTrendMetricValue("Partial")).toBe("一部収集");
    expect(formatTrendMetricValue("Unavailable")).toBe("利用不可");
  });

  it("translates the DEMO fixture labels and change sentences", () => {
    expect(formatTrendMetricLabel("Resources healthy")).toBe("正常なリソース");
    expect(formatTrendMetricChange("vs prior period")).toBe("前期間との比較");
    expect(formatTrendMetricChange("3 resolved")).toBe("解決済み 3 件");
    expect(formatTrendMetricChange("+1.8 pts")).toBe("+1.8 pt");
    expect(formatTrendMetricChange("-0.03 pts")).toBe("-0.03 pt");
  });
});
