import { createHash } from "node:crypto";

/**
 * SHA-256 of the published snapshot's collector-produced portion as it stood when the collector
 * started emitting Japanese. Taken over `JSON.stringify` of the parsed value with `aiInsights`
 * removed, so that neither a checkout's line endings nor an insights refresh can change it.
 *
 * The published file is the collector's output. It is not a document anyone edits by hand, so the
 * English it still carries cannot be corrected in place — the correction is that the collector now
 * writes Japanese, and it takes effect when the next scheduled run publishes. Until then the audit
 * would fail on an artifact this branch is not allowed to touch, so that one artifact is exempt.
 *
 * The exemption is keyed on the content rather than on a date or a mode so that it expires by
 * itself and cannot be widened by accident:
 *
 *   - the next collection publishes different bytes, the hash stops matching, and the audit applies
 *     to the new file with nothing to switch off;
 *   - `.candidate/snapshot.json` is validated before it is copied over the published path, so a run
 *     that would publish English is rejected while the old file is still in place;
 *   - editing the published file by hand also breaks the match, so the exemption cannot be used to
 *     shelter a hand-written value. That is the intended reading: this covers exactly one artifact
 *     that a machine produced, and nothing a person writes.
 *
 * `aiInsights` are excluded from the hash because the AI workflow rewrites them on its own schedule
 * and validates the result with `--insights-only`. Including them would make the first insights
 * refresh cancel the exemption and fail that workflow on collector fields it did not write and
 * cannot fix. Excluding them costs no coverage: insight prose is separately held to the stricter
 * `validateJapaneseInsights`, which runs whether or not this exemption applies.
 */
export const PRE_LOCALISATION_SNAPSHOT_SHA256 =
  "895e7d0885861a0088e2147972288b75763b66ef44622550f0d22bbc70ecdc98";

/**
 * True only for the one already-published artifact named above. Takes the parsed value rather than
 * the file text so that formatting differences are not mistaken for content differences.
 */
export function isPreLocalisationSnapshot(candidate: unknown): boolean {
  const collected =
    candidate && typeof candidate === "object"
      ? { ...(candidate as Record<string, unknown>), aiInsights: [] }
      : candidate;
  return (
    createHash("sha256").update(JSON.stringify(collected)).digest("hex") ===
    PRE_LOCALISATION_SNAPSHOT_SHA256
  );
}
