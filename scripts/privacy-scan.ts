import { readdir, readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { scanContent } from "./privacy-rules";

const roots = process.argv.slice(2).length ? process.argv.slice(2) : ["public"];
const textExtensions = new Set([".html", ".js", ".css", ".json", ".txt", ".xml", ".svg"]);

async function filesUnder(path: string): Promise<string[]> {
  const info = await stat(path);
  if (info.isFile()) return [path];
  const children = await readdir(path);
  const nested = await Promise.all(children.map((child) => filesUnder(resolve(path, child))));
  return nested.flat();
}

const findings: string[] = [];
for (const root of roots) {
  for (const file of await filesUnder(resolve(root))) {
    if (!textExtensions.has(extname(file).toLowerCase())) continue;
    const content = await readFile(file, "utf8");
    for (const label of scanContent(content)) {
      findings.push(`${label}: ${file}`);
    }
  }
}

if (findings.length) {
  throw new Error(`Privacy gate failed:\n${findings.map((item) => `- ${item}`).join("\n")}`);
}
console.log(`Privacy gate passed for ${roots.join(", ")}`);
