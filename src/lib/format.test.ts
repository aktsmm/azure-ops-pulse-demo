import { describe, expect, it } from "vitest";
import {
  availabilityLabelJa,
  formatAgeJa,
  formatDateTimeJa,
  modeLabelJa,
  networkFlowStatusSeverity,
  recommendationStatusLabelJa,
  resourceStatusLabelJa,
  resourceStatusSeverity,
  severityLabelJa
} from "./format";

describe("Japanese display formatter", () => {
  it("labels every severity in Japanese", () => {
    expect(severityLabelJa("critical")).toBe("重大");
    expect(severityLabelJa("warning")).toBe("警告");
    expect(severityLabelJa("healthy")).toBe("正常");
    expect(severityLabelJa("info")).toBe("情報");
  });

  it("labels every resource status in Japanese", () => {
    expect(resourceStatusLabelJa("Healthy")).toBe("正常");
    expect(resourceStatusLabelJa("Degraded")).toBe("低下");
    expect(resourceStatusLabelJa("Unavailable")).toBe("取得不可");
    expect(resourceStatusLabelJa("Unknown")).toBe("不明");
  });

  it("never treats Unknown resource status as unhealthy", () => {
    expect(resourceStatusSeverity("Unknown")).toBe("info");
    expect(resourceStatusSeverity("Healthy")).toBe("healthy");
    expect(resourceStatusSeverity("Degraded")).toBe("warning");
    expect(resourceStatusSeverity("Unavailable")).toBe("critical");
  });

  it("labels source availability in Japanese", () => {
    expect(availabilityLabelJa("available")).toBe("利用可能");
    expect(availabilityLabelJa("partial")).toBe("部分的に利用可能");
    expect(availabilityLabelJa("unavailable")).toBe("利用不可");
  });

  it("labels network flow severity without escalating degraded flows to critical", () => {
    expect(networkFlowStatusSeverity("Allowed")).toBe("healthy");
    expect(networkFlowStatusSeverity("Degraded")).toBe("warning");
    expect(networkFlowStatusSeverity("Blocked")).toBe("critical");
  });

  it("labels recommendation status in Japanese", () => {
    expect(recommendationStatusLabelJa("Open")).toBe("未対応");
    expect(recommendationStatusLabelJa("In progress")).toBe("対応中");
    expect(recommendationStatusLabelJa("Resolved")).toBe("解決済み");
  });

  it("labels dashboard mode while preserving the Azure product name", () => {
    expect(modeLabelJa("DEMO")).toBe("デモ");
    expect(modeLabelJa("AZURE")).toBe("Azure");
  });

  it("formats an ISO timestamp using the ja-JP locale", () => {
    const formatted = formatDateTimeJa("2026-07-23T05:27:06.878Z");
    expect(formatted).not.toContain("Invalid");
    expect(formatted).toMatch(/2026/);
  });

  it("returns an explicit fallback for an invalid timestamp instead of throwing", () => {
    expect(formatDateTimeJa("not-a-date")).toBe("不明");
  });

  it("formats freshness age in Japanese without fabricating a unit", () => {
    expect(formatAgeJa(0.4)).toBe("1分未満前");
    expect(formatAgeJa(30)).toBe("30分前");
    expect(formatAgeJa(180)).toBe("3時間前");
    expect(formatAgeJa(60 * 24 * 2)).toBe("2日前");
    expect(formatAgeJa(Number.NaN)).toBe("不明");
  });
});
