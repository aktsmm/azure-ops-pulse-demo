import { describe, expect, it } from "vitest";
import { validateEvidenceItem } from "./evidence-validator";

describe("AI numeric evidence validation", () => {
  it("accepts one normalized numeric value supported by the cited scalar", () => {
    expect(() =>
      validateEvidenceItem(
        { security: { secureScore: 87 } },
        "Supported evidence",
        { label: "Secure score", value: "87%", source: "security.secureScore" }
      )
    ).not.toThrow();
  });

  it("rejects an invented second value even when one value matches", () => {
    expect(() =>
      validateEvidenceItem(
        { security: { secureScore: 87 } },
        "Unsupported evidence",
        {
          label: "Invented assets",
          value: "87% and 42 exposed assets",
          source: "security.secureScore"
        }
      )
    ).toThrow(/87% and 42 exposed assets/);
  });

  it.each([
    ["9007199254740993", 9007199254740992],
    ["1", "1.0000000000000001"]
  ])("rejects precision-loss comparison %s against %s", (evidenceValue, sourceValue) => {
    expect(() =>
      validateEvidenceItem(
        { metric: sourceValue },
        "Precision-sensitive evidence",
        { label: "Metric", value: evidenceValue, source: "metric" }
      )
    ).toThrow(/Precision-sensitive evidence/);
  });

  it("canonicalizes formatting without changing the represented decimal", () => {
    expect(() =>
      validateEvidenceItem(
        { metric: "001.2300" },
        "Canonical evidence",
        { label: "Metric", value: "+1.23%", source: "metric" }
      )
    ).not.toThrow();
  });

  it("rejects a default zero from an unavailable source", () => {
    expect(() =>
      validateEvidenceItem(
        {
          sources: [
            {
              source: "Defender for Cloud",
              availability: "unavailable",
              message: "Unavailable."
            }
          ],
          security: { secureScore: 0 }
        },
        "Unavailable Defender evidence",
        { label: "Secure score", value: "0%", source: "security.secureScore" }
      )
    ).toThrow(/Defender for Cloud is not available/);
  });

  it("rejects null posture as numeric evidence", () => {
    expect(() =>
      validateEvidenceItem(
        {
          sources: [
            { source: "Resource Health", availability: "available", message: "Collected." }
          ],
          overview: { postureScore: null }
        },
        "Unknown health evidence",
        { label: "Health", value: "0%", source: "overview.postureScore" }
      )
    ).toThrow(/invalid scalar source/);
  });

  it("rejects a default incident zero when Resource Health is unavailable", () => {
    expect(() =>
      validateEvidenceItem(
        {
          sources: [
            {
              source: "Resource Health",
              availability: "unavailable",
              message: "Unavailable."
            }
          ],
          reliability: { incidentAvailability: "available", incidents: 0 }
        },
        "Unavailable incident evidence",
        { label: "障害件数", value: "0", source: "reliability.incidents" }
      )
    ).toThrow(/Resource Health is not available/);
  });

  it("rejects incident evidence when no incident count source was collected", () => {
    expect(() =>
      validateEvidenceItem(
        {
          sources: [
            {
              source: "Resource Health",
              availability: "available",
              message: "Collected."
            }
          ],
          reliability: { incidentAvailability: "unavailable", incidents: 0 }
        },
        "Uncollected incident evidence",
        { label: "障害件数", value: "0", source: "reliability.incidents" }
      )
    ).toThrow(/Incident observations are not available/);
  });

  it("rejects null incident evidence even when Resource Health is available", () => {
    expect(() =>
      validateEvidenceItem(
        {
          sources: [
            {
              source: "Resource Health",
              availability: "available",
              message: "Collected."
            }
          ],
          reliability: { incidentAvailability: "available", incidents: null }
        },
        "Null incident evidence",
        { label: "障害件数", value: "0", source: "reliability.incidents" }
      )
    ).toThrow(/invalid scalar source/);
  });
});
