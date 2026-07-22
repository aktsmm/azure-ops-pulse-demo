import { isIP } from "node:net";

export interface PrivacyFinding {
  label: string;
  index: number;
}

interface ScanRule {
  label: string;
  pattern: RegExp;
  accept?: (match: RegExpExecArray, content: string) => boolean;
}

function isVersionContext(match: RegExpExecArray, content: string): boolean {
  const prefix = content.slice(Math.max(0, match.index - 24), match.index).toLowerCase();
  return /(?:\bversion|\brelease|\btag|\bv)\s*[:=@-]?\s*$/.test(prefix);
}

function isValidUnmaskedIpv4(match: RegExpExecArray, content: string): boolean {
  if (isIP(match[0]) !== 4 || isVersionContext(match, content)) return false;
  const suffix = content.slice(match.index + match[0].length, match.index + match[0].length + 12);
  return !/^-\d+[.,]\d+(?:[.,-]\d+)*/.test(suffix);
}

function isValidUnmaskedIpv6(match: RegExpExecArray, content: string): boolean {
  const previous = content[match.index - 1] ?? "";
  const next = content[match.index + match[0].length] ?? "";
  if (/[A-Za-z_-]/.test(previous) || /[A-Za-z_-]/.test(next)) return false;
  const address = match[0].split("%", 1)[0] ?? "";
  return address.includes(":") && isIP(address) === 6;
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
    accept: isValidUnmaskedIpv4
  },
  {
    label: "unmasked IPv6 address",
    pattern: /[0-9a-f:.]{2,}(?:%[A-Za-z0-9_.-]+)?/gi,
    accept: isValidUnmaskedIpv6
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

export function scanContent(content: string): PrivacyFinding[] {
  const findings: PrivacyFinding[] = [];
  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    let match = rule.pattern.exec(content);
    while (match) {
      if (!rule.accept || rule.accept(match, content)) {
        findings.push({ label: rule.label, index: match.index });
        break;
      }
      match = rule.pattern.exec(content);
    }
  }
  return findings;
}
