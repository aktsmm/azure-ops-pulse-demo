import { writeFile } from "node:fs/promises";
import { semanticCalibrationCases } from "./semantic-review-cases";

const [outputPath, ...extra] = process.argv.slice(2);
if (!outputPath || extra.length) throw new Error("Expected one calibration input path.");
await writeFile(outputPath, `${JSON.stringify(semanticCalibrationCases(), null, 2)}\n`, {
  encoding: "utf8", flag: "wx"
});
