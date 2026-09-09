import { describe, expect, it } from "vitest";
import { SOURCE_REASONS, type SourceStatus } from "../src/data/contracts";
import { costPeriodDiagnostics } from "./cost-diagnostics";
import { transformComparableCost } from "./cost-transform";
import { CollectionError } from "./collection-diagnostics";
import { collectSource } from "./source-status";
import { createDemoRawSnapshot } from "./demo-data";
import { sanitizeSnapshot } from "../src/lib/sanitize";
import { publicSnapshotSchema } from "./public-schema";
import { validatePublicJsonSchema } from "./json-schema-validator";

const response = { columns: [{ name: "Cost" }, { name: "Currency" }], rows: [[2000, "JPY"]] };
const collected: SourceStatus = {
  source: "Cost Management", availability: "available", message: "RAW_MESSAGE_SENTINEL"
};

describe("typed cost diagnostic causes", () => {
  it("keeps the previous-period failure without hiding the collected current value", () => {
    const result = costPeriodDiagnostics(transformComparableCost(response, null), collected, {
      ...collected, availability: "unavailable", reason: "forbidden"
    });
    expect(result).toEqual({
      current: { availability: "available" },
      previous: { availability: "unavailable", reason: "forbidden" }
    });
    expect(JSON.stringify(result)).not.toContain("RAW_MESSAGE_SENTINEL");
  });

  it.each([
    [null, "empty"],
    [{ ...response, rows: [] }, "empty"],
    [{ ...response, columns: [{ name: "Quantity" }, { name: "Currency" }] }, "unsupported-columns"],
    [{ ...response, rows: [[20, "USD"]] }, "currency-mismatch"],
    [{ ...response, rows: [[null, "JPY"]] }, "invalid-rows"]
  ] as const)("preserves the safe transform cause %s", (input, reason) => {
    const current = input === null ? null : {
      columns: input.columns.map((column) => ({ ...column })),
      rows: input.rows.map((row) => [...row])
    };
    const diagnostics = costPeriodDiagnostics(transformComparableCost(current, response), collected, collected);
    expect(diagnostics.current).toEqual({ availability: "unavailable", reason });
    expect(diagnostics.previous).toEqual({ availability: "available" });
  });

  it("preserves independent current authentication and prior throttling causes", () => {
    const result = costPeriodDiagnostics(transformComparableCost(null, null),
      { ...collected, availability: "unavailable", reason: "authentication" },
      { ...collected, availability: "unavailable", reason: "throttled" }
    );
    expect(result.current.reason).toBe("authentication");
    expect(result.previous.reason).toBe("throttled");
  });

  it("uses unknown for unclassified failures rather than parsing or echoing public messages", () => {
    const status = { ...collected, availability: "unavailable" as const };
    expect(costPeriodDiagnostics(transformComparableCost(null, null), status, status).current.reason).toBe("unknown");
    expect(collectSource("test", () => { throw new CollectionError("billing-scope"); },
      () => ({ availability: "available", message: "" }), "RAW_MESSAGE_SENTINEL").status.reason).toBe("billing-scope");
  });
});

describe("diagnostic publication contracts", () => {
  function fixture() {
    const raw = createDemoRawSnapshot();
    raw.exactPreviousCostJpy = null;
    raw.costPeriodDiagnostics = {
      current: { availability: "available" },
      previous: { availability: "unavailable", reason: "throttled" }
    };
    raw.sources.find((source) => source.source === "Cost Management")!.reason = "throttled";
    return sanitizeSnapshot(raw);
  }

  it("accepts safe optional reasons and amount-consistent period causes in both schemas", () => {
    const snapshot = fixture();
    expect(publicSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(() => validatePublicJsonSchema(snapshot)).not.toThrow();
    for (const reason of SOURCE_REASONS) {
      snapshot.sources[0]!.reason = reason;
      expect(publicSnapshotSchema.safeParse(snapshot).success).toBe(true);
    }
  });

  it("rejects unknown reason strings and free-form period messages", () => {
    const snapshot = fixture();
    Object.assign(snapshot.sources[0]!, { reason: "RAW_SECRET_SENTINEL" });
    expect(publicSnapshotSchema.safeParse(snapshot).success).toBe(false);
    expect(() => validatePublicJsonSchema(snapshot)).toThrow();
    delete snapshot.sources[0]!.reason;
    Object.assign(snapshot.cost.periodDiagnostics!.previous, { message: "RAW_SECRET_SENTINEL" });
    expect(publicSnapshotSchema.safeParse(snapshot).success).toBe(false);
    expect(() => validatePublicJsonSchema(snapshot)).toThrow();
  });

  it("rejects misleading period availability or an unavailable period with no cause", () => {
    const snapshot = fixture();
    snapshot.cost.periodDiagnostics!.current = { availability: "unavailable", reason: "empty" };
    expect(publicSnapshotSchema.safeParse(snapshot).success).toBe(false);
    expect(() => validatePublicJsonSchema(snapshot)).toThrow();
    snapshot.cost.periodDiagnostics!.current = { availability: "available" };
    delete snapshot.cost.periodDiagnostics!.previous.reason;
    expect(publicSnapshotSchema.safeParse(snapshot).success).toBe(false);
    expect(() => validatePublicJsonSchema(snapshot)).toThrow();
  });

  it("replaces unrecognized raw codes with unknown at the sanitization boundary", () => {
    const raw = createDemoRawSnapshot();
    Object.assign(raw.sources[0]!, { reason: "RAW_SECRET_SENTINEL" });
    raw.exactPreviousCostJpy = null;
    raw.costPeriodDiagnostics = { current: { availability: "available" }, previous: { availability: "unavailable" } };
    Object.assign(raw.costPeriodDiagnostics.previous, { reason: "RAW_SECRET_SENTINEL", message: "RAW_SECRET_SENTINEL" });
    const result = sanitizeSnapshot(raw);
    expect(result.sources[0]!.reason).toBe("unknown");
    expect(result.cost.periodDiagnostics!.previous.reason).toBe("unknown");
    expect(JSON.stringify(result)).not.toContain("RAW_SECRET_SENTINEL");
  });
});
