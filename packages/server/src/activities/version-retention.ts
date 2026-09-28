/**
 * Which versions retention removes. Manual, restore and deploy versions are kept for ever,
 * as are the newest automatic ones; an older automatic version goes unless it went to QA or
 * PROD or a kept version was restored from it.
 */
import type { VersionRow } from "./version-store.js";

/** How many automatic versions an activity keeps. */
export const AUTO_VERSIONS_KEPT = 20;

/** The versions to remove, from every version of one activity in any order. */
export function prunableVersions(
  rows: readonly VersionRow[],
  keep = AUTO_VERSIONS_KEPT,
): VersionRow[] {
  const referenced = new Set(rows.map((row) => row.sourceVersionId).filter(Boolean));
  return [...rows]
    .filter((row) => row.kind === "auto")
    .sort((a, b) => b.seq - a.seq)
    .slice(keep)
    .filter((row) => !row.deployedQaAt && !row.deployedProdAt && !referenced.has(row.versionId));
}
