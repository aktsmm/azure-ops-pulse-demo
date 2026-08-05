import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
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
    expect(collection).toContain(
      'gh workflow run ai-insights.lock.yml --ref "${{ github.event.repository.default_branch }}"'
    );
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

    expect(ci).toContain("bash .github/actions/await-pages-deployment/scenarios.test.sh");
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
    expect(workflow).toContain("run-id: ${{ github.event.workflow_run.id }}");
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
