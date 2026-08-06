import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { aggregateServiceHealthCategories } from "./service-health";

/**
 * Migrates a published snapshot's Service Health categories onto the Japanese labels the collector
 * now emits.
 *
 * `public/data/snapshot.json` was collected before `scripts/service-health-event-types.ts` existed,
 * so it holds Azure's `EventType` members verbatim. Removing the language audit's exemption for that
 * field makes the already-published file fail `validate:data`, and a red `main` cannot be merged.
 *
 * Editing the file by hand would translate it, which is the thing this repository does not do to
 * published data — a hand translation is a human judgement nobody can recompute or check. This
 * script applies the same function the collector applies, so the migration is derivable from the
 * public file alone: anyone can re-run it and get the same bytes.
 *
 * It reproduces the next real collection rather than approximating it because it does not
 * reimplement anything. `aggregateServiceHealthCategories` is the collector's own aggregation step,
 * called here with `(publishedLabel, publishedCount)` pairs instead of one `(eventType, 1)` pair per
 * event. Counting `n` events of a type and adding `n` once build the same map, so the localisation,
 * the many-to-one merge and the tie order that follow are not merely equivalent — they are the same
 * code. The ordering it applies is a fixed label order rather than a locale collation, so the result
 * does not vary with the host either.
 *
 * Running it twice is a no-op: `localizeServiceHealthEventType` maps a Japanese label to itself.
 */

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeServiceHealthCategories(snapshot: unknown): number {
  const reliability = isRecord(snapshot) ? snapshot.reliability : undefined;
  const serviceHealth = isRecord(reliability) ? reliability.serviceHealth : undefined;
  if (!isRecord(serviceHealth) || !Array.isArray(serviceHealth.categories)) {
    throw new Error("Snapshot must contain a reliability.serviceHealth.categories array.");
  }

  const published: unknown[] = serviceHealth.categories;
  const entries = published.map((category, index) => {
    if (!isRecord(category) || typeof category.label !== "string") {
      throw new Error(
        `reliability.serviceHealth.categories.${index}.label must be text.`
      );
    }
    if (typeof category.count !== "number" || !Number.isInteger(category.count)) {
      throw new Error(
        `reliability.serviceHealth.categories.${index}.count must be a whole number.`
      );
    }
    return [category.label, category.count] as const;
  });

  const normalized = aggregateServiceHealthCategories(entries);
  if (isDeepStrictEqual(published, normalized)) return 0;

  // Counted over the longer of the two, so a merge that removes a row is still reported as a change.
  // A count that could read zero while the arrays differ would leave the CLI declining to write.
  let changed = 0;
  for (let index = 0; index < Math.max(published.length, normalized.length); index += 1) {
    if (!isDeepStrictEqual(published[index], normalized[index])) changed += 1;
  }
  serviceHealth.categories = normalized;
  return changed;
}

async function main(): Promise<void> {
  const path = resolve(process.argv[2] ?? "public/data/snapshot.json");
  const snapshot = JSON.parse(await readFile(path, "utf8")) as unknown;
  const normalized = normalizeServiceHealthCategories(snapshot);

  if (normalized > 0) {
    await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  }

  console.log(`Normalized ${normalized} Service Health category label(s).`);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  await main();
}
