/**
 * The Activities home's groups: one per product code, its refs as cards. A product's refs
 * belong together (one product has ten), and a product code is what authors search by.
 */
import type { ActivityRecord, ActivitySummary } from "@prismshadow/penguin-server/api";
import { filterByTag } from "./activity-tags";
import { filterActivities } from "./preview";

export type GroupSort = "recent" | "code";

export interface ActivityGroup {
  productCode: string;
  activityType: "standard" | "book";
  items: ActivityRecord[];
  canonicalId: string | null;
  attention: number;
  latest: string;
}

export function groupByProduct(
  items: readonly ActivityRecord[],
  summaries: Readonly<Record<string, ActivitySummary>>,
  options: { sort: GroupSort; search: string; tag: string | null },
): ActivityGroup[] {
  // The canonical ref is found across ALL of a product's refs, before search or tag
  // filtering: the New-ref gate follows it even when the filter hides it.
  const canonicalByCode = new Map<string, string>();
  for (const entry of items) {
    if (summaries[entry.id]?.canonical === true && !canonicalByCode.has(entry.productCode)) {
      canonicalByCode.set(entry.productCode, entry.id);
    }
  }
  const visible = filterActivities(filterByTag(items, options.tag), options.search);
  const byCode = new Map<string, ActivityRecord[]>();
  for (const entry of visible) {
    const list = byCode.get(entry.productCode) ?? [];
    list.push(entry);
    byCode.set(entry.productCode, list);
  }
  const groups = [...byCode.entries()].map(([productCode, refs]): ActivityGroup => {
    const canonicalId = canonicalByCode.get(productCode) ?? null;
    const ordered = [...refs].sort((left, right) =>
      left.id === canonicalId ? -1 : right.id === canonicalId ? 1 : left.refNum - right.refNum,
    );
    return {
      productCode,
      // refs[0]! is safe: refs is an array only created when there is at least one item in visible with this productCode.
      activityType: refs[0]!.activityType,
      items: ordered,
      canonicalId,
      attention: refs.filter((entry) => summaries[entry.id]?.status?.kind === "stale").length,
      latest: refs.reduce((max, entry) => (entry.updatedAt > max ? entry.updatedAt : max), ""),
    };
  });
  return groups.sort((left, right) =>
    options.sort === "code"
      ? left.productCode.localeCompare(right.productCode)
      : right.latest.localeCompare(left.latest) || left.productCode.localeCompare(right.productCode),
  );
}

export const COLLAPSED_GROUPS_KEY = "penguin.activities.collapsedGroups";

type CollapsedStore = Record<string, string[]>;

function readStore(storage: Pick<Storage, "getItem">): CollapsedStore {
  const parsed: unknown = JSON.parse(storage.getItem(COLLAPSED_GROUPS_KEY) ?? "{}");
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as CollapsedStore)
    : {};
}

export function readCollapsed(
  projectId: string,
  storage?: Pick<Storage, "getItem">,
): Set<string> {
  try {
    const codes = readStore(storage ?? localStorage)[projectId];
    return new Set(Array.isArray(codes) ? codes.filter((code) => typeof code === "string") : []);
  } catch {
    return new Set();
  }
}

export function writeCollapsed(
  projectId: string,
  collapsed: ReadonlySet<string>,
  storage?: Pick<Storage, "getItem" | "setItem">,
): void {
  try {
    const s = storage ?? localStorage;
    const store = readStore(s);
    store[projectId] = [...collapsed];
    s.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(store));
  } catch {
    // Remembering folds is a convenience; a blocked storage just forgets them.
  }
}
