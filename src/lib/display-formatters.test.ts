import { describe, expect, it } from "vitest";
import {
  formatActivityTitle,
  formatDateTimeJa,
  formatEndpointLabel,
  formatEventTimestamp,
  formatSourceMessage,
  formatSourceName,
  metricWhenSourcePublished,
  resourceStatusLabel,
  resourceStatusSeverity,
  summarizeResourceHealth
} from "./display-formatters";
import { classifyEndpoint } from "./sanitize";

describe("activity title rendering", () => {
  it("passes the collected Japanese title through untouched", () => {
    expect(formatActivityTitle("管理操作を検出")).toBe("管理操作を検出");
  });

  /**
   * The formatter must not translate: a lookup table that turned English titles into Japanese is
   * what let the DEMO fixture publish English event copy while the page looked correct.
   */
  it("does not translate an English title into Japanese", () => {
    expect(formatActivityTitle("Inventory change observed")).toBe("Inventory change observed");
  });

  it("replaces a serialized object with a readable label", () => {
    expect(formatActivityTitle("[object Object]を検出")).toBe("Azure 操作を検出");
  });
});

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

  it("formats snapshot timestamps in ja-JP and shows an unparseable label verbatim", () => {
    expect(formatDateTimeJa("2026-07-23T05:27:06.878Z")).toContain("2026");
    expect(formatEventTimestamp("2026-07-23T05:27:06.878Z")).toContain("2026");
    // No exact-match table: a collector label reaches the page as stored, so the language audit
    // judges the same text the reader sees instead of a translation layered over English data.
    expect(formatEventTimestamp("現在のスナップショット")).toBe("現在のスナップショット");
    expect(formatEventTimestamp("Current snapshot")).toBe("Current snapshot");
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

  it("translates every endpoint label the sanitizer is able to produce", () => {
    // Derive the closed set from `classifyEndpoint` itself rather than restating it here, so a new
    // branch in the sanitizer fails this test instead of quietly reaching the page in English.
    const literals = [...classifyEndpoint.toString().matchAll(/return\s+"([^"]+)"/g)].map(
      (match) => match[1] as string
    );
    expect(literals.length).toBeGreaterThanOrEqual(6);

    for (const label of literals) {
      const rendered = formatEndpointLabel(label);
      expect(rendered, `${label} is rendered unchanged`).not.toBe(label);
      expect(rendered, `${label} is rendered without Latin prose`).toMatch(/[ぁ-んァ-ヶ一-龯]/u);
    }
  });

  it("passes an unknown destination through so the audit can report it", () => {
    expect(formatEndpointLabel("Some future endpoint")).toBe("Some future endpoint");
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
