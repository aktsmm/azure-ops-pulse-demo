import approved from "./fixtures/approved-snapshot.json";
import type { PublicSnapshotV1 } from "../data/contracts";

/**
 * Test-only copy of 1ba5f2a:public/data/snapshot.json, collected 2026-09-10T04:17:04.906Z.
 * Its three approved insights retain their complete evidence and legacy masked scope. Never load
 * public/data or last-analysis here: automatic collection may empty insights, anonymize scope, or
 * replace the inventory. Live publication invariants belong in scripts/published-snapshot.test.ts.
 */
export function snapshotFixture(): PublicSnapshotV1 {
  return structuredClone(approved) as PublicSnapshotV1;
}
