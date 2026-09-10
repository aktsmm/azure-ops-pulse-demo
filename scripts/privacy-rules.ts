import { isIP } from "node:net";
import { isPrivateIpv4, isPrivateCidr } from "../src/lib/network-evidence";

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
    // `stableHash` output. Scope IDs are fixed anonymous labels; historical masked IDs remain
    // schema-compatible. A longer run cannot have come
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

function collectStrings(value: unknown, into: string[], path: string[] = []): void {
  if (typeof value === "string") {
    // Only typed address-array elements on inventory resources or topology nodes may carry
    // RFC1918 values. A matching key in prose, tags, or an arbitrary nested object is not a grant.
    const field = path.at(-2);
    const parent = path.slice(0, -2).join(".");
    const addressPath = /^(?:inventory\.resources|resources)\.\d+\.network$/.test(parent) ||
      /^(?:(?:network\.)?topology\.)?nodes\.\d+\.network$/.test(parent);
    if (addressPath && ((field === "privateIpv4" && isPrivateIpv4(value)) ||
        (field === "privateCidrs" && isPrivateCidr(value)))) return;
    into.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) collectStrings(item, into, [...path, String(index)]);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      into.push(key);
      collectStrings(item, into, [...path, key]);
    }
  }
}

const CONTINUITY_KIND = "azure-ops-pulse-analysis-continuity";
const CONTINUITY_HASH_FIELDS = ["archiveSha256", "currentEvidenceSha256", "sourceScopeSha256"] as const;

function isContinuitySidecar(value: Record<string, unknown>, content: string): boolean {
  const keys = ["kind", "version", ...CONTINUITY_HASH_FIELDS];
  const digest = (hash: unknown) => typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash);
  // Count raw property tokens too: JSON.parse alone hides duplicate-key values from the scan.
  const rawKeyCount = [...content.matchAll(/"(?:\\.|[^"\\])*"\s*:/g)].length;
  return Buffer.byteLength(content, "utf8") <= 2048 && rawKeyCount === keys.length &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)) &&
    value.kind === CONTINUITY_KIND && value.version === 1 &&
    (value.archiveSha256 === null || digest(value.archiveSha256)) &&
    digest(value.currentEvidenceSha256) && digest(value.sourceScopeSha256);
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
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) &&
      (parsed as Record<string, unknown>).kind === CONTINUITY_KIND) {
    const sidecar = parsed as Record<string, unknown>;
    if (!isContinuitySidecar(sidecar, content)) {
      collectStrings(parsed, strings);
      return [{ label: "invalid analysis continuity sidecar", index: 0 }, ...scanContent(strings.join("\n"), { structured: true })];
    }
    // Only the strict root sidecar's three digest values are exempt; producer provenance and
    // canonical pair/lineage verification remain the continuity validator's responsibility.
    collectStrings({ ...sidecar, archiveSha256: null, currentEvidenceSha256: null, sourceScopeSha256: null }, strings);
    return scanContent(strings.join("\n"), { structured: true });
  }
  collectStrings(parsed, strings);
  return scanContent(strings.join("\n"), { structured: true });
}
