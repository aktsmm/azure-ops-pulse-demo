// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDemoSnapshot } from "../../scripts/build-demo-snapshot";
import { validateRetainedAnalysis } from "../../scripts/retain-last-analysis";
import { snapshotFixture } from "./snapshot-fixtures";

afterEach(() => {
  vi.doUnmock("../../public/data/snapshot.json");
  vi.doUnmock("../../public/data/last-analysis.json");
  vi.resetModules();
});

describe("Deterministic approved snapshot fixture", () => {
  it("retains all three approved insights with their original evidence and scope", () => {
    const fixture = snapshotFixture();
    expect(fixture.generatedAt).toBe("2026-09-10T04:17:04.906Z");
    expect(fixture.aiInsights).toHaveLength(3);
    expect(fixture.scope.subscriptionId).toMatch(/^[0-9a-f]{8}-\*{4}-\*{4}-\*{4}-\*{4}[0-9a-f]{8}$/);
    expect(fixture.scope.tenantId).toMatch(/^[0-9a-f]{8}-\*{4}-\*{4}-\*{4}-\*{4}[0-9a-f]{8}$/);
    expect(validateRetainedAnalysis(JSON.stringify(fixture))).toEqual(fixture);
  });

  it("returns independent copies, including nested inventory, evidence and scope", () => {
    const original = snapshotFixture();
    const changed = snapshotFixture();
    changed.aiInsights[0]!.numericEvidence[0]!.value = "99999";
    changed.scope.subscriptionId = "subscription-anonymous";
    changed.inventory.resources.length = 0;
    expect(snapshotFixture()).toEqual(original);
  });

  it.each([
    { insights: false, anonymous: false },
    { insights: true, anonymous: false },
    { insights: false, anonymous: true },
    { insights: true, anonymous: true }
  ])("does not load mutable publication or archive for $insights insights / $anonymous anonymous scope", async ({ insights, anonymous }) => {
    const expected = snapshotFixture();
    const live = buildDemoSnapshot("2026-09-12T00:00:00.000Z");
    live.mode = "AZURE";
    if (!insights) live.aiInsights = [];
    if (!anonymous) live.scope = structuredClone(expected.scope);
    expect(live.inventory).not.toEqual(expected.inventory);
    const currentRead = vi.fn(() => ({ default: live }));
    const archiveRead = vi.fn(() => ({ default: live }));
    vi.resetModules();
    vi.doMock("../../public/data/snapshot.json", currentRead);
    vi.doMock("../../public/data/last-analysis.json", archiveRead);
    const fixtures = await import("./snapshot-fixtures");
    const reliability = await import("./reliability-fixtures");
    expect(fixtures.snapshotFixture()).toEqual(expected);
    expect(reliability.publishedSnapshot).toEqual(expected);
    expect(reliability.reliabilityFixture({ supported: 4, evaluated: 4 }).inventory.total).toBe(4);
    expect(currentRead).not.toHaveBeenCalled();
    expect(archiveRead).not.toHaveBeenCalled();
  });

  it("keeps mutable JSON imports out of test modules and helpers", () => {
    const offenders: string[] = [];
    function visitDirectory(directory: string) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          visitDirectory(path);
        } else if (/\.[cm]?tsx?$/.test(entry.name)) {
          const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
          const visit = (node: ts.Node) => {
            const specifier = ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
              ? node.moduleSpecifier
              : ts.isCallExpression(node) &&
                  (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === "require")
                ? node.arguments[0] : undefined;
            if (specifier && ts.isStringLiteral(specifier) &&
                /public[/\\]data[/\\].+\.json$/.test(specifier.text)) {
              offenders.push(`${relative(".", path)}: ${specifier.text}`);
            }
            ts.forEachChild(node, visit);
          };
          visit(source);
        }
      }
    }
    // Live integrations use explicit filesystem reads, never an implicit fixture import.
    visitDirectory("src");
    visitDirectory("scripts");
    expect(offenders).toEqual([]);
  });
});
