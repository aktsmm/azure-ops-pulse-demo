import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDemoSnapshot } from "./build-demo-snapshot";
import {
  bindSemanticReview, candidateDigest, parseReviewJson, validateSemanticReview
} from "./semantic-review";
import { EXPECTED_CALIBRATION, semanticCalibrationCases } from "./semantic-review-cases";

const snapshot = buildDemoSnapshot("2026-09-10T00:00:00Z");
const bytes = Buffer.from(JSON.stringify(snapshot));
const calibration = Object.entries(EXPECTED_CALIBRATION).map(([caseId, acceptable]) => ({ caseId, acceptable }));
const verdict = () => ({
  reviews: snapshot.aiInsights.map((insight) => ({
    insightId: insight.id, grounded: true, relevant: true, actionable: true, bounded: true,
    reasonCodes: [] as string[],
    explanation: "例の数値と主張の関係を確認し、判断に必要な比較と確認先が示されています。"
  })),
  calibration
});
const bind = (value: unknown = verdict(), input = bytes) => bindSemanticReview(input, value, candidateDigest(input));

describe("snapshot-bound independent semantic review", () => {
  it("accepts a complete affirmative review and does not mutate the snapshot", () => {
    const before = Buffer.from(bytes);
    const report = bind();
    expect(validateSemanticReview(bytes, report)).toEqual(report);
    expect(bytes).toEqual(before);
  });

  it.each(["grounded", "relevant", "actionable", "bounded"] as const)(
    "fails publication on a negative %s decision, without echoing generated prose", (field) => {
      const value = verdict();
      value.reviews[0]![field] = false;
      value.reviews[0]!.reasonCodes = ["generic"];
      value.reviews[0]!.explanation = "private-prose-sentinel を含むこの候補は根拠と意味が対応していません。";
      const report = bind(value);
      expect(() => validateSemanticReview(bytes, report)).toThrow("Semantic review rejected publication");
      try { validateSemanticReview(bytes, report); } catch (error) {
        expect(String(error)).not.toContain("private-prose-sentinel");
      }
    }
  );

  it.each(["missing", "duplicate", "extra"] as const)("rejects %s candidate decisions", (mode) => {
    const value = verdict();
    if (mode === "missing") value.reviews.pop();
    if (mode === "duplicate") value.reviews[1] = { ...value.reviews[0]! };
    if (mode === "extra") value.reviews[0]!.insightId = "insight-00000000";
    expect(() => bind(value)).toThrow("exactly once");
  });

  it("rejects changed bytes even when only whitespace changed", () => {
    const report = bind();
    const altered = Buffer.concat([bytes, Buffer.from("\n")]);
    expect(() => validateSemanticReview(altered, report)).toThrow("exact candidate bytes");
    expect(() => bindSemanticReview(altered, verdict(), candidateDigest(bytes))).toThrow("changed after");
    expect(() => bindSemanticReview(bytes, verdict(), undefined)).toThrow("Expected candidate digest");
  });

  it("rejects reused reviews from a different collected snapshot", () => {
    const other = Buffer.from(JSON.stringify({ ...snapshot, generatedAt: "2026-09-11T00:00:00Z" }));
    expect(() => validateSemanticReview(other, bind())).toThrow("exact candidate bytes");
  });

  it("rejects malformed, extra, inconsistent, or missing fields", () => {
    expect(() => bind({ ...verdict(), approved: true })).toThrow("schema rejected");
    expect(() => bind({ reviews: [] })).toThrow("schema rejected");
    const value = verdict();
    value.reviews[0]!.reasonCodes = ["generic"];
    expect(() => bind(value)).toThrow("schema rejected");
    expect(() => validateSemanticReview(bytes, { ...bind(), approved: true })).toThrow("schema rejected");
    expect(() => parseReviewJson(Buffer.from("not json"))).toThrow("not valid JSON");
  });

  it("scans all model-authored prose for privacy, while allowing the exact content digest", () => {
    const value = verdict();
    value.reviews[0]!.explanation = "対象の確認先として private@example.com に連絡する必要があります。";
    expect(() => bind(value)).toThrow("privacy gate");
    expect(() => validateSemanticReview(bytes, bind())).not.toThrow();
  });

  it("requires a calibrated review even for zero insights", () => {
    const empty = Buffer.from(JSON.stringify({ ...snapshot, aiInsights: [] }));
    const report = bind({ reviews: [], calibration }, empty);
    expect(() => validateSemanticReview(empty, report)).not.toThrow();
    expect(() => bind({ reviews: [] }, empty)).toThrow("schema rejected");
    expect(() => validateSemanticReview(bytes, report)).toThrow("exact candidate bytes");
  });

  it("fails closed if the reviewer accepts a weak case or rejects a meaningful one", () => {
    for (const changed of Object.keys(EXPECTED_CALIBRATION)) {
      const value = {
        ...verdict(), calibration: calibration.map((entry) =>
          entry.caseId === changed ? { ...entry, acceptable: !entry.acceptable } : entry)
      };
      const report = bind(value);
      expect(() => validateSemanticReview(bytes, report)).toThrow("failed calibration");
    }
  });

  it("requires each calibration case exactly once and never supplies expected answers to the model", () => {
    const value = verdict();
    expect(() => bind({ ...value, calibration: [calibration[0], ...calibration.slice(0, -1)] }))
      .toThrow("each calibration case exactly once");
    expect(() => bind({ ...value, calibration: [] })).toThrow("schema rejected");
    const modelInput = semanticCalibrationCases();
    expect(modelInput.cases.map((entry) => entry.caseId)).toEqual(Object.keys(EXPECTED_CALIBRATION));
    expect(JSON.stringify(modelInput)).not.toMatch(/acceptable|expected|verdict/i);
  });
});

describe("semantic review CLIs", () => {
  it("binds and checks an actual report; missing, rejected and preexisting outputs fail", { timeout: 60_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "semantic-review-"));
    const candidatePath = join(dir, "snapshot.json");
    const verdictPath = join(dir, "verdict.json");
    const reportPath = join(dir, "semantic-review.json");
    const tsx = resolve("node_modules", "tsx", "dist", "cli.mjs");
    const run = (script: string, args: string[]) => execFileSync(
      process.execPath, [tsx, resolve("scripts", script), ...args],
      { encoding: "utf8", stdio: "pipe", env: { ...process.env, EXPECTED_CANDIDATE_SHA256: candidateDigest(bytes) } }
    );
    try {
      writeFileSync(candidatePath, bytes);
      writeFileSync(verdictPath, JSON.stringify(verdict()));
      run("bind-semantic-review.ts", [candidatePath, verdictPath, reportPath]);
      expect(run("validate-semantic-review.ts", [candidatePath, reportPath])).toContain("Semantic review accepted");
      expect(() => run("bind-semantic-review.ts", [candidatePath, verdictPath, reportPath])).toThrow();
      expect(() => run("validate-semantic-review.ts", [candidatePath, join(dir, "missing.json")])).toThrow();
      const report = JSON.parse(readFileSync(reportPath, "utf8")) as ReturnType<typeof bind>;
      report.reviews[0]!.grounded = false;
      report.reviews[0]!.reasonCodes = ["unsupported-claim"];
      writeFileSync(reportPath, JSON.stringify(report));
      expect(() => run("validate-semantic-review.ts", [candidatePath, reportPath])).toThrow();
      expect(() => run("validate-semantic-review.ts", [candidatePath, reportPath, "--skip"])).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
