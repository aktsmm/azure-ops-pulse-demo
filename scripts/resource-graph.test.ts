import { describe, expect, it } from "vitest";
import { collectGraphPages, type GraphResponse } from "./resource-graph";

describe("complete Resource Graph pagination", () => {
  it("follows camel and snake case tokens with exact totals", () => {
    const tokens: Array<string | undefined> = [];
    const pages: GraphResponse<number>[] = [
      { data: [1], count: 1, total_records: 3, skip_token: "next", result_truncated: "true" },
      { data: [2, 3], count: 2, totalRecords: 3, resultTruncated: false }
    ];
    expect(collectGraphPages((token) => { tokens.push(token); return pages.shift()!; })).toEqual([1, 2, 3]);
    expect(tokens).toEqual([undefined, "next"]);
  });
  it.each([
    { data: [1], total_records: 2 },
    { data: [1], result_truncated: true },
    { data: [1], resultTruncated: "true" },
    { data: [1], count: 3 },
    { data: [1], totalRecords: -1 },
    { data: [1], totalRecords: 0 },
    { data: [], skipToken: "private-token" }
  ])("rejects incomplete or contradictory responses without leaking tokens", (response) => {
    expect(() => collectGraphPages(() => response)).toThrow();
    try { collectGraphPages(() => response); } catch (error) { expect(String(error)).not.toContain("private-token"); }
  });
  it("rejects token cycles and a moving total instead of returning a plausible partial dataset", () => {
    let page = 0;
    expect(() => collectGraphPages(() => ({ data: [1], skipToken: ["a", "b", "a"][page++] }))).toThrow();
    page = 0;
    expect(() => collectGraphPages(() => ({ data: [1], totalRecords: ++page === 1 ? 2 : 3, skipToken: page === 1 ? "a" : undefined }))).toThrow();
    expect(() => collectGraphPages(() => ({ data: Array.from({ length: 1000 }, (_, index) => index) }))).toThrow();
  });
  it("accepts explicit successful zero results and enforces the page cap", () => {
    expect(collectGraphPages(() => ({ data: [], totalRecords: 0, skip_token: null }))).toEqual([]);
    let page = 0;
    expect(() => collectGraphPages(() => ({ data: [1], skipToken: String(page++) }))).toThrow();
    expect(page).toBe(100);
  });
});
