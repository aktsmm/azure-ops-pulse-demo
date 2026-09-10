import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export function prepareAiInput(candidate: unknown): Record<string, unknown> {
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate) ||
      !("aiInsights" in candidate) || !Array.isArray(candidate.aiInsights)) {
    throw new Error("AI input must be a snapshot with an aiInsights array.");
  }
  return { ...candidate, aiInsights: [] };
}

if (process.argv[1] && /prepare-ai-input\.[cm]?[jt]s$/u.test(process.argv[1])) {
  const path = resolve(process.argv[2] ?? "public/data/snapshot.json");
  const input = prepareAiInput(JSON.parse(await readFile(path, "utf8")) as unknown);
  await writeFile(path, `${JSON.stringify(input, null, 2)}\n`, "utf8");
}
