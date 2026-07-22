import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createDemoRawSnapshot } from "./demo-data";
import { sanitizeSnapshot } from "../src/lib/sanitize";

const output = resolve(process.env.OUTPUT_PATH ?? "public/data/snapshot.json");
const generatedAt = process.env.SNAPSHOT_TIME ?? new Date().toISOString();
const snapshot = sanitizeSnapshot(createDemoRawSnapshot(generatedAt));

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(`Generated sanitized DEMO snapshot: ${output}`);

