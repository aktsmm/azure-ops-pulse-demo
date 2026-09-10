import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { z } from "zod";
import { publicSnapshotSchema } from "./public-schema";
import { validateInsightIds } from "./insight-identity";
import { scanJson } from "./privacy-rules";
import { EXPECTED_CALIBRATION } from "./semantic-review-cases";

export const REVIEW_REASON_CODES = [
  "unsupported-claim", "generic", "unrelated-evidence", "unavailable-data",
  "invalid-comparison", "unusable-action", "overstated-priority"
] as const;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const decisionSchema = z.object({
  insightId: z.string().regex(/^insight-[a-f0-9]{8}$/u),
  grounded: z.boolean(),
  relevant: z.boolean(),
  actionable: z.boolean(),
  bounded: z.boolean(),
  reasonCodes: z.array(z.enum(REVIEW_REASON_CODES)).max(REVIEW_REASON_CODES.length),
  explanation: z.string().min(20).max(600).refine((text) => /[ぁ-ゟ゠-ヿ]/u.test(text))
}).strict().superRefine((decision, ctx) => {
  const accepted = decision.grounded && decision.relevant && decision.actionable && decision.bounded;
  if (accepted !== (decision.reasonCodes.length === 0) ||
      new Set(decision.reasonCodes).size !== decision.reasonCodes.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Decision and reason codes disagree." });
  }
});
const reviewsSchema = z.array(decisionSchema).max(4);
const calibrationSchema = z.array(z.object({
  caseId: z.string().regex(/^case-\d{2}$/u), acceptable: z.boolean()
}).strict()).length(Object.keys(EXPECTED_CALIBRATION).length);
export const semanticVerdictSchema = z.object({ reviews: reviewsSchema, calibration: calibrationSchema }).strict();
export const semanticReviewSchema = z.object({
  schemaVersion: z.literal(1),
  candidateSha256: sha256Schema,
  reviews: reviewsSchema,
  calibration: calibrationSchema
}).strict();
export type SemanticReview = z.infer<typeof semanticReviewSchema>;

export function candidateDigest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function parse<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    // Model-authored values must not be echoed into public Actions logs.
    throw new Error(`${label} schema rejected at ${result.error.issues.map((issue) => issue.path.join(".") || "root").join(", ")}`);
  }
  return result.data;
}

export function parseReviewJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch {
    throw new Error("Semantic review input is not valid JSON.");
  }
}

function requireCompleteReviews(candidate: Uint8Array, report: SemanticReview): void {
  const snapshot = parse(publicSnapshotSchema, parseReviewJson(candidate), "Review candidate");
  validateInsightIds(snapshot);
  const expected = new Set(snapshot.aiInsights.map((insight) => insight.id));
  const actual = new Set(report.reviews.map((review) => review.insightId));
  if (actual.size !== report.reviews.length || actual.size !== expected.size ||
      [...actual].some((id) => !expected.has(id))) {
    throw new Error("Semantic review must cover each candidate insight exactly once, with no extra decisions.");
  }
  const caseIds = new Set(report.calibration.map((entry) => entry.caseId));
  if (caseIds.size !== report.calibration.length ||
      [...caseIds].some((id) => !Object.hasOwn(EXPECTED_CALIBRATION, id))) {
    throw new Error("Semantic review must cover each calibration case exactly once.");
  }
}

export function bindSemanticReview(candidate: Uint8Array, verdict: unknown, expectedDigest: unknown): SemanticReview {
  const digest = parse(sha256Schema, expectedDigest, "Expected candidate digest");
  if (candidateDigest(candidate) !== digest) {
    throw new Error("Semantic review candidate changed after the review input was prepared.");
  }
  const parsed = parse(semanticVerdictSchema, verdict, "Semantic verdict");
  const report: SemanticReview = { schemaVersion: 1, candidateSha256: digest, ...parsed };
  requireCompleteReviews(candidate, report);
  requirePrivateReport(report);
  return report;
}

function requirePrivateReport(report: SemanticReview): void {
  // The trusted SHA-256 is deliberately longer than public identifier aliases. Scan all
  // model-authored fields, not the exact-match-validated binding metadata.
  if (scanJson(JSON.stringify({ reviews: report.reviews })).length) {
    throw new Error("Semantic review report failed the privacy gate.");
  }
}

export function validateSemanticReview(candidate: Uint8Array, value: unknown): SemanticReview {
  const report = parse(semanticReviewSchema, value, "Semantic review");
  if (report.candidateSha256 !== candidateDigest(candidate)) {
    throw new Error("Semantic review is not bound to these exact candidate bytes.");
  }
  requireCompleteReviews(candidate, report);
  requirePrivateReport(report);
  if (report.calibration.some((entry) => entry.acceptable !== EXPECTED_CALIBRATION[entry.caseId])) {
    throw new Error("Semantic reviewer failed calibration; publication is blocked.");
  }
  const rejected = report.reviews.filter((review) =>
    !review.grounded || !review.relevant || !review.actionable || !review.bounded);
  if (rejected.length) {
    throw new Error(`Semantic review rejected publication: ${rejected.map((review) =>
      `${review.insightId} [${review.reasonCodes.join(", ")}]`).join("; ")}`);
  }
  return report;
}

export async function readReviewFile(path: string, maximumBytes: number): Promise<Buffer> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size === 0 || info.size > maximumBytes) {
    throw new Error("Semantic review requires a bounded, nonempty regular file.");
  }
  const bytes = await readFile(path);
  if (bytes.length > maximumBytes) throw new Error("Semantic review file exceeded its size limit.");
  return bytes;
}
