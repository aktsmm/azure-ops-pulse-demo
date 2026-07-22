import { describe, expect, it } from "vitest";
import { isCompleteIpv6, scanContent } from "./privacy-rules";

describe("privacy scanner network address rules", () => {
  it.each(["10.24.8.17", "172.16.0.1", "192.168.1.12", "203.0.113.42"])(
    "rejects complete IPv4 address %s",
    (address) => {
      expect(scanContent(address)).toContain("unmasked IPv4 address");
    }
  );

  it.each(["Address 10.24.8.17.", "range 10.24.8.17-82"])(
    "rejects complete IPv4 in punctuation context: %s",
    (value) => {
      expect(scanContent(value)).toContain("unmasked IPv4 address");
    }
  );

  it.each(["2001:db8::1", "::1", "fe80::abcd%eth0", "2603:1030:20e:3::23"])(
    "rejects complete IPv6 address %s",
    (address) => {
      expect(isCompleteIpv6(address)).toBe(true);
      expect(scanContent(address)).toContain("unmasked IPv6 address");
    }
  );

  it.each([
    "10.24.*.*",
    "2603:1030:*",
    "version 1.2.3",
    "invalid 999.2.3.4",
    "time 12:34:56",
    "mac 00:11:22:33:44:55",
    "svg path m16.71 13.88.7.71-2.82 2.82",
    "input::placeholder",
    "div::before",
    "span::after",
    "p::first-letter"
  ])("ignores masked addresses and obvious non-addresses: %s", (value) => {
    expect(scanContent(value)).toEqual([]);
  });

  it("still rejects the standalone IPv6 unspecified address", () => {
    expect(scanContent("address :: is not publishable")).toContain("unmasked IPv6 address");
  });
});
