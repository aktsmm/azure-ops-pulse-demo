import { describe, expect, it } from "vitest";
import {
  countMetricSeries,
  isUnsupportedMetricNamespaceError,
  metricNamesFromDefinitions,
  networkMetricMessage,
  summarizeMetricCoverage
} from "./azure-metrics";

describe("isUnsupportedMetricNamespaceError", () => {
  it("recognises the Azure Monitor answer for types without platform metrics", () => {
    // Observed for Microsoft.Network/networkWatchers, which has no platform metric namespace.
    expect(
      isUnsupportedMetricNamespaceError(
        "(BadRequest) Microsoft.Network/networkWatchers is not a supported platform metric namespace"
      )
    ).toBe(true);
  });

  it("does not classify unrelated failures as not applicable", () => {
    expect(isUnsupportedMetricNamespaceError("(AuthorizationFailed) permission denied")).toBe(false);
    expect(isUnsupportedMetricNamespaceError("")).toBe(false);
  });
});

describe("metric definition handling", () => {
  it("keeps only named definitions and caps the request size", () => {
    expect(
      metricNamesFromDefinitions(
        [
          { name: { value: "BytesReceived" } },
          { name: { value: "" } },
          { name: null },
          { name: { value: "BytesSent" } },
          { name: { value: "Throughput" } },
          { name: { value: "Extra" } }
        ],
        3
      )
    ).toEqual(["BytesReceived", "BytesSent", "Throughput"]);
  });

  it("counts time series across metrics without assuming they exist", () => {
    expect(countMetricSeries([{ timeseries: [1, 2] }, { timeseries: null }, {}])).toBe(2);
  });
});

describe("summarizeMetricCoverage", () => {
  it("separates resources without platform metrics from real read failures", () => {
    const coverage = summarizeMetricCoverage(
      [
        { kind: "collected", series: 4 },
        { kind: "collected", series: 2 },
        { kind: "notApplicable" },
        { kind: "notApplicable" },
        { kind: "failed" }
      ],
      12
    );

    expect(coverage).toEqual({
      inventoryTotal: 12,
      sampledResources: 5,
      metricCapableResources: 2,
      metricSeries: 6,
      notApplicableResources: 2,
      failedResources: 1
    });
  });

  it("describes the outcome without calling not-applicable resources failures", () => {
    const message = networkMetricMessage(
      summarizeMetricCoverage([{ kind: "notApplicable" }, { kind: "collected", series: 3 }], 2)
    );

    expect(message).toContain("1 have no platform metrics");
    expect(message).toContain("0 could not be read");
  });
});
