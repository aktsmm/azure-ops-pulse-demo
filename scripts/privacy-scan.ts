import { readdir, readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { scanContent, scanJson } from "./privacy-rules";

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
    const extension = extname(file).toLowerCase();
    if (!textExtensions.has(extension)) continue;
    const content = await readFile(file, "utf8");
    const scanned = extension === ".json" ? scanJson(content) : scanContent(content);
    for (const finding of scanned) {
      findings.push(`${finding.label}: ${file}`);
    }
  }
}

if (findings.length) {
  throw new Error(`Privacy gate failed:\n${findings.map((item) => `- ${item}`).join("\n")}`);
}
console.log(`Privacy gate passed for ${roots.join(", ")}`);
