import { spawnSync } from "node:child_process";

/**
 * The single command the analysis agent is allowed to run against its own output.
 *
 * It exists because the order matters and the order must not be the model's to choose. `period` and
 * the evidence labels are derived by this pipeline rather than written by the analysis, so validating
 * before normalizing fails on fields the analysis was told not to write. The agent's guardrails then
 * tell it to leave the existing insights alone, and the run ends green having published nothing —
 * the silent no-op this repository refuses to ship.
 *
 * Granting the normalization and the validation as two allowlist entries did not prevent that: the
 * agent could still run them in the wrong order. Granting one npm script did not prevent it either,
 * because a shell allowlist matches a command prefix and `npm run` keeps reading flags after it, so
 * `npm run check:insights --prefix <elsewhere> --if-present` exits 0 without checking anything. This
 * entry point takes no arguments at all and rejects them loudly, so the only thing the granted
 * command can do is the whole sequence.
 *
 * It is a convenience for the agent, not a security boundary. The authority lives in
 * `publish-ai-insights.yml`, which repeats these gates from a fresh checkout of the default branch
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
