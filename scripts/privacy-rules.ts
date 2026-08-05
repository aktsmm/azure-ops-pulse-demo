import { isIP } from "node:net";

export interface PrivacyFinding {
  label: string;
  index: number;
}

export interface ScanContext {
  /** True when the content is published JSON data rather than application code. */
  structured: boolean;
}

interface ScanRule {
  label: string;
  pattern: RegExp;
  accept?: (match: RegExpExecArray, content: string, context: ScanContext) => boolean;
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

function isRecoverableHexRun(match: RegExpExecArray, _content: string, context: ScanContext): boolean {
  // Inside published JSON every string is sanitizer output, so no run of this length can be a
  // legitimate constant and composition does not matter.
  if (context.structured) return true;
  // Application code is different: minified bundles are full of numeric constants such as the React
  // lane bitmasks (536870912, 1073741823). Those are numbers, not identifiers. A run made only of
  // letters is an English-ish word like "deadbeefcafe". Requiring both a digit and an a-f letter is
  // what separates an encoded identifier from ordinary code, and it is only ever applied to content
  // that is not published data.
  return /[0-9]/.test(match[0]) && /[a-f]/i.test(match[0]);
}

const rules: ScanRule[] = [
  {
    label: "full GUID",
    pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
  },
  {
    // The sanitizer never emits more than eight hex characters in a row: alias suffixes are
    // `stableHash` output, and the published subscription and tenant GUIDs deliberately reveal an
    // eight-character head and tail with asterisks in between. So a longer run cannot have come
    // from the masking boundary, and nine characters already discloses more of a GUID than the
    // contract allows. Anchoring the threshold to what the sanitizer produces — rather than to a
    // GUID's shape — is what lets this catch fragments embedded inside other text, which is exactly
    // how the subscription GUID escaped through Azure-generated resource names. Runs of eight or
    // fewer are indistinguishable from a legitimate alias suffix and cannot be flagged here; the
    // masking boundary itself has to guarantee those, which is why names are now full aliases.
    label: "recoverable hex fragment",
    pattern: /[0-9a-f]{9,}/gi,
    accept: isRecoverableHexRun
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

export function scanContent(content: string, context: ScanContext = { structured: false }): PrivacyFinding[] {
  const findings: PrivacyFinding[] = [];
  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    let match = rule.pattern.exec(content);
    while (match) {
      if (!rule.accept || rule.accept(match, content, context)) {
        findings.push({ label: rule.label, index: match.index });
        break;
      }
      match = rule.pattern.exec(content);
    }
  }
  return findings;
}

function collectStrings(value: unknown, into: string[]): void {
  if (typeof value === "string") {
    into.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, into);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      into.push(key);
      collectStrings(item, into);
    }
  }
}

/**
 * Published JSON is scanned through its parsed strings rather than its raw text. Numbers then can
 * never be mistaken for identifiers, which is what lets the hex-run rule stay strict here without
 * having to reason about whether a digit run sits inside a quoted value or is a bare JSON number.
 * Unparseable content is a finding rather than a fallback to the lenient raw scan: a `.json` file
 * the gate cannot read is one it cannot vouch for, and the lenient path would let the very
 * compositions the structured rule exists to reject through unexamined.
 */
export function scanJson(content: string): PrivacyFinding[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [{ label: "unreadable published JSON", index: 0 }];
  }
  const strings: string[] = [];
  collectStrings(parsed, strings);
  return scanContent(strings.join("\n"), { structured: true });
}
