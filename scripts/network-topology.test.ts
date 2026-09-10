import { describe, expect, it } from "vitest";
import type { RawResource } from "../src/data/contracts";
import { sanitizeTopology, resourceRef } from "../src/lib/sanitize";
import { buildNetworkTopology, TOPOLOGY_QUERY, type TopologyRow } from "./network-topology";

const sub = "00000000-0000-0000-0000-000000000001";
const prefix = `/subscriptions/${sub}/resourceGroups/private-project/providers/`;
const arm = (type: string, name: string) => `${prefix}${type}/${name}`;
const vnet = arm("Microsoft.Network/virtualNetworks", "private-vnet");
const subnet = `${vnet}/subnets/private-subnet`;
const nic = arm("Microsoft.Network/networkInterfaces", "private-nic");
const vm = arm("Microsoft.Compute/virtualMachines", "private-vm");
const nsg = arm("Microsoft.Network/networkSecurityGroups", "private-nsg");
const routes = arm("Microsoft.Network/routeTables", "private-routes");
const nat = arm("Microsoft.Network/natGateways", "private-nat");
const privateEndpoint = arm("Microsoft.Network/privateEndpoints", "private-endpoint");
const row = (id: string, type: string, properties: object = {}): TopologyRow => ({
  id, type, location: "japaneast", properties
});
const fixture: TopologyRow[] = [
  row(vnet, "microsoft.network/virtualnetworks", {
    addressSpace: { addressPrefixes: ["10.92.0.0/16"] },
    subnets: [{ id: subnet, properties: { networkSecurityGroup: { id: nsg }, routeTable: { id: routes }, natGateway: { id: nat } } }]
  }),
  row(nic, "microsoft.network/networkinterfaces", {
    virtualMachine: { id: vm.toUpperCase() },
    ipConfigurations: [{ properties: { subnet: { id: subnet }, privateIPAddress: "10.92.0.5" } }]
  }),
  row(vm, "microsoft.compute/virtualmachines", { networkProfile: { networkInterfaces: [{ id: nic }] } }),
  row(privateEndpoint, "microsoft.network/privateendpoints", { subnet: { id: subnet } }),
  row(nsg, "microsoft.network/networksecuritygroups"),
  row(routes, "microsoft.network/routetables"),
  row(nat, "microsoft.network/natgateways")
];
const inventory: RawResource[] = fixture.map((item) => ({
  ...item, name: "private-title", resourceGroup: "private-project"
}));

describe("explicit topology references", () => {
  it("collects only supported resource configuration without inventory tags or display names", () => {
    expect(TOPOLOGY_QUERY).toContain("| project id, type, location,");
    expect(TOPOLOGY_QUERY).toContain("ipConfigurations=properties.ipConfigurations");
    expect(TOPOLOGY_QUERY).not.toMatch(/\bname\b|\btags\b|resourceGroup|osProfile|sslCertificates/);
  });

  it("connects VNet, subnet, NIC, VM, endpoint, NSG, routes and NAT from explicit references", () => {
    const result = buildNetworkTopology(fixture, inventory, sub);
    expect(result.availability).toBe("available");
    expect(result.truncated).toBe(false);
    expect(result.nodes).toHaveLength(8);
    expect(result.edges).toHaveLength(7);
    expect(result.edges).toContainEqual({ source: vnet, target: subnet, kind: "contains" });
    expect(result.edges).toContainEqual({ source: nic, target: vm, kind: "virtual-machine" });
    expect(result.edges).toContainEqual({ source: subnet, target: nat, kind: "nat-gateway" });
    expect(result.edges).toContainEqual({ source: privateEndpoint, target: subnet, kind: "subnet" });
  });

  it("publishes structured RFC1918 only, no raw names or ARM IDs, and normalized inventory IDs", () => {
    const result = sanitizeTopology(buildNetworkTopology(fixture, inventory, sub), inventory);
    expect(JSON.stringify(result)).not.toMatch(/private-|subscriptions|properties/);
    expect(result.nodes.find((item) => item.type === "microsoft.network/virtualnetworks")?.network?.privateCidrs).toEqual(["10.92.0.0/16"]);
    expect(result.nodes.find((item) => item.type === "microsoft.compute/virtualmachines")?.id)
      .toBe(resourceRef(vm));
    expect(result.edges.some((edge) => edge.target === resourceRef(vm))).toBe(true);
  });

  it("marks external and uncollected endpoints reference-only without inventing regions", () => {
    const external = `/subscriptions/other/resourceGroups/secret/providers/Microsoft.Network/virtualNetworks/remote`;
    const missing = arm("Microsoft.Network/routeTables", "missing");
    const result = buildNetworkTopology([
      row(vnet, "microsoft.network/virtualnetworks", { virtualNetworkPeerings: [{ properties: { remoteVirtualNetwork: { id: external } } }] }),
      row(subnet, "microsoft.network/virtualnetworks/subnets", { routeTable: { id: missing } })
    ], [], sub);
    expect(result.availability).toBe("partial");
    expect(result.nodes.find((item) => item.id === external)).toMatchObject({ referenceOnly: true, scope: "external" });
    expect(result.nodes.find((item) => item.id === missing)).toMatchObject({ referenceOnly: true, scope: "uncollected" });
    expect(result.nodes.find((item) => item.id === external)?.region).toBeUndefined();
    expect(result.edges).not.toContainEqual({ source: vnet, target: subnet, kind: "contains" });
  });

  it("never invents associations from shared region/group or ARM parent path alone", () => {
    const result = buildNetworkTopology([
      row(vnet, "microsoft.network/virtualnetworks"),
      row(subnet, "microsoft.network/virtualnetworks/subnets"),
      row(nic, "microsoft.network/networkinterfaces")
    ], inventory, sub);
    expect(result.edges).toEqual([]);
  });

  it("does not turn reverse NSG/route/NAT subnet associations into containment", () => {
    const result = buildNetworkTopology([
      row(nsg, "microsoft.network/networksecuritygroups", { subnets: [{ id: subnet }], networkInterfaces: [{ id: nic }] }),
      row(routes, "microsoft.network/routetables", { subnets: [{ id: subnet }] }),
      row(nat, "microsoft.network/natgateways", { subnets: [{ id: subnet }] })
    ], inventory, sub);
    expect(result.edges).toContainEqual({ source: subnet, target: nsg, kind: "network-security-group" });
    expect(result.edges).toContainEqual({ source: nic, target: nsg, kind: "network-security-group" });
    expect(result.edges).toContainEqual({ source: subnet, target: routes, kind: "route-table" });
    expect(result.edges).toContainEqual({ source: subnet, target: nat, kind: "nat-gateway" });
    expect(result.edges.some((edge) => edge.kind === "contains")).toBe(false);
  });

  it("treats subnet ipConfiguration entries as reverse references, not embedded children", () => {
    const ip = `${nic}/ipConfigurations/config`;
    const result = buildNetworkTopology([
      row(subnet, "microsoft.network/virtualnetworks/subnets", { ipConfigurations: [{ id: ip }] }),
      row(nic, "microsoft.network/networkinterfaces", {
        ipConfigurations: [{ id: ip, properties: { subnet: { id: subnet } } }]
      })
    ], inventory, sub);
    expect(result.availability).toBe("available");
    expect(result.edges).toContainEqual({ source: ip, target: subnet, kind: "subnet" });
    expect(result.edges).not.toContainEqual({ source: subnet, target: ip, kind: "contains" });
  });

  it("deduplicates exact references and marks caps partial with no dangling edges", () => {
    const full = buildNetworkTopology([...fixture, ...fixture], inventory, sub);
    expect(full.nodes).toHaveLength(8);
    expect(full.edges).toHaveLength(7);
    for (const limits of [{ nodes: 3, edges: 800 }, { nodes: 400, edges: 2 }]) {
      const result = buildNetworkTopology(fixture, inventory, sub, limits);
      expect(result.availability).toBe("partial");
      expect(result.truncated).toBe(true);
      expect(result.nodes.length).toBeLessThanOrEqual(limits.nodes);
      expect(result.edges.length).toBeLessThanOrEqual(limits.edges);
      expect(result.edges.every((edge) => result.nodes.some((node) => node.id === edge.source) &&
        result.nodes.some((node) => node.id === edge.target))).toBe(true);
    }
  });

  it("detects malformed properties instead of reporting a fully collected graph", () => {
    expect(buildNetworkTopology([row(vnet, "microsoft.network/virtualnetworks", { subnets: "redacted" })], [], sub).availability).toBe("partial");
    expect(buildNetworkTopology([{ id: vnet, type: "microsoft.network/virtualnetworks" }], [], sub).availability).toBe("partial");
    expect(() => buildNetworkTopology([row("not-an-arm-id", "microsoft.network/virtualnetworks")], [], sub)).toThrow();
  });

  it("connects load balancer/application gateway frontends and backends by configuration", () => {
    const lb = arm("Microsoft.Network/loadBalancers", "private-lb");
    const gateway = arm("Microsoft.Network/applicationGateways", "private-gateway");
    const pool = `${lb}/backendAddressPools/private-pool`;
    const publicIp = arm("Microsoft.Network/publicIPAddresses", "private-ip");
    const result = buildNetworkTopology([
      row(lb, "microsoft.network/loadbalancers", {
        frontendIPConfigurations: [{ properties: { subnet: { id: subnet }, publicIPAddress: { id: publicIp } } }],
        backendAddressPools: [{ id: pool, properties: { backendIPConfigurations: [{ id: `${nic}/ipConfigurations/config` }] } }]
      }),
      row(gateway, "microsoft.network/applicationgateways", { gatewayIPConfigurations: [{ properties: { subnet: { id: subnet } } }] }),
      row(nic, "microsoft.network/networkinterfaces", { ipConfigurations: [{ properties: { loadBalancerBackendAddressPools: [{ id: pool }] } }] })
    ], inventory, sub);
    expect(result.edges).toContainEqual({ source: lb, target: publicIp, kind: "public-ip" });
    expect(result.edges).toContainEqual({ source: gateway, target: subnet, kind: "subnet" });
    expect(result.edges).toContainEqual({ source: nic, target: pool, kind: "backend" });
    expect(result.nodes.find((item) => item.id === pool)?.referenceOnly).toBe(false);
  });

  it("separates a successful empty query from an uncollected snapshot", () => {
    expect(buildNetworkTopology([], [], sub)).toMatchObject({ availability: "available", nodes: [], edges: [], truncated: false });
  });
});
