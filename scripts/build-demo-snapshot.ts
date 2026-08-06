import { createDemoRawSnapshot } from "./demo-data";
import { sanitizeSnapshot } from "../src/lib/sanitize";
import { applyDeterministicInsightIds } from "./insight-identity";
import type { PublicSnapshotV1 } from "../src/data/contracts";

/**
 * The single place that turns the DEMO fixture into a publishable snapshot. `generate-demo.ts` and
 * the DEMO contract test both call it so the tested artifact is the artifact that gets written; a
 * test that rebuilt the pipeline itself could stay green while the script produced something else.
 *
 * The insight ids are derived here for the same reason the periods are derived in the fixture:
 * `preview:demo` writes over the published file, and a DEMO artifact that could not survive
 * `validate:data` would make that flow fail for a reason that has nothing to do with the change
 * being previewed.
 */
export function buildDemoSnapshot(generatedAt = new Date().toISOString()): PublicSnapshotV1 {
  const snapshot = sanitizeSnapshot(createDemoRawSnapshot(generatedAt));
  applyDeterministicInsightIds(snapshot);
  return snapshot;
}

/** Where a DEMO run writes when nothing asks it to write somewhere else. */
export const DEMO_OUTPUT_PATH = ".candidate/demo-snapshot.json";

/** The file GitHub Pages serves as the site's real data. */
export const PUBLISHED_SNAPSHOT_PATH = "public/data/snapshot.json";

/**
 * DEMO output used to default to the published file, so generating a demo overwrote the real data
 * and a forgotten restore would have shipped synthetic numbers as production: the snapshot is valid,
 * so no validator objects, and `vite build` copies `public/` into `dist/` untouched. The default now
 * points at the ignored `.candidate/` directory the collector already uses, and writing over the
 * published file needs `--preview`, which names the intent at the call site.
 */
export function resolveDemoOutputPath(
  env: Record<string, string | undefined>,
  argv: readonly string[] = []
): string {
  if (env.OUTPUT_PATH) return env.OUTPUT_PATH;
  return argv.includes("--preview") ? PUBLISHED_SNAPSHOT_PATH : DEMO_OUTPUT_PATH;
}
