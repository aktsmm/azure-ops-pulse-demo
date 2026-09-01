import { describe, expect, it } from "vitest";
import { execFile, execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { buildDemoSnapshot } from "./build-demo-snapshot";
import { deriveInsightId } from "./insight-identity";
import { formatInsightFindings } from "./insight-findings";

/**
 * Three real collections failed at three different gates, one per run, because a gate stops at its
 * first violation and the analysis agent had no way to see any of them before the run ended. Two of
 * those three are no longer reachable: `period` and the evidence notation are derived now, so the
 * mistakes that caused them are repaired before the gates run. The third — English prose the agent
 * wrote — cannot be derived from anything, and is the class this feedback is for.
 *
 * These tests hold that claim to real behaviour rather than to a description of it. Each recorded
 * failure signature is replayed through the actual derivation-then-validate sequence, taken from
 * `check-insights.ts` itself so it cannot fall behind, and the report is exercised by running it.
 *
 * Fixtures are built from `buildDemoSnapshot`, never from `public/data/snapshot.json`: pinning
 * published values is what PR #21 and PR #26 had to undo, because every real collection changes them.
 */

const SUBPROCESS_TIMEOUT = 120_000;
const TSX = join("node_modules", "tsx", "dist", "cli.mjs");

type Result = { status: number; output: string };

const run = promisify(execFile);

/**
 * Awaited rather than synchronous. These spawns take tens of seconds under a loaded suite, and a
 * blocking call holds the Vitest worker's event loop for that whole time, which shows up as the
 * runner losing contact with the worker rather than as a slow test.
 */
async function spawn(args: string[], cwd?: string): Promise<Result> {
  try {
    const { stdout, stderr } = await run(process.execPath, args, {
      encoding: "utf8",
      cwd,
      maxBuffer: 16 * 1024 * 1024
    });
    return { status: 0, output: `${stdout}${stderr}` };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { status: failure.code ?? 1, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

const demo = buildDemoSnapshot("2026-08-05T13:00:00.000Z");
/** Production publishes `AZURE`; validating a `DEMO` document would excuse gates production runs. */
const snapshot = { ...demo, mode: "AZURE" } as typeof demo;

function insightAt(index: number): (typeof snapshot)["aiInsights"][number] {
  const insight = snapshot.aiInsights[index];
  if (!insight) throw new Error(`demo fixture must publish at least ${index + 1} AI insight(s)`);
  return insight;
}

/**
 * The step list is read out of `check-insights.ts` rather than repeated here. A second copy of the
 * order would let this file keep passing after the real sequence changed, which is the drift the
 * whole design is trying not to introduce.
 */
function derivationSequence(): string[] {
  const check = readFileSync("scripts/check-insights.ts", "utf8");
  return [...check.matchAll(/^ {2}\["(scripts\/[\w-]+\.ts)", \[(.*?)\]\],?$/gm)]
    .map((match) => match[1] as string)
    .filter((script) => script.startsWith("scripts/normalize-"));
}

/** Runs the derivations, then the gates, over a throwaway copy of the candidate. */
async function deriveThenValidate(candidate: unknown): Promise<Result> {
  const directory = mkdtempSync(join(tmpdir(), "insight-findings-"));
  const target = join(directory, "snapshot.json");
  writeFileSync(target, JSON.stringify(candidate), "utf8");
  try {
    for (const script of derivationSequence()) {
      const derived = await spawn([TSX, script, target]);
      if (derived.status !== 0) return derived;
    }
    // Without `--insights-only`: the baseline diff compares against the committed published file,
    // which a fixture is not. Every gate the recorded failures hit runs either way.
    return await spawn([TSX, "scripts/validate-public-data.ts", target]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function validateOnly(candidate: unknown): Promise<Result> {
  const directory = mkdtempSync(join(tmpdir(), "insight-findings-raw-"));
  const target = join(directory, "snapshot.json");
  writeFileSync(target, JSON.stringify(candidate), "utf8");
  try {
    return await spawn([TSX, "scripts/validate-public-data.ts", target]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function report(candidate: unknown): Promise<Result> {
  const directory = mkdtempSync(join(tmpdir(), "insight-report-"));
  const target = join(directory, "snapshot.json");
  writeFileSync(target, JSON.stringify(candidate), "utf8");
  try {
    return await spawn([TSX, "scripts/insight-findings.ts", target]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/**
 * The `ServiceIssue` residue is the one run 31075793541 actually failed on. `id` is derived from the
 * insight's own content, so rewriting `observation` without re-deriving it would trip the identity
 * gate first and this fixture would prove nothing about the language gate.
 */
function leaking(index: number): (typeof snapshot)["aiInsights"][number] {
  const edited = {
    ...insightAt(index),
    observation: `Service Health に ${index + 2} 件の ServiceIssue が継続しています`
  };
  return { ...edited, id: deriveInsightId(edited) };
}

describe("recorded insight failures replayed through the derivations", () => {
  it("still runs a derivation before the gates", () => {
    expect(derivationSequence().length).toBeGreaterThan(0);
  });

  /**
   * Run 31037073625. The analysis wrote an ISO `period`, which reads as English on a Japanese page.
   * The pipeline derives `period` from `generatedAt` now, so the value the analysis wrote never
   * reaches a gate. Asserting that the same fixture fails without the derivation keeps this from
   * passing because the gate stopped checking.
   */
  it(
    "repairs the English period that failed run 31037073625",
    { timeout: SUBPROCESS_TIMEOUT },
    async () => {
      const candidate = {
        ...snapshot,
        aiInsights: snapshot.aiInsights.map((insight) => ({ ...insight, period: "2026-08-05" }))
      };

      expect((await validateOnly(candidate)).status).not.toBe(0);
      expect((await deriveThenValidate(candidate)).status).toBe(0);
    }
  );

  /**
   * Run 31071772340. The analysis addressed an array element as `cost.categories[0].sharePercent`.
   * The bracket form is produced from the fixture's own source path rather than written out, so this
   * cannot drift into asserting a value the demo fixture no longer publishes.
   */
  it(
    "repairs the bracket notation that failed run 31071772340",
    { timeout: SUBPROCESS_TIMEOUT },
    async () => {
      const first = insightAt(0);
      const evidence = first.numericEvidence[0];
      if (!evidence) throw new Error("demo fixture must publish at least one evidence item");
      const bracketed = evidence.source.replace(/\.(\d+)(?=\.)/gu, "[$1]");
      expect(bracketed).not.toBe(evidence.source);

      const candidate = {
        ...snapshot,
        aiInsights: [
          { ...first, numericEvidence: [{ ...evidence, source: bracketed }] },
          ...snapshot.aiInsights.slice(1)
        ]
      };

      expect((await validateOnly(candidate)).status).not.toBe(0);
      expect((await deriveThenValidate(candidate)).status).toBe(0);
    }
  );

  /**
   * Run 31075793541, and the reason this change exists: prose is not derivable, so no amount of
   * normalization removes this class. Only the author can, and only if it can see the finding.
   */
  it(
    "cannot repair the English prose that failed run 31075793541",
    { timeout: SUBPROCESS_TIMEOUT },
    async () => {
      const candidate = { ...snapshot, aiInsights: [leaking(0), ...snapshot.aiInsights.slice(1)] };
      const result = await deriveThenValidate(candidate);

      expect(result.status).not.toBe(0);
      expect(result.output).toContain("English prose in a Japanese dashboard");
    }
  );

  it(
    "accepts the Japanese technical abbreviations rejected by runs 33143695720 and 33454461097",
    { timeout: SUBPROCESS_TIMEOUT },
    async () => {
      for (const recommendedAction of [
        "BCP の観点から復旧手順を人が確認してください。",
        "メトリクス取得が可能なネットワークリソース（ロードバランサー、パブリック IP など）については、Azure Monitor でアラートを設定することを推奨します。詳細は /network ダッシュボードを参照してください。"
      ]) {
        const candidate = {
          ...snapshot,
          aiInsights: [{ ...insightAt(0), recommendedAction }, ...snapshot.aiInsights.slice(1)]
        };

        expect((await deriveThenValidate(candidate)).status).toBe(0);
      }
    }
  );
});

describe("insight findings report", () => {
  /**
   * The gate names one field. Repairing one field per run is what turned three mistakes into three
   * runs across several days, so the report has to name the ones the gate did not reach.
   */
  it("names every leaking field, not only the one the gate stopped at", { timeout: SUBPROCESS_TIMEOUT }, async () => {
    const candidate = {
      ...snapshot,
      aiInsights: [leaking(0), leaking(1), ...snapshot.aiInsights.slice(2)]
    };

    const gate = await validateOnly(candidate);
    expect(gate.status).not.toBe(0);
    // The gate reports a count and one path; the second one is invisible to the author.
    expect(gate.output).toContain("aiInsights[0].observation");
    expect(gate.output).not.toContain("aiInsights[1].observation");

    const result = await report(candidate);
    expect(result.status).toBe(0);
    expect(result.output).toContain("aiInsights[0].observation");
    expect(result.output).toContain("aiInsights[1].observation");
    expect(result.output).toContain("untranslated: ServiceIssue");
  });

  /**
   * This output reaches a public Actions log. PR #25 published real names through an error message,
   * so the report names where a value is wrong and which token is wrong, and does not echo the value:
   * it discloses strictly less per finding than the gate whose message it supplements.
   */
  it("reports the path and the offending token without echoing the prose", { timeout: SUBPROCESS_TIMEOUT }, async () => {
    const insight = leaking(0);
    const candidate = { ...snapshot, aiInsights: [insight, ...snapshot.aiInsights.slice(1)] };

    const result = await report(candidate);
    expect(result.output).toContain("aiInsights[0].observation");
    expect(result.output).not.toContain(insight.observation);
    // The gate does echo it, which is the asymmetry being claimed.
    expect((await validateOnly(candidate)).output).toContain(insight.observation);
  });

  /**
   * Advice must never become the reason a run fails or passes. Nothing it can do — including being
   * handed something it cannot parse — may change an exit code.
   */
  it("never fails, and never passes, a candidate", { timeout: SUBPROCESS_TIMEOUT }, async () => {
    expect((await report(snapshot)).status).toBe(0);
    expect(
      (await report({ ...snapshot, aiInsights: [leaking(0), ...snapshot.aiInsights.slice(1)] }))
        .status
    ).toBe(0);

    const directory = mkdtempSync(join(tmpdir(), "insight-report-broken-"));
    try {
      const target = join(directory, "snapshot.json");
      writeFileSync(target, "{ not json", "utf8");
      expect((await spawn([TSX, "scripts/insight-findings.ts", target])).status).toBe(0);
      expect(
        (await spawn([TSX, "scripts/insight-findings.ts", join(directory, "absent.json")])).status
      ).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  /** A snapshot with hundreds of leaks would otherwise bury the log rather than inform it. */
  it("caps how much it prints", () => {
    const many = Array.from({ length: 40 }, (_, index) => `aiInsights.${index}.title  untranslated: X`);
    const lines = formatInsightFindings(many).join("\n");

    expect(lines).toContain("aiInsights.0.title");
    expect(lines).not.toContain("aiInsights.39.title");
    expect(lines).toContain("more, hidden by the report cap");
    expect(formatInsightFindings([]).join("\n")).toContain("no further findings");
  });
});

describe("check-insights", () => {
  /**
   * A workspace the real command can run in. `check-insights` writes to `public/data/snapshot.json`
   * by design and compares the result against the committed baseline, so the published file is not
   * a usable fixture: this builds a throwaway repository instead, links the code in rather than
   * copying it, and commits a baseline whose only difference from the candidate is `aiInsights`.
   */
  async function withWorkspace(
    candidate: unknown,
    assert: (result: Result) => void
  ): Promise<void> {
    const workspace = mkdtempSync(join(tmpdir(), "insight-check-"));
    try {
      for (const directory of ["scripts", "src", "schemas", "node_modules"]) {
        symlinkSync(resolve(directory), join(workspace, directory), "junction");
      }
      copyFileSync("package.json", join(workspace, "package.json"));
      mkdirSync(join(workspace, "public", "data"), { recursive: true });
      const target = join(workspace, "public", "data", "snapshot.json");
      const git = (...args: string[]) =>
        execFileSync("git", args, { cwd: workspace, stdio: ["ignore", "ignore", "pipe"] });

      writeFileSync(target, JSON.stringify({ ...snapshot, aiInsights: [] }), "utf8");
      git("init", "-q");
      git("add", "public/data/snapshot.json");
      git(
        "-c",
        "user.email=test@example.invalid",
        "-c",
        "user.name=test",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-q",
        "--no-verify",
        "-m",
        "baseline"
      );
      writeFileSync(target, JSON.stringify(candidate), "utf8");

      assert(await spawn([resolve(TSX), resolve("scripts/check-insights.ts")], workspace));
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }

  /**
   * That the report is wired in, proved by running the real command rather than by finding the call
   * in the source. A commented-out call satisfies a substring assertion, which is how three
   * assertions in this repository were hollowed out before anyone noticed.
   */
  it("prints the report after a gate fails", { timeout: SUBPROCESS_TIMEOUT }, async () => {
    await withWorkspace(
      { ...snapshot, aiInsights: [leaking(0), leaking(1), ...snapshot.aiInsights.slice(2)] },
      (result) => {
        expect(result.status).not.toBe(0);
        expect(result.output).toContain("English prose in a Japanese dashboard");
        expect(result.output).toContain("[advisory]");
        expect(result.output).toContain("aiInsights[1].observation");
        expect(result.output).toContain("Insight check failed at scripts/validate-public-data.ts");
      }
    );
  });

  /**
   * The success line carries the count because the cheapest way to satisfy a gate is to publish
   * nothing, and a silent green run is how that would go unnoticed.
   */
  it("reports how many insights passed", { timeout: SUBPROCESS_TIMEOUT }, async () => {
    await withWorkspace({ ...snapshot, aiInsights: [] }, (result) => {
      expect(result.status).toBe(0);
      expect(result.output).toContain("on 0 insight(s)");
      expect(result.output).not.toContain("[advisory]");
    });
  });
});
