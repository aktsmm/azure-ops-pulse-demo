// Frozen synthetic examples exercise the reviewer without becoming published observations.
const cost = {
  category: "検索サービス", sharePercent: 62.9, categoryDeltaPercent: -5.4, overallDeltaPercent: -0.9,
  period: "同じ長さの連続した集計期間", usageDataAvailable: false
};
const goodCost = {
  title: "主要カテゴリと全体の減少率が異なるため、他カテゴリも合わせて確認",
  observation: "検索サービスは構成比62.9%、増減率-5.4%で、全体の増減率は-0.9%です。",
  impact: "構成比62.9%のカテゴリの減少に対して全体の減少が小さいため、全体の値だけで各カテゴリの動きを判断せず、他カテゴリの寄与も確認する意味があります。無駄な支出や原因を特定したものではありません。",
  recommendedAction: "/cost のカテゴリ別構成比と増減率を比較し、検索サービスだけでなく他カテゴリも確認対象に含めるか判断してください。使用量や原因はこの集計からは分かりません。"
};

export function semanticCalibrationCases() {
  return {
    purpose: "本番データではない独立した例です。本番候補と同じ品質基準で各例を評価してください。",
    cases: [
      { caseId: "case-01", observations: cost, insight: goodCost },
      {
        caseId: "case-02", observations: cost,
        insight: {
          ...goodCost, title: "コストの確認を推奨",
          impact: "構成比は62.9%なので、状況に応じて注意が必要な可能性があります。",
          recommendedAction: "定期的にダッシュボードを確認してください。"
        }
      },
      {
        caseId: "case-03",
        observations: { ...cost, network: { sampled: 10, unsupported: 7, failed: 0 } },
        insight: {
          title: "ネットワークの監視リスク",
          observation: "ネットワーク10件中7件がメトリック対象外で、検索サービスのコスト構成比は62.9%です。",
          impact: "7件が対象外なので、ネットワークの稼働状況を把握しにくい可能性があります。",
          recommendedAction: "/network を定期確認して監視の見直しを検討してください。"
        }
      },
      {
        caseId: "case-04", observations: cost,
        insight: {
          ...goodCost, title: "検索サービスの確認でコスト削減が可能",
          impact: "検索サービスを確認すれば必ず5.4%のコスト削減ができ、全体の支出も改善します。",
          recommendedAction: "/cost で検索サービスを確認して、5.4%の削減効果を見込んでください。"
        }
      },
      {
        caseId: "case-05",
        observations: {
          advisor: [
            { category: "信頼性", impact: "高", count: 21 },
            { category: "信頼性", impact: "中", count: 27 },
            { category: "パフォーマンス", impact: "中", count: 1 }
          ],
          scope: "推奨レコード数であり対象リソースの重複は除いていません。詳細内容は含みません。",
          ui: "/security の Advisor カテゴリで信頼性を選択すると、影響度別の件数が表示されます。"
        },
        insight: {
          title: "Advisor のレビューは信頼性の影響度「高」から着手",
          observation: "信頼性は影響度「高」21件・「中」27件で、パフォーマンスの影響度「中」1件より多くなっています。",
          impact: "影響度「高」21件がある信頼性から確認することは、集計に基づくレビュー着手順として合理的です。個々の障害発生や21リソースへの影響を示すものではありません。",
          recommendedAction: "/security の Advisor カテゴリで「信頼性」を選び、影響度「高」の件数を他カテゴリと比較してレビューの着手順を決めてください。"
        }
      }
    ]
  };
}

// Expected judgements stay out of the model input.
export const EXPECTED_CALIBRATION: Readonly<Record<string, boolean>> = {
  "case-01": true, "case-02": false, "case-03": false, "case-04": false, "case-05": true
};
