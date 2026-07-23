import { describe, expect, it } from "vitest";
import { activityEventSeverity, activityEventTitle, fieldLabel } from "./activity-normalize";

describe("activity log field normalization", () => {
  it("extracts a plain string field as-is", () => {
    expect(fieldLabel("Administrative")).toBe("Administrative");
  });

  it("extracts localizedValue from an Azure CLI {value, localizedValue} object", () => {
    expect(fieldLabel({ value: "Administrative", localizedValue: "Administrative" })).toBe(
      "Administrative"
    );
  });

  it("falls back to value when localizedValue is missing", () => {
    expect(fieldLabel({ value: "Security" })).toBe("Security");
  });

  it("returns undefined for null, undefined, empty string, or an unrecognized shape", () => {
    expect(fieldLabel(undefined)).toBeUndefined();
    expect(fieldLabel(null)).toBeUndefined();
    expect(fieldLabel("")).toBeUndefined();
    expect(fieldLabel({})).toBeUndefined();
  });

  it("never renders the literal text [object Object] in an activity title", () => {
    const title = activityEventTitle({ value: "Administrative", localizedValue: "Administrative" });
    expect(title).not.toContain("[object Object]");
    expect(title).toBe("Administrative のアクティビティを検出");
  });

  it("still produces a safe Japanese fallback title when category is missing entirely", () => {
    const title = activityEventTitle(undefined);
    expect(title).not.toContain("[object Object]");
    expect(title).toBe("Azure のアクティビティを検出");
  });

  it("maps an Error-level object to warning severity and everything else to info", () => {
    expect(activityEventSeverity({ value: "Error", localizedValue: "Error" })).toBe("warning");
    expect(activityEventSeverity({ value: "Informational" })).toBe("info");
    expect(activityEventSeverity(undefined)).toBe("info");
  });
});
