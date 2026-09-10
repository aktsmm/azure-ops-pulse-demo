import type { AdvisorCategory, AdvisorRecommendationGroup } from "../data/contracts";

export const ADVISOR_CATEGORIES = ["Cost", "HighAvailability", "Performance", "Security", "OperationalExcellence", "Other"] as const;
export const ADVISOR_IMPACTS = ["High", "Medium", "Low", "Unknown"] as const;
export const ADVISOR_REFERENCE_URL = "https://learn.microsoft.com/ja-jp/azure/advisor/advisor-reference-reliability-recommendations";
export const ADVISOR_PERFORMANCE_REFERENCE_URL = "https://learn.microsoft.com/ja-jp/azure/advisor/advisor-reference-performance-recommendations";
export const ADVISOR_LIFECYCLE_URL = "https://learn.microsoft.com/ja-jp/azure/advisor/advisor-azure-resource-graph";
export const ADVISOR_SUMMARY_MESSAGE = "カテゴリ・影響度の件数は全ライフサイクルの推奨レコード数です。対応候補の内容別集計は完了・却下・延期を除外します。";
export const ADVISOR_DETAILS_MESSAGE = "内容は公式の種類 ID と照合した固定カタログです。影響度は期限ではありません。状態不明は未対応と断定せず、非公開の内容は Azure ポータルで確認してください。";

type CatalogContent = Pick<AdvisorRecommendationGroup,
  "id" | "category" | "contentStatus" | "title" | "description" | "recommendedAction" | "deferWhen" | "caveat" | "sourceUrl">;
interface CatalogEntry extends CatalogContent { resourceType: string }

// Reviewed 2026-09-10 against the official references above (Japanese GET 200).
// The source's recommendation IDs are matched ONLY in the collector, not bundled into the public UI.
// No remote title, template interpolation, substring echo, or custom/tracked recommendation is trusted.
// Review/defer conditions below are local decision guidance, not claims of Azure-mandated urgency.
const entry = (
  id: string, resourceType: string, title: string, description: string,
  recommendedAction: string, deferWhen: string,
  category: AdvisorCategory = "HighAvailability", sourceUrl = ADVISOR_REFERENCE_URL
): CatalogEntry => ({
  id, resourceType, category, contentStatus: "mapped", title, description,
  recommendedAction, deferWhen,
  caveat: "稼働用途・許容停止時間・復旧要件・費用は未収集です。適用可否と現在の状態を確認し、影響度だけで緊急対応を決めません。",
  sourceUrl
});

export const ADVISOR_CATALOG: readonly CatalogEntry[] = [
  entry("service-health-alert", "microsoft.subscriptions/subscriptions",
    "Service Health の通知経路を確認",
    "サービス障害や計画メンテナンスを担当者が認識できないと、初動が遅れる可能性があります。",
    "対象サービス・リージョンを選び、Service Health アラートの有無、受信担当、通知テストを確認します。",
    "同等の通知と担当者への連絡経路が検証済みなら、新規作成を保留し、対象範囲の変更時に再確認します。"),
  entry("vmss-automatic-repair", "microsoft.compute/virtualmachinescalesets",
    "VMSS の自動修復と復旧手順を確認",
    "異常インスタンスを検知しても修復が手動のままだと、サービス復旧が遅れる可能性があります。",
    "正常性シグナルと修復ポリシー、猶予時間、状態保持の影響を確認し、検証環境で障害時の復旧を試します。",
    "状態保持などの理由で自動修復が不適切でも、手動復旧が許容時間内に完了することを検証済みなら保留できます。"),
  entry("vmss-health-monitoring", "microsoft.compute/virtualmachinescalesets",
    "VMSS のアプリ正常性監視を確認",
    "アプリの異常を検知できないと、安全な更新や自動修復の判断に必要な情報が不足します。",
    "Application Health 拡張機能またはロードバランサーのプローブで、アプリの正常性が正しく判定されるか確認します。",
    "同等のアプリ正常性監視を実測で検証済みなら追加導入を保留し、更新・修復方式の変更時に再確認します。"),
  entry("outbound-nat-capacity", "microsoft.network/virtualnetworks",
    "送信接続の SNAT 容量と NAT Gateway を検討",
    "SNAT ポートが不足すると外部への接続が失敗する可能性があります。発生の有無はこの集計だけでは判断できません。",
    "送信経路とピーク接続数、接続失敗の記録を確認し、NAT Gateway の採用を現在の経路・費用と比較します。",
    "外部送信が不要、または既存経路でピーク時の容量と接続成功を検証済みなら保留し、負荷増加時に再評価します。"),
  entry("storage-zone-redundancy", "microsoft.storage/storageaccounts",
    "Storage のゾーン障害対策を確認",
    "単一データセンターに依存する構成では、障害時にデータへアクセスできなくなる可能性があります。",
    "現在の冗長化方式と許容停止時間を確認し、対応リージョン・アカウント条件・移行方法・追加費用を比較します。",
    "再生成できる検証データなどでゾーン停止を許容すると所有者が合意済みなら保留し、本番化や復旧要件変更時に再確認します。"),
  entry("blob-soft-delete", "microsoft.storage/storageaccounts",
    "Blob の誤削除・上書きからの復旧を確認",
    "論理的な削除や上書きはデータ複製だけでは防げません。復旧できる保持期間の確認が必要です。",
    "Blob の論理的な削除と保持期間、上書き時の保護、復元テストを確認し、復旧要件と保持コストを比較します。",
    "再生成可能な一時データ、または別の検証済み復元手段が要件を満たす場合は保留し、重要データの追加時に再評価します。"),
  entry("vm-availability-zones", "microsoft.compute/virtualmachines",
    "VM のゾーン配置と停止許容範囲を確認",
    "配置先のゾーン障害に備えるには、VM 単体の配置変更だけでなくアプリ全体の冗長化・復旧設計が必要です。",
    "現在の配置と依存先、冗長インスタンス、移行時の停止を確認し、ゾーン障害時に必要なサービスを継続できるか検討します。",
    "単一 VM の停止を許容し、復旧手順が許容時間を満たす検証・一時用途なら保留し、本番化時に再確認します。"),
  entry("container-apps-zone-redundancy", "microsoft.app/managedenvironments",
    "Container Apps 環境のゾーン冗長性を確認",
    "環境やアプリの配置が単一ゾーンに依存すると、ゾーン障害時に稼働を継続できない可能性があります。",
    "環境のゾーン設定、アプリのレプリカ数、ワークロードのノード数を確認し、移行方法と費用を復旧要件に照らして検討します。",
    "停止を許容する開発・検証用途で再作成手順が確認済みなら保留し、本番化や可用性要件変更時に再評価します。"),
  entry("registry-premium-tier", "microsoft.containerregistry/registries",
    "Container Registry の階層と本番要件を確認",
    "必要な処理容量や復元性の機能が現在の階層にない場合、イメージ取得や展開に影響する可能性があります。",
    "本番の同時取得数・帯域・必要な冗長化機能を確認し、Premium の機能と追加費用が要件に見合うか比較します。",
    "現行階層で負荷と復旧要件を満たすことを検証済みなら保留し、利用量や配備リージョンの増加時に再確認します。"),
  entry("registry-geo-replication", "microsoft.containerregistry/registries",
    "Container Registry のリージョン障害対策を確認",
    "単一リージョンに依存すると、障害時にイメージ取得や新しい展開ができなくなる可能性があります。",
    "障害時にイメージ取得が必要なリージョンと代替経路を確認し、Premium の geo レプリケーションを復旧要件・費用と比較します。",
    "リージョン障害中の新規展開を許容範囲内で停止でき、代替取得手段を検証済みなら保留し、DR 設計変更時に再評価します。"),
  entry("cosmos-continuous-backup", "microsoft.documentdb/databaseaccounts",
    "Cosmos DB の復元時点とバックアップ方式を確認",
    "定期バックアップでは復元できる時点が要件に合わない可能性があり、継続バックアップとの比較が必要です。",
    "許容データ損失と復元対象期間、利用 API の対応条件を確認し、継続バックアップの復元テストと費用を比較します。",
    "現在のバックアップと復元テストが合意済みのデータ損失・復旧時間を満たすなら保留し、要件変更時に再評価します。"),
  entry("search-replica-capacity", "microsoft.search/searchservices",
    "Azure AI Search のレプリカと可用性要件を確認",
    "レプリカが不足すると、メンテナンスや障害時のクエリ継続性に影響する可能性があります。",
    "レプリカ数とクエリ・インデックス更新の用途、必要な SLA 条件を確認し、追加レプリカの費用と継続性を比較します。",
    "検索停止を許容する検証用途で、現行構成の性能と復旧を検証済みなら保留し、本番化や SLA 要件変更時に再確認します。"),
  entry("storage-tls-version", "microsoft.storage/storageaccounts",
    "Storage の TLS 設定と接続互換性を確認",
    "古い TLS に依存するクライアントは、サービスの対応変更時に接続できなくなる可能性があります。",
    "最小 TLS 設定とクライアントの実接続バージョンを確認し、公式の適用条件・日程と照合して互換性テストを計画します。",
    "対応済み TLS で全接続を検証し、対象外または解消済みと確認できた場合だけ変更を保留し、状態を再確認します。"),
  entry("cosmos-missing-indexes", "microsoft.documentdb/databaseaccounts",
    "Cosmos DB の不足インデックスを確認",
    "インデックスの追加で、クエリの要求ユニット消費量や応答時間を改善できる可能性があります。具体的なクエリ・パス・実測値は未収集です。",
    "Azure ポータルで推奨されたインデックス パスと現在のポリシーを確認し、対象クエリの応答時間・要求ユニット消費量を追加前後で比較します。読み書き双方の負荷を検証して適用を判断します。",
    "現行クエリの応答時間と要求ユニット消費量が合意済みの目標を満たし、追加インデックスの効果が検証で確認できない場合は保留し、クエリや負荷の変更時に再評価します。",
    "Performance", ADVISOR_PERFORMANCE_REFERENCE_URL)
];

export const ADVISOR_RESOURCE_TYPES = [...new Set(ADVISOR_CATALOG.map((item) => item.resourceType)), "other"];

export function advisorContent(id: string, category: AdvisorCategory): CatalogContent {
  const known = ADVISOR_CATALOG.find((item) => item.id === id && item.category === category);
  if (known) {
    return {
      id: known.id, category: known.category, contentStatus: known.contentStatus,
      title: known.title, description: known.description, recommendedAction: known.recommendedAction,
      deferWhen: known.deferWhen, caveat: known.caveat, sourceUrl: known.sourceUrl
    };
  }
  return {
    id: `withheld-${category.toLowerCase()}`, category, contentStatus: "withheld",
    title: "内容未分類の推奨事項",
    description: "公開用カタログで内容を確認できないため、元のタイトル・説明は公開していません。",
    recommendedAction: "Azure ポータルで内容・対象・現在の状態を確認し、業務要件に照らして対応を判断します。",
    deferWhen: "内容を確認するまでは対応不要とも緊急とも判断しません。対象外や解消済みと確認できた場合に保留を判断します。",
    caveat: "カテゴリと影響度のみでは具体的なリスクや対策を特定できません。セキュリティの状態は Defender for Cloud でも確認します。",
    sourceUrl: ADVISOR_LIFECYCLE_URL
  };
}
