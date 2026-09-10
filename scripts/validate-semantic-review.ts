import { parseReviewJson, readReviewFile, validateSemanticReview } from "./semantic-review";

const [candidatePath, reportPath, ...extra] = process.argv.slice(2);
if (!candidatePath || !reportPath || extra.length) {
  throw new Error("Expected candidate and semantic review paths.");
}
const candidate = await readReviewFile(candidatePath, 1_048_576);
const report = parseReviewJson(await readReviewFile(reportPath, 16_384));
const accepted = validateSemanticReview(candidate, report);
console.log(`Semantic review accepted ${accepted.reviews.length} insight(s) bound to the exact candidate.`);
