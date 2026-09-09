import { describe, expect, it } from "vitest";
import { matchesResourceQuery, resourceTypeInfo, resourceTypeLabel } from "./resource-catalog";
import type { ResourceItem } from "../data/contracts";

const vm: ResourceItem = {
  id: "res-demo", name: "resource-demo", type: "Microsoft.Compute/virtualMachines",
  resourceGroup: "rg-demo", region: "japaneast", status: "Healthy", owner: "team",
  tags: { environment: "dev" }, change: "変更なし"
};

describe("Resource catalog", () => {
  it.each(["VM", "ｖｍ", "仮想マシン", "サーバー", "VM japaneast", "res-demo", "dev"])("finds resources using %s", (query) => {
    expect(matchesResourceQuery(vm, query)).toBe(true);
  });
  it("combines terms rather than matching only one", () => {
    expect(matchesResourceQuery(vm, "VM westus")).toBe(false);
  });
  it("finds NW and DB without matching arbitrary raw names", () => {
    expect(matchesResourceQuery({ ...vm, type: "microsoft.network/virtualnetworks" }, "NW")).toBe(true);
    expect(matchesResourceQuery({ ...vm, type: "microsoft.documentdb/databaseaccounts" }, "DB")).toBe(true);
  });
  it("handles case and unknown types without labelling them VM", () => {
    expect(resourceTypeLabel(vm.type)).toBe("仮想マシン (VM)");
    expect(resourceTypeInfo("custom.widgets/examples")).toEqual({ label: "examples", category: "その他", aliases: "" });
  });
});
