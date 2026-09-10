import { CollectionError } from "./collection-diagnostics";

export interface GraphResponse<T> {
  data?: T[];
  count?: number;
  totalRecords?: number;
  total_records?: number;
  skipToken?: string | null;
  skip_token?: string | null;
  resultTruncated?: boolean | string;
  result_truncated?: boolean | string;
}

/** Fail closed instead of publishing a complete-looking partial inventory/recommendation set. */
export function collectGraphPages<T>(read: (skipToken?: string) => GraphResponse<T>): T[] {
  const rows: T[] = [];
  const seen = new Set<string>();
  let skipToken: string | undefined;
  let expectedTotal: number | undefined;
  for (let page = 0; page < 100; page += 1) {
    const response = read(skipToken);
    if (!Array.isArray(response?.data)) throw new CollectionError("invalid-response");
    const total = response.totalRecords ?? response.total_records;
    const next = response.skipToken ?? response.skip_token ?? undefined;
    const truncated = response.resultTruncated ?? response.result_truncated;
    if ((total !== undefined && (!Number.isSafeInteger(total) || total < 0)) ||
        (response.count !== undefined && response.count !== response.data.length) ||
        (next !== undefined && typeof next !== "string") ||
        (truncated !== undefined && ![true, false, "true", "false"].includes(truncated))) {
      throw new CollectionError("invalid-response");
    }
    if (total !== undefined) {
      if (expectedTotal !== undefined && total !== expectedTotal) throw new CollectionError("invalid-response");
      expectedTotal = total;
    }
    rows.push(...response.data);
    if (expectedTotal !== undefined && rows.length > expectedTotal) throw new CollectionError("invalid-response");
    if (!next) {
      if (truncated === true || truncated === "true" ||
          (expectedTotal === undefined && truncated !== false && truncated !== "false" && response.data.length >= 1000) ||
          (expectedTotal !== undefined && rows.length !== expectedTotal)) throw new CollectionError("invalid-response");
      return rows;
    }
    if (!response.data.length || seen.has(next)) throw new CollectionError("invalid-response");
    seen.add(next);
    skipToken = next;
  }
  throw new CollectionError("invalid-response");
}
