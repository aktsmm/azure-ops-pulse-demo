import { readdir, readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";

const roots = process.argv.slice(2).length ? process.argv.slice(2) : ["public"];
const textExtensions = new Set([".html", ".js", ".css", ".json", ".txt", ".xml", ".svg"]);
interface ScanRule {
  label: string;
  pattern: RegExp;
  accept?: (match: RegExpExecArray, content: string) => boolean;
}

function isPublicIpv4(match: RegExpExecArray, content: string): boolean {
  const octets = match[0].split(".").map(Number);
  if (octets.some((octet) => octet > 255)) return false;
  const [first = 0, second = 0] = octets;
  if (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  ) {
    return false;
  }
  const following = content[match.index + match[0].length] ?? "";
  return following !== "-";
}

const rules: ScanRule[] = [
  {
    label: "full GUID",
    pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
  },
  {
    label: "email address",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
  },
  {
    label: "unmasked IPv4 address",
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    accept: isPublicIpv4
  },
  {
    label: "private key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g
  },
  {
    label: "cloud access key",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g
  },
  {
    label: "suspicious secret assignment",
    pattern: /\b(?:client[_-]?secret|password|access[_-]?token)\s*[:=]\s*["'][^"']{8,}["']/gi
  }
];

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
    for (const rule of rules) {
      rule.pattern.lastIndex = 0;
      let match = rule.pattern.exec(content);
      while (match) {
        if (!rule.accept || rule.accept(match, content)) {
          findings.push(`${rule.label}: ${file}`);
          break;
        }
        match = rule.pattern.exec(content);
      }
    }
  }
}

if (findings.length) {
  throw new Error(`Privacy gate failed:\n${findings.map((item) => `- ${item}`).join("\n")}`);
}
console.log(`Privacy gate passed for ${roots.join(", ")}`);
