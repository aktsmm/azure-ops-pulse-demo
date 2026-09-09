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

export function hardenAgentWorkflowLock(content: string): string {
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

  if (
    !/name: validated-ai-insights\n\s+path: public\/data\/snapshot\.json\n\s+retention-days: 1/.test(
      hardened
    )
  ) {
    throw new Error("Validated candidate must use the exact one-day trusted handoff artifact");
  }
  if (
    !/name: safe-outputs-upload-artifacts\n\s+path: \$\{\{ runner\.temp \}\}\/gh-aw\/safeoutputs\/upload-artifacts\/\n\s+retention-days: 1/.test(
      hardened
    )
  ) {
    throw new Error("Agent-facing staged output must remain separate from the trusted handoff");
  }

  return hardened;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const compiled = readFileSync(LOCK_PATH, "utf8");
  writeFileSync(LOCK_PATH, hardenAgentWorkflowLock(compiled), "utf8");
}
