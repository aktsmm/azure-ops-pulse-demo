import type { NetworkAddressEvidence } from "../data/contracts";

const OCTET = "(?:0|[1-9][0-9]?|1[0-9]{2}|2[0-4][0-9]|25[0-5])";
export const PRIVATE_IPV4_PATTERN = `^(?:10\\.${OCTET}\\.${OCTET}\\.${OCTET}|172\\.(?:1[6-9]|2[0-9]|3[01])\\.${OCTET}\\.${OCTET}|192\\.168\\.${OCTET}\\.${OCTET})$`;
export const MASKED_PUBLIC_IPV4_PATTERN = `^${OCTET}\\.${OCTET}\\.\\*\\.\\*$`;
export const PRIVATE_CIDR_PATTERN = `(?:${PRIVATE_IPV4_PATTERN.slice(1, -1)})/(?:[0-9]|[12][0-9]|3[0-2])`;
const ipv4 = new RegExp(`^${OCTET}\\.${OCTET}\\.${OCTET}\\.${OCTET}$`);

export function isPrivateIpv4(value: string): boolean {
  return new RegExp(PRIVATE_IPV4_PATTERN).test(value);
}

/** The entire block, not just its first address, must fit inside RFC1918. */
export function isPrivateCidr(value: string): boolean {
  const [address, prefix, extra] = value.split("/");
  if (!address || extra !== undefined || !/^(?:[0-9]|[12][0-9]|3[0-2])$/.test(prefix ?? "") || !isPrivateIpv4(address)) return false;
  const minimum = address.startsWith("10.") ? 8 : address.startsWith("172.") ? 12 : 16;
  return Number(prefix) >= minimum;
}

export function publicIpv4Mask(value: string): string | null {
  if (!ipv4.test(value) || isPrivateIpv4(value)) return null;
  const [first, second] = value.split(".");
  return `${first}.${second}.*.*`;
}

export function sanitizeNetworkEvidence(value: NetworkAddressEvidence): NetworkAddressEvidence {
  const clean = (items: unknown, valid: (item: string) => boolean) =>
    [...new Set((Array.isArray(items) ? items : []).filter((item): item is string => typeof item === "string" && valid(item)))].sort();
  const privateIpv4 = clean(value.privateIpv4, isPrivateIpv4);
  const privateCidrs = clean(value.privateCidrs, isPrivateCidr);
  const publicIpv4Masked = clean(value.publicIpv4Masked, (item) => new RegExp(MASKED_PUBLIC_IPV4_PATTERN).test(item));
  return {
    privateIpv4: privateIpv4.slice(0, 32), privateCidrs: privateCidrs.slice(0, 32),
    publicIpv4Masked: publicIpv4Masked.slice(0, 32),
    truncated: value.truncated === true || [privateIpv4, privateCidrs, publicIpv4Masked].some((items) => items.length > 32)
  };
}
