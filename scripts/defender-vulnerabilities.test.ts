import { describe, expect, it } from "vitest";
import { collectVulnerabilities, VULNERABILITY_QUERY } from "./defender-vulnerabilities";
import { sanitizeSnapshot, resourceRef } from "../src/lib/sanitize";
import { createDemoRawSnapshot } from "./demo-data";
import { publicSnapshotSchema } from "./public-schema";
import { validatePublicJsonSchema } from "./json-schema-validator";
import { scanJson } from "./privacy-rules";

const raw = createDemoRawSnapshot();
const id = raw.resources[0]!.id;
const row = (overrides: object = {}) => ({
  id: `${id}/providers/Microsoft.Security/assessments/private-assessment/subassessments/private-sub`,
  properties: {
    status: { code: "Unhealthy", severity: "High" },
    additionalData: {
      cve: [{ title: "CVE-2026-12345", link: "https://private.invalid" }],
      cvss: { "3.0": { base: 9.8 } }, patchable: true, repositoryName: "private-repo"
    },
    resourceDetails: { source: "Azure", id },
    displayName: "private-person-and-host", remediation: "password='private-secret'",
    ...overrides
  }
});
const query = (rows: unknown[]) => <T>(): T[] => rows as T[];

describe("observed Defender CVE evidence", () => {
  it("publishes only real unhealthy CVE, CVSS, patchability and inventory aliases through both schemas", () => {
    expect(VULNERABILITY_QUERY).toContain("project id, properties");
    const result = collectVulnerabilities(query([row()]), raw.resources);
    expect(result).toMatchObject({ availability: "available", totalSubAssessments: 1, unhealthySubAssessments: 1, totalFindings: 1 });
    expect(result.findings).toEqual([{
      cve: "CVE-2026-12345", severity: "High", resourceRefs: [resourceRef(id)], cvssScore: 9.8, patchable: true
    }]);
    const snapshot = sanitizeSnapshot({ ...raw, security: { ...raw.security, vulnerabilities: result } });
    publicSnapshotSchema.parse(snapshot);
    expect(() => validatePublicJsonSchema(snapshot)).not.toThrow();
    expect(scanJson(JSON.stringify(snapshot))).toEqual([]);
    expect(JSON.stringify(snapshot.security.vulnerabilities)).not.toMatch(/private-|password|repositoryName|displayName/);
  });

  it("keeps a successful zero answer distinct from inaccessible collection", () => {
    expect(collectVulnerabilities(query([]), raw.resources)).toMatchObject({
      availability: "available", totalSubAssessments: 0, totalFindings: 0, findings: []
    });
    expect(collectVulnerabilities(() => { throw new Error("private failure"); }, raw.resources)).toMatchObject({
      availability: "unavailable", totalSubAssessments: null, totalFindings: null, findings: []
    });
  });

  it("does not turn healthy, absent status, non-CVE assessments or uncollected assets into confirmed targets", () => {
    const rows = [
      row({ status: { code: "Healthy", severity: "High" } }),
      row({ status: {} }),
      row({ additionalData: { cve: [{ title: "private-secret" }] } }),
      row({ resourceDetails: { source: "Azure", id: "repositories/private-image" } })
    ].map((value, index) => ({ ...value, id: `${value.id}-${index}` }));
    const result = collectVulnerabilities(query(rows), raw.resources);
    expect(result).toMatchObject({
      availability: "partial", totalSubAssessments: 4, unhealthySubAssessments: 2,
      unknownStatusSubAssessments: 1, unmappedSubAssessments: 1, unmappedTargetSubAssessments: 1, totalFindings: 1
    });
    expect(result.findings[0]!.resourceRefs).toEqual([]);
    const snapshot = sanitizeSnapshot({ ...raw, security: { ...raw.security, vulnerabilities: result } });
    expect(snapshot.security.vulnerabilities?.unmappedTargetSubAssessments).toBe(1);
    publicSnapshotSchema.parse(snapshot);
    expect(() => validatePublicJsonSchema(snapshot)).not.toThrow();
  });

  it("matches case and trailing-slash variants only to an observed raw inventory identity", () => {
    const result = collectVulnerabilities(query([row({
      resourceDetails: { source: "Azure", id: `${id.toUpperCase()}/` }
    })]), raw.resources);
    expect(result.unmappedTargetSubAssessments).toBe(0);
    expect(result.findings[0]!.resourceRefs).toEqual([resourceRef(id)]);
  });

  it("does not silently deduplicate source identities and caps published findings explicitly", () => {
    expect(collectVulnerabilities(query([row(), row()]), raw.resources).availability).toBe("unavailable");
    const rows = Array.from({ length: 103 }, (_, i) => ({
      ...row({ additionalData: { cve: [{ title: `CVE-2026-${10000 + i}` }] } }), id: `assessment-${i}`
    }));
    const result = collectVulnerabilities(query(rows), raw.resources);
    expect(result).toMatchObject({ availability: "partial", totalFindings: 103, truncated: true });
    expect(result.findings).toHaveLength(100);
  });
});
