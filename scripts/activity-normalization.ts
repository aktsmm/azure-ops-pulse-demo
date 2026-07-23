export type AzureActivityLabel =
  | string
  | {
      value?: unknown;
      localizedValue?: unknown;
    }
  | null;

export interface AzureActivityEvent {
  category?: AzureActivityLabel;
  operationName?: AzureActivityLabel;
  level?: string;
  eventTimestamp?: string;
}

const OPERATION_LABELS = new Map<string, string>([
  ["microsoft.resources/subscriptions/resourcegroups/write", "リソース グループの作成または更新"],
  ["microsoft.resources/subscriptions/resourcegroups/delete", "リソース グループの削除"],
  ["microsoft.resources/deployments/write", "デプロイの作成または更新"],
  ["microsoft.resources/deployments/delete", "デプロイの削除"],
  ["microsoft.compute/virtualmachines/write", "仮想マシンの作成または更新"],
  ["microsoft.compute/virtualmachines/delete", "仮想マシンの削除"],
  ["microsoft.compute/virtualmachines/start/action", "仮想マシンの起動"],
  ["microsoft.compute/virtualmachines/restart/action", "仮想マシンの再起動"],
  ["microsoft.compute/virtualmachines/deallocate/action", "仮想マシンの割り当て解除"],
  ["microsoft.network/virtualnetworks/write", "仮想ネットワークの作成または更新"],
  ["microsoft.network/virtualnetworks/delete", "仮想ネットワークの削除"],
  ["microsoft.storage/storageaccounts/write", "ストレージ アカウントの作成または更新"],
  ["microsoft.storage/storageaccounts/delete", "ストレージ アカウントの削除"]
]);

const CATEGORY_LABELS = new Map<string, string>([
  ["administrative", "管理操作"],
  ["管理", "管理操作"],
  ["security", "セキュリティ操作"],
  ["セキュリティ", "セキュリティ操作"],
  ["servicehealth", "Service Health 操作"],
  ["resourcehealth", "Resource Health 操作"],
  ["alert", "アラート操作"],
  ["autoscale", "自動スケール操作"],
  ["policy", "ポリシー操作"],
  ["recommendation", "推奨事項操作"]
]);

function readAllowlistCandidates(label: AzureActivityLabel | undefined): string[] {
  if (typeof label === "string") return [label];
  if (!label || typeof label !== "object" || Array.isArray(label)) return [];
  return [label.value, label.localizedValue].filter(
    (candidate): candidate is string => typeof candidate === "string"
  );
}

function allowlistedLabel(
  label: AzureActivityLabel | undefined,
  allowlist: Map<string, string>
): string | null {
  for (const candidate of readAllowlistCandidates(label)) {
    const mapped = allowlist.get(candidate.trim().toLowerCase());
    if (mapped) return mapped;
  }
  return null;
}

export function normalizeActivityOperationLabel(event: AzureActivityEvent): string {
  return (
    allowlistedLabel(event.operationName, OPERATION_LABELS) ??
    allowlistedLabel(event.category, CATEGORY_LABELS) ??
    "変更操作"
  );
}
