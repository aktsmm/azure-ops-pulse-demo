import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { snapshotFixture } from "../test/snapshot-fixtures";
import type { AdvisorRecommendationGroup } from "../data/contracts";
import { AdvisorTargetResources } from "./AdvisorTargetResources";

const data = snapshotFixture();
const storage = data.inventory.resources.filter((resource) => resource.type === "microsoft.storage/storageaccounts");
const group: AdvisorRecommendationGroup = {
  ...data.advisor!.details!.groups[0]!,
  resourceRefs: [storage[0]!.id], targets: [{ resourceRef: storage[0]!.id, type: storage[0]!.type }],
  targetCoverage: { totalResources: 7, publishedResources: 1, unresolvedResources: 6, truncated: false },
  scopeCounts: { resource: 7, subscription: 0, unknown: 0 }
};
afterEach(cleanup);
describe("Exact Advisor target references", () => {
  it("does not treat every same-type resource as affected", () => {
    const select = vi.fn();
    render(<AdvisorTargetResources group={group} resources={storage} onSelect={select} />);
    fireEvent.click(screen.getByText("対象リソースの公開参照 1 件を見る"));
    fireEvent.click(screen.getByRole("button", { name: `${storage[0]!.name}の詳細を開く` }));
    expect(select).toHaveBeenCalledWith(storage[0]);
    expect(screen.queryByText(storage[1]!.name)).not.toBeInTheDocument();
    expect(screen.getByText(/収集インベントリとの対応未確認 6 件/)).toBeInTheDocument();
  });
  it("leaves a published reference unresolved rather than guessing an inventory resource", () => {
    render(<AdvisorTargetResources group={{ ...group, resourceRefs: ["res-ffffffff"] }} resources={storage} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByText("対象リソースの公開参照 1 件を見る"));
    expect(screen.getByText("res-ffffffff")).toBeInTheDocument();
    expect(screen.getByText(/インベントリ詳細なし/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("distinguishes missing reference collection, empty publication and truncation", () => {
    const { rerender } = render(<AdvisorTargetResources group={data.advisor!.details!.groups[0]!} resources={storage} />);
    expect(screen.getByText("対象リソースの対応付けは未収集")).toBeInTheDocument();
    rerender(<AdvisorTargetResources group={{ ...group, resourceRefs: [], targetCoverage: {
      totalResources: 7, publishedResources: 0, unresolvedResources: 6, truncated: true
    } }} resources={storage} />);
    fireEvent.click(screen.getByText("対象リソースの公開参照 0 件を見る"));
    expect(screen.getByText(/公開できる対象参照はありません/)).toBeInTheDocument();
    expect(screen.getByText(/公開件数の上限により一部を省略/)).toBeInTheDocument();
  });
  it("explains subscription-only targets without suggesting a missing inventory resource", () => {
    render(<AdvisorTargetResources group={{
      ...group, resourceRefs: [], targets: [],
      scopeCounts: { resource: 0, subscription: 2, unknown: 0 },
      targetCoverage: { totalResources: 0, publishedResources: 0, unresolvedResources: 0, truncated: false }
    }} resources={storage} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByText("対象リソースの公開参照 0 件を見る"));
    expect(screen.getByText(/サブスクリプション単位の推奨です/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/個別の対応付けを確認できません/)).not.toBeInTheDocument();
  });
});
