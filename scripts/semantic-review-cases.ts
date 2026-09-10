// Version 2: the user's content-first requirement rejects count-only Advisor prioritization.
// Synthetic examples exercise the reviewer without becoming published observations.
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
          ui: "/recommendations の Advisor カテゴリで信頼性を選択すると、影響度別の件数が表示されます。"
        },
        insight: {
          title: "Advisor のレビューは信頼性の影響度「高」から着手",
          observation: "信頼性は影響度「高」21件・「中」27件で、パフォーマンスの影響度「中」1件より多くなっています。",
          impact: "影響度「高」21件がある信頼性から確認することは、集計に基づくレビュー着手順として合理的です。個々の障害発生や21リソースへの影響を示すものではありません。",
          recommendedAction: "/recommendations の Advisor カテゴリで「信頼性」を選び、影響度「高」の件数を他カテゴリと比較してレビューの着手順を決めてください。"
        }
      },
      {
        caseId: "case-06",
        observations: {
          recommendation: "可用性ゾーンを利用した冗長化の検討",
          contentStatus: "mapped",
          records: 3,
          affectedResourceCount: 2,
          impact: "高",
          guidance: "ゾーン障害に対する継続性が必要な場合は冗長化構成を確認する。停止を許容できる検証用途なら費用との比較で保留を検討できる。",
          unknowns: "本番・検証の用途、停止許容時間、既存の代替構成、追加費用は未収集。",
          ui: "/recommendations に内容別カード、確認ガイド、対象リソース数が表示されます。"
        },
        insight: {
          title: "冗長化の推奨は、件数より停止許容条件を先に確認",
          observation: "可用性ゾーンを利用した冗長化の推奨が3レコードあり、重複を除いた対象は2リソースです。",
          impact: "2リソースに対する冗長化の検討であり、3件の障害を示しません。ゾーン障害時にも稼働継続が必要な用途なら確認を優先しますが、現在のデータからその用途は断定できません。",
          recommendedAction: "/recommendations の冗長化カードで確認ガイドを読み、運用担当者と停止許容条件や代替構成を確認してください。停止を許容する検証用途なら追加費用と比較して保留できるか判断し、用途未確認のまま対応不要とは決めないでください。"
        }
      },
      {
        caseId: "case-07",
        observations: {
          recommendation: "バックアップの復旧設定を確認",
          contentStatus: "mapped",
          records: 1,
          impact: "低",
          unknowns: "データの重要度、既存バックアップ、復旧要件は未収集。"
        },
        insight: {
          title: "低影響の推奨は対応不要",
          observation: "バックアップの推奨は影響度「低」で1件だけです。",
          impact: "1件だけで影響度が低いため、データ消失の心配はありません。",
          recommendedAction: "対応せず放置してかまいません。"
        }
      },
      {
        caseId: "case-08", observations: cost,
        insight: {
          ...goodCost,
          recommendedAction: "/cost で検索サービスと他カテゴリの増減を比較して調査対象を絞ってください。原因調査が必要なら、運用担当者が Azure portal のコスト分析で対象カテゴリの使用量と料金内訳を確認します。使用量や原因はこのダッシュボードでは未観測です。"
        }
      },
      {
        caseId: "case-09",
        observations: {
          source: "Defender for Cloud", availability: "partial",
          activeAlerts: 1, secureScore: null,
          fieldAvailability: { activeAlerts: "available", secureScore: "unavailable" },
          unknowns: "アラートの内容、重要度、対象、業務影響は未収集。",
          ui: "/security に取得済みアクティブアラート件数を表示。詳細確認は Azure portal で行う。"
        },
        insight: {
          title: "アラートの内容確認はスコア取得待ちにしない",
          observation: "アクティブアラートは1件を取得済みですが、セキュリティスコアは未取得です。",
          impact: "取得済みの1件は内容確認の対象です。スコアの欠落で確認を遅らせる必要はありませんが、侵害や業務影響が発生したと判断できる情報はありません。",
          recommendedAction: "/security の件数を起点に、運用担当者が Azure portal の Defender for Cloud でアラートの重要度と対象を確認し、対応または誤検知としての扱いを判断してください。"
        }
      }
    ]
  };
}

// Expected judgements stay out of the model input.
export const EXPECTED_CALIBRATION: Readonly<Record<string, boolean>> = {
  "case-01": true, "case-02": false, "case-03": false, "case-04": false,
  "case-05": false, "case-06": true, "case-07": false,
  "case-08": true, "case-09": true
};
