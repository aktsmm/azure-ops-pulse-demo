import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { publicSnapshotSchema } from "./public-schema";
import { validateNumericEvidence } from "./public-data-validation";

const file = resolve(process.argv[2] ?? "public/data/snapshot.json");
const insightsOnly = process.argv.includes("--insights-only");
const parsed = publicSnapshotSchema.parse(JSON.parse(await readFile(file, "utf8")));

validateNumericEvidence(parsed);

if (insightsOnly) {
  const repositoryPath = relative(process.cwd(), file).replaceAll("\\", "/");
  if (repositoryPath.startsWith("../")) {
    throw new Error("Insights-only validation requires a file inside the repository");
  }
  let baseline: typeof parsed;
  try {
    const baselineRef = process.env.BASELINE_REF ?? "HEAD";
    const content = execFileSync("git", ["show", `${baselineRef}:${repositoryPath}`], {
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
