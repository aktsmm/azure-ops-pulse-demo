import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { publicSnapshotSchema } from "./public-schema";

const file = resolve(process.argv[2] ?? "public/data/snapshot.json");
const insightsOnly = process.argv.includes("--insights-only");
const parsed = publicSnapshotSchema.parse(JSON.parse(await readFile(file, "utf8")));

function valueAtPath(root: unknown, path: string): unknown {
  let current = root;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function numericTokens(value: unknown): string[] {
  return String(value).match(/\d+(?:\.\d+)?/g) ?? [];
}

for (const insight of parsed.aiInsights) {
  for (const evidence of insight.numericEvidence) {
    const sourceValue = valueAtPath(parsed, evidence.source);
    if (sourceValue === undefined || (typeof sourceValue !== "string" && typeof sourceValue !== "number")) {
      throw new Error(
        `Insight "${insight.title}" cites an invalid scalar source: ${evidence.source}`
      );
    }
    const citedNumbers = numericTokens(evidence.value);
    const sourceNumbers = numericTokens(sourceValue);
    if (!citedNumbers.length || !citedNumbers.some((number) => sourceNumbers.includes(number))) {
      throw new Error(
        `Insight "${insight.title}" cites ${evidence.value} but ${evidence.source} contains ${String(sourceValue)}`
      );
    }
  }
}

if (insightsOnly) {
  const repositoryPath = relative(process.cwd(), file).replaceAll("\\", "/");
  if (repositoryPath.startsWith("../")) {
    throw new Error("Insights-only validation requires a file inside the repository");
  }
  let baseline: typeof parsed;
  try {
    const content = execFileSync("git", ["show", `HEAD:${repositoryPath}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    baseline = publicSnapshotSchema.parse(JSON.parse(content));
  } catch {
    throw new Error("Unable to load the committed baseline for insights-only validation");
  }
  const currentWithoutInsights = { ...parsed, aiInsights: [] };
  const baselineWithoutInsights = { ...baseline, aiInsights: [] };
  if (!isDeepStrictEqual(currentWithoutInsights, baselineWithoutInsights)) {
    throw new Error("AI workflow changed fields outside aiInsights");
  }
}

console.log(
  `Validated ${insightsOnly ? "AI insights" : "public snapshot"} schema and numeric evidence: ${file}`
);
