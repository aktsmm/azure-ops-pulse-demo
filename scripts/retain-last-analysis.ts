import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { validateNumericEvidence } from "./evidence-validator";
import { validateInsightIds } from "./insight-identity";
import { validateInsightPeriods } from "./insight-period";
import { validateJapaneseInsights } from "./japanese-insights-validator";
import { validatePublicJsonSchema } from "./json-schema-validator";
import { scanJson } from "./privacy-rules";
import { publicSnapshotSchema } from "./public-schema";
import { validateUiLanguage } from "./ui-language-audit";

export const LAST_ANALYSIS_PATH = "public/data/last-analysis.json";
export const MAX_ANALYSIS_BYTES = 1_048_576;

/** Historical analysis keeps its original evidence, collection time and exact published bytes. */
export function validateRetainedAnalysis(content: string) {
  if (Buffer.byteLength(content, "utf8") > MAX_ANALYSIS_BYTES) {
    throw new Error("Retained analysis exceeds the single-snapshot size limit.");
  }
  const candidate: unknown = JSON.parse(content);
  validatePublicJsonSchema(candidate);
  const snapshot = publicSnapshotSchema.parse(candidate);
  if (snapshot.mode !== "AZURE") throw new Error("Only published AZURE analysis can be retained.");
  validateInsightIds(snapshot);
  validateNumericEvidence(snapshot);
  validateInsightPeriods(snapshot);
  validateJapaneseInsights(snapshot.aiInsights);
  validateUiLanguage(snapshot);
  const privacy = scanJson(content);
  if (privacy.length) {
    throw new Error(`Retained analysis privacy gate failed: ${privacy.map((item) => item.label).join(", ")}`);
  }
  // Hash the validated original representation, not a future schema's defaults or transformations.
  return candidate as typeof snapshot;
}

export function selectLastAnalysis(published: string | undefined, retained: string | undefined): string | undefined {
  // A corrupt/incompatible archive is an error even if a replacement is available. Do not silently
  // hide schema migrations or privacy failures behind an empty/missing analysis fallback.
  const previous = retained === undefined ? undefined : validateRetainedAnalysis(retained);
  if (previous && previous.aiInsights.length === 0) {
    throw new Error("Retained analysis must contain at least one published insight.");
  }
  const current = published === undefined ? undefined : validateRetainedAnalysis(published);
  if (current && previous && Date.parse(previous.generatedAt) > Date.parse(current.generatedAt)) {
    throw new Error("Retained analysis cannot be newer than the published snapshot.");
  }
  return current?.aiInsights.length ? published : retained;
}

async function readOptionalSnapshot(path: string): Promise<string | undefined> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ANALYSIS_BYTES) {
      throw new Error(`Expected a bounded regular snapshot file: ${path}`);
    }
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function retainLastAnalysis(
  publishedPath = "public/data/snapshot.json",
  retainedPath = LAST_ANALYSIS_PATH
): Promise<boolean> {
  if (resolve(publishedPath) === resolve(retainedPath)) {
    throw new Error("Current snapshot and retained analysis must be separate files.");
  }
  const [published, retained] = await Promise.all([
    readOptionalSnapshot(publishedPath),
    readOptionalSnapshot(retainedPath)
  ]);
  const selected = selectLastAnalysis(published, retained);
  if (selected === undefined || selected === retained) return false;
  await mkdir(dirname(retainedPath), { recursive: true });
  await writeFile(retainedPath, selected, "utf8");
  return true;
}

if (process.argv[1] && /retain-last-analysis\.[cm]?[jt]s$/u.test(process.argv[1])) {
  const changed = await retainLastAnalysis(process.argv[2], process.argv[3]);
  console.log(changed ? "Retained the complete published analysis snapshot." : "Previous analysis unchanged or absent.");
}
