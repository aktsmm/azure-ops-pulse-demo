import type { ResourceItem } from "../data/contracts";

export const RESOURCE_CATEGORIES = [
  "コンピューティング", "ネットワーク", "ストレージ", "データベース",
  "Web・アプリ", "AI・検索", "監視・運用", "セキュリティ・ID", "その他"
] as const;
export type ResourceCategory = (typeof RESOURCE_CATEGORIES)[number];

interface ResourceTypeInfo {
  label: string;
  category: ResourceCategory;
  aliases: string;
}

const TYPES: Record<string, ResourceTypeInfo> = {
  "microsoft.compute/virtualmachines": { label: "仮想マシン (VM)", category: "コンピューティング", aliases: "vm virtual machine サーバー" },
  "microsoft.compute/virtualmachinescalesets": { label: "VM スケール セット", category: "コンピューティング", aliases: "vm vmss virtual machine サーバー" },
  "microsoft.compute/disks": { label: "マネージド ディスク", category: "ストレージ", aliases: "disk hdd ssd" },
  "microsoft.containerservice/managedclusters": { label: "Azure Kubernetes Service (AKS)", category: "コンピューティング", aliases: "aks k8s kubernetes コンテナー" },
  "microsoft.containerregistry/registries": { label: "コンテナー レジストリ (ACR)", category: "コンピューティング", aliases: "acr docker container コンテナー" },
  "microsoft.app/containerapps": { label: "Container Apps", category: "Web・アプリ", aliases: "aca container コンテナー" },
  "microsoft.app/jobs": { label: "Container Apps ジョブ", category: "Web・アプリ", aliases: "aca job container コンテナー" },
  "microsoft.app/managedenvironments": { label: "Container Apps 環境", category: "Web・アプリ", aliases: "aca environment コンテナー" },
  "microsoft.web/sites": { label: "App Service / Functions", category: "Web・アプリ", aliases: "web app function website 関数 ウェブ" },
  "microsoft.web/serverfarms": { label: "App Service プラン", category: "Web・アプリ", aliases: "web app plan ウェブ" },
  "microsoft.web/staticsites": { label: "Static Web Apps", category: "Web・アプリ", aliases: "swa website 静的 ウェブ" },
  "microsoft.web/connections": { label: "API 接続", category: "Web・アプリ", aliases: "api connection connector コネクター" },
  "microsoft.logic/workflows": { label: "Logic Apps", category: "Web・アプリ", aliases: "workflow ワークフロー 自動化" },
  "microsoft.network/virtualnetworks": { label: "仮想ネットワーク (VNet)", category: "ネットワーク", aliases: "nw vnet virtual network" },
  "microsoft.network/virtualnetworks/subnets": { label: "サブネット", category: "ネットワーク", aliases: "nw subnet" },
  "microsoft.network/networkinterfaces": { label: "ネットワーク インターフェイス (NIC)", category: "ネットワーク", aliases: "nw nic" },
  "microsoft.network/networksecuritygroups": { label: "ネットワーク セキュリティ グループ (NSG)", category: "ネットワーク", aliases: "nw nsg firewall ファイアウォール" },
  "microsoft.network/publicipaddresses": { label: "パブリック IP", category: "ネットワーク", aliases: "nw pip public ip" },
  "microsoft.network/loadbalancers": { label: "ロード バランサー", category: "ネットワーク", aliases: "nw lb load balancer" },
  "microsoft.network/applicationgateways": { label: "Application Gateway", category: "ネットワーク", aliases: "nw appgw waf ゲートウェイ" },
  "microsoft.network/privateendpoints": { label: "プライベート エンドポイント", category: "ネットワーク", aliases: "nw pe private endpoint privatelink" },
  "microsoft.network/natgateways": { label: "NAT ゲートウェイ", category: "ネットワーク", aliases: "nw nat gateway" },
  "microsoft.network/routetables": { label: "ルート テーブル", category: "ネットワーク", aliases: "nw route udr" },
  "microsoft.network/networkwatchers": { label: "Network Watcher", category: "ネットワーク", aliases: "nw watcher" },
  "microsoft.network/virtualnetworkgateways": { label: "仮想ネットワーク ゲートウェイ", category: "ネットワーク", aliases: "nw vpn expressroute gateway" },
  "microsoft.network/privatednszones": { label: "プライベート DNS ゾーン", category: "ネットワーク", aliases: "nw dns" },
  "microsoft.network/azurefirewalls": { label: "Azure Firewall", category: "ネットワーク", aliases: "nw firewall ファイアウォール" },
  "microsoft.storage/storageaccounts": { label: "ストレージ アカウント", category: "ストレージ", aliases: "storage blob file ファイル" },
  "microsoft.documentdb/databaseaccounts": { label: "Azure Cosmos DB", category: "データベース", aliases: "db database nosql mongo データベース" },
  "microsoft.sql/servers": { label: "SQL 論理サーバー", category: "データベース", aliases: "db database sql" },
  "microsoft.sql/servers/databases": { label: "SQL データベース", category: "データベース", aliases: "db database sql" },
  "microsoft.dbforpostgresql/flexibleservers": { label: "PostgreSQL サーバー", category: "データベース", aliases: "db database postgres" },
  "microsoft.dbformysql/flexibleservers": { label: "MySQL サーバー", category: "データベース", aliases: "db database mysql" },
  "microsoft.cache/redis": { label: "Redis キャッシュ", category: "データベース", aliases: "db database cache" },
  "microsoft.cognitiveservices/accounts": { label: "AI サービス", category: "AI・検索", aliases: "ai openai cognitive foundry 生成ai" },
  "microsoft.search/searchservices": { label: "Azure AI Search", category: "AI・検索", aliases: "ai search 検索" },
  "microsoft.insights/components": { label: "Application Insights", category: "監視・運用", aliases: "apm monitor 監視" },
  "microsoft.insights/actiongroups": { label: "アクション グループ", category: "監視・運用", aliases: "monitor alert アラート 通知" },
  "microsoft.insights/datacollectionrules": { label: "データ収集ルール (DCR)", category: "監視・運用", aliases: "monitor dcr 監視" },
  "microsoft.insights/datacollectionendpoints": { label: "データ収集エンドポイント (DCE)", category: "監視・運用", aliases: "monitor dce 監視" },
  "microsoft.operationalinsights/workspaces": { label: "Log Analytics ワークスペース", category: "監視・運用", aliases: "log monitor law ログ 監視" },
  "microsoft.alertsmanagement/smartdetectoralertrules": { label: "スマート検出アラート", category: "監視・運用", aliases: "alert monitor アラート" },
  "microsoft.automation/automationaccounts": { label: "Automation アカウント", category: "監視・運用", aliases: "automation 自動化" },
  "microsoft.automation/automationaccounts/runbooks": { label: "Automation Runbook", category: "監視・運用", aliases: "automation runbook 自動化" },
  "microsoft.managedidentity/userassignedidentities": { label: "マネージド ID", category: "セキュリティ・ID", aliases: "identity managed id 認証" },
  "microsoft.keyvault/vaults": { label: "Key Vault", category: "セキュリティ・ID", aliases: "key secret セキュリティ 鍵" }
};

const PROVIDERS: Record<string, ResourceCategory> = {
  "microsoft.compute": "コンピューティング",
  "microsoft.containerservice": "コンピューティング",
  "microsoft.network": "ネットワーク",
  "microsoft.storage": "ストレージ",
  "microsoft.sql": "データベース",
  "microsoft.documentdb": "データベース",
  "microsoft.dbforpostgresql": "データベース",
  "microsoft.dbformysql": "データベース",
  "microsoft.web": "Web・アプリ",
  "microsoft.app": "Web・アプリ",
  "microsoft.insights": "監視・運用",
  "microsoft.operationsmanagement": "監視・運用",
  "microsoft.chaos": "監視・運用",
  "microsoft.azureresiliencemanagement": "監視・運用",
  "microsoft.security": "セキュリティ・ID",
  "microsoft.keyvault": "セキュリティ・ID",
  "microsoft.machinelearningservices": "AI・検索",
  "microsoft.cognitiveservices": "AI・検索"
};

export function resourceTypeInfo(type: string): ResourceTypeInfo {
  const key = type.toLowerCase();
  return TYPES[key] ?? {
    label: type.split("/").slice(1).join(" / ") || type,
    category: PROVIDERS[key.split("/")[0]!] ?? "その他",
    aliases: key.startsWith("microsoft.network/") ? "nw network" : ""
  };
}

export function resourceTypeLabel(type: string): string {
  return resourceTypeInfo(type).label;
}

const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ja-JP");

export function matchesResourceQuery(resource: ResourceItem, query: string): boolean {
  const info = resourceTypeInfo(resource.type);
  const haystack = normalize([
    resource.id, resource.name, resource.type, info.label, info.category, info.aliases,
    resource.region, resource.resourceGroup, resource.owner,
    ...Object.entries(resource.tags).flat()
  ].join(" "));
  return normalize(query).trim().split(/\s+/).every((term) => haystack.includes(term));
}
