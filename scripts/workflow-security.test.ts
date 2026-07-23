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

describe("AI insight publication gate", () => {
  it("scans the Azure collection candidate before promotion and PR creation", () => {
    const workflow = readFileSync(".github/workflows/collect-azure.yml", "utf8");
    const collection = workflow.indexOf("Collect directly into a sanitized candidate");
    const validation = workflow.indexOf("Validate candidate schema, evidence, and privacy");
    const privacyScan = workflow.indexOf("privacy-scan.ts .candidate");
    const promotion = workflow.indexOf("Promote candidate in the ephemeral checkout");
    const pullRequest = workflow.indexOf("Open review-gated snapshot pull request");

    expect(collection).toBeGreaterThan(-1);
    expect(validation).toBeGreaterThan(collection);
    expect(privacyScan).toBeGreaterThan(validation);
    expect(promotion).toBeGreaterThan(privacyScan);
    expect(pullRequest).toBeGreaterThan(promotion);
  });

  it("pins the compiler and compiles no public agent mutation", () => {
    const source = readFileSync(".github/workflows/ai-insights.md", "utf8");
    const lock = readFileSync(".github/workflows/ai-insights.lock.yml", "utf8");
    const actionsLock = readFileSync(".github/aw/actions-lock.json", "utf8");

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
    expect(source).toContain("Do not inspect Azure, workflow secrets,");
    expect(source).toContain("logs, artifacts, commit history, or external services");
    expect(hardenAgentWorkflowLock(lock)).toBe(lock);
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
    const validation = workflow.indexOf("Repeat schema, evidence, baseline, and privacy gates");
    const trustedUpload = workflow.indexOf("Upload trusted candidate");
    const publication = workflow.indexOf("Open human-review draft pull request");

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
    expect(workflow.match(/(?:contents|pull-requests): write/g)).toHaveLength(2);
    expect(workflow).not.toContain("issues: write");
    expect(workflow).not.toContain("discussions: write");
    expect(workflow).toContain("needs: validate");
    expect(validation).toBeGreaterThan(-1);
    expect(trustedUpload).toBeGreaterThan(validation);
    expect(publication).toBeGreaterThan(trustedUpload);
  });
});
