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

  it("uses a privacy-safe category label when operationName is absent", () => {
    expect(normalizeActivityOperationLabel({ category: "Administrative" })).toBe("管理操作");
  });

  it("never stringifies objects", () => {
    expect(normalizeActivityOperationLabel({ category: { value: { nested: true } } })).toBe(
      "変更操作"
    );
  });

  it.each([
    "payroll-prod-secret の作成",
    "本番顧客DBを削除",
    "2001:db8::1234 の削除",
    "Delete admin@example.com",
    "Update 01234567-89ab-cdef-0123-456789abcdef",
    "Create payroll-prod-secret.example.com",
    "Delete 203.0.113.42"
  ])("never publishes arbitrary operation text: %s", (operationName) => {
    const label = normalizeActivityOperationLabel({ operationName });
    expect(label).toBe("変更操作");
    expect(operationName).not.toContain(label);
  });

  it("falls back to an allowlisted category without exposing an unknown operation", () => {
    expect(
      normalizeActivityOperationLabel({
        category: { value: "Security", localizedValue: "セキュリティ" },
        operationName: "Delete payroll-prod-secret"
      })
    ).toBe("セキュリティ操作");
  });
});
