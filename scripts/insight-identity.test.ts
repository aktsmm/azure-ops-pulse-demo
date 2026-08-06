import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AiInsight } from "../src/data/contracts";
import { buildDemoSnapshot } from "./build-demo-snapshot";
import { insightSchema } from "./public-schema";
import {
  applyDeterministicInsightIds,
  deriveInsightId,
  validateInsightIds
} from "./insight-identity";

/**
 * Nothing here is pinned to a value in `public/data/snapshot.json`. The fixtures are written locally
 * or built from the DEMO builder, and every expected id is computed by the implementation, so a
 * collection that republishes different insights cannot turn this suite red on its own.
 */
const COLLECTED_AT = "2026-08-05T18:56:06.000Z";

function insight(overrides: Partial<AiInsight> = {}): AiInsight {
  return {
    id: "insight-a3c1f2e4",
    severity: "warning",
    title: "コストの前期比増加を確認",
    observation: "公開スナップショットのコスト増減率が、前回の比較対象より大きくなっています。",
    impact: "この傾向が続くと、次回の比較でコストの増加幅がさらに広がるおそれがあります。",
    numericEvidence: [{ label: "コストの増減率", value: "76.7%", source: "cost.deltaPercent" }],
    recommendedAction: "コスト ページで増加の内訳を人が確認することを推奨します。",
    confidence: 0.85,
    period: "2026-08-06 スナップショット収集時点",
    route: "/cost",
    ...overrides
  };
}

describe("deriving an insight identifier from the insight", () => {
  it("always produces the spelling the schema asks for", () => {
    const written = [
      insight(),
      insight({ severity: "critical", route: "/security" }),
      insight({ numericEvidence: [] }),
      insight({ title: "英数字 ASCII 1234" })
    ];

    for (const candidate of written) {
      const id = deriveInsightId(candidate);
      expect(id).toMatch(/^insight-[0-9a-f]{8}$/);
      expect(insightSchema.shape.id.safeParse(id).success).toBe(true);
    }
  });

  it("produces the same identifier for the same analysis and a different one for a different analysis", () => {
    const base = insight();

    expect(deriveInsightId(base)).toBe(deriveInsightId(insight()));
    expect(deriveInsightId(insight({ title: `${base.title}。` }))).not.toBe(deriveInsightId(base));
    expect(deriveInsightId(insight({ confidence: 0.86 }))).not.toBe(deriveInsightId(base));
    expect(
      deriveInsightId(
        insight({
          numericEvidence: [{ label: "コストの増減率", value: "76.7%", source: "cost.categories.0.deltaPercent" }]
        })
      )
    ).not.toBe(deriveInsightId(base));
  });

  /**
   * `id` and `period` are both derived, so an identity that depended on either would depend on the
   * clock or on itself. Two runs that reached the same conclusion about the same snapshot have to
   * agree on the identifier.
   */
  it("ignores the fields the pipeline derives", () => {
    const base = insight();

    expect(deriveInsightId(insight({ id: "insight-ffffffff" }))).toBe(deriveInsightId(base));
    expect(deriveInsightId(insight({ period: "Last 30 days" }))).toBe(deriveInsightId(base));
  });

  it("derives an identifier for an insight that wrote none", () => {
    const withoutId: Partial<AiInsight> = insight();
    delete withoutId.id;

    expect(deriveInsightId(withoutId)).toBe(deriveInsightId(insight()));
  });
});

describe("replacing the identifier the analysis wrote", () => {
  /**
   * Spellings a model reaches for that the schema rejects: capitalised hexadecimal, a readable slug,
   * the wrong length, and no id at all.
   */
  it.each([
    "insight-A3C1F2E4",
    "insight-cost-spike",
    "insight-a3c1f2",
    "a3c1f2e4",
    "1",
    undefined
  ])("replaces the written identifier %j", (written) => {
    const candidate: Partial<AiInsight> = insight();
    if (written === undefined) delete candidate.id;
    else candidate.id = written;
    const snapshot = { aiInsights: [candidate] };

    expect(applyDeterministicInsightIds(snapshot)).toBe(1);
    expect(snapshot.aiInsights[0]!.id).toBe(deriveInsightId(insight()));
  });

  it("leaves the rest of the insight untouched", () => {
    const snapshot = { aiInsights: [insight({ id: "insight-A3C1F2E4" })] };
    const before = insight({ id: "insight-A3C1F2E4" });

    applyDeterministicInsightIds(snapshot);

    expect({ ...snapshot.aiInsights[0], id: before.id }).toEqual(before);
  });

  it("is idempotent, so the trusted pass agrees with the pass the analysis ran", () => {
    const snapshot = { aiInsights: [insight(), insight({ severity: "info" })] };

    expect(applyDeterministicInsightIds(snapshot)).toBe(2);
    expect(applyDeterministicInsightIds(snapshot)).toBe(0);
  });

  /**
   * The dashboard renders insight cards with `key={insight.id}`, so two insights sharing an id are
   * rendered as one. Renaming one of them would publish a duplicate finding as if it were two
   * findings, so this fails instead.
   */
  it("refuses to disambiguate two insights that say the same thing", () => {
    expect(() => applyDeterministicInsightIds({ aiInsights: [insight(), insight()] })).toThrow(
      /derives the same identifier as aiInsights\.0/
    );
  });

  it("rejects an output it cannot walk instead of skipping it", () => {
    expect(() => applyDeterministicInsightIds({})).toThrow(/aiInsights array/);
    expect(() => applyDeterministicInsightIds({ aiInsights: ["nope"] })).toThrow(
      /aiInsights\.0 must be an insight object/
    );
  });
});

describe("rejecting a candidate whose identifier did not come from the snapshot", () => {
  it.each(["insight-A3C1F2E4", "insight-cost-spike", "insight-a3c1f2e4", "insight-00000000"])(
    "fails publication on the written identifier %j",
    (written) => {
      expect(() => validateInsightIds({ aiInsights: [insight({ id: written })] })).toThrow(
        /field id must be/
      );
    }
  );

  it("names the value the insight must carry", () => {
    expect(() => validateInsightIds({ aiInsights: [insight({ id: "insight-00000000" })] })).toThrow(
      new RegExp(deriveInsightId(insight()))
    );
  });

  /**
   * Two ids can only be equal here if two insights derived the same one, which means the analysis
   * published one finding twice. The dashboard would render a single card, so this has to fail on
   * the property the dashboard needs — the derivation check alone does not cover it, because both
   * ids are exactly what the content produces.
   */
  it("fails two insights that carry one identifier even though both ids are derived", () => {
    const duplicated = { ...insight(), id: deriveInsightId(insight()) };

    expect(() => validateInsightIds({ aiInsights: [duplicated, { ...duplicated }] })).toThrow(
      /appears more than once/
    );
  });

  it("accepts a candidate the deterministic pass produced", () => {
    const snapshot = {
      aiInsights: [insight({ id: "insight-A3C1F2E4" }), insight({ route: "/security" })]
    };
    applyDeterministicInsightIds(snapshot);

    expect(() => validateInsightIds(snapshot)).not.toThrow();
  });

  it("passes for a snapshot that published no insights at all", () => {
    expect(() => validateInsightIds({ aiInsights: [] })).not.toThrow();
  });
});

describe("the DEMO snapshot uses the same derivation as the published one", () => {
  it("labels every demo insight with the derived identifier", () => {
    for (const generatedAt of ["2026-08-05T13:00:00.000Z", "2027-02-28T03:04:05.000Z"]) {
      const snapshot = buildDemoSnapshot(generatedAt);

      expect(snapshot.aiInsights.length).toBeGreaterThan(0);
      expect(new Set(snapshot.aiInsights.map((entry) => entry.id)).size).toBe(
        snapshot.aiInsights.length
      );
      expect(() => validateInsightIds(snapshot)).not.toThrow();
    }
  });
});

describe("the identity gate inside deterministic validation", () => {
  /**
   * Asserting that the script mentions the gate would pass on a commented-out call, so this runs the
   * command CI and the publishing workflow run and requires it to reject the snapshot.
   */
  it("rejects an identifier the insight content did not produce", { timeout: 120_000 }, () => {
    const snapshot = buildDemoSnapshot(COLLECTED_AT);
    const [first, ...rest] = snapshot.aiInsights;
    if (!first) throw new Error("demo fixture must publish at least one insight");

    const directory = mkdtempSync(join(tmpdir(), "ops-pulse-identity-"));
    const derived = join(directory, "derived.json");
    const written = join(directory, "written.json");
    writeFileSync(derived, JSON.stringify(snapshot), "utf8");
    // Correctly spelled, unique, and accepted by every other gate. It is rejected because the id
    // identifies the insight and this one was not derived from it.
    writeFileSync(
      written,
      JSON.stringify({
        ...snapshot,
        aiInsights: [{ ...first, id: "insight-a3c1f2e4" }, ...rest]
      }),
      "utf8"
    );

    const run = (file: string) => {
      const result = spawnSync("npx", ["tsx", "scripts/validate-public-data.ts", file], {
        encoding: "utf8",
        shell: process.platform === "win32"
      });
      return { ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
    };

    expect(run(derived).ok).toBe(true);

    const rejected = run(written);
    expect(rejected.ok).toBe(false);
    expect(rejected.output).toContain("field id must be");
  });
});
