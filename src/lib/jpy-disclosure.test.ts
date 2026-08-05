import { describe, expect, it } from "vitest";
import {
  JPY_DISCLOSURE_FLOOR,
  WITHHELD_JPY_AMOUNT_LABEL,
  isComparableJpyChange,
  isWithheldJpyAmount
} from "./jpy-disclosure";
import { formatApproximateJpy } from "./sanitize";

describe("JPY disclosure floor", () => {
  /**
   * The floor only means something if it is the same number the amount formatter uses. Deriving the
   * expectation from `formatApproximateJpy` keeps the guard tied to the published rounding unit
   * instead of to a hand-copied constant.
   */
  it("is the amount below which the snapshot publishes a label instead of a figure", () => {
    expect(formatApproximateJpy(JPY_DISCLOSURE_FLOOR - 1)).toBe(WITHHELD_JPY_AMOUNT_LABEL);
    expect(formatApproximateJpy(JPY_DISCLOSURE_FLOOR)).not.toBe(WITHHELD_JPY_AMOUNT_LABEL);
    expect(isWithheldJpyAmount(formatApproximateJpy(JPY_DISCLOSURE_FLOOR - 1))).toBe(true);
    expect(isWithheldJpyAmount(formatApproximateJpy(JPY_DISCLOSURE_FLOOR))).toBe(false);
  });

  it("recognises a withheld credit, which carries a suffix", () => {
    const credit = formatApproximateJpy(-(JPY_DISCLOSURE_FLOOR - 1));

    expect(credit).toBe(`${WITHHELD_JPY_AMOUNT_LABEL} credit`);
    expect(isWithheldJpyAmount(credit)).toBe(true);
  });

  it("treats an exact zero as a published figure rather than a withheld one", () => {
    expect(formatApproximateJpy(0)).toBe("約¥0");
    expect(isWithheldJpyAmount(formatApproximateJpy(0))).toBe(false);
  });

  it("does not treat a missing amount as withheld", () => {
    expect(isWithheldJpyAmount(null)).toBe(false);
    expect(isWithheldJpyAmount(undefined)).toBe(false);
  });

  it("compares only when both periods reach the floor", () => {
    expect(isComparableJpyChange(JPY_DISCLOSURE_FLOOR, JPY_DISCLOSURE_FLOOR)).toBe(true);
    expect(isComparableJpyChange(JPY_DISCLOSURE_FLOOR, JPY_DISCLOSURE_FLOOR - 1)).toBe(false);
    expect(isComparableJpyChange(JPY_DISCLOSURE_FLOOR - 1, JPY_DISCLOSURE_FLOOR)).toBe(false);
  });

  it("compares credits by magnitude so a large negative period is still a valid divisor", () => {
    expect(isComparableJpyChange(-50_000, -40_000)).toBe(true);
    expect(isComparableJpyChange(-50_000, -1)).toBe(false);
  });

  it("refuses to compare against a missing or non-finite amount", () => {
    expect(isComparableJpyChange(50_000, null)).toBe(false);
    expect(isComparableJpyChange(null, 50_000)).toBe(false);
    expect(isComparableJpyChange(50_000, undefined)).toBe(false);
    expect(isComparableJpyChange(50_000, 0)).toBe(false);
    expect(isComparableJpyChange(Number.NaN, 50_000)).toBe(false);
    expect(isComparableJpyChange(50_000, Number.POSITIVE_INFINITY)).toBe(false);
  });
});
