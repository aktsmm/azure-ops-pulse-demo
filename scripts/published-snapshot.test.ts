import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEMO_OUTPUT_PATH,
  PUBLISHED_SNAPSHOT_PATH,
  buildDemoSnapshot,
  resolveDemoOutputPath
} from "./build-demo-snapshot";

/**
 * `public/data/snapshot.json` is what GitHub Pages serves as the site's real data, and nothing else
 * stops synthetic data from reaching it: a DEMO snapshot satisfies every validator, and the Pages
 * job only checks that the file exists before `vite build` copies `public/` into `dist/`. So a
 * forgotten `--preview` run would have published the demo fixture as production until the next
 * scheduled collection overwrote it, with CI green the whole way.
 *
 * The assertion is on `mode`, which the collector writes as a literal, so a successful collection
 * never changes it. Pinning published values instead would fail on every real collection, which is
 * the failure mode PR #21 had to remove.
 */
describe("published snapshot", () => {
  it("is collected from Azure rather than generated from the demo fixture", () => {
    const published = JSON.parse(readFileSync(PUBLISHED_SNAPSHOT_PATH, "utf8")) as {
      mode?: unknown;
    };

    expect(published.mode).toBe("AZURE");
  });

  it("is not where a DEMO run writes by default", () => {
    expect(resolveDemoOutputPath({})).toBe(DEMO_OUTPUT_PATH);
    expect(resolveDemoOutputPath({})).not.toBe(PUBLISHED_SNAPSHOT_PATH);
  });

  it("is reachable only when the caller asks for it by name", () => {
    expect(resolveDemoOutputPath({}, ["--preview"])).toBe(PUBLISHED_SNAPSHOT_PATH);
    expect(resolveDemoOutputPath({ OUTPUT_PATH: "/tmp/demo.json" })).toBe("/tmp/demo.json");
    // An explicit destination stays explicit even next to the flag, so a script cannot acquire the
    // published path by accident.
    expect(resolveDemoOutputPath({ OUTPUT_PATH: "/tmp/demo.json" }, ["--preview"])).toBe(
      "/tmp/demo.json"
    );
  });

  it("keeps the default destination out of version control", () => {
    const ignored = readFileSync(".gitignore", "utf8")
      .split(/\r?\n/u)
      .map((line) => line.trim());

    expect(ignored).toContain(`${DEMO_OUTPUT_PATH.split("/")[0]}/`);
  });
});


/**
 * The language audit used to sit behind a grandfather clause: one artifact, pinned by digest,
 * predated the localised collector, and a digest match narrowed the audit down to `aiInsights` alone.
 * The collection on 2026-08-05 replaced that file, the clause expired as designed, and the branch was
 * removed. Its tests went with it because they read the published file's own insights to prove the
 * narrowing still covered them — and at the moment CI validates a fresh collection that array is
 * always empty, so the assertion failed on every real run and blocked Pages.
 *
 * These replace it by running the real script, so a skip added later — a digest, an env check, a mode
 * test — fails here regardless of the shape it takes. The subject is a snapshot built in this file,
 * never the published one: what production happens to contain on a given day is not the contract, and
 * depending on it is the coupling PR #21 removed. The published file is read only where its own value
 * is the point (`mode`, above).
 */
describe("language audit in validate-public-data", () => {
  /** Spawning `tsx` costs seconds, well past Vitest's 5s default, and CI contention widens that. */
  const SUBPROCESS_TIMEOUT = 60_000;

  function run(target: string, extraArguments: string[] = []): { status: number; output: string } {
    try {
      const output = execFileSync(
        process.execPath,
        [
          join("node_modules", "tsx", "dist", "cli.mjs"),
          "scripts/validate-public-data.ts",
          target,
          ...extraArguments
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
      );
      return { status: 0, output };
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string };
      return { status: failure.status ?? 1, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
    }
  }

  function validate(snapshot: unknown): { status: number; output: string } {
    const directory = mkdtempSync(join(tmpdir(), "snapshot-audit-"));
    const target = join(directory, "snapshot.json");
    writeFileSync(target, JSON.stringify(snapshot), "utf8");
    try {
      return run(target);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  const demo = buildDemoSnapshot("2026-08-05T13:00:00.000Z");
  /**
   * Production publishes `AZURE`. Validating a `DEMO` document would leave `if (parsed.mode ===
   * "DEMO")` around the audit passing here while production went unaudited, which is the same
   * "excuse one artifact" shape the removed clause had.
   */
  const snapshot = { ...demo, mode: "AZURE" } as typeof demo;

  /**
   * An insight the Japanese-prose rule accepts — it clears the minimum Japanese ratio — carrying an
   * English clause the UI audit still has to reject. Insight fields are otherwise owned by earlier
   * validators (`numericEvidence[].value` by the numeric-evidence rule, everything else by the
   * Japanese rule), so mixed prose is the only way to reach the audit through an insight.
   */
  function leakingInsight(): (typeof demo)["aiInsights"][number] {
    const [insight] = demo.aiInsights;
    if (!insight) throw new Error("demo fixture must publish at least one AI insight");
    return {
      ...insight,
      observation: "評価対象のリソースは前期間から変化していません no material change"
    };
  }

  it("accepts a snapshot whose prose is Japanese", { timeout: SUBPROCESS_TIMEOUT }, () => {
    expect(validate(snapshot).status).toBe(0);
  });

  /**
   * `overview.metrics[].label` is collector prose rather than insight prose, so this fails on the UI
   * audit alone: the Japanese-insight rule never looks at it. Asserting the audit's own wording keeps
   * a future failure for some unrelated reason from passing as proof.
   */
  it("rejects collector prose that is English", { timeout: SUBPROCESS_TIMEOUT }, () => {
    const [metric, ...rest] = snapshot.overview.metrics;
    if (!metric) throw new Error("demo fixture must publish at least one overview metric");
    const result = validate({
      ...snapshot,
      overview: {
        ...snapshot.overview,
        metrics: [{ ...metric, label: "Resource Health coverage" }, ...rest]
      }
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("English prose in a Japanese dashboard");
    expect(result.output).toContain("overview.metrics[0].label");
  });

  /**
   * Records which guard owns insight bodies: `validateJapaneseInsights` reads `observation`, so it
   * fires before the UI audit and this case would still pass with the audit deleted. That is what the
   * two cases below are for — this one only proves the script wires the Japanese rule at all.
   */
  it("rejects an English AI insight", { timeout: SUBPROCESS_TIMEOUT }, () => {
    const [insight] = demo.aiInsights;
    if (!insight) throw new Error("demo fixture must publish at least one AI insight");
    const result = validate({
      ...snapshot,
      aiInsights: [{ ...insight, observation: "Compute spend increased again this period" }]
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("field observation must be Japanese prose");
  });

  /**
   * Prose that clears the Japanese-ratio rule can still carry an English clause, so this reaches the
   * UI audit through an insight rather than stopping at an earlier validator. Auditing the snapshot
   * with `aiInsights` emptied — the exact hole the removed digest left, since it hashed the file
   * without them — passes every other case here and fails this one.
   */
  it("audits insight prose the Japanese rule accepts", { timeout: SUBPROCESS_TIMEOUT }, () => {
    const result = validate({ ...snapshot, aiInsights: [leakingInsight()] });

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("English prose in a Japanese dashboard");
    expect(result.output).toContain("aiInsights[0].observation");
  });

  /**
   * The AI workflow rewrites `aiInsights` on an already-published file and revalidates with
   * `--insights-only`, which is the only path an insight reaches production by. Skipping the audit in
   * that mode would leave the field that arrives last as the field nothing checks.
   */
  it("audits insights on the AI workflow's own path", { timeout: SUBPROCESS_TIMEOUT }, () => {
    // `--insights-only` diffs against a baseline and refuses paths outside the repository, so these
    // cannot live in the OS temp directory.
    const directory = join(DEMO_OUTPUT_PATH.split("/")[0] ?? ".candidate", "language-audit-test");
    mkdirSync(directory, { recursive: true });
    const baseline = join(directory, "baseline.json");
    const candidate = join(directory, "candidate.json");
    writeFileSync(baseline, JSON.stringify({ ...snapshot, aiInsights: [] }), "utf8");
    writeFileSync(
      candidate,
      JSON.stringify({ ...snapshot, aiInsights: [leakingInsight()] }),
      "utf8"
    );

    try {
      const result = run(candidate, ["--insights-only", `--baseline=${baseline}`]);

      expect(result.status).not.toBe(0);
      expect(result.output).toContain("English prose in a Japanese dashboard");
      expect(result.output).toContain("aiInsights[0].observation");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
