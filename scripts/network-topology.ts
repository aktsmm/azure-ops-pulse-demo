import type { NetworkTopology, RawResource, TopologyEdgeKind } from "../src/data/contracts";
import { CollectionError } from "./collection-diagnostics";
import { normalizeResourceId } from "../src/lib/sanitize";
import { isPrivateIpv4, isPrivateCidr, publicIpv4Mask, sanitizeNetworkEvidence } from "../src/lib/network-evidence";

// Only references and structured address fields are consumed; names, tags and routing rules stay private.
// https://learn.microsoft.com/ja-jp/azure/governance/resource-graph/samples/samples-by-category
export const TOPOLOGY_QUERY = `Resources
| where type in~ ('microsoft.network/virtualnetworks', 'microsoft.network/virtualnetworks/subnets',
  'microsoft.network/networkinterfaces', 'microsoft.network/privateendpoints',
  'microsoft.network/networksecuritygroups', 'microsoft.network/routetables',
  'microsoft.network/natgateways', 'microsoft.network/loadbalancers',
  'microsoft.network/applicationgateways', 'microsoft.network/publicipaddresses',
  'microsoft.compute/virtualmachines')
| project id, type, location,
  addressSpace=properties.addressSpace, addressPrefix=properties.addressPrefix,
  addressPrefixes=properties.addressPrefixes, ipAddress=properties.ipAddress,
  privateIPAddress=properties.privateIPAddress,
  subnets=properties.subnets, subnet=properties.subnet,
  virtualNetworkPeerings=properties.virtualNetworkPeerings,
  virtualMachine=properties.virtualMachine, networkProfile=properties.networkProfile,
  networkInterfaces=properties.networkInterfaces,
  networkSecurityGroup=properties.networkSecurityGroup, routeTable=properties.routeTable,
  natGateway=properties.natGateway, ipConfigurations=properties.ipConfigurations,
  gatewayIPConfigurations=properties.gatewayIPConfigurations,
  frontendIPConfigurations=properties.frontendIPConfigurations,
  backendAddressPools=properties.backendAddressPools,
  publicIpAddresses=properties.publicIpAddresses,
  privateLinkServiceConnections=properties.privateLinkServiceConnections,
  manualPrivateLinkServiceConnections=properties.manualPrivateLinkServiceConnections`;

export interface TopologyRow {
  id: string;
  type: string;
  location?: string | null;
  properties?: unknown;
}

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};

function addressEvidence(properties: unknown) {
  const p = object(properties);
  const configurations = ["ipConfigurations", "frontendIPConfigurations", "gatewayIPConfigurations"]
    .flatMap((field) => Array.isArray(p[field]) ? p[field] as unknown[] : [])
    .map((item) => object(object(item).properties));
  const privateIpv4 = [p.privateIPAddress, ...configurations.map((item) => item.privateIPAddress)]
    .filter((value): value is string => typeof value === "string" && isPrivateIpv4(value));
  const prefixes = [p.addressPrefix,
    ...(Array.isArray(p.addressPrefixes) ? p.addressPrefixes : []),
    ...(Array.isArray(object(p.addressSpace).addressPrefixes) ? object(p.addressSpace).addressPrefixes as unknown[] : [])];
  const privateCidrs = prefixes.filter((value): value is string => typeof value === "string" && isPrivateCidr(value));
  const masked = typeof p.ipAddress === "string" ? publicIpv4Mask(p.ipAddress) : null;
  return sanitizeNetworkEvidence({ privateIpv4, privateCidrs, publicIpv4Masked: masked ? [masked] : [], truncated: false });
}

function armType(id: string): string | null {
  const segments = id.split("/").filter(Boolean);
  const provider = segments.findIndex((part) => part.toLowerCase() === "providers");
  if (provider < 0 || segments.length < provider + 4) return null;
  const namespace = segments[provider + 1];
  const types = segments.slice(provider + 2).filter((_, index) => index % 2 === 0);
  if (!namespace || !/^microsoft\.[a-z0-9]+$/i.test(namespace) ||
      types.some((type) => !/^[a-z][a-z0-9]*$/i.test(type)) ||
      (segments.length - provider - 2) % 2 !== 0) return null;
  return [namespace, ...types].join("/").toLowerCase();
}

export function buildNetworkTopology(
  rows: readonly TopologyRow[],
  inventory: readonly RawResource[],
  subscriptionId: string,
  limits = { nodes: 400, edges: 800 }
): NetworkTopology {
  const known = new Map(inventory.map((item) => [normalizeResourceId(item.id), item]));
  const observed = new Map<string, TopologyRow>();
  let incomplete = false;
  let truncated = false;
  const nodes = new Map<string, NetworkTopology["nodes"][number]>();
  const edges = new Map<string, NetworkTopology["edges"][number]>();
  const list = (value: unknown): unknown[] => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) { incomplete = true; return []; }
    return value.filter((item) => {
      const valid = item !== null && typeof item === "object" && !Array.isArray(item);
      if (!valid) incomplete = true;
      return valid;
    });
  };
  for (const row of rows) {
    if (!row || typeof row.id !== "string" || !armType(row.id) ||
        typeof row.type !== "string" || row.type.toLowerCase() !== armType(row.id)) {
      throw new CollectionError("invalid-response");
    }
    observed.set(normalizeResourceId(row.id), row);
    if (!row.properties || typeof row.properties !== "object" || Array.isArray(row.properties)) incomplete = true;
    if (row.type.toLowerCase() === "microsoft.network/virtualnetworks") {
      for (const value of list(object(row.properties).subnets)) {
        const subnet = object(value);
        if (typeof subnet.id !== "string" || armType(subnet.id) !== "microsoft.network/virtualnetworks/subnets") {
          incomplete = true;
          continue;
        }
        observed.set(normalizeResourceId(subnet.id), {
          id: subnet.id, type: "microsoft.network/virtualnetworks/subnets",
          location: row.location, properties: subnet.properties
        });
      }
    }
    for (const field of ["ipConfigurations", "gatewayIPConfigurations", "frontendIPConfigurations", "backendAddressPools"]) {
      if (field === "ipConfigurations" && row.type.toLowerCase() === "microsoft.network/virtualnetworks/subnets") continue;
      for (const value of list(object(row.properties)[field])) {
        const child = object(value);
        // Missing optional child IDs cannot be guessed from names. Parent-level references still work.
        if (child.id === undefined) continue;
        if (typeof child.id !== "string" || !armType(child.id) ||
            !normalizeResourceId(child.id).startsWith(`${normalizeResourceId(row.id)}/`)) {
          incomplete = true;
          continue;
        }
        observed.set(normalizeResourceId(child.id), {
          id: child.id, type: armType(child.id)!, location: row.location, properties: child.properties
        });
      }
    }
  }
  const addNode = (id: string): string | null => {
    const key = normalizeResourceId(id);
    if (nodes.has(key)) return nodes.get(key)!.id;
    const type = armType(id);
    if (!type) { incomplete = true; return null; }
    if (nodes.size >= limits.nodes) { truncated = true; return null; }
    const item = known.get(key);
    const observedItem = observed.get(key);
    const referenceOnly = !item && !observedItem;
    const ownScope = key.startsWith(`/subscriptions/${subscriptionId.toLowerCase()}/`);
    const originalId = item?.id ?? observedItem?.id ?? id;
    const region = item?.location ?? observedItem?.location;
    nodes.set(key, {
      id: originalId, type: item?.type ?? observedItem?.type ?? type,
      ...(region ? { region } : {}),
      ...(observedItem?.properties ? { network: addressEvidence(observedItem.properties) } : {}),
      referenceOnly,
      scope: referenceOnly ? ownScope ? "uncollected" : "external" : "inventory"
    });
    return originalId;
  };
  const link = (source: string, value: unknown, kind: TopologyEdgeKind): void => {
    if (value === undefined || value === null) return;
    const target = object(value).id;
    if (typeof target !== "string" || !target) { incomplete = true; return; }
    const key = `${normalizeResourceId(source)}|${normalizeResourceId(target)}|${kind}`;
    if (edges.has(key)) return;
    if (edges.size >= limits.edges) { truncated = true; return; }
    const sourceId = addNode(source);
    const targetId = addNode(target);
    if (sourceId && targetId) edges.set(key, { source: sourceId, target: targetId, kind });
  };
  const ipConfiguration = (source: string, value: unknown): void => {
    if (!object(value).properties || typeof object(value).properties !== "object") incomplete = true;
    const p = object(object(value).properties);
    link(source, p.subnet, "subnet");
    link(source, p.publicIPAddress, "public-ip");
    for (const ref of list(p.loadBalancerBackendAddressPools)) link(source, ref, "backend");
    for (const ref of list(p.applicationGatewayBackendAddressPools)) link(source, ref, "backend");
  };
  for (const row of [...observed.values()].sort((a, b) => normalizeResourceId(a.id).localeCompare(normalizeResourceId(b.id)))) {
    // Unconnected VMs are outside this graph. The VM-side NIC reference also works when NIC inventory is missing.
    if (row.type.toLowerCase() === "microsoft.compute/virtualmachines") {
      for (const ref of list(object(object(row.properties).networkProfile).networkInterfaces)) {
        const id = object(ref).id;
        if (typeof id === "string") link(id, { id: row.id }, "virtual-machine");
        else incomplete = true;
      }
      continue;
    }
    addNode(row.id);
    if (!row.properties || typeof row.properties !== "object" || Array.isArray(row.properties)) incomplete = true;
    const p = object(row.properties);
    link(row.id, p.subnet, "subnet");
    link(row.id, p.virtualMachine, "virtual-machine");
    link(row.id, p.networkSecurityGroup, "network-security-group");
    link(row.id, p.routeTable, "route-table");
    link(row.id, p.natGateway, "nat-gateway");
    link(row.id, p.publicIPAddress, "public-ip");
    for (const subnet of list(p.subnets)) {
      const type = row.type.toLowerCase();
      if (type === "microsoft.network/virtualnetworks") link(row.id, subnet, "contains");
      else {
        const subnetId = object(subnet).id;
        const kind = type === "microsoft.network/networksecuritygroups" ? "network-security-group"
          : type === "microsoft.network/routetables" ? "route-table"
            : type === "microsoft.network/natgateways" ? "nat-gateway" : null;
        if (kind && typeof subnetId === "string") link(subnetId, { id: row.id }, kind);
        else incomplete = true;
      }
    }
    for (const peer of list(p.virtualNetworkPeerings)) link(row.id, object(object(peer).properties).remoteVirtualNetwork, "peering");
    for (const nic of list(p.networkInterfaces)) {
      if (row.type.toLowerCase() === "microsoft.network/networksecuritygroups") {
        const nicId = object(nic).id;
        if (typeof nicId === "string") link(nicId, { id: row.id }, "network-security-group");
        else incomplete = true;
      } else link(row.id, nic, "backend");
    }
    const isSubnet = row.type.toLowerCase() === "microsoft.network/virtualnetworks/subnets";
    for (const ip of list(p.ipConfigurations)) {
      if (isSubnet) {
        const ipId = object(ip).id;
        if (typeof ipId === "string") link(ipId, { id: row.id }, "subnet");
        else incomplete = true;
      } else ipConfiguration(row.id, ip);
    }
    for (const ip of list(p.gatewayIPConfigurations)) ipConfiguration(row.id, ip);
    for (const ip of list(p.frontendIPConfigurations)) ipConfiguration(row.id, ip);
    for (const ip of [...(isSubnet ? [] : list(p.ipConfigurations)), ...list(p.gatewayIPConfigurations)]) {
      if (object(ip).id !== undefined) link(row.id, ip, "contains");
    }
    for (const ip of list(p.frontendIPConfigurations)) {
      if (object(ip).id !== undefined) link(row.id, ip, "frontend");
    }
    for (const ref of list(p.loadBalancerBackendAddressPools)) link(row.id, ref, "backend");
    for (const ref of list(p.applicationGatewayBackendAddressPools)) link(row.id, ref, "backend");
    for (const ref of list(p.backendIPConfigurations)) link(row.id, ref, "backend");
    for (const ref of list(p.publicIpAddresses)) link(row.id, ref, "public-ip");
    for (const connection of [...list(p.privateLinkServiceConnections), ...list(p.manualPrivateLinkServiceConnections)]) {
      const target = object(object(connection).properties).privateLinkServiceId;
      if (target !== undefined) link(row.id, { id: target }, "private-link");
    }
    for (const pool of list(p.backendAddressPools)) {
      const poolObject = object(pool);
      link(row.id, pool, "backend");
      if (typeof poolObject.id !== "string") continue;
      // Embedded pool records are directly observed, not merely an inferred association.
      const poolNode = nodes.get(normalizeResourceId(poolObject.id));
      if (poolNode) { poolNode.referenceOnly = false; poolNode.scope = "inventory"; }
      for (const ip of list(object(poolObject.properties).backendIPConfigurations)) link(poolObject.id, ip, "backend");
    }
  }
  const references = [...nodes.values()].filter((node) => node.referenceOnly).length;
  return {
    availability: truncated || incomplete || references > 0 ? "partial" : "available",
    message: truncated
      ? "構成参照を収集しましたが、公開グラフの上限で一部を省略しました。線は通信状態を示しません。"
      : incomplete || references > 0
        ? "構成参照を一部収集しました。参照先が未収集・対象スコープ外、または一部プロパティが未取得です。線は通信状態を示しません。"
        : rows.length
          ? "明示的な構成参照のみを収集しました。通信経路・許可・正常性を示す図ではありません。"
          : "構成の読み取りは成功しましたが、対象のネットワークリソースは返されませんでした。",
    nodes: [...nodes.values()], edges: [...edges.values()], truncated
  };
}
