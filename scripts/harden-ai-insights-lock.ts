import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const LOCK_PATH = resolve(".github/workflows/ai-insights.lock.yml");
const JOB_HEADER = /^ {2}[A-Za-z0-9_-]+:\s*$/;
const STEP_HEADER = /^ {6}- /;

function removeJob(lines: string[], jobName: string): void {
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  if (start < 0) return;

  let end = start + 1;
  while (end < lines.length && !JOB_HEADER.test(lines[end] ?? "")) end += 1;
  lines.splice(start, end - start);
}

function removeNamedStep(lines: string[], stepName: string): void {
  const marker = `      - name: ${stepName}`;
  const markerIndex = lines.findIndex((line) => line === marker);
  if (markerIndex < 0) return;

  const start =
    markerIndex > 0 && lines[markerIndex - 1]?.trimStart().startsWith("#")
      ? markerIndex - 1
      : markerIndex;
  let end = markerIndex + 1;
  while (
    end < lines.length &&
    !STEP_HEADER.test(lines[end] ?? "") &&
    !JOB_HEADER.test(lines[end] ?? "")
  ) {
    end += 1;
  }
  lines.splice(start, end - start);
}

export function hardenAgentWorkflowLock(content: string): string {
  const lines = content.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");

  for (const step of ["Upload upload-artifact staging", "Upload agent artifacts"]) {
    removeNamedStep(lines, step);
  }
  for (const job of ["conclusion", "safe_outputs"]) {
    removeJob(lines, job);
  }

  while (lines.at(-1) === "") lines.pop();
  const hardened = `${lines.join("\n")}\n`;
  const forbidden = [
    "create_issue",
    "issues: write",
    "Process Safe Outputs",
    "Upload agent artifacts",
    "Upload upload-artifact staging"
  ];
  for (const value of forbidden) {
    if (hardened.includes(value)) {
      throw new Error(`Compiled AI workflow still contains forbidden runtime content: ${value}`);
    }
  }

  const uploadSteps = hardened.match(/^\s+uses: actions\/upload-artifact@/gm) ?? [];
  if (uploadSteps.length !== 2) {
    throw new Error(`Expected only activation and validated-candidate uploads, found ${uploadSteps.length}`);
  }
  if (
    !/name: validated-ai-insights\n\s+path: public\/data\/snapshot\.json\n\s+retention-days: 1/.test(
      hardened
    )
  ) {
    throw new Error("Validated candidate must be the only one-day agent output artifact");
  }

  return hardened;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const compiled = readFileSync(LOCK_PATH, "utf8");
  writeFileSync(LOCK_PATH, hardenAgentWorkflowLock(compiled), "utf8");
}
