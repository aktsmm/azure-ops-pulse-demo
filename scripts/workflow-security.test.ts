import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hardenAgentWorkflowLock } from "./harden-ai-insights-lock";

describe("AI insight publication gate", () => {
  it("compiles no public agent safe output", () => {
    const source = readFileSync(".github/workflows/ai-insights.md", "utf8");
    const lock = readFileSync(".github/workflows/ai-insights.lock.yml", "utf8");

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
    expect(source).toContain("activation-comments: false");
    expect(source).toContain("report-failure-as-issue: false");
    expect(source).toContain("report-incomplete: false");
    expect(lock).not.toContain('"create_issue"');
    expect(lock).not.toContain("created_issue_url");
    expect(lock).not.toContain("created_pr_url");
    expect(lock).not.toContain("issues: write");
    expect(lock).not.toContain("discussions: write");
    expect(lock).not.toContain("pull-requests: write");
    expect(lock).not.toContain("Process Safe Outputs");
    expect(lock).not.toContain("Upload agent artifacts");
    expect(lock).not.toContain("Upload upload-artifact staging");
    expect(hardenAgentWorkflowLock(lock)).toBe(lock);
  });

  it("retains no unvalidated agent output artifact", () => {
    const lock = readFileSync(".github/workflows/ai-insights.lock.yml", "utf8");
    const uploads = lock.match(/^\s+uses: actions\/upload-artifact@/gm) ?? [];

    expect(uploads).toHaveLength(2);
    expect(lock).toContain("name: activation");
    expect(lock).toMatch(
      /name: validated-ai-insights\r?\n\s+path: public\/data\/snapshot\.json\r?\n\s+retention-days: 1/
    );
    for (const rawPath of [
      "/logs/",
      "safeoutputs.jsonl",
      "agent_output.json",
      "agent-stdio.log"
    ]) {
      const uploadBlocks = lock.match(
        /uses: actions\/upload-artifact@[^\n]+\n(?:[^\n]*\n)*?(?= {6}- | {2}[A-Za-z0-9_-]+:|$)/g
      );
      expect(uploadBlocks?.join("\n") ?? "").not.toContain(rawPath);
    }
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
    expect(workflow).toContain("run: npm ci --ignore-scripts");
    expect(workflow).toContain(
      "validate-public-data.ts .candidate/snapshot.json --insights-only --baseline=public/data/snapshot.json"
    );
    expect(workflow).toContain("privacy-scan.ts .candidate");
    expect(workflow).toContain("retention-days: 1");
    expect(workflow).toContain("needs: validate");
    expect(validation).toBeGreaterThan(-1);
    expect(trustedUpload).toBeGreaterThan(validation);
    expect(publication).toBeGreaterThan(trustedUpload);
  });
});
