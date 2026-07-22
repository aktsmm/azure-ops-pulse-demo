import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("AI insight publication gate", () => {
  it("does not compile a direct agent pull-request safe output", () => {
    const source = readFileSync(".github/workflows/ai-insights.md", "utf8");
    const lock = readFileSync(".github/workflows/ai-insights.lock.yml", "utf8");

    expect(source).not.toMatch(/^\s+create-pull-request:/m);
    expect(source).toContain("report-failure-as-issue: false");
    expect(source).toContain("report-incomplete: false");
    expect(lock).not.toContain("created_pr_url");
    expect(lock).not.toContain("pull-requests: write");
    const guard = lock.indexOf("Require successful trusted agent validation");
    const processing = lock.indexOf("Process Safe Outputs");
    expect(guard).toBeGreaterThan(-1);
    expect(processing).toBeGreaterThan(guard);
  });

  it("publishes only successful default-branch artifacts after deterministic validation", () => {
    const workflow = readFileSync(".github/workflows/publish-ai-insights.yml", "utf8");
    const validation = workflow.indexOf("Repeat schema, evidence, baseline, and privacy gates");
    const publication = workflow.indexOf("Open human-review draft pull request");

    expect(workflow).toContain("workflow_run.conclusion == 'success'");
    expect(workflow).toContain("workflow_run.head_branch == github.event.repository.default_branch");
    expect(workflow).toContain(
      "validate-public-data.ts .candidate/snapshot.json --insights-only --baseline=public/data/snapshot.json"
    );
    expect(workflow).toContain("privacy-scan.ts .candidate");
    expect(validation).toBeGreaterThan(-1);
    expect(publication).toBeGreaterThan(validation);
  });
});
