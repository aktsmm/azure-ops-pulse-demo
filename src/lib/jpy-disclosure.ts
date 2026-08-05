/**
 * Every yen amount in the public snapshot is rounded before publication, and one thousand yen is the
 * smallest unit that is ever disclosed as a figure: below it `formatApproximateJpy` deliberately
 * publishes a label ("約¥1千未満") instead of a number, so the exact Azure invoice cannot be
 * reconstructed from the dashboard.
 *
 * That publication floor is also the floor for anything *derived* from an amount. A percentage
 * change relates two amounts, so once either endpoint is smaller than the unit we are willing to
 * publish, the result stops describing spend and starts amplifying rounding noise: a service that
 * moved from ¥1 to ¥400 reads as "+39,900%" even though the whole move is invisible at published
 * precision. Both periods therefore have to reach this floor before a change is published, which
 * keeps one rule for the whole cost block instead of an arbitrary cut-off per call site.
 */
export const JPY_DISCLOSURE_FLOOR = 1_000;

/** The label `formatApproximateJpy` publishes instead of a figure below the disclosure floor. */
export const WITHHELD_JPY_AMOUNT_LABEL = "約¥1千未満";

/**
 * Recognises a published amount whose figure was withheld. Credits are suffixed (" credit"), so the
 * label is matched by prefix rather than equality.
 */
export function isWithheldJpyAmount(label: string | null | undefined): boolean {
  return typeof label === "string" && label.startsWith(WITHHELD_JPY_AMOUNT_LABEL);
}

/**
 * True when a period-over-period percentage may be published: both amounts must be known and reach
 * the disclosure floor. Callers keep their own formula and sign handling; only the threshold is
 * shared, so the collector and the dashboard cannot drift apart on what "too small to compare" means.
 */
export function isComparableJpyChange(
  current: number | null | undefined,
  previous: number | null | undefined
): boolean {
  if (typeof current !== "number" || typeof previous !== "number") return false;
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return false;
  return (
    Math.abs(current) >= JPY_DISCLOSURE_FLOOR && Math.abs(previous) >= JPY_DISCLOSURE_FLOOR
  );
}
