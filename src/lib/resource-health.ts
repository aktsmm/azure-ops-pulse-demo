import type { ReliabilityCoverage, ResourceHealthStatus } from "../data/contracts";

/**
 * Resource types that Azure Resource Health evaluates, taken from
 * https://learn.microsoft.com/azure/service-health/resource-health-checks-resource-types
 *
 * Types outside this list are reported as "NotApplicable" (out of scope) instead of "Unknown"
 * (in scope but not evaluated) so the published snapshot never implies that a resource is
 * unmonitored when Azure simply does not publish health for it.
 */
export const RESOURCE_HEALTH_SUPPORTED_TYPES: ReadonlySet<string> = new Set(
  [
    "Microsoft.AlertsManagement/prometheusRuleGroups",
    "Microsoft.AnalysisServices/servers",
    "Microsoft.ApiManagement/service",
    "Microsoft.AppPlatform/Spring",
    "Microsoft.AVS/PrivateClouds",
    "Microsoft.AzureFleet/fleets",
    "Microsoft.Batch/batchAccounts",
    "Microsoft.Cache/Redis",
    "Microsoft.CDN/profile",
    "Microsoft.CDN/profiles",
    "Microsoft.ClassicCompute/domainNames",
    "Microsoft.ClassicCompute/virtualMachines",
    "Microsoft.CognitiveServices/accounts",
    "Microsoft.Compute/hostGroups/hosts",
    "Microsoft.Compute/virtualMachines",
    "Microsoft.Compute/virtualMachineScaleSets",
    "Microsoft.Compute/virtualMachineScaleSets/virtualMachines",
    "Microsoft.ContainerService/managedClusters",
    "Microsoft.Dashboard/grafana",
    "Microsoft.DataFactory/factories",
    "Microsoft.DataLakeAnalytics/accounts",
    "Microsoft.DataLakeStore/accounts",
    "Microsoft.DataMigration/services",
    "Microsoft.DataShare/accounts",
    "Microsoft.DBforMariaDB/servers",
    "Microsoft.DBforMySQL/flexibleServers",
    "Microsoft.DBforMySQL/servers",
    "Microsoft.DBforPostgreSQL/flexibleServers",
    "Microsoft.DBforPostgreSQL/serverGroupsv2",
    "Microsoft.DBforPostgreSQL/servers",
    "Microsoft.Devices/IotHubs",
    "Microsoft.DigitalTwins/DigitalTwinsInstances",
    "Microsoft.DocumentDB/databaseAccounts",
    "Microsoft.Easm/workspaces",
    "Microsoft.EventHub/namespaces",
    "Microsoft.ExtendedLocation/customLocations",
    "Microsoft.FluidRelay/fluidRelayServers",
    "Microsoft.HDInsight/clusters",
    "Microsoft.HealthcareApis/workspaces/dicomservices",
    "Microsoft.HybridCompute/machines",
    "Microsoft.HybridNetwork/devices",
    "Microsoft.HybridNetwork/networkFunctions",
    "Microsoft.Insights/scheduledQueryRules",
    "Microsoft.IoTCentral/IoTApps",
    "Microsoft.KeyVault/vaults",
    "Microsoft.Kubernetes/connectedClusters",
    "Microsoft.Kusto/clusters",
    "Microsoft.MachineLearning/webServices",
    "Microsoft.Media/mediaservices",
    "Microsoft.MobileNetwork/packetCoreControlPlanes",
    "Microsoft.Monitor/accounts",
    "Microsoft.Network/applicationGateways",
    "Microsoft.Network/azureFirewalls",
    "Microsoft.Network/bastionHosts",
    "Microsoft.Network/connections",
    "Microsoft.Network/dnsResolvers",
    "Microsoft.Network/dnsResolvers/inboundEndpoints",
    "Microsoft.Network/dnsResolvers/outboundEndpoints",
    "Microsoft.Network/dnsZones",
    "Microsoft.Network/expressRouteCircuits",
    "Microsoft.Network/expressRouteGateways",
    "Microsoft.Network/frontDoors",
    "Microsoft.Network/loadBalancers",
    "Microsoft.Network/natGateways",
    "Microsoft.Network/p2sVpnGateways",
    "Microsoft.Network/trafficManagerProfiles",
    "Microsoft.Network/virtualHubs",
    "Microsoft.Network/virtualNetworkGateways",
    "Microsoft.Network/vpnGateways",
    "Microsoft.Network/vpnGateways/vpnConnections",
    "Microsoft.Network/vpnGateways/vpnConnections/vpnLinkConnections",
    "Microsoft.NetworkCloud/bareMetalMachines",
    "Microsoft.NetworkCloud/clusterManagers",
    "Microsoft.NetworkCloud/clusters",
    "Microsoft.NetworkCloud/storageAppliances",
    "Microsoft.NotificationHubs/namespaces",
    "Microsoft.OnlineExperimentation/workspaces",
    "Microsoft.OperationalInsights/workspaces",
    "Microsoft.Orbital/contactProfiles",
    "Microsoft.Orbital/spacecrafts",
    "Microsoft.PowerBIDedicated/capacities",
    "Microsoft.Purview/accounts",
    "Microsoft.RecoveryServices/vaults",
    "Microsoft.RedHatOpenShift/openShiftClusters",
    "Microsoft.ResourceConnector/appliances",
    "Microsoft.SCOM/managedInstances",
    "Microsoft.Search/searchServices",
    "Microsoft.ServiceBus/namespaces",
    "Microsoft.ServiceFabric/clusters",
    "Microsoft.ServiceFabric/managedClusters",
    "Microsoft.SignalRService/SignalR",
    "Microsoft.SignalRService/SignalR/replicas",
    "Microsoft.SignalRService/WebPubSub",
    "Microsoft.Sql/managedInstances",
    "Microsoft.Sql/managedInstances/databases",
    "Microsoft.Sql/servers/databases",
    "Microsoft.Storage/storageAccounts",
    "Microsoft.StorageCache/caches",
    "Microsoft.StorageMover/storageMovers",
    "Microsoft.StreamAnalytics/streamingjobs",
    "Microsoft.Synapse/workspaces",
    "Microsoft.VideoIndexer/accounts",
    "Microsoft.VoiceServices/communicationsGateways",
    "Microsoft.Web/serverFarms",
    "Microsoft.Web/sites",
    "Microsoft.Workloads/monitors"
  ].map((type) => type.toLowerCase())
);

export function supportsResourceHealth(resourceType: string): boolean {
  return RESOURCE_HEALTH_SUPPORTED_TYPES.has(resourceType.trim().toLowerCase());
}

const AVAILABILITY_STATUS_SEGMENT = "/providers/microsoft.resourcehealth/";

/**
 * Azure Resource Manager does not guarantee the casing of resource IDs, and Azure Resource Graph
 * lowercases them for some tables. A case-sensitive split therefore silently fails to find the
 * parent resource and every resource ends up unmatched.
 */
export function parentResourceIdFromAvailabilityStatus(
  availabilityStatusId: string | undefined | null
): string | null {
  if (!availabilityStatusId) return null;
  const index = availabilityStatusId.toLowerCase().lastIndexOf(AVAILABILITY_STATUS_SEGMENT);
  if (index <= 0) return null;
  return availabilityStatusId.slice(0, index).toLowerCase();
}

export interface AvailabilityStatusRecord {
  id?: string | null;
  properties?: {
    targetResourceId?: string | null;
    availabilityState?: string | null;
    occurredTime?: string | null;
    occuredTime?: string | null;
  } | null;
}

export interface HealthIndexEntry {
  availabilityState: string;
  occurredTime: string | null;
}

function readOccurredTime(record: AvailabilityStatusRecord): string | null {
  // The REST API historically spells this "occuredTime"; Resource Graph uses "occurredTime".
  return record.properties?.occurredTime ?? record.properties?.occuredTime ?? null;
}

/**
 * Indexes availability statuses by lowercase parent resource ID. `properties.targetResourceId` is
 * the documented way to reach the evaluated resource; the availability status resource ID is only
 * used as a fallback.
 */
export function indexAvailabilityStatuses(
  records: readonly AvailabilityStatusRecord[]
): Map<string, HealthIndexEntry> {
  const index = new Map<string, HealthIndexEntry>();
  for (const record of records) {
    const target =
      record.properties?.targetResourceId?.toLowerCase() ??
      parentResourceIdFromAvailabilityStatus(record.id);
    const availabilityState = record.properties?.availabilityState;
    if (!target || !availabilityState) continue;
    const occurredTime = readOccurredTime(record);
    const existing = index.get(target);
    if (existing && (existing.occurredTime ?? "") >= (occurredTime ?? "")) continue;
    index.set(target, { availabilityState, occurredTime });
  }
  return index;
}

/**
 * `Unknown` is a real Resource Health state (the platform has not received a signal recently), so
 * it stays distinct from `NotApplicable`, which means the resource type is never evaluated.
 *
 * `evaluatedTypes` carries the resource types that actually returned a state during this
 * collection. A type that Azure evaluated is by definition supported, so passing it keeps a stale
 * static list from silently shrinking the coverage denominator.
 */
export function classifyResourceHealth(
  resourceType: string,
  availabilityState: string | undefined,
  evaluatedTypes?: ReadonlySet<string>
): ResourceHealthStatus {
  const state = availabilityState?.trim().toLowerCase();
  if (state === "available") return "Healthy";
  if (state === "degraded") return "Degraded";
  if (state === "unavailable") return "Unavailable";
  if (state === "unknown") return "Unknown";
  const normalizedType = resourceType.trim().toLowerCase();
  const supported =
    supportsResourceHealth(normalizedType) || (evaluatedTypes?.has(normalizedType) ?? false);
  return supported ? "Unknown" : "NotApplicable";
}

/**
 * Resource types that Azure Resource Health evaluated in this collection but that the static
 * support list does not know about. A non-empty result means the list has drifted.
 */
export function unlistedEvaluatedTypes(
  resources: ReadonlyArray<{ type: string; status?: string }>
): string[] {
  const drifted = new Set<string>();
  for (const resource of resources) {
    if (resource.status === undefined || resource.status === "NotApplicable") continue;
    const normalizedType = resource.type.trim().toLowerCase();
    if (!supportsResourceHealth(normalizedType)) drifted.add(normalizedType);
  }
  return [...drifted].sort();
}

export function summarizeReliabilityCoverage(
  resources: ReadonlyArray<{ status?: string }>
): ReliabilityCoverage {
  const coverage: ReliabilityCoverage = {
    totalResources: resources.length,
    supportedResources: 0,
    notApplicableResources: 0,
    evaluatedResources: 0,
    unevaluatedResources: 0,
    healthyResources: 0,
    degradedResources: 0,
    unavailableResources: 0,
    supportedCoveragePercent: null
  };
  for (const resource of resources) {
    if (resource.status === "NotApplicable") {
      coverage.notApplicableResources += 1;
      continue;
    }
    coverage.supportedResources += 1;
    if (resource.status === "Healthy") coverage.healthyResources += 1;
    else if (resource.status === "Degraded") coverage.degradedResources += 1;
    else if (resource.status === "Unavailable") coverage.unavailableResources += 1;
    else coverage.unevaluatedResources += 1;
  }
  coverage.evaluatedResources =
    coverage.healthyResources + coverage.degradedResources + coverage.unavailableResources;
  coverage.supportedCoveragePercent = coverage.supportedResources
    ? Math.round((coverage.evaluatedResources / coverage.supportedResources) * 100)
    : null;
  return coverage;
}

export function resourceHealthReport(coverage: ReliabilityCoverage): {
  availability: "available" | "partial" | "unavailable";
  message: string;
} {
  if (coverage.supportedResources === 0) {
    return {
      availability: "unavailable",
      message:
        "No inventoried resource type is covered by Azure Resource Health, so no availability state was published."
    };
  }
  if (coverage.evaluatedResources === 0) {
    return {
      availability: "unavailable",
      message: `Resource Health returned no availability state for any of the ${coverage.supportedResources} supported resources.`
    };
  }
  if (coverage.evaluatedResources < coverage.supportedResources) {
    return {
      availability: "partial",
      message: `Resource Health evaluated ${coverage.evaluatedResources} of ${coverage.supportedResources} supported resources; ${coverage.notApplicableResources} resources are outside Resource Health coverage.`
    };
  }
  return {
    availability: "available",
    message: `Resource Health evaluated all ${coverage.supportedResources} supported resources; ${coverage.notApplicableResources} resources are outside Resource Health coverage.`
  };
}
