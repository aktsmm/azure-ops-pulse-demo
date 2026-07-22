export interface ScanRule {
  label: string;
  pattern: RegExp;
  accept?: (match: RegExpExecArray, content: string) => boolean;
}

function isCompleteIpv4(value: string): boolean {
  return value.split(".").map(Number).every((octet) => octet >= 0 && octet <= 255);
}

export function isCompleteIpv6(value: string): boolean {
  const address = value.replace(/^\[/, "").replace(/\]$/, "").split("%", 1)[0] ?? "";
  if (!address.includes(":") || address.includes("*")) return false;

  const compression = address.indexOf("::");
  if (compression !== address.lastIndexOf("::")) return false;

  const validateHextets = (part: string): number | null => {
    if (!part) return 0;
    const hextets = part.split(":");
    let units = 0;
    for (const [index, hextet] of hextets.entries()) {
      if (/^[0-9a-f]{1,4}$/i.test(hextet)) {
        units += 1;
        continue;
      }
      const isIpv4Tail = index === hextets.length - 1 && /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hextet);
      if (!isIpv4Tail || !isCompleteIpv4(hextet)) return null;
      units += 2;
    }
    return units;
  };

  if (compression >= 0) {
    const left = validateHextets(address.slice(0, compression));
    const right = validateHextets(address.slice(compression + 2));
    return left !== null && right !== null && left + right < 8;
  }

  return validateHextets(address) === 8;
}

export const privacyRules: ScanRule[] = [
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
    pattern: /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?!\d|\.\d)/g,
    accept: (match, content) =>
      isCompleteIpv4(match[0]) && !/^-\d+\.\d+/.test(content.slice(match.index + match[0].length))
  },
  {
    label: "unmasked IPv6 address",
    pattern:
      /(?<![0-9a-f:])(?:[0-9a-f]{0,4}:){2,7}(?:[0-9a-f]{0,4}|(?:\d{1,3}\.){3}\d{1,3})(?:%[a-z0-9_.-]+)?(?![0-9a-f:*])/gi,
    accept: (match, content) => {
      if (!isCompleteIpv6(match[0])) return false;
      const preceding = content[match.index - 1] ?? "";
      const following = content[match.index + match[0].length] ?? "";
      return !/[a-z0-9_-]/i.test(preceding) && !/[a-z0-9_-]/i.test(following);
    }
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

export function scanContent(content: string): string[] {
  const findings: string[] = [];
  for (const rule of privacyRules) {
    rule.pattern.lastIndex = 0;
    let match = rule.pattern.exec(content);
    while (match) {
      if (!rule.accept || rule.accept(match, content)) {
        findings.push(rule.label);
        break;
      }
      match = rule.pattern.exec(content);
    }
  }
  return findings;
}
