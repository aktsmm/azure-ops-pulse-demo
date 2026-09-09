import type { CostPeriodDiagnostic, CostPeriodDiagnostics, SourceStatus } from "../src/data/contracts";
import type { ComparableCostResult, CostPeriodOutcome } from "./cost-transform";

function periodDiagnostic(
  status: SourceStatus,
  total: number | null,
  outcome: CostPeriodOutcome
): CostPeriodDiagnostic {
  if (status.availability === "unavailable") {
    return { availability: "unavailable", reason: status.reason ?? "unknown" };
  }
  if (total !== null && Number.isFinite(total) && outcome === "ok") {
    return { availability: "available" };
  }
  return { availability: "unavailable", reason: outcome === "ok" ? "invalid-response" : outcome };
}

/** Period causes are typed constants; source messages and raw CLI diagnostics are never copied. */
export function costPeriodDiagnostics(
  result: ComparableCostResult,
  current: SourceStatus,
  previous: SourceStatus
): CostPeriodDiagnostics {
  return {
    current: periodDiagnostic(current, result.currentTotalJpy, result.currentOutcome),
    previous: periodDiagnostic(previous, result.previousTotalJpy, result.previousOutcome)
  };
}
