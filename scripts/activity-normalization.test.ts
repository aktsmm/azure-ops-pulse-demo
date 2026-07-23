import { describe, expect, it } from "vitest";
import { normalizeActivityOperationLabel } from "./activity-normalization";

describe("Activity Log operation normalization", () => {
  it("prefers the localized operation label from Azure CLI object output", () => {
    expect(
      normalizeActivityOperationLabel({
        category: { value: "Administrative", localizedValue: "管理" },
        operationName: {
          value: "Microsoft.Resources/subscriptions/resourceGroups/write",
          localizedValue: "リソース グループの作成または更新"
        }
      })
    ).toBe("リソース グループの作成または更新");
  });

  it("uses a string category when operationName is absent", () => {
    expect(normalizeActivityOperationLabel({ category: "Administrative" })).toBe("Administrative");
  });

  it("never stringifies objects or publishes sensitive tokens", () => {
    expect(normalizeActivityOperationLabel({ category: { value: { nested: true } } })).toBe(
      "Azure 操作"
    );
    expect(
      normalizeActivityOperationLabel({
        operationName: "Update 01234567-89ab-cdef-0123-456789abcdef"
      })
    ).toBe("Azure 操作");
  });
});
