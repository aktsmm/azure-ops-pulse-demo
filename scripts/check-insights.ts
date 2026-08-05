import { spawnSync } from "node:child_process";

/**
 * The deterministic pass over an analysis candidate: it fills in the fields this pipeline derives
 * rather than writes, then checks schema, Japanese prose, evidence, baseline and privacy, in that
 * order and always in that order.
 *
 * The order is not the analysis agent's to choose. `period` and the evidence labels are derived
 * here, so validating before normalizing fails on fields the analysis was told not to write. Giving
 * the agent the commands and depending on it to run them in the right order does not work: a shell
 * allowlist matches a command prefix, so any granted command can be followed by another one. So the
 * agent is granted no command that touches its own output, and this runs afterwards instead.
 *
 * Running afterwards in the same job is fast feedback, not authority — the agent can write to that
 * workspace, including to this file. The authority is `publish-ai-insights.yml`, which derives
 * `period` and repeats every gate on trusted code from a fresh checkout of the default branch
 * before anything reaches the site.
 */
const steps: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["scripts/normalize-ai-insight-period.ts", ["public/data/snapshot.json"]],
  ["scripts/normalize-ai-insight-labels.ts", ["public/data/snapshot.json"]],
  ["scripts/validate-public-data.ts", ["public/data/snapshot.json", "--insights-only"]],
  ["scripts/privacy-scan.ts", ["public"]]
];

const extraArguments = process.argv.slice(2);
if (extraArguments.length > 0) {
  console.error(
    `This check takes no arguments, so that it always runs the same sequence. Received: ${extraArguments.join(" ")}`
  );
  process.exit(1);
}

for (const [script, args] of steps) {
  const result = spawnSync("npx", ["tsx", script, ...args], {
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) {
    console.error(`Insight check failed at ${script}. Nothing is published while it fails.`);
    process.exit(result.status ?? 1);
  }
}

console.log(
  "Insight check passed: derived period, derived evidence labels, schema, Japanese prose, evidence, baseline and privacy."
);
