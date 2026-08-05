import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDemoSnapshot } from "./build-demo-snapshot";
import {
  GH_AW_SETUP_SHA,
  GH_AW_VERSION,
  hardenAgentWorkflowLock
} from "./harden-ai-insights-lock";

const STEP_HEADER = /^ {6}- /;
const JOB_HEADER = /^ {2}[A-Za-z0-9_-]+:\s*$/;

function getUploadBlocks(workflow: string): string[] {
  const lines = workflow.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s+uses: actions\/upload-artifact@/.test(lines[index] ?? "")) continue;

    let start = index;
    while (start > 0 && !STEP_HEADER.test(lines[start] ?? "")) start -= 1;
    let end = index + 1;
    while (
      end < lines.length &&
      !STEP_HEADER.test(lines[end] ?? "") &&
      !JOB_HEADER.test(lines[end] ?? "")
    ) {
      end += 1;
    }
    blocks.push(lines.slice(start, end).join("\n"));
  }
  return blocks;
}

/** The lines under a top-level workflow key, up to the next unindented key. */
function getTopLevelBlock(workflow: string, key: string): string {
  const lines = workflow.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.startsWith(key));
  if (start === -1) return "";
  let end = start + 1;
  while (end < lines.length && !/^[A-Za-z]/u.test(lines[end] ?? "")) end += 1;
  return lines.slice(start, end).join("\n");
}

function getStepContaining(workflow: string, needle: string): string {
  const lines = workflow.replace(/\r\n/g, "\n").split("\n");
  const index = lines.findIndex((line) => line.includes(needle));
  if (index === -1) return "";

  let start = index;
  while (start > 0 && !STEP_HEADER.test(lines[start] ?? "")) start -= 1;
  let end = index + 1;
  while (
    end < lines.length &&
    !STEP_HEADER.test(lines[end] ?? "") &&
    !JOB_HEADER.test(lines[end] ?? "")
  ) {
    end += 1;
  }
  return lines.slice(start, end).join("\n");
}

/** Returns the shell lines a `run:` block executes, so assertions cannot be satisfied by `echo`. */
function getRunCommands(step: string): string[] {
  const lines = step.replace(/\r\n/gu, "\n").split("\n");
  const index = lines.findIndex((line) => /^\s+run:/u.test(line));
  if (index === -1) return [];

  const inline = lines[index]?.match(/^\s+run:\s*(?!\||>)(\S.*)$/u);
  if (inline?.[1]) return [inline[1].trim()];

  const indent = (lines[index] ?? "").search(/\S/u);
  const body: string[] = [];
  for (const line of lines.slice(index + 1)) {
    if (line.trim() === "") continue;
    if (line.search(/\S/u) <= indent) break;
    body.push(line.trim());
  }
  return body;
}

/** Returns a job block so job-level escapes are visible to the step's own guard. */
function getJob(workflow: string, name: string): string {
  const lines = workflow.replace(/\r\n/gu, "\n").split("\n");
  const start = lines.findIndex((line) => line === `  ${name}:`);
  if (start === -1) return "";

  let end = start + 1;
  while (end < lines.length && !JOB_HEADER.test(lines[end] ?? "")) end += 1;
  return lines.slice(start, end).join("\n");
}

describe("AI insight publication gate", () => {
  it("publishes validated snapshots and gates the site on the deployment result", () => {
    const collection = readFileSync(".github/workflows/collect-azure.yml", "utf8");

    expect(collection).toContain('cron: "0 21 * * 1,4"');
    expect(collection).toMatch(
      /permissions:\r?\n\s+actions: write\r?\n\s+contents: write\r?\n\s+id-token: write/
    );
    expect(collection).toContain("ref: ${{ github.event.repository.default_branch }}");
    expect(collection).toContain("Publish validated snapshot to main");
    expect(collection).toContain('git push origin "HEAD:${{ github.event.repository.default_branch }}"');
    expect(collection).toContain("Dispatch AI analysis");
    expect(collection).toContain("actions/workflows/ai-insights.lock.yml/dispatches");
    expect(collection).toContain("uses: ./.github/actions/await-pages-deployment");
    // A bare dispatch would publish to the branch and never learn whether the site received it.
    expect(collection).not.toContain("gh workflow run pages.yml");
    expect(collection).not.toContain("gh pr create");
    expect(collection).not.toContain("pull-requests: write");
  });

  it("fails the publishing workflow when the site deployment does not succeed", () => {
    const action = readFileSync(".github/actions/await-pages-deployment/action.yml", "utf8");
    const script = readFileSync(
      ".github/actions/await-pages-deployment/await-deployment.sh",
      "utf8"
    );

    expect(action).toContain('run: bash "$GITHUB_ACTION_PATH/await-deployment.sh"');
    expect(action).toMatch(/timeout-minutes:\r?\n(?:.*\r?\n)*?\s+default: "30"/);
    // Success is asserted positively so an unexpected conclusion can never pass the gate.
    expect(script).toContain('if [ "$conclusion" = "success" ]; then');
    // Waiting forever would turn a stuck deployment into a stuck collection instead of an alert.
    expect(script).toContain("deadline=$(( $(date +%s) + TIMEOUT_MINUTES * 60 ))");
    for (const failure of [
      "did not report a deployment run",
      "did not finish within $TIMEOUT_MINUTES minutes",
      "finished as '$conclusion'"
    ]) {
      expect(script).toContain("::error::");
      expect(script).toContain(failure);
    }
  });

  it("identifies the deployment it dispatched instead of guessing from timing", () => {
    const script = readFileSync(
      ".github/actions/await-pages-deployment/await-deployment.sh",
      "utf8"
    );

    // The dispatch endpoint reports the run it created from this API version onwards. Adopting the
    // newest run instead can adopt one allocated just before the dispatch, which builds a
    // pre-publication commit and would report success while the real deployment is still queued.
    expect(script).toContain("X-GitHub-Api-Version: 2026-03-10");
    expect(script).toMatch(
      /gh api -X POST \\\r?\n\s+"repos\/\$GITHUB_REPOSITORY\/actions\/workflows\/\$WORKFLOW\/dispatches"/
    );
    expect(script).toMatch(/workflow_run_id.*BASH_REMATCH\[1\]/s);
    expect(script).toContain('gh run view "$run_id"');
    expect(script).not.toContain("gh run list");
    expect(script).not.toContain('gh workflow run "$WORKFLOW"');
  });

  it("verifies the deployed site on every successful publication run", () => {
    const collection = readFileSync(".github/workflows/collect-azure.yml", "utf8");
    const insights = readFileSync(".github/workflows/publish-ai-insights.yml", "utf8");

    // Gating the deployment on a fresh commit would leave a previously failed deployment in place
    // forever: the branch already carries data the site never received, and a later run that
    // collects identical data would skip the deployment and preserve the mismatch. The whole step
    // is inspected because YAML key order is free, so a condition can sit after `uses:`.
    for (const workflow of [collection, insights]) {
      const step = getStepContaining(workflow, "uses: ./.github/actions/await-pages-deployment");
      expect(step).toContain("await-pages-deployment");
      expect(step).not.toContain("if:");
    }
  });

  it("keeps the deployment gate covered by executable scenarios", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    const scenarios = readFileSync(
      ".github/actions/await-pages-deployment/scenarios.test.sh",
      "utf8"
    );
    const handover = readFileSync(
      ".github/actions/await-analysis-run/scenarios.test.sh",
      "utf8"
    );

    expect(ci).toContain("bash .github/actions/await-pages-deployment/scenarios.test.sh");
    expect(ci).toContain("bash .github/actions/await-analysis-run/scenarios.test.sh");
    for (const covered of [
      "failed deployment fails caller",
      "cancellation past the deadline fails",
      "run never completes times out",
      "dispatch without a run id fails",
      "transient view errors are retried"
    ]) {
      expect(scenarios).toContain(`scenario "${covered}"`);
    }
    // A cancelled deployment never ran, so it must not be reported as success; retrying it keeps a
    // benign supersede from raising a false alarm without weakening that guarantee.
    expect(scenarios).toContain("cancelled run is retried and then succeeds");
    expect(scenarios).toContain("retry that fails still fails the caller");
    // Asserting only the exit status would pass even if the gate watched an unrelated run.
    expect(scenarios).toContain("never lists runs to guess the deployment");
    expect(scenarios).toContain("reads only the dispatched run");

    // The analysis handover has the same shape of failure: anything other than a successful run must
    // never reach the publisher, and a successful one must always reach it.
    for (const covered of [
      "successful analysis is published",
      "failed analysis is not published",
      "cancelled analysis is not published",
      "run never completes times out",
      "transient view errors are retried",
      "non-numeric run id fails"
    ]) {
      expect(handover).toContain(`scenario "${covered}"`);
    }
    // Exit status alone would accept a script that succeeded without handing the run on, which is
    // exactly the silent break this gate exists to catch.
    expect(handover).toContain("hands the run to the publisher");
    expect(handover).toContain("hands nothing to the publisher");
  });

  it("carries the analysis it dispatched through to the publisher", () => {
    const collection = readFileSync(".github/workflows/collect-azure.yml", "utf8");
    const insights = readFileSync(".github/workflows/publish-ai-insights.yml", "utf8");

    // GITHUB_TOKEN only creates runs through workflow_dispatch and repository_dispatch, so an
    // analysis the collection dispatches emits no workflow_run event when it finishes. Relying on
    // that event alone left every automated analysis unpublished while the collection reported
    // success, which is the silent staleness this gate exists to prevent.
    const dispatch = getStepContaining(collection, "name: Dispatch AI analysis");
    expect(dispatch).toContain("actions/workflows/ai-insights.lock.yml/dispatches");
    expect(dispatch).toContain("X-GitHub-Api-Version: 2026-03-10");
    expect(dispatch).toContain('echo "run-id=${BASH_REMATCH[1]}" >> "$GITHUB_OUTPUT"');

    const await_ = getStepContaining(collection, "name: Await the AI analysis");
    expect(await_).toContain("id: await-analysis");
    expect(await_).toContain("uses: ./.github/actions/await-analysis-run");
    expect(await_).toContain("run-id: ${{ steps.analysis.outputs.run-id }}");
    // A failed site deployment must not strand an analysis that is about to succeed, because
    // publishing its insights deploys the site again and repairs it.
    expect(await_).toContain("if: ${{ !cancelled() && steps.analysis.outputs.run-id != '' }}");

    // Calling the publisher rather than dispatching it makes its outcome part of this run. A
    // dispatch reports only that the run started, so a publisher that then failed would leave the
    // collection green with insights the site never received.
    expect(collection).toContain("uses: ./.github/workflows/publish-ai-insights.yml");
    expect(collection).toContain(
      "analysis-run-id: ${{ needs.collect.outputs.analysis-run-id }}"
    );
    expect(collection).toContain("analysis-run-id: ${{ steps.await-analysis.outputs.run-id }}");
    expect(collection).toContain(
      "if: ${{ !cancelled() && needs.collect.outputs.analysis-run-id != '' }}"
    );
    expect(collection).not.toContain("actions/workflows/publish-ai-insights.yml/dispatches");
    expect(insights).toContain("workflow_call:");
    // A public entry point would let anyone replay an old analysis over fresh insights.
    expect(insights).not.toContain("workflow_dispatch:");

    // A called workflow evaluates its own concurrency group in the caller's context, so reusing the
    // caller's group queues the call behind the run waiting for it and the whole run fails.
    expect(insights).toMatch(
      /group: \$\{\{ github\.event_name == 'workflow_run' && 'azure-pulse-publication' \|\| format\('azure-pulse-publication-nested-\{0\}', github\.run_id\) \}\}/
    );
    expect(collection).toContain("group: azure-pulse-publication");

    // The caller-supplied run id is attacker-controlled in a way the workflow_run payload is not, so
    // the publisher re-derives every condition its job guard asserts before trusting the artifact.
    expect(insights).toContain("analysis-run-id:");
    expect(insights).toContain("name: Resolve and verify the analysis run");
    expect(insights).toContain("expected_path=.github/workflows/ai-insights.lock.yml");
    expect(insights).toContain('[ "$path" = "$expected_path" ] || reject');
    expect(insights).toContain('[ "$conclusion" = success ] || reject');
    expect(insights).toContain('[ "$branch" = "$DEFAULT_BRANCH" ] || reject');
    expect(insights).toContain('[ "$repo" = "$GITHUB_REPOSITORY" ] || reject');
  });

  it("keeps collection scheduled and AI analysis event driven", () => {
    const agentSource = readFileSync(".github/workflows/ai-insights.md", "utf8");
    const agentLock = readFileSync(".github/workflows/ai-insights.lock.yml", "utf8");
    const readme = readFileSync("README.md", "utf8");

    expect(agentSource).toContain("workflow_dispatch:");
    expect(agentSource).not.toContain("schedule:");
    expect(agentSource).not.toContain('cron: "45 21 * * 1,4"');
    expect(agentLock).not.toContain("schedule:");
    expect(agentLock).not.toContain('cron: "45 21 * * 1,4"');
    expect(readme).toContain("火・金 06:00（JST）");
    expect(readme).toContain("検証済みsnapshotを`main`へ直接commit");
    expect(readme).not.toContain("火・金 06:45");
  });

  it("scans and refreshes the Azure collection candidate before direct publication", () => {
    const workflow = readFileSync(".github/workflows/collect-azure.yml", "utf8");
    const collection = workflow.indexOf("Collect directly into a sanitized candidate");
    const validation = workflow.indexOf(
      "Validate candidate JSON Schema, runtime schema, evidence, and privacy"
    );
    const privacyScan = workflow.indexOf("privacy-scan.ts .candidate");
    const refresh = workflow.indexOf("Refresh main and repeat candidate validation");
    const publication = workflow.indexOf("Publish validated snapshot to main");

    expect(collection).toBeGreaterThan(-1);
    expect(validation).toBeGreaterThan(collection);
    expect(privacyScan).toBeGreaterThan(validation);
    expect(refresh).toBeGreaterThan(privacyScan);
    expect(publication).toBeGreaterThan(refresh);
  });

  it("pins the compiler and compiles no public agent mutation", () => {
    const source = readFileSync(".github/workflows/ai-insights.md", "utf8");
    const lock = readFileSync(".github/workflows/ai-insights.lock.yml", "utf8");
    const actionsLock = readFileSync(".github/aw/actions-lock.json", "utf8");
    const deterministicValidation = readFileSync("scripts/validate-public-data.ts", "utf8");

    for (const output of [
      "create-issue",
      "create-discussion",
      "add-comment",
      "create-pull-request",
      "upload-asset"
    ]) {
      expect(source).not.toMatch(new RegExp(`^\\s+${output}:`, "m"));
    }
    expect(source).toContain("upload-artifact:");
    expect(source).toMatch(/allowed-paths:\r?\n\s+- public\/data\/snapshot\.json/);
    expect(source).toContain("retention-days: 1");
    expect(source).toContain("staged: true");
    expect(source).toContain("activation-comments: false");
    expect(source).toContain("report-failure-as-issue: false");
    expect(source).toContain("report-incomplete: false");
    expect(source).toMatch(/permissions:\r?\n\s+contents: read\r?\n\s+copilot-requests: write/);
    expect(lock).toContain("copilot-requests: write");
    expect(lock).toContain("COPILOT_GITHUB_TOKEN: ${{ github.token }}");
    expect(lock).not.toContain("${{ secrets.COPILOT_GITHUB_TOKEN }}");
    expect(lock).not.toMatch(
      /^# gh-aw-manifest: .*"secrets":\[[^\]]*"COPILOT_GITHUB_TOKEN"/m
    );
    expect(lock).not.toContain("needs.activation.outputs.secret_verification_result");
    expect(lock).not.toContain('"create_issue"');
    expect(lock).not.toContain("created_issue_url");
    expect(lock).not.toContain("created_pr_url");
    expect(lock).not.toContain("issues: write");
    expect(lock).not.toContain("discussions: write");
    expect(lock).not.toContain("pull-requests: write");
    expect(lock).not.toContain("contents: write");
    expect(lock).toContain(`"compiler_version":"${GH_AW_VERSION}"`);
    expect(lock).toContain(`github/gh-aw-actions/setup@${GH_AW_SETUP_SHA} # ${GH_AW_VERSION}`);
    expect(actionsLock).toContain(`"github/gh-aw-actions/setup@${GH_AW_VERSION}"`);
    expect(actionsLock).toContain(`"sha": "${GH_AW_SETUP_SHA}"`);
    expect(lock).toContain("Process Safe Outputs");
    expect(lock).toMatch(/^ {2}safe_outputs:\r?\n(?:.*\r?\n){1,10}? {4}permissions: \{\}$/m);
    expect(lock).toContain('GH_AW_SAFE_OUTPUTS_STAGED: "true"');
    expect(lock).toContain('GH_AW_SAFE_OUTPUTS_HANDLER_CONFIG: "{\\"upload_artifact\\"');
    expect(source).toContain("Analyze only `public/data/snapshot.json`");
    expect(source).toContain(
      "Validate generated insight JSON Schema, runtime schema, Japanese prose, evidence, and privacy"
    );
    expect(source).toContain("normalize-ai-insight-labels.ts");
    expect(source).toContain("never copy an English-only metric label or source path");
    expect(deterministicValidation).toContain("validateJapaneseInsights(parsed.aiInsights)");
    expect(source).toContain("Do not inspect Azure, workflow secrets,");
    expect(source).toContain("logs, artifacts, commit history, or external services");
    expect(hardenAgentWorkflowLock(lock)).toBe(lock.replace(/\r\n/g, "\n"));
  });

  it("retains every compiler audit and candidate artifact for one day", () => {
    const lock = readFileSync(".github/workflows/ai-insights.lock.yml", "utf8");
    const uploads = getUploadBlocks(lock);

    expect(uploads.length).toBeGreaterThanOrEqual(6);
    for (const upload of uploads) {
      expect(upload.match(/retention-days: 1/g)).toHaveLength(1);
    }
    for (const name of [
      "activation",
      "safe-outputs-upload-artifacts",
      "validated-ai-insights",
      "agent",
      "usage",
      "aic-usage-cache"
    ]) {
      expect(lock).toContain(`name: ${name}`);
    }
    expect(lock).toMatch(
      /name: validated-ai-insights\r?\n\s+path: public\/data\/snapshot\.json\r?\n\s+retention-days: 1/
    );
    expect(lock.indexOf("Redact secrets in logs")).toBeLessThan(
      lock.indexOf("Upload agent artifacts")
    );
  });

  it("bounds the direct candidate before its exact artifact upload", () => {
    const source = readFileSync(".github/workflows/ai-insights.md", "utf8");
    const verification = source.indexOf("Verify bounded candidate handoff");
    const upload = source.indexOf("Upload validated insight candidate");

    expect(source).toContain('candidate_path="public/data/snapshot.json"');
    expect(source).toContain("-type f -name 'snapshot.json'");
    expect(source).toContain('[ -L "$candidate_path" ]');
    expect(source).toContain('candidate_size="$(wc -c < "$candidate_path")"');
    expect(source).toContain('[ "$candidate_size" -gt 1048576 ]');
    expect(source).toContain("steps.bound_candidate.outcome == 'success'");
    expect(verification).toBeGreaterThan(-1);
    expect(upload).toBeGreaterThan(verification);
  });

  it("publishes only successful default-branch artifacts after deterministic validation", () => {
    const workflow = readFileSync(".github/workflows/publish-ai-insights.yml", "utf8");
    const validation = workflow.indexOf(
      "Repeat JSON Schema, runtime schema, Japanese, evidence, baseline, and privacy gates"
    );
    const trustedUpload = workflow.indexOf("Upload trusted candidate");
    const publication = workflow.indexOf("Publish validated AI insights to main");

    expect(workflow).toContain("workflow_run.conclusion == 'success'");
    expect(workflow).toContain(
      "workflow_run.head_repository.full_name == github.repository"
    );
    expect(workflow).toContain("workflow_run.head_branch == github.event.repository.default_branch");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("Verify candidate artifact scope");
    expect(workflow).toContain('"${candidate_files[0]}" != "snapshot.json"');
    expect(workflow).toContain('test "$(wc -c < .candidate/snapshot.json)" -le 1048576');
    expect(workflow).toContain("run: npm ci --ignore-scripts");
    expect(workflow).toContain(
      "validate-public-data.ts .candidate/snapshot.json --insights-only --baseline=public/data/snapshot.json"
    );
    expect(workflow).toContain("privacy-scan.ts .candidate");
    expect(workflow).toContain("retention-days: 1");
    expect(workflow).toContain("name: validated-ai-insights");
    expect(workflow).toContain("run-id: ${{ steps.analysis.outputs.run-id }}");
    expect(workflow).not.toContain("pattern:");
    expect(workflow).toMatch(/permissions:\r?\n\s+actions: write\r?\n\s+contents: write/);
    expect(workflow).toContain(
      'git push origin "HEAD:${{ github.event.repository.default_branch }}"'
    );
    expect(workflow).toContain("Deploy to Pages and fail if the site does not receive these insights");
    expect(workflow).toContain("uses: ./.github/actions/await-pages-deployment");
    expect(workflow).not.toContain("gh workflow run pages.yml");
    expect(workflow).not.toContain("pull-requests: write");
    expect(workflow).not.toContain("gh pr create");
    expect(workflow).not.toContain("issues: write");
    expect(workflow).not.toContain("discussions: write");
    expect(workflow).toContain("needs: validate");
    expect(validation).toBeGreaterThan(-1);
    expect(trustedUpload).toBeGreaterThan(validation);
    expect(publication).toBeGreaterThan(trustedUpload);
  });
});

describe("DEMO snapshot validation gate", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  const step = getStepContaining(ci, "name: Generate and validate the DEMO snapshot");
  const commands = getRunCommands(step);
  const GENERATE = 'OUTPUT_PATH="$RUNNER_TEMP/demo-snapshot.json" npm run generate:demo';
  const VALIDATE = 'npx tsx scripts/validate-public-data.ts "$RUNNER_TEMP/demo-snapshot.json"';

  it("runs the generator and the validator as the step's only commands", () => {
    // `toContain` on the whole step also passes for `echo "npm run generate:demo"`, so the
    // assertions are made against the command lines the shell would execute. Requiring the exact
    // list — not just that both lines appear — is what stops the pair from being wrapped in
    // `if false; then ... fi`, which keeps them present while they never run.
    expect(commands).toEqual([GENERATE, VALIDATE]);
  });

  it("writes the DEMO artifact outside the published data file", () => {
    // The generator's default destination is already outside `public/`, and this keeps the CI run
    // from depending on that: an explicit temp path means a regression in the default cannot make
    // the pipeline overwrite published data.
    expect(step).not.toMatch(/public\/data\/snapshot\.json/u);
    expect(commands.some((line) => line.includes("$RUNNER_TEMP/demo-snapshot.json"))).toBe(true);
  });

  it("cannot be switched off without deleting it", () => {
    // A condition or a swallowed exit code leaves the step listed in the workflow while it stops
    // failing the run, which is the shape a guard rots into.
    expect(step).not.toMatch(/^\s+if:/mu);
    expect(step).not.toContain("continue-on-error");
    for (const command of commands) {
      expect(command).not.toMatch(/\|\||;\s*(?:true|:)\s*$|set \+e/u);
    }
  });

  it("cannot be skipped by narrowing what CI triggers on", () => {
    // A path filter switches the guard off from outside the step, and takes this test with it: a
    // `paths-ignore` naming the DEMO fixture stops the whole workflow on exactly the commits the
    // gate exists to inspect, while every assertion above still reads as satisfied.
    const triggers = getTopLevelBlock(ci, "on:");
    expect(triggers).not.toMatch(/^\s+paths(?:-ignore)?:/mu);
    expect(triggers).toMatch(/^\s+pull_request:/mu);
  });

  it("keeps the commands on their own lines under a shell that stops at the first failure", () => {
    // A folded scalar (`run: >`) joins the lines into one command, so the generator's exit code
    // stops being the step's exit code. An explicit `shell:` at either level replaces the default
    // `bash -e`, which is what makes the first command's failure end the step.
    expect(step).toMatch(/^\s+run: \|\s*$/mu);
    expect(step).not.toMatch(/^\s+shell:/mu);
    expect(getJob(ci, "quality")).not.toMatch(/^\s{4,6}shell:/mu);
    expect(ci).not.toMatch(/^\s*defaults:/mu);
  });

  it("keeps the job that hosts it failing on error", () => {
    const job = getJob(ci, "quality");

    expect(job).toContain("name: Generate and validate the DEMO snapshot");
    expect(job).not.toMatch(/^\s{4}continue-on-error:/mu);
    expect(job).not.toMatch(/^\s{4}if:/mu);
  });

  // Spawning the real validator costs a TypeScript startup, which exceeds the default per-test
  // budget when the whole suite competes for the machine.
  it("keeps the rendered-language check inside deterministic validation", { timeout: 60_000 }, () => {
    const snapshot = buildDemoSnapshot("2026-08-05T13:00:00.000Z");
    const [first, ...rest] = snapshot.inventory.resources;
    if (!first) throw new Error("demo fixture must publish at least one resource");
    const leaking = {
      ...snapshot,
      inventory: {
        ...snapshot.inventory,
        resources: [{ ...first, change: "Collected from Azure Resource Graph" }, ...rest]
      }
    };
    const file = join(mkdtempSync(join(tmpdir(), "ops-pulse-lang-")), "snapshot.json");
    writeFileSync(file, JSON.stringify(leaking), "utf8");

    // Asserting that the script merely mentions the audit would pass on a commented-out call, so
    // this runs the script the publishing workflow runs and requires it to reject the snapshot.
    expect(() =>
      execFileSync("npx", ["tsx", "scripts/validate-public-data.ts", file], {
        stdio: "pipe",
        shell: process.platform === "win32"
      })
    ).toThrow();
  });
});
