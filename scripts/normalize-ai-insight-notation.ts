import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  describeNotationRepairs,
  normalizeAiInsightNotation,
  totalNotationRepairs
} from "./insight-notation";

async function main(): Promise<void> {
  const path = resolve(process.argv[2] ?? "public/data/snapshot.json");
  const snapshot = JSON.parse(await readFile(path, "utf8")) as unknown;
  const counts = normalizeAiInsightNotation(snapshot);
  const total = totalNotationRepairs(counts);

  if (total > 0) {
    await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  }

  console.log(
    `Normalized ${total} AI insight notation value(s): ${describeNotationRepairs(counts)}.`
  );
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  await main();
}
