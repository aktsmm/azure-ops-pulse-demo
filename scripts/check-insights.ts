import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * The deterministic pass over an analysis candidate: it repairs the notation of the machine-checked
 * fields, fills in the fields this pipeline derives rather than writes, and then checks schema,
 * Japanese prose, evidence, baseline and privacy, in that order and always in that order.
 *
 * Every step before the checks is ordered by what it reads. Notation runs first because everything
 * after it reads values the analysis may have spelled its own way; ids run last because they are
 * derived from the content the earlier steps just settled.
 *
 * The order is not the analysis agent's to choose, and that is what makes it safe to hand the agent
 * this command. `period`, the ids and the evidence labels are derived here, so a validator run on
 * its own would fail on fields the analysis was told not to write. Bundling derivation and checks
 * into one argument-refusing command removes that choice: there is no way to reach the gates through
 * it without the derivations having run first.
 *
 * Running here, in the agent's own job, is fast feedback and never authority — the agent can write
 * to that workspace, including to this file, so a pass reported here proves nothing. The authority
 * is `publish-ai-insights.yml`, which derives `period` and repeats every gate on trusted code from a
 * fresh checkout of the default branch before anything reaches the site. Feedback that cannot be
 * trusted is still worth giving: a candidate the agent has already checked is more likely to survive
 * the publisher, and a candidate it lied about fails there exactly as it does today.
 */
const steps: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["scripts/normalize-ai-insight-notation.ts", ["public/data/snapshot.json"]],
  ["scripts/normalize-ai-insight-period.ts", ["public/data/snapshot.json"]],
  ["scripts/normalize-ai-insight-labels.ts", ["public/data/snapshot.json"]],
  ["scripts/normalize-ai-insight-ids.ts", ["public/data/snapshot.json"]],
  ["scripts/validate-public-data.ts", ["public/data/snapshot.json", "--insights-only"]],
  ["scripts/privacy-scan.ts", ["public"]]
];

const CANDIDATE = "public/data/snapshot.json";
const GATE_SCRIPT = "scripts/validate-public-data.ts";
const FINDINGS_REPORT = "scripts/insight-findings.ts";

const extraArguments = process.argv.slice(2);
if (extraArguments.length > 0) {
  console.error(
    `This check takes no arguments, so that it always runs the same sequence. Received: ${extraArguments.join(" ")}`
  );
  process.exit(1);
}

function run(script: string, args: readonly string[]) {
  return spawnSync("npx", ["tsx", script, ...args], {
    stdio: "inherit",
    shell: process.platform === "win32"
  });
}

/**
 * A gate stops at its first violation, which turns a repair into one round trip per field. After a
 * real failure — never instead of one — list the rest. The report cannot change the outcome: the
 * failing status is captured before it runs and returned unchanged afterwards.
 */
function reportRemainingFindings(): void {
  run(FINDINGS_REPORT, [CANDIDATE]);
}

function publishedInsightCount(): string {
  try {
    const candidate = JSON.parse(readFileSync(CANDIDATE, "utf8")) as { aiInsights?: unknown };
    return Array.isArray(candidate.aiInsights) ? String(candidate.aiInsights.length) : "an unreadable number of";
  } catch {
    return "an unreadable number of";
  }
}

for (const [script, args] of steps) {
  const result = run(script, args);
  if (result.status !== 0) {
    const status = result.status ?? 1;
    if (script === GATE_SCRIPT) reportRemainingFindings();
    console.error(`Insight check failed at ${script}. Nothing is published while it fails.`);
    process.exit(status);
  }
}

console.log(
  `Insight check passed on ${publishedInsightCount()} insight(s): repaired notation, derived period, derived evidence labels, derived ids, schema, Japanese prose, evidence, baseline and privacy.`
);
