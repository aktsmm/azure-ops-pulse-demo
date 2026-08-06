import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateEvidenceItem } from "./evidence-validator";
import { validateJapaneseInsights } from "./japanese-insights-validator";
import { publicSnapshotSchema } from "./public-schema";
import { findUiLanguageLeaks } from "./ui-language-audit";

/**
 * Advisory listing of every gate finding the authoritative validator could locate, not just the one
 * it stops at. It exists so the analysis agent can repair a whole class in one pass instead of
 * learning about one field per run, and it is deliberately powerless: it never decides whether a
 * snapshot may be published.
 *
 * Two properties keep it from becoming a second, drifting validator:
 *
 * - it reuses the validators themselves (`validateEvidenceItem`, `validateJapaneseInsights`,
 *   `findUiLanguageLeaks`) rather than re-deciding what is a violation, so a rule can only change in
 *   one place;
 * - it cannot report success. It runs only after a real gate has already failed and it never
 *   influences an exit code, so drift here can under-report a finding but can never turn a rejected
 *   snapshot green.
 *
 * It also reports less about each finding than the gate it accompanies. Findings are addressed by
 * path and by the offending token, and prose values are not echoed: this output reaches a public
 * Actions log, and naming where a value is wrong is enough to repair it.
 */

const MAXIMUM_REPORTED_FINDINGS = 25;
const PREFIX = "[advisory]";

export function collectInsightFindings(candidate: unknown): string[] {
  const parsed = publicSnapshotSchema.safeParse(candidate);
  if (!parsed.success) {
    return [
      "the runtime schema rejected this snapshot, so field-level findings cannot be listed; fix the schema errors reported above first"
    ];
  }

  const snapshot = parsed.data;
  const findings: string[] = [];

  const evidenceFindings: string[] = [];
  snapshot.aiInsights.forEach((insight, index) => {
    insight.numericEvidence.forEach((evidence, evidenceIndex) => {
      try {
        // The second argument only labels the message. Passing the path instead of the title keeps
        // author-written prose out of a public log while still using the real check.
        validateEvidenceItem(snapshot, `aiInsights.${index}`, evidence);
      } catch (error) {
        evidenceFindings.push(
          `aiInsights.${index}.numericEvidence.${evidenceIndex}  ${messageOf(error)}`
        );
      }
    });
  });
  appendSection(findings, "numeric evidence", evidenceFindings);

  const japaneseFindings: string[] = [];
  snapshot.aiInsights.forEach((insight, index) => {
    try {
      validateJapaneseInsights([insight]);
    } catch (error) {
      japaneseFindings.push(`aiInsights.${index}  ${messageOf(error)}`);
    }
  });
  appendSection(findings, "Japanese prose (first failing field per insight)", japaneseFindings);

  const leakFindings = findUiLanguageLeaks(snapshot).map(
    (leak) => `${leak.path}  untranslated: ${leak.residue}`
  );
  appendSection(findings, "rendered UI language", leakFindings);

  return findings;
}

function appendSection(findings: string[], label: string, entries: string[]): void {
  if (entries.length === 0) return;
  findings.push(`${label}: ${entries.length} finding(s)`);
  for (const entry of entries) findings.push(`  ${entry}`);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function formatInsightFindings(findings: string[]): string[] {
  if (findings.length === 0) {
    return [
      `${PREFIX} no further findings; the gate above reports the only one this pass can locate.`
    ];
  }
  const shown = findings.slice(0, MAXIMUM_REPORTED_FINDINGS);
  const lines = [
    `${PREFIX} every finding this pass can locate, not only the one the gate stopped at:`,
    ...shown.map((finding) => `${PREFIX} ${finding}`)
  ];
  if (findings.length > shown.length) {
    lines.push(`${PREFIX} ... and ${findings.length - shown.length} more, hidden by the report cap.`);
  }
  lines.push(`${PREFIX} Repair the fields named above and run the check again.`);
  return lines;
}

function main(): void {
  const file = resolve(process.argv[2] ?? "public/data/snapshot.json");
  let findings: string[];
  try {
    findings = collectInsightFindings(JSON.parse(readFileSync(file, "utf8")) as unknown);
  } catch (error) {
    // Advice must never become the reason a run fails, so an unreadable candidate is reported and
    // nothing else. The gate that already failed owns the exit code.
    findings = [`this report could not read ${file}: ${messageOf(error)}`];
  }
  for (const line of formatInsightFindings(findings)) console.log(line);
}

const invokedDirectly = process.argv[1] !== undefined && /insight-findings\.[cm]?[jt]s$/u.test(process.argv[1]);
if (invokedDirectly) main();
