import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(".github/workflows/ai-insights.md", "utf8");
const lock = readFileSync(".github/workflows/ai-insights.lock.yml", "utf8");
const publicationGate = readFileSync(".github/workflows/validate-ai-insights.yml", "utf8");

describe("AI insight publication safety", () => {
  it("clears every safe-output artifact before failing post-validation", () => {
    expect(source).toContain("if: always()");
    expect(source).toContain("AGENT_OUTCOME: ${{ steps.agentic_execution.outcome }}");
    expect(source).toContain(`printf '{"items":[]}\\n' > /tmp/gh-aw/agent_output.json`);
    expect(source).toContain(": > /tmp/gh-aw/safeoutputs.jsonl");
    expect(source).toContain(': > "$GH_AW_SAFE_OUTPUTS"');
    expect(lock.indexOf('printf \'{\\"items\\":[]}\\\\n\'')).toBeGreaterThan(-1);
    expect(lock.indexOf("Validate generated insight schema")).toBeLessThan(
      lock.indexOf("Upload agent artifacts")
    );
  });

  it("limits agent-created pull requests to non-merging drafts", () => {
    expect(lock).toContain('"auto_merge":false');
    expect(lock).toContain('"draft":true');
    expect(lock).toContain('"allowed_files":["public/data/snapshot.json"]');
  });

  it("uses a trusted workflow to validate and publish the bot draft", () => {
    expect(publicationGate).toContain("pull_request_target:");
    expect(publicationGate).toContain("ref: ${{ github.event.pull_request.base.sha }}");
    expect(publicationGate).toContain("sparse-checkout: public/data/snapshot.json");
    expect(publicationGate).toContain('git -C candidate diff --name-only "$BASE_SHA...$HEAD_SHA"');
    expect(publicationGate).toContain("needs: validate");
    expect(publicationGate).toContain(
      "github.event.pull_request.head.repo.full_name == github.repository"
    );
    expect(publicationGate).toContain("gh pr ready");
  });
});
