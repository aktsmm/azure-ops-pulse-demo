import { transformComparableCost, type CostQueryProperties } from "../../scripts/cost-transform";
import { createDemoRawSnapshot } from "../../scripts/demo-data";
import type { PublicSnapshotV1 } from "../data/contracts";
import { sanitizeSnapshot } from "../lib/sanitize";

/**
 * Cost fixtures are built by running the real pipeline — the Cost Management transform followed by
 * the publication sanitiser — over synthesised query responses. Asserting against hand-written
 * published values would let a fixture describe a snapshot production can never emit, and the
 * published `snapshot.json` is rewritten by every scheduled collection so its numbers cannot serve
 * as expectations either.
 */
export interface CostServiceFixture {
  name: string;
  /** Spend in the current period, in yen, before any rounding. */
  amountJpy: number;
  /** Spend in the prior period. Omit to model a service with no comparable prior record. */
  previousAmountJpy?: number;
}

function costResponse(services: Array<{ name: string; amountJpy: number }>): CostQueryProperties {
  return {
    columns: [{ name: "Cost" }, { name: "ServiceName" }, { name: "Currency" }],
    rows: services.map((service) => [service.amountJpy, service.name, "JPY"])
  };
}

/**
 * Builds a published snapshot whose cost block is the pipeline's own output for the given per-service
 * spend, so the fixture and production agree on every rounded label and percentage.
 */
export function costFixture(services: CostServiceFixture[]): PublicSnapshotV1 {
  const current = costResponse(services);
  const previous = costResponse(
    services
      .filter((service) => service.previousAmountJpy !== undefined)
      .map((service) => ({ name: service.name, amountJpy: service.previousAmountJpy as number }))
  );
  const comparable = transformComparableCost(current, previous.rows?.length ? previous : null);

  const raw = createDemoRawSnapshot();
  raw.exactCostJpy = comparable.currentTotalJpy;
  raw.exactPreviousCostJpy = comparable.previousTotalJpy;
  raw.costCategories = comparable.categories;
  return sanitizeSnapshot(raw);
}

/**
 * Reproduces a snapshot published before the disclosure floor existed: a change survives next to an
 * amount the dashboard withholds. The current contract rejects this shape, which is exactly why the
 * dashboard has to defend against it — the browser fetches `snapshot.json` without revalidating it.
 */
export function withUnroundedChange(
  snapshot: PublicSnapshotV1,
  serviceName: string,
  deltaPercent: number
): PublicSnapshotV1 {
  const next = structuredClone(snapshot);
  const index = next.cost.categories.findIndex((category) => category.name === serviceName);
  const category = next.cost.categories[index];
  if (!category) throw new Error(`Fixture has no cost category named ${serviceName}`);
  next.cost.categories[index] = { ...category, deltaPercent };
  return next;
}

/** The same pre-floor shape as {@link withUnroundedChange}, but for the portfolio total. */
export function withUnroundedPortfolioChange(
  snapshot: PublicSnapshotV1,
  deltaPercent: number
): PublicSnapshotV1 {
  const next = structuredClone(snapshot);
  next.cost.deltaPercent = deltaPercent;
  return next;
}
