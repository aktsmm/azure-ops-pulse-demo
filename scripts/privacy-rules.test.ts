import { describe, expect, it } from "vitest";
import { scanContent } from "./privacy-rules";

const dotted = (...parts: string[]) => parts.join(".");
const coloned = (...parts: string[]) => parts.join(":");

describe("public asset privacy rules", () => {
  it.each([
    dotted("10", "24", "8", "17"),
    dotted("172", "16", "4", "8"),
    dotted("192", "168", "1", "20"),
    dotted("127", "0", "0", "1"),
    dotted("203", "0", "113", "42")
  ])("rejects every syntactically valid IPv4 range: %s", (address) => {
    expect(scanContent(`endpoint=${address}`)).toContainEqual(
      expect.objectContaining({ label: "unmasked IPv4 address" })
    );
  });

  it.each([
    `Address ${dotted("10", "24", "8", "17")}.`,
    `range ${dotted("10", "24", "8", "17")}-82`
  ])("rejects complete IPv4 in punctuation context: %s", (value) => {
    expect(scanContent(value)).toContainEqual(
      expect.objectContaining({ label: "unmasked IPv4 address" })
    );
  });

  it.each([
    coloned("2603", "1030", "20e", "3", "", "23"),
    coloned("fd12", "3456", "789a", "", "1"),
    coloned("", "", "1"),
    `${coloned("fe80", "", "1")}%eth0`,
    `${coloned("fe80", "", "1")}%12`
  ])("rejects full IPv6 addresses: %s", (address) => {
    expect(scanContent(`endpoint=${address}`)).toContainEqual(
      expect.objectContaining({ label: "unmasked IPv6 address" })
    );
  });

  it("allows masked addresses and common non-address numeric content", () => {
    const safe = [
      dotted("203", "0", "*", "*"),
      `${coloned("2603", "1030")}:*`,
      `version ${dotted("1", "2", "3", "4")}`,
      "2026-03-14T12:34:56Z",
      `${dotted("13", "88", "7", "71")}-2.82`,
      `${dotted("13", "88", "7", "71")}-9.2-4.1`,
      "input::placeholder",
      "div::before",
      "span::after",
      "p::first-letter"
    ].join("\n");

    expect(scanContent(safe)).toEqual([]);
  });
});
