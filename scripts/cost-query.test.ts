import { describe, expect, it, vi } from "vitest";
import { costRetryDelay, queryCostPeriod } from "./cost-query";
import { collectSourceAsync } from "./source-status";
import { CollectionError, safeCollectionFailure } from "./collection-diagnostics";

const subscription = "test-subscription";
const start = new Date("2026-09-01T00:00:00Z");
const end = new Date("2026-09-10T00:00:00Z");
const nextLink = `https://management.azure.com/subscriptions/${subscription}/providers/Microsoft.CostManagement/query?page=2`;
const page = (amount = 1234, next?: string) => new Response(JSON.stringify({
  properties: {
    columns: [{ name: "Cost" }, { name: "ServiceName" }, { name: "Currency" }],
    rows: [[amount, "Compute", "JPY"]],
    ...(next ? { nextLink: next } : {})
  }
}));

function fixture(responses: Response[]) {
  let time = start.getTime();
  const request = vi.fn<typeof fetch>();
  for (const response of responses) request.mockResolvedValueOnce(response);
  const wait = vi.fn(async (milliseconds: number) => { time += milliseconds; });
  const log = vi.fn();
  const token = vi.fn(() => "test-token");
  const dependencies = { request, wait, log, token, now: () => time, random: () => 0 };
  return { ...dependencies, run: () => queryCostPeriod(subscription, start, end, dependencies) };
}

describe("Cost Management server-directed backoff", () => {
  it("honors the longest quota or standard header, with positive jitter", () => {
    expect(costRetryDelay(new Headers({
      "Retry-After": "20",
      "x-ms-ratelimit-microsoft.costmanagement-qpu-retry-after": "65",
      "x-ms-ratelimit-microsoft.costmanagement-entity-retry-after": "40"
    }), 0, start.getTime(), 0.5)).toBe(65_500);
  });
  it("accepts HTTP dates and consumption retry headers", () => {
    expect(costRetryDelay(new Headers({
      "retry-after": new Date(start.getTime() + 90_000).toUTCString(),
      "x-ms-ratelimit-microsoft.consumption-retry-after": "100"
    }), 0, start.getTime(), 0)).toBe(100_000);
  });
  it("backs off exponentially without trusting invalid or negative headers", () => {
    const headers = new Headers({ "retry-after": "invalid", "x-ms-ratelimit-microsoft.costmanagement-qpu-retry-after": "-1" });
    expect([0, 1, 2, 3, 4].map((attempt) => costRetryDelay(headers, attempt, start.getTime(), 0)))
      .toEqual([15_000, 30_000, 60_000, 120_000, 120_000]);
  });
  it("recovers from throttling without leaking response bodies or credentials", async () => {
    const f = fixture([new Response("PRIVATE-ERROR", { status: 429, headers: { "retry-after": "45" } }), page()]);
    const result = await f.run();
    expect(result?.rows).toEqual([[1234, "Compute", "JPY"]]);
    expect(f.wait).toHaveBeenCalledWith(45_000);
    expect(f.request).toHaveBeenCalledTimes(2);
    expect(f.token).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(f.log.mock.calls)).not.toMatch(/PRIVATE-ERROR|test-token|test-subscription/);
    expect(f.request.mock.calls[0][1]).toMatchObject({ redirect: "error", method: "POST" });
    expect(f.request.mock.calls[0][1]?.body).toBe(f.request.mock.calls[1][1]?.body);
  });
  it("retries service unavailability but never retries forbidden or authentication failures", async () => {
    const f = fixture([new Response("", { status: 503 }), page()]);
    expect((await f.run())?.rows).toHaveLength(1);
    for (const [status, failure] of [[401, "authentication"], [403, "forbidden"]] as const) {
      const denied = fixture([new Response("private", { status })]);
      await expect(denied.run()).rejects.toMatchObject({ failure });
      expect(denied.wait).not.toHaveBeenCalled();
    }
  });
  it("stops after six attempts and reports unavailable instead of zero", async () => {
    const f = fixture(Array.from({ length: 6 }, () => new Response("", { status: 429 })));
    const result = await collectSourceAsync("Cost Management", f.run,
      () => ({ availability: "available", message: "Collected" }), safeCollectionFailure);
    expect(result.value).toBeNull();
    expect(result.status).toMatchObject({ availability: "unavailable", reason: "throttled" });
    expect(f.request).toHaveBeenCalledTimes(6);
    expect(f.wait).toHaveBeenCalledTimes(5);
  });
  it("never retries earlier than a server delay exceeding the whole period budget", async () => {
    const f = fixture([new Response("", { status: 429, headers: { "retry-after": "3600" } })]);
    await expect(f.run()).rejects.toMatchObject({ failure: "throttled" });
    expect(f.request).toHaveBeenCalledTimes(1);
    expect(f.wait).not.toHaveBeenCalled();
  });
  it("shares the time budget across pages, not just individual attempts", async () => {
    const f = fixture([
      new Response("", { status: 429, headers: { "retry-after": "400" } }),
      page(100, nextLink),
      new Response("", { status: 429, headers: { "retry-after": "300" } })
    ]);
    await expect(f.run()).rejects.toMatchObject({ failure: "throttled" });
    expect(f.wait.mock.calls).toEqual([[400_000]]);
  });
  it("retries only the failed page without duplicating earlier cost rows", async () => {
    const f = fixture([page(100, nextLink), new Response("", { status: 429 }), page(200)]);
    expect((await f.run())?.rows).toEqual([[100, "Compute", "JPY"], [200, "Compute", "JPY"]]);
    expect(f.request.mock.calls.slice(1).map(([url]) => url)).toEqual([nextLink, nextLink]);
  });
  it.each([
    "https://untrusted.invalid/cost",
    `https://management.azure.com/subscriptions/other/providers/Microsoft.CostManagement/query`,
    `http://management.azure.com/subscriptions/${subscription}/providers/Microsoft.CostManagement/query`
  ])("rejects continuation outside the exact ARM scope: %s", async (url) => {
    const f = fixture([page(100, url)]);
    await expect(f.run()).rejects.toMatchObject({ failure: "invalid-response" });
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it("rejects repeated continuation URLs", async () => {
    const f = fixture([page(100, nextLink), page(200, nextLink)]);
    await expect(f.run()).rejects.toMatchObject({ failure: "invalid-response" });
  });
  it("distinguishes no content from invalid or incomplete data", async () => {
    expect(await fixture([new Response(null, { status: 204 })]).run()).toBeNull();
    for (const responses of [
      [new Response("invalid")],
      [new Response('{"properties":{}}')],
      [page(100, nextLink), new Response(null, { status: 204 })]
    ]) {
      await expect(fixture(responses).run()).rejects.toMatchObject({ failure: "invalid-response" });
    }
  });
  it("sanitizes transport and token failures", async () => {
    const f = fixture([]);
    f.request.mockRejectedValue(new Error("PRIVATE-URL"));
    await expect(f.run()).rejects.toMatchObject({ failure: "unknown" });
    f.token.mockImplementation(() => { throw new CollectionError("authentication"); });
    await expect(f.run()).rejects.toMatchObject({ failure: "authentication" });
  });
});
