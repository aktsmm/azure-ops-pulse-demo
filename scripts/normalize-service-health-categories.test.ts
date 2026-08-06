import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeServiceHealthCategories } from "./normalize-service-health-categories";
import { summarizeServiceHealth } from "./service-health";
import {
  UNKNOWN_SERVICE_HEALTH_EVENT_TYPE_LABEL,
  localizeServiceHealthEventType
} from "./service-health-event-types";
import type { SourceStatus } from "../src/data/contracts";

/**
 * Every fixture here is written by this file. The published snapshot's own values are not read: they
 * change on every collection, and a test that pins them fails the next real run and takes Pages with
 * it — the coupling PR #21 removed and PR #26 reintroduced.
 */
function snapshotWith(categories: Array<{ label: string; count: number }>): unknown {
  return {
    reliability: {
      serviceHealth: {
        availability: "available",
        message: "diagnostic",
        activeEvents: 1,
        resolvedEvents: 1,
        categories
      }
    }
  };
}

function categoriesOf(snapshot: unknown): Array<{ label: string; count: number }> {
  return (
    snapshot as {
      reliability: { serviceHealth: { categories: Array<{ label: string; count: number }> } };
    }
  ).reliability.serviceHealth.categories;
}

describe("normalizeServiceHealthCategories", () => {
  it("rewrites Azure event types onto the labels the collector now publishes", () => {
    const snapshot = snapshotWith([
      { label: "ServiceIssue", count: 3 },
      { label: "HealthAdvisory", count: 2 }
    ]);

    expect(normalizeServiceHealthCategories(snapshot)).toBe(2);
    expect(categoriesOf(snapshot)).toEqual([
      { label: localizeServiceHealthEventType("ServiceIssue"), count: 3 },
      { label: localizeServiceHealthEventType("HealthAdvisory"), count: 2 }
    ]);
  });

  it("leaves no Latin behind for any event type a published file could hold", () => {
    const snapshot = snapshotWith(
      ["ServiceIssue", "PlannedMaintenance", "HealthAdvisory", "SecurityAdvisory", "Billing", "EmergingIssues", "RCA", "Unclassified"].map(
        (label) => ({ label, count: 1 })
      )
    );

    normalizeServiceHealthCategories(snapshot);

    for (const category of categoriesOf(snapshot)) {
      expect(category.label).not.toMatch(/[A-Za-z]/u);
    }
    expect(categoriesOf(snapshot).reduce((total, { count }) => total + count, 0)).toBe(8);
  });

  it("merges rows the mapping sends to one label instead of publishing a duplicate", () => {
    const snapshot = snapshotWith([
      { label: "RCA", count: 2 },
      { label: "PostIncidentReview", count: 1 }
    ]);

    // Reported over the longer array, so the row the merge removed counts as a change and the CLI
    // cannot decline to write a file it did alter.
    expect(normalizeServiceHealthCategories(snapshot)).toBe(2);
    expect(categoriesOf(snapshot)).toEqual([
      { label: localizeServiceHealthEventType("RCA"), count: 3 }
    ]);
  });

  it("reports nothing to do once the file is migrated", () => {
    const snapshot = snapshotWith([{ label: "ServiceIssue", count: 3 }]);
    expect(normalizeServiceHealthCategories(snapshot)).toBe(1);

    const migrated = categoriesOf(snapshot).map((category) => ({ ...category }));
    expect(normalizeServiceHealthCategories(snapshot)).toBe(0);
    expect(categoriesOf(snapshot)).toEqual(migrated);
  });

  it("refuses a snapshot that does not carry the field it migrates", () => {
    expect(() => normalizeServiceHealthCategories({ reliability: {} })).toThrow(
      /reliability\.serviceHealth\.categories/u
    );
    expect(() => normalizeServiceHealthCategories(snapshotWith([{ label: 1 } as never]))).toThrow(
      /must be text/u
    );
  });
});

/**
 * The migration is only allowed to exist because it is a function of the public file, not a human
 * judgement about it. That is worth an assertion rather than a promise: a snapshot migrated from a
 * published aggregate has to equal what the collector writes from the events that aggregate came
 * from, byte for byte, or the next collection would produce a diff nobody asked for.
 */
describe("migration reproduces a collection", () => {
  const available: SourceStatus = {
    source: "Service Health",
    availability: "available",
    message: "diagnostic"
  };

  it("lands on the bytes the collector would write from the same events", () => {
    const eventTypes = [
      "ServiceIssue",
      "ServiceIssue",
      "ServiceIssue",
      "HealthAdvisory",
      "HealthAdvisory",
      "RCA",
      "PostIncidentReview",
      "Billing",
      "SomethingUndocumented"
    ];
    const collected = summarizeServiceHealth(
      eventTypes.map((EventType) => ({ properties: { EventType, Status: "Active" } })),
      available
    );

    // What a snapshot collected before the mapping existed holds: the same events, aggregated by
    // the untranslated event type.
    const legacy = new Map<string, number>();
    for (const eventType of eventTypes) {
      const label = eventType.trim() ? eventType.trim() : "Unclassified";
      legacy.set(label, (legacy.get(label) ?? 0) + 1);
    }
    const published = snapshotWith(
      [...legacy]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([label, count]) => ({ label, count }))
    );

    normalizeServiceHealthCategories(published);

    expect(JSON.stringify(categoriesOf(published))).toBe(JSON.stringify(collected.categories));
  });
});

/**
 * The exported function is what the tests above drive, so they would keep passing if the CLI stopped
 * calling it or stopped writing the file. Spawning the real script is what covers that: a static
 * search for the call site would also match a commented-out one.
 */
describe("normalize-service-health-categories CLI", () => {
  const SUBPROCESS_TIMEOUT = 60_000;

  function run(target: string): { status: number; output: string } {
    try {
      const output = execFileSync(
        process.execPath,
        [
          join("node_modules", "tsx", "dist", "cli.mjs"),
          "scripts/normalize-service-health-categories.ts",
          target
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
      );
      return { status: 0, output };
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string };
      return {
        status: failure.status ?? 1,
        output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`
      };
    }
  }

  it("rewrites the file it is pointed at", { timeout: SUBPROCESS_TIMEOUT }, () => {
    const directory = mkdtempSync(join(tmpdir(), "service-health-migration-"));
    const target = join(directory, "snapshot.json");
    writeFileSync(
      target,
      `${JSON.stringify(
        snapshotWith([
          { label: "ServiceIssue", count: 3 },
          { label: "Unclassified", count: 1 }
        ]),
        null,
        2
      )}\n`,
      "utf8"
    );

    try {
      const result = run(target);
      expect(result.status).toBe(0);

      const written = readFileSync(target, "utf8");
      expect(written.endsWith("\n")).toBe(true);
      expect(categoriesOf(JSON.parse(written))).toEqual([
        { label: localizeServiceHealthEventType("ServiceIssue"), count: 3 },
        { label: UNKNOWN_SERVICE_HEALTH_EVENT_TYPE_LABEL, count: 1 }
      ]);

      // Running it again must neither change the bytes nor claim it did.
      const second = run(target);
      expect(second.status).toBe(0);
      expect(second.output).toContain("Normalized 0");
      expect(readFileSync(target, "utf8")).toBe(written);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
