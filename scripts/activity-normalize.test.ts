import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { activityTitleJa, normalizeActivityCategory } from "./activity-normalize";

describe("Azure Activity Log category normalization", () => {
  it("extracts the category value from an Azure LocalizableValue object", () => {
    expect(
      normalizeActivityCategory({ value: "Administrative", localizedValue: "管理" })
    ).toBe("Administrative");
  });

  it("accepts plain string categories", () => {
    expect(normalizeActivityCategory("Alert")).toBe("Alert");
  });

  it("is case-insensitive when matching known categories", () => {
    expect(normalizeActivityCategory("servicehealth")).toBe("ServiceHealth");
  });

  it("falls back to Unknown instead of guessing at unrecognized objects", () => {
    expect(normalizeActivityCategory({ foo: "bar" })).toBe("Unknown");
    expect(normalizeActivityCategory(undefined)).toBe("Unknown");
    expect(normalizeActivityCategory(null)).toBe("Unknown");
    expect(normalizeActivityCategory(42)).toBe("Unknown");
  });

  it("never renders the literal [object Object] in the generated title", () => {
    const title = activityTitleJa({ value: "Administrative", localizedValue: "Administrative" });
    expect(title).not.toContain("[object Object]");
    expect(title).toBe("管理操作のアクティビティを検知");
  });

  it("produces a privacy-safe generic title for unrecognized activity categories", () => {
    const title = activityTitleJa({ unexpected: "shape" });
    expect(title).not.toContain("[object Object]");
    expect(title).toBe("Azureのアクティビティを検知");
  });

  it.each([
    ["Administrative", "管理操作のアクティビティを検知"],
    ["Alert", "アラートのアクティビティを検知"],
    ["Autoscale", "自動スケールのアクティビティを検知"],
    ["Policy", "ポリシーのアクティビティを検知"],
    ["Recommendation", "推奨事項のアクティビティを検知"],
    ["ResourceHealth", "リソースの状態のアクティビティを検知"],
    ["Security", "セキュリティのアクティビティを検知"],
    ["ServiceHealth", "サービスの状態のアクティビティを検知"]
  ] as const)("labels %s activity in Japanese", (category, expected) => {
    expect(activityTitleJa(category)).toBe(expected);
  });

  it("regression: the published snapshot no longer contains the [object Object] activity bug", () => {
    const snapshot = readFileSync("public/data/snapshot.json", "utf8");
    expect(snapshot).not.toContain("[object Object]");
    const parsed = JSON.parse(snapshot) as {
      overview: { eventTimeline: Array<{ title: string }> };
    };
    for (const event of parsed.overview.eventTimeline) {
      expect(event.title).not.toContain("[object Object]");
      expect(event.title.length).toBeGreaterThan(0);
    }
  });
});
