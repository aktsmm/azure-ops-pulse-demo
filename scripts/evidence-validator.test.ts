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
});
