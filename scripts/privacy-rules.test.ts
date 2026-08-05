import { describe, expect, it } from "vitest";
import { scanContent, scanJson } from "./privacy-rules";

const dotted = (...parts: string[]) => parts.join(".");
const coloned = (...parts: string[]) => parts.join(":");

/**
 * The tail of a synthetic GUID. Real published values are deliberately not used here: an assertion
 * about a leak should not need to restate the leak, and hardcoding published data makes the test
 * fail for unrelated reasons the next time the snapshot is collected.
 */
const GUID_TAIL = "a5b4c3d2e1f0";

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

  it.each([
    ["a resource name carrying the tail of a masked GUID", `DefaultWorkspa…${GUID_TAIL}-WUS2-e65866fb`],
    ["a fragment wrapped in punctuation", `SecurityCenterFree(…b0-${GUID_TAIL}-EA)-1c2ec251`],
    ["a fragment glued to surrounding letters", `workspace${GUID_TAIL}westus2`],
    ["a bare nine character run", `name=${GUID_TAIL.slice(0, 9)}`]
  ])("rejects %s", (_label, value) => {
    expect(scanContent(value)).toContainEqual(
      expect.objectContaining({ label: "recoverable hex fragment" })
    );
  });

  it.each([
    ["an all-digit run", "1754377322000"],
    ["an all-letter run", "deadbeefcafe"]
  ])("rejects %s inside published JSON even though code may contain it", (_label, value) => {
    // Application bundles are full of numeric constants and English-ish words, so the raw scan has
    // to tolerate them. Published JSON strings are pure sanitizer output, so nothing this long is
    // ever legitimate there and composition must not be a way through.
    expect(scanContent(value)).toEqual([]);
    expect(scanJson(JSON.stringify({ name: value }))).toContainEqual(
      expect.objectContaining({ label: "recoverable hex fragment" })
    );
  });

  it("does not mistake a JSON number for an identifier", () => {
    // The same digits as a bare number rather than a string: a byte count or a timestamp field must
    // not fail the gate just because published strings are held to a stricter rule.
    expect(scanJson(JSON.stringify({ bytes: 1073741823, at: "2026-03-14T12:34:56Z" }))).toEqual([]);
  });

  it("fails the gate outright when published JSON cannot be parsed", () => {
    // The lenient raw scan would have let `deadbeefcafe` through here, so a file the gate cannot
    // read has to be a finding rather than a downgrade to the weaker rule.
    expect(scanJson(`{"name": "deadbeefcafe"`)).toEqual([
      expect.objectContaining({ label: "unreadable published JSON" })
    ]);
    expect(scanContent(`{"name": "deadbeefcafe"`)).toEqual([]);
  });

  it("allows the identifiers the masking boundary is designed to publish", () => {
    const safe = [
      // Every alias the sanitizer emits is a label, a hyphen, and exactly eight hex characters.
      "res-1a2b3c4d",
      "rg-d0a1b2c3",
      "identity-caac8562",
      "virtualmachinescalesets-dc9a2eaf",
      "databaseaccounts-6f303527",
      "flow-0992ae83",
      "event-fb4849b8",
      "insight-63e43ae7",
      "value-7887422e",
      "Azure subscription ad7fb9a5",
      // The deliberate partial disclosure of the subscription and tenant GUIDs.
      "0f1e2d3c-****-****-****-****c3d2e1f0",
      // Azure vocabulary that happens to sit inside the hex alphabet.
      "microsoft.automation/automationaccounts/runbooks",
      "japaneast",
      "eastasia",
      "germanywestcentral"
    ].join("\n");

    expect(scanContent(safe)).toEqual([]);
    expect(scanJson(JSON.stringify(safe.split("\n")))).toEqual([]);
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
