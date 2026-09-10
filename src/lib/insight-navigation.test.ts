import { describe, expect, it } from "vitest";
import published from "../../public/data/snapshot.json";
import type { PublicSnapshotV1 } from "../data/contracts";
import { insightAdvisorGroups, insightTargets, prioritizeInsights } from "./insight-navigation";

const data = published as PublicSnapshotV1;
const insight = data.aiInsights.find((item) => item.route === "/recommendations")!;
describe("Evidence-driven insight navigation", () => {
  it("resolves exact group indices and deduplicates multiple facts from a group", () => {
    const groups = insightAdvisorGroups(insight, data);
    expect(groups).toEqual([data.advisor!.details!.groups[0]]);
    expect(insightTargets(insight, data)[0]!.href).toBe(`/recommendations?group=${groups[0]!.id}`);
  });
  it("does not guess a group from a title, resource type, malformed path or missing index", () => {
    for (const source of ["inventory.byType.0.count", "advisor.details.groups.999.count", "advisor.details.groups.0", "advisor.details.groups.-1.count", "advisor.details.groups.01.count"]) {
      const unrelated = { ...insight, numericEvidence: [{ label: "Storage", value: "7", source }] };
      expect(insightAdvisorGroups(unrelated, data)).toEqual([]);
      expect(insightTargets(unrelated, data)[0]!.href).toBe(insight.route);
    }
  });
  it("links multiple groups without silently choosing only the first", () => {
    const multi = { ...insight, numericEvidence: [
      { label: "a", value: "7", source: "advisor.details.groups.0.count" },
      { label: "b", value: "1", source: "advisor.details.groups.9.count" }
    ] };
    expect(insightTargets(multi, data)).toHaveLength(2);
  });
  it("ignores unavailable details", () => {
    expect(insightAdvisorGroups(insight, { ...data, advisor: undefined })).toEqual([]);
    expect(insightAdvisorGroups(insight, { ...data, advisor: { ...data.advisor!, details: {
      ...data.advisor!.details!, availability: "unavailable"
    } } })).toEqual([]);
  });
  it("uses the current snapshot index rather than a stored title lookup", () => {
    const reordered = { ...data, advisor: { ...data.advisor!, details: {
      ...data.advisor!.details!, groups: [...data.advisor!.details!.groups].reverse()
    } } };
    expect(insightAdvisorGroups(insight, reordered)[0]).toBe(reordered.advisor.details.groups[0]);
  });
  it("ranks warning/high ahead of warning/medium without mutating the snapshot", () => {
    const original = [...data.aiInsights];
    const sorted = prioritizeInsights(data);
    expect(sorted[0]!.numericEvidence.some((evidence) => evidence.source.endsWith(".impacts.High"))).toBe(true);
    expect(sorted.at(-1)!.severity).toBe("info");
    expect(data.aiInsights).toEqual(original);
  });
});
