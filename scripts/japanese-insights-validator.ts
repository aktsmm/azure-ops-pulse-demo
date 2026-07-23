import type { AiInsight } from "../src/data/contracts";

const JAPANESE_CHARACTER = /[ぁ-ゟ゠-ヿ一-龯々〆ヵヶ]/u;
const KANA_CHARACTER = /[ぁ-ゟ゠-ヿ]/u;
const LATIN_CHARACTER = /[A-Za-z]/u;
const MINIMUM_JAPANESE_RATIO = 0.2;

function validateJapaneseText(insightId: string, field: string, value: string): void {
  const characters = [...value.normalize("NFKC")];
  const japaneseCount = characters.filter((character) => JAPANESE_CHARACTER.test(character)).length;
  const latinCount = characters.filter((character) => LATIN_CHARACTER.test(character)).length;
  const languageCharacterCount = japaneseCount + latinCount;
  const japaneseRatio = languageCharacterCount ? japaneseCount / languageCharacterCount : 0;

  if (
    japaneseCount < 2 ||
    !characters.some((character) => KANA_CHARACTER.test(character)) ||
    japaneseRatio < MINIMUM_JAPANESE_RATIO
  ) {
    throw new Error(
      `Insight "${insightId}" field ${field} must be Japanese prose, not an English-only output`
    );
  }
}

export function validateJapaneseInsights(insights: AiInsight[]): void {
  for (const insight of insights) {
    const fields: Array<[string, string]> = [
      ["title", insight.title],
      ["observation", insight.observation],
      ["impact", insight.impact],
      ["recommendedAction", insight.recommendedAction],
      ["period", insight.period],
      ...insight.numericEvidence.map(
        (evidence, index) => [`numericEvidence.${index}.label`, evidence.label] as [string, string]
      )
    ];
    for (const [field, value] of fields) {
      validateJapaneseText(insight.id, field, value);
    }
  }
}
