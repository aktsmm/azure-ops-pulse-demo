import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { validateNumericEvidence } from "./evidence-validator";
import { validatePublicJsonSchema } from "./json-schema-validator";
import { validateInsightPeriods } from "./insight-period";
import { validateJapaneseInsights } from "./japanese-insights-validator";
import { validateUiLanguage } from "./ui-language-audit";
import { publicSnapshotSchema } from "./public-schema";

const file = resolve(process.argv[2] ?? "public/data/snapshot.json");
const insightsOnly = process.argv.includes("--insights-only");
const baselineArgument = process.argv
  .find((argument) => argument.startsWith("--baseline="))
  ?.slice("--baseline=".length);
const candidate = JSON.parse(await readFile(file, "utf8")) as unknown;
validatePublicJsonSchema(candidate);
const parsed = publicSnapshotSchema.parse(candidate);

validateNumericEvidence(parsed);
// Checked before the prose audit so the field the pipeline owns reports the rule it broke instead of
// being reported as bad Japanese. The prose audit still covers `period` afterwards, which is what
// catches a derivation that stopped producing Japanese rather than one the analysis overwrote.
validateInsightPeriods(parsed);
validateJapaneseInsights(parsed.aiInsights);

// Unconditional on purpose. The one artifact that predated the localised collector was excused by a
// pinned digest; the collection on 2026-08-05 replaced it, so the excuse expired exactly as designed
// and the branch is gone. Anything that skips this call — a digest, an environment check, a mode
// test — lets the dashboard publish English again, which is what `published-snapshot.test.ts`
// exercises by running this script over a snapshot carrying English.
validateUiLanguage(parsed);

if (insightsOnly) {
  const repositoryPath = relative(process.cwd(), file).replaceAll("\\", "/");
  if (repositoryPath.startsWith("../")) {
    throw new Error("Insights-only validation requires a file inside the repository");
  }
  let baseline: typeof parsed;
  try {
    const content = baselineArgument
      ? await readFile(resolve(baselineArgument), "utf8")
      : execFileSync("git", ["show", `HEAD:${repositoryPath}`], {
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
  `Validated ${insightsOnly ? "AI insights" : "public snapshot"} JSON Schema, runtime schema, Japanese prose, rendered UI language, and numeric evidence: ${file}`
);
