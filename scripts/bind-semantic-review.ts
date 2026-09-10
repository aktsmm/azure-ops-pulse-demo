import { writeFile } from "node:fs/promises";
import { bindSemanticReview, parseReviewJson, readReviewFile } from "./semantic-review";

const [candidatePath, verdictPath, outputPath, ...extra] = process.argv.slice(2);
if (!candidatePath || !verdictPath || !outputPath || extra.length) {
  throw new Error("Expected candidate, verdict, and bound review output paths.");
}
const candidate = await readReviewFile(candidatePath, 1_048_576);
const verdict = parseReviewJson(await readReviewFile(verdictPath, 16_384));
const report = bindSemanticReview(candidate, verdict, process.env.EXPECTED_CANDIDATE_SHA256);
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
console.log(`Bound semantic review of ${report.reviews.length} insight(s); publication evaluates the verdict independently.`);
