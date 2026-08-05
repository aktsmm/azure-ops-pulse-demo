import { describe, expect, it } from "vitest";
import { collectSource, countReport, isPublishable } from "./source-status";

describe("collectSource", () => {
  it("never reports available when a successful call returned nothing", () => {
    const result = collectSource(
      "Resource Health",
      () => [] as string[],
      (records) =>
        countReport(records.length, {
          collected: (count) => `Collected ${count} records.`,
          empty: "Returned 0 records."
        }),
      "Unavailable."
    );

    expect(result.status.availability).toBe("unavailable");
    expect(result.status.message).toBe("Returned 0 records.");
    expect(result.value).toBeNull();
  });

  it("reports available with the record count when data was returned", () => {
    const result = collectSource(
      "Activity Log",
      () => ["a", "b"],
      (records) =>
        countReport(records.length, {
          collected: (count) => `Collected ${count} records.`,
          empty: "Returned 0 records."
        }),
      "Unavailable."
    );

    expect(result.status).toEqual({
      source: "Activity Log",
      availability: "available",
      message: "Collected 2 records."
    });
    expect(result.value).toEqual(["a", "b"]);
  });

  it("lets a caller mark an honest empty answer as partial and keeps the value", () => {
    const result = collectSource(
      "Service Health",
      () => [] as string[],
      (records) =>
        countReport(records.length, {
          collected: (count) => `Collected ${count} records.`,
          empty: "Returned 0 events.",
          emptyAvailability: "partial"
        }),
      "Unavailable."
    );

    expect(result.status.availability).toBe("partial");
    expect(result.value).toEqual([]);
  });

  it("reports unavailable and suppresses the value when the operation throws", () => {
    const result = collectSource(
      "Cost Management",
      (): string[] => {
        throw new Error("boom");
      },
      () => ({ availability: "available" as const, message: "unreachable" }),
      "Cost Management is unavailable."
    );

    expect(result.status.availability).toBe("unavailable");
    expect(result.status.message).toBe("Cost Management is unavailable.");
    expect(result.value).toBeNull();
  });

  it("drops the value whenever the report decides the source is unavailable", () => {
    const result = collectSource(
      "Defender for Cloud",
      () => ({ assessments: [] }),
      () => ({ availability: "unavailable" as const, message: "Defender plans are disabled." }),
      "Unavailable."
    );

    expect(result.value).toBeNull();
  });
});

describe("isPublishable", () => {
  it("treats partial as publishable and unavailable or missing as not", () => {
    expect(isPublishable({ source: "x", availability: "available", message: "" })).toBe(true);
    expect(isPublishable({ source: "x", availability: "partial", message: "" })).toBe(true);
    expect(isPublishable({ source: "x", availability: "unavailable", message: "" })).toBe(false);
    expect(isPublishable(undefined)).toBe(false);
  });
});
