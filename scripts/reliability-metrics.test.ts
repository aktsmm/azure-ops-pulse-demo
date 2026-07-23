import { describe, expect, it } from "vitest";
import { uncollectedIncidentMetric } from "./reliability-metrics";

describe("reliability incident collection", () => {
  it("publishes no count until an incident-count source is implemented", () => {
    expect(uncollectedIncidentMetric()).toEqual({
      incidentAvailability: "unavailable",
      incidents: null
    });
  });
});
