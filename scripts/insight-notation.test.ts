import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDemoSnapshot } from "./build-demo-snapshot";
import { PUBLIC_SCHEMA_DIRECTORY, validatePublicJsonSchema } from "./json-schema-validator";
import { insightSchema } from "./public-schema";
import {
  EVIDENCE_SOURCE_PATTERN,
  INSIGHT_ROUTES,
  INSIGHT_SEVERITIES,
  normalizeAiInsightNotation,
  normalizeConfidenceNotation,
  normalizeEvidenceSourceNotation,
  normalizeEvidenceValueNotation,
  normalizeRouteNotation,
  normalizeSeverityNotation,
  totalNotationRepairs
} from "./insight-notation";

/**
 * Every expectation is a property of the contract or is derived from a locally built snapshot.
 * Nothing is pinned to a value in `public/data/snapshot.json`: the cost categories are reordered and
 * renamed by every collection, so a test that knew which category sat at index 0 would fail on data
 * changes that say nothing about this code.
 */
const COLLECTED_AT = "2026-08-05T18:56:06.000Z";

function publishedInsightSchema(): {
  severity: { enum: string[] };
  route: { enum: string[] };
  numericEvidence: { items: { properties: { source: { pattern: string } } } };
} {
  const schema = JSON.parse(
    readFileSync(join(PUBLIC_SCHEMA_DIRECTORY, "ai-insights.schema.json"), "utf8")
  ) as { items: { properties: Record<string, never> } };
  return schema.items.properties as never;
}

/** The reverse of the repair, so a fixture can be written in the notation a run actually produced. */
function bracketIndices(source: string): string {
  return source.replace(/\.(\d+)(?=\.|$)/g, "[$1]");
}

function evidenceSourceWithIndex(): string {
  const source = buildDemoSnapshot(COLLECTED_AT)
    .aiInsights.flatMap((insight) => insight.numericEvidence)
    .map((evidence) => evidence.source)
    .find((candidate) => /\.\d+(\.|$)/.test(candidate));
  if (!source) throw new Error("the demo fixture must cite at least one array element");
  return source;
}

describe("the notation contract this module mirrors", () => {
  it("uses the pattern and enums the published schema states", () => {
    const properties = publishedInsightSchema();

    expect(new RegExp(properties.numericEvidence.items.properties.source.pattern).source).toBe(
      EVIDENCE_SOURCE_PATTERN.source
    );
    expect(properties.severity.enum).toEqual([...INSIGHT_SEVERITIES]);
    expect(properties.route.enum).toEqual([...INSIGHT_ROUTES]);
  });
});

describe("evidence path notation", () => {
  /**
   * The three paths run 31071772340 wrote that the schema rejected, alongside the seven it accepted.
   * They are spellings of a path, not published values, so a later collection cannot change them.
   */
  it.each([
    ["cost.categories[0].deltaPercent", "cost.categories.0.deltaPercent"],
    ["cost.categories[0].sharePercent", "cost.categories.0.sharePercent"],
    ["cost.categories[1].sharePercent", "cost.categories.1.sharePercent"],
    ["overview.trends[2].points[3]", "overview.trends.2.points.3"],
    ["inventory.byType[10].count", "inventory.byType.10.count"]
  ])("respells %j as %j", (written, expected) => {
    expect(normalizeEvidenceSourceNotation(written)).toBe(expected);
    expect(EVIDENCE_SOURCE_PATTERN.test(expected)).toBe(true);
  });

  it.each([
    "cost.deltaPercent", // already canonical
    "cost.categories.0.sharePercent", // already canonical
    "cost.categories[first].sharePercent", // a name, not an index: nothing to move
    "cost.categories[].sharePercent", // no index at all
    "cost.categories[0][1]", // an index of an index: an unexpected shape, not a misspelling
    "[0].cost", // a rewrite would still miss the pattern
    "spend.categories[0].sharePercent" // not one of the six roots
  ])("leaves %j for the schema to judge", (written) => {
    expect(normalizeEvidenceSourceNotation(written)).toBeNull();
  });

  it("repairs only the notation, so an unresolvable path still fails", () => {
    const snapshot = buildDemoSnapshot(COLLECTED_AT);
    const invented = "cost.categories[99].sharePercent";

    expect(normalizeEvidenceSourceNotation(invented)).toBe("cost.categories.99.sharePercent");
    expect(
      snapshot.cost.categories.length,
      "the repaired path must still point at nothing"
    ).toBeLessThan(99);
  });
});

describe("severity, route, confidence and value notation", () => {
  it.each([
    ["Critical", "critical"],
    ["WARNING", "warning"],
    [" info ", "info"]
  ])("respells severity %j as %j", (written, expected) => {
    expect(normalizeSeverityNotation(written)).toBe(expected);
  });

  it.each(["high", "medium", "low", "sev1", "", "High", "Medium", "SEV1", "Blocker"])(
    "leaves the severity %j for the schema to judge",
    (written) => {
      expect(normalizeSeverityNotation(written)).toBeNull();
    }
  );

  it.each([
    ["/Cost", "/cost"],
    ["cost", "/cost"],
    ["/cost/", "/cost"],
    ["/AI-Insights", "/ai-insights"]
  ])("respells route %j as %j", (written, expected) => {
    expect(normalizeRouteNotation(written)).toBe(expected);
  });

  it.each(["/costs", "/dashboard", "/", "", "/overview/costs", "/Costs", "Dashboard"])(
    "leaves the route %j for the schema to judge",
    (written) => {
      expect(normalizeRouteNotation(written)).toBeNull();
    }
  );

  it.each([
    ["0.78", 0.78],
    ["1", 1],
    ["0", 0],
    [" 0.5 ", 0.5]
  ])("respells confidence %j as %d", (written, expected) => {
    expect(normalizeConfidenceNotation(written)).toBe(expected);
  });

  /**
   * `78` and `"78%"` read as "78 percent" to a person, and that is the reason not to repair them:
   * dividing by a hundred would be this pipeline deciding what the analysis meant, and it could not
   * be told apart from a run that really did report 78 on a 0-1 scale.
   */
  it.each([78, "78", "78%", "0.78%", "high", "", "-0.1", "1.1", null, true])(
    "leaves the confidence %j for the schema to judge",
    (written) => {
      expect(normalizeConfidenceNotation(written)).toBeNull();
    }
  );

  it("respells a numeric evidence value as the string the schema types it as", () => {
    expect(normalizeEvidenceValueNotation(72.7)).toBe("72.7");
    expect(normalizeEvidenceValueNotation(0)).toBe("0");
    expect(normalizeEvidenceValueNotation("72.7%")).toBeNull();
    expect(normalizeEvidenceValueNotation(null)).toBeNull();
  });
});

describe("applying the repairs to a candidate", () => {
  function candidate() {
    const source = evidenceSourceWithIndex();
    return {
      aiInsights: [
        {
          id: "insight-a3c1f2e4",
          severity: "Warning",
          route: "/Cost",
          confidence: "0.85",
          numericEvidence: [
            { label: "指標", value: 72.7, source: bracketIndices(source) },
            { label: "指標", value: "1", source: "inventory.total" }
          ]
        }
      ]
    };
  }

  it("counts every field it had to respell", () => {
    const snapshot = candidate();
    const counts = normalizeAiInsightNotation(snapshot);

    expect(counts).toEqual({
      evidenceSources: 1,
      evidenceValues: 1,
      severities: 1,
      routes: 1,
      confidences: 1
    });
    expect(totalNotationRepairs(counts)).toBe(5);
    expect(snapshot.aiInsights[0]).toMatchObject({
      severity: "warning",
      route: "/cost",
      confidence: 0.85
    });
    expect(snapshot.aiInsights[0]!.numericEvidence[0]).toMatchObject({
      value: "72.7",
      source: evidenceSourceWithIndex()
    });
  });

  it("is idempotent, so the trusted pass agrees with the pass the analysis ran", () => {
    const snapshot = candidate();

    expect(totalNotationRepairs(normalizeAiInsightNotation(snapshot))).toBe(5);
    expect(totalNotationRepairs(normalizeAiInsightNotation(snapshot))).toBe(0);
  });

  it("changes nothing in a candidate that was already spelled correctly", () => {
    const snapshot = buildDemoSnapshot(COLLECTED_AT);
    const before = JSON.stringify(snapshot);

    expect(totalNotationRepairs(normalizeAiInsightNotation(snapshot))).toBe(0);
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it("produces values the schema accepts", () => {
    const snapshot = candidate();
    normalizeAiInsightNotation(snapshot);
    const repaired = snapshot.aiInsights[0]!;

    expect(INSIGHT_SEVERITIES).toContain(repaired.severity);
    expect(INSIGHT_ROUTES).toContain(repaired.route);
    expect(insightSchema.shape.confidence.safeParse(repaired.confidence).success).toBe(true);
    for (const evidence of repaired.numericEvidence) {
      expect(EVIDENCE_SOURCE_PATTERN.test(evidence.source)).toBe(true);
      expect(typeof evidence.value).toBe("string");
    }
  });

  it("rejects an output it cannot walk instead of skipping it", () => {
    expect(() => normalizeAiInsightNotation({})).toThrow(/aiInsights array/);
    expect(() => normalizeAiInsightNotation({ aiInsights: ["nope"] })).toThrow(
      /aiInsights\.0 must be an insight object/
    );
  });
});

function bracketedSnapshot() {
  const snapshot = buildDemoSnapshot(COLLECTED_AT);
  const insights = snapshot.aiInsights.map((insight) => ({
    ...insight,
    numericEvidence: insight.numericEvidence.map((evidence) => ({
      ...evidence,
      source: bracketIndices(evidence.source)
    }))
  }));
  if (!insights.some((insight) => insight.numericEvidence.some((e) => e.source.includes("[")))) {
    throw new Error("the demo fixture must cite at least one array element");
  }
  return { ...snapshot, aiInsights: insights };
}

describe("the notation repair inside the deterministic pass", () => {
  it("is what makes the published schema accept the run's evidence", () => {
    const written = bracketedSnapshot();

    expect(() => validatePublicJsonSchema(written)).toThrow(/must match pattern/);

    normalizeAiInsightNotation(written);
    expect(() => validatePublicJsonSchema(written)).not.toThrow();
  });

  /**
   * Asserting that the pass merely mentions the repair would pass on a commented-out call, and
   * asserting that the module works in isolation would pass on a repair nothing runs. This runs the
   * shipped command against a file on disk and requires the file to change.
   */
  it(
    "runs from the command the workflows invoke",
    { timeout: 120_000 },
    () => {
      const directory = mkdtempSync(join(tmpdir(), "ops-pulse-notation-"));
      const file = join(directory, "candidate.json");
      writeFileSync(file, JSON.stringify(bracketedSnapshot()), "utf8");

      const rejectedBefore = spawnSync("npx", ["tsx", "scripts/validate-public-data.ts", file], {
        encoding: "utf8",
        shell: process.platform === "win32"
      });
      expect(rejectedBefore.status).not.toBe(0);
      expect(`${rejectedBefore.stdout}${rejectedBefore.stderr}`).toContain("must match pattern");

      const repaired = spawnSync(
        "npx",
        ["tsx", "scripts/normalize-ai-insight-notation.ts", file],
        { encoding: "utf8", shell: process.platform === "win32" }
      );
      expect(repaired.status).toBe(0);
      expect(repaired.stdout).toMatch(/Normalized [1-9]\d* AI insight notation value\(s\)/);

      const accepted = spawnSync("npx", ["tsx", "scripts/validate-public-data.ts", file], {
        encoding: "utf8",
        shell: process.platform === "win32"
      });
      expect(`${accepted.stdout}${accepted.stderr}`).toContain("Validated public snapshot");
      expect(accepted.status).toBe(0);
    }
  );
});
