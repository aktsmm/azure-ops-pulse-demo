import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { applyDeterministicInsightPeriods } from "./insight-period";

async function main(): Promise<void> {
  const path = resolve(process.argv[2] ?? "public/data/snapshot.json");
  const snapshot = JSON.parse(await readFile(path, "utf8")) as unknown;
  const rewritten = applyDeterministicInsightPeriods(snapshot);

  if (rewritten > 0) {
    await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  }

  console.log(`Derived ${rewritten} AI insight period(s) from the collection time.`);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  await main();
}
