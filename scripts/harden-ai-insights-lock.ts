import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const LOCK_PATH = resolve(".github/workflows/ai-insights.lock.yml");
export const GH_AW_VERSION = "v0.88.7";
export const GH_AW_SETUP_SHA = "5e508589e03a7757a7e05b26e834292f5445bfb6";
const MANIFEST_PREFIX = "# gh-aw-manifest: ";
const JOB_HEADER = /^ {2}[A-Za-z0-9_-]+:\s*$/;
const STEP_HEADER = /^ {6}- /;

function findStepEnd(lines: string[], start: number): number {
  let end = start + 1;
  while (
    end < lines.length &&
    !STEP_HEADER.test(lines[end] ?? "") &&
    !JOB_HEADER.test(lines[end] ?? "")
  ) {
    end += 1;
  }
  return end;
}

function enforceOneDayUploadRetention(lines: string[]): number {
  let uploads = 0;

  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s+uses: actions\/upload-artifact@/.test(lines[index] ?? "")) continue;
    uploads += 1;

    const end = findStepEnd(lines, index);
    const retentionIndexes: number[] = [];
    for (let candidate = index + 1; candidate < end; candidate += 1) {
      if (/^\s+retention-days:/.test(lines[candidate] ?? "")) retentionIndexes.push(candidate);
    }

    if (retentionIndexes.length > 1) {
      throw new Error("Generated upload-artifact step contains multiple retention-days values");
    }
    const retentionIndex = retentionIndexes[0];
    if (retentionIndex !== undefined) {
      lines[retentionIndex] = "          retention-days: 1";
      continue;
    }

    let insertAt = end;
    while (insertAt > index && lines[insertAt - 1]?.trim() === "") insertAt -= 1;
    lines.splice(insertAt, 0, "          retention-days: 1");
    index = insertAt;
  }

  return uploads;
}

function getUploadBlocks(content: string): string[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s+uses: actions\/upload-artifact@/.test(lines[index] ?? "")) continue;

    let start = index;
    while (start > 0 && !STEP_HEADER.test(lines[start] ?? "")) start -= 1;
    const end = findStepEnd(lines, index);
    blocks.push(lines.slice(start, end).join("\n"));
  }
  return blocks;
}

function validateSecretDeclaration(lines: string[]): void {
  const manifestIndex = lines.findIndex((line) => line.startsWith(MANIFEST_PREFIX));
  if (manifestIndex === -1) throw new Error("Generated workflow is missing the gh-aw manifest");

  const manifest = JSON.parse(lines[manifestIndex]!.slice(MANIFEST_PREFIX.length)) as {
    secrets?: unknown;
  };
  if (!Array.isArray(manifest.secrets)) {
    throw new Error("Generated workflow manifest must contain a secrets array");
  }
  if (manifest.secrets.includes("COPILOT_GITHUB_TOKEN")) {
    throw new Error("Generated workflow must not require a long-lived Copilot token");
  }
}

export function hardenAgentWorkflowLock(
  content: string,
  workflow: "ai-insights" | "review-ai-insights" = "ai-insights"
): string {
  const lines = content.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");

  validateSecretDeclaration(lines);
  const uploadCount = enforceOneDayUploadRetention(lines);

  while (lines.at(-1) === "") lines.pop();
  const hardened = `${lines.join("\n")}\n`;
  if (!hardened.includes(`"compiler_version":"${GH_AW_VERSION}"`)) {
    throw new Error(`AI workflow must be compiled with exact gh-aw ${GH_AW_VERSION}`);
  }
  const setupActions = [...hardened.matchAll(/^\s+uses: (github\/gh-aw-actions\/setup@.+)$/gm)];
  if (setupActions.length === 0 || setupActions.some(
    ([, action]) => action !== `github/gh-aw-actions/setup@${GH_AW_SETUP_SHA} # ${GH_AW_VERSION}`
  )) {
    throw new Error(`AI workflow setup action must be pinned to gh-aw ${GH_AW_VERSION}`);
  }
  if (!hardened.includes("copilot-requests: write")) {
    throw new Error("Compiled AI workflow must use keyless Copilot authentication");
  }
  if (!hardened.includes("COPILOT_GITHUB_TOKEN: ${{ github.token }}")) {
    throw new Error("Copilot inference must use the ephemeral GitHub Actions token");
  }

  const forbidden = [
    "${{ secrets.COPILOT_GITHUB_TOKEN }}",
    "needs.activation.outputs.secret_verification_result",
    "GH_AW_DEFAULT_OTLP",
    "create_issue",
    "issues: write",
    "pull-requests: write",
    "discussions: write",
    "contents: write"
  ];
  for (const value of forbidden) {
    if (hardened.includes(value)) {
      throw new Error(`Compiled AI workflow still contains forbidden runtime content: ${value}`);
    }
  }
  for (const setting of [
    'GH_AW_NOOP_REPORT_AS_ISSUE: "false"',
    'GH_AW_FAILURE_REPORT_AS_ISSUE: "false"',
    'OTEL_EXPORTER_OTLP_ENDPOINT: ""',
    'OTEL_EXPORTER_OTLP_HEADERS: ""',
    'GH_AW_OTLP_ENDPOINTS: "[]"'
  ]) {
    if (!hardened.includes(setting)) {
      throw new Error(`Compiled AI workflow must preserve its non-publishing policy: ${setting}`);
    }
  }

  const uploadBlocks = getUploadBlocks(hardened);
  if (uploadBlocks.length !== uploadCount || uploadBlocks.length < 6) {
    throw new Error(`Expected all generated audit uploads, found ${uploadBlocks.length}`);
  }
  for (const block of uploadBlocks) {
    const retentions = block.match(/retention-days: 1/g) ?? [];
    if (retentions.length !== 1) {
      throw new Error("Every generated artifact upload must explicitly retain data for one day");
    }
  }

  const handoff = workflow === "ai-insights"
    ? { name: "validated-ai-insights", path: "public/data/snapshot.json" }
    : { name: "semantic-ai-review", path: "review-output/semantic-review.json" };
  const stagedPath = workflow === "ai-insights"
    ? "public/data/snapshot.json"
    : "review-output/verdict.json";
  const handlerConfigs = [...hardened.matchAll(/^\s+GH_AW_SAFE_OUTPUTS_HANDLER_CONFIG: (".*")$/gm)];
  if (handlerConfigs.length !== 1) throw new Error("Expected exactly one staged artifact configuration");
  const handler = JSON.parse(JSON.parse(handlerConfigs[0]![1]!) as string) as {
    upload_artifact?: Record<string, unknown>;
  };
  const upload = handler.upload_artifact;
  if (
    !upload ||
    JSON.stringify(upload["allowed-paths"]) !== JSON.stringify([stagedPath]) ||
    upload["max-size-bytes"] !== 1048576 ||
    upload["max-uploads"] !== 1 ||
    upload["retention-days"] !== 1 ||
    upload["skip-archive"] !== true
  ) {
    throw new Error("Agent-facing staged artifact must retain its exact bounded configuration");
  }
  // Check actual upload-step properties, not substrings a different step or extra path can satisfy.
  for (const expected of [
    handoff,
    { name: "safe-outputs-upload-artifacts", path: "${{ runner.temp }}/gh-aw/safeoutputs/upload-artifacts/" }
  ]) {
    const matching = uploadBlocks.filter((block) =>
      block.split("\n").some((line) => line === `          name: ${expected.name}`)
    );
    if (matching.length !== 1) {
      throw new Error(`Expected exactly one trusted handoff artifact: ${expected.name}`);
    }
    const block = matching[0]!;
    const properties = block.split("\n").filter((line) => /^ {10}\S/.test(line));
    if (
      properties.filter((line) => line.startsWith("          name:")).length !== 1 ||
      properties.filter((line) => line.startsWith("          path:")).length !== 1 ||
      !properties.includes(`          path: ${expected.path}`) ||
      block.split("\n").some((line) => /^ {11,}\S/.test(line))
    ) {
      throw new Error(`Artifact ${expected.name} must use its exact bounded path`);
    }
    if (expected === handoff && !properties.includes("          if-no-files-found: error")) {
      throw new Error("Trusted handoff artifact must fail when missing");
    }
  }

  return hardened;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const compiled = readFileSync(LOCK_PATH, "utf8");
  writeFileSync(LOCK_PATH, hardenAgentWorkflowLock(compiled), "utf8");
}
