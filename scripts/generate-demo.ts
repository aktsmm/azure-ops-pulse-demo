import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildDemoSnapshot, resolveDemoOutputPath } from "./build-demo-snapshot";

const output = resolve(resolveDemoOutputPath(process.env, process.argv.slice(2)));
const generatedAt = process.env.SNAPSHOT_TIME ?? new Date().toISOString();
const snapshot = buildDemoSnapshot(generatedAt);

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(`Generated sanitized DEMO snapshot: ${output}`);
