import { setTimeout as sleep } from "node:timers/promises";
import { CollectionError, classifyCollectionFailure } from "./collection-diagnostics";
import { mergeCostPages, type CostQueryProperties } from "./cost-transform";

const ARM_ORIGIN = "https://management.azure.com";
const MAX_ATTEMPTS = 6;
const PERIOD_BUDGET_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 60_000;

interface CostQueryDependencies {
  token: () => string;
  request?: typeof fetch;
  wait?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  log?: (message: string) => void;
}

// Honor the longest server delay, including Cost Management's per-quota backoff headers.
// https://learn.microsoft.com/ja-jp/azure/cost-management-billing/costs/manage-automation
export function costRetryDelay(headers: Headers, attempt: number, now: number, random: number): number {
  const delays = [Math.min(120_000, 15_000 * 2 ** attempt)];
  headers.forEach((value, name) => {
    if (name === "retry-after") {
      const seconds = Number(value);
      const milliseconds = value.trim() && Number.isFinite(seconds)
        ? seconds * 1000 : Date.parse(value) - now;
      if (Number.isFinite(milliseconds) && milliseconds >= 0) delays.push(milliseconds);
    } else if (/^x-ms-ratelimit-microsoft\.(costmanagement|consumption)-.*retry-after$/.test(name) ||
               name === "x-ms-ratelimit-microsoft.consumption-retry-after") {
      const seconds = Number(value);
      if (value.trim() && Number.isFinite(seconds) && seconds >= 0) delays.push(seconds * 1000);
    }
  });
  return Math.max(...delays) + Math.floor(Math.max(0, Math.min(1, random)) * 1000);
}

export async function queryCostPeriod(
  subscriptionId: string,
  start: Date,
  end: Date,
  dependencies: CostQueryDependencies
): Promise<CostQueryProperties | null> {
  const request = dependencies.request ?? fetch;
  const wait = dependencies.wait ?? sleep;
  const now = dependencies.now ?? Date.now;
  const random = dependencies.random ?? Math.random;
  const log = dependencies.log ?? console.warn;
  const deadline = now() + PERIOD_BUDGET_MS;
  const path = `/subscriptions/${subscriptionId}/providers/Microsoft.CostManagement/query`;
  let url = `${ARM_ORIGIN}${path}?api-version=2025-03-01`;
  const body = JSON.stringify({
    type: "ActualCost",
    timeframe: "Custom",
    timePeriod: { from: start.toISOString(), to: end.toISOString() },
    dataset: {
      granularity: "None",
      aggregation: { totalCost: { name: "Cost", function: "Sum" } },
      grouping: [{ type: "Dimension", name: "ServiceName" }]
    }
  });
  const pages: CostQueryProperties[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < 50; page += 1) {
    if (seen.has(url)) throw new CollectionError("invalid-response");
    seen.add(url);
    let result: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const remaining = deadline - now();
      if (remaining <= 0) throw new CollectionError("throttled");
      // OIDC's CLI token stays in memory; never put it in process arguments, logs or artifacts.
      const token = dependencies.token();
      if (!token) throw new CollectionError("authentication");
      let response: Response;
      let text: string;
      try {
        response = await request(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body,
          redirect: "error",
          signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, remaining))
        });
        text = await response.text();
      } catch {
        // Transport errors can include URLs/credentials. Surface only a closed diagnostic.
        throw new CollectionError("unknown");
      }
      if (response.status === 429 || response.status === 503) {
        const delay = costRetryDelay(response.headers, attempt, now(), random());
        const failure = response.status === 429 ? "throttled" : "unknown";
        if (attempt + 1 === MAX_ATTEMPTS || delay >= deadline - now()) {
          log(`Cost Management HTTP ${response.status}: automatic retry budget exhausted.`);
          throw new CollectionError(failure);
        }
        log(`Cost Management HTTP ${response.status}: retry ${attempt + 1}/${MAX_ATTEMPTS - 1} in ${Math.ceil(delay / 1000)}s.`);
        await wait(delay);
        continue;
      }
      if (!response.ok) {
        throw new CollectionError(classifyCollectionFailure(`${response.status} ${text}`));
      }
      if (response.status === 204 || !text.trim()) {
        if (pages.length) throw new CollectionError("invalid-response");
        return null;
      }
      try { result = JSON.parse(text); }
      catch { throw new CollectionError("invalid-response"); }
      break;
    }
    if (!result || typeof result !== "object" || !("properties" in result)) {
      throw new CollectionError("invalid-response");
    }
    const properties = result.properties as CostQueryProperties | null;
    if (!properties || !Array.isArray(properties.rows) || !Array.isArray(properties.columns)) {
      throw new CollectionError("invalid-response");
    }
    pages.push(properties);
    if (!properties.nextLink) return mergeCostPages(pages);
    let next: URL;
    try { next = new URL(properties.nextLink, ARM_ORIGIN); }
    catch { throw new CollectionError("invalid-response"); }
    if (next.origin !== ARM_ORIGIN || next.pathname.toLowerCase() !== path.toLowerCase() ||
        next.username || next.password || next.hash) {
      throw new CollectionError("invalid-response");
    }
    url = next.href;
  }
  throw new CollectionError("invalid-response");
}
