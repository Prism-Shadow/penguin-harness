/**
 * Pure logic behind the model-picker modal (model-picker-modal.tsx), kept out of the component
 * so the node-only test suite can pin it without a DOM:
 *
 * - which models each provider group holds, under the same visibility rule the composer's
 *   picker has always applied (visibleChatModels: configured-key models plus the selected and
 *   the default one, everything once "show all" is on or when nothing has a key);
 * - which group is active when the modal opens;
 * - how search results rank and group across providers;
 * - how the arrow keys move between the group rail and the model list.
 *
 * `modelLabel` lives here too (model-select.tsx re-exports it for its existing importers), so
 * the modal and the triggers share it without importing each other.
 */
import type { ModelProviderInfo } from "@prismshadow/penguin-core/model-catalog";
import {
  groupModelRows,
  hasConfiguredKey,
  sameModelRef,
  visibleChatModels,
} from "../models/model-grouping";
import type { ModelCredentialRowLike, ModelRefValue, ModelRowLike } from "../models/model-grouping";

/**
 * Display label for a model: the display name, or falls back to the upstream id (model_id is
 * the raw field, no prefix parsing). Blank counts as absent — a name the user cleared is sent
 * as the empty string, which must read as the id rather than as an empty label.
 */
export function modelLabel(m: Pick<ModelRowLike, "displayName" | "modelId">): string {
  return m.displayName?.trim() || m.modelId;
}

/** One provider group as the picker shows it: the rail entry and the rows behind it. */
export interface PickerGroup<T> {
  /** The group key (the rows' `provider` field). */
  id: string;
  provider: ModelProviderInfo;
  rows: T[];
}

export interface PickerVisibility {
  /** The "show models without a key" toggle. */
  showAll: boolean;
  selected?: ModelRefValue | null;
  defaultModel?: ModelRefValue | null;
  /** The models page's stored group order (loadModelGroupOrder); empty = catalog order. */
  groupOrder?: readonly string[];
}

/** Visible rows regrouped by provider; groups with nothing visible are left off the rail. */
function regroup<T extends ModelCredentialRowLike>(
  visible: T[],
  groupOrder: readonly string[] | undefined,
): PickerGroup<T>[] {
  return groupModelRows(visible, "", groupOrder ?? [])
    .filter((g) => g.rows.length > 0)
    .map((g) => ({ id: g.provider.id, provider: g.provider, rows: g.rows }));
}

/** The rail: every group holding a visible model, in the user's group order. */
export function pickerGroups<T extends ModelCredentialRowLike>(
  models: T[],
  { showAll, selected, defaultModel, groupOrder }: PickerVisibility,
): PickerGroup<T>[] {
  return regroup(
    visibleChatModels(models, {
      showAll,
      query: "",
      selected: selected ?? null,
      defaultModel: defaultModel ?? null,
      ...(groupOrder !== undefined ? { groupOrder } : {}),
    }),
    groupOrder,
  );
}

/**
 * How many models the key filter hides under `query` — the number on the "show models without
 * a key" toggle. Zero once the toggle is on, and zero when nothing has a key (everything is
 * already listed then).
 */
export function hiddenModelCount<T extends ModelCredentialRowLike>(
  models: T[],
  { showAll, selected, defaultModel, groupOrder, query }: PickerVisibility & { query: string },
): number {
  if (showAll) return 0;
  const opts = {
    query,
    selected: selected ?? null,
    defaultModel: defaultModel ?? null,
    ...(groupOrder !== undefined ? { groupOrder } : {}),
  };
  return (
    visibleChatModels(models, { ...opts, showAll: true }).length -
    visibleChatModels(models, { ...opts, showAll: false }).length
  );
}

/**
 * The group active when the picker opens: the current model's group, so the modal opens on
 * what is already chosen; with nothing chosen (or a choice no longer in the list), the first
 * group that has a configured key — the one the user can actually run — and failing that the
 * first group. Null only when the rail is empty.
 */
export function initialGroupId<T extends ModelCredentialRowLike>(
  groups: readonly PickerGroup<T>[],
  value: ModelRefValue | null | undefined,
): string | null {
  const holding = groups.find((g) => g.rows.some((m) => sameModelRef(m, value)));
  if (holding) return holding.id;
  const keyed = groups.find((g) => g.rows.some(hasConfiguredKey));
  return (keyed ?? groups[0])?.id ?? null;
}

/** Where a row's highlight lands when its group becomes active: the current model, else the top. */
export function entryRow<T extends ModelRowLike>(
  rows: readonly T[],
  value: ModelRefValue | null | undefined,
): number {
  const at = rows.findIndex((m) => sameModelRef(m, value));
  return at >= 0 ? at : 0;
}

/**
 * How well a row matches a query, lower is better: an exact name or id (0), a prefix (1), a
 * match at a word boundary (2), a match anywhere in the name or id (3), and a row that matches
 * only through its provider's name (4). It orders results and never filters them — the result
 * set stays exactly what matchesQuery lets through, so search finds what it always found.
 */
export function matchRank(row: ModelRowLike, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  let best = 4;
  for (const field of [row.displayName?.trim() ?? "", row.modelId]) {
    const f = field.toLowerCase();
    if (!f) continue;
    if (f === q) return 0;
    if (f.startsWith(q)) best = Math.min(best, 1);
    else if (atWordBoundary(f, q)) best = Math.min(best, 2);
    else if (f.includes(q)) best = Math.min(best, 3);
  }
  return best;
}

/** Whether `q` occurs in `f` right after a separator ("mini" in `gpt-5-mini`). */
function atWordBoundary(f: string, q: string): boolean {
  for (let i = f.indexOf(q, 1); i > 0; i = f.indexOf(q, i + 1)) {
    if (/[\s\-_/.:]/.test(f[i - 1]!)) return true;
  }
  return false;
}

/**
 * Search results across every group: the visible rows matching `query`, grouped by provider,
 * best matches first — rows within a group by rank, and groups by their best row. Ties keep the
 * library order (the user's group order, then in-group order), so equally good matches read in
 * the sequence the rail shows.
 */
export function searchPickerGroups<T extends ModelCredentialRowLike>(
  models: T[],
  { showAll, selected, defaultModel, groupOrder, query }: PickerVisibility & { query: string },
): PickerGroup<T>[] {
  const visible = visibleChatModels(models, {
    showAll,
    query,
    selected: selected ?? null,
    defaultModel: defaultModel ?? null,
    ...(groupOrder !== undefined ? { groupOrder } : {}),
  });
  const ranked = regroup(visible, groupOrder).map((g, order) => {
    const rows = g.rows
      .map((row, i) => ({ row, i, rank: matchRank(row, query) }))
      .sort((a, b) => a.rank - b.rank || a.i - b.i);
    return { group: { ...g, rows: rows.map((r) => r.row) }, order, best: rows[0]?.rank ?? 4 };
  });
  return ranked.sort((a, b) => a.best - b.best || a.order - b.order).map((r) => r.group);
}

/** Which half of the group view the arrow keys drive. */
export type PickerRegion = "rail" | "list";

/** Keyboard position in the group view: the region, the active group, the highlighted row. */
export interface PickerNav {
  region: PickerRegion;
  group: number;
  row: number;
}

export type PickerNavKey = "up" | "down" | "left" | "right" | "tab";

/**
 * One step through `count` entries with wrap-around; from nothing (-1), down lands on the first
 * entry and up on the last.
 */
export function stepIndex(index: number, count: number, delta: 1 | -1): number {
  if (count <= 0) return -1;
  if (index < 0 || index >= count) return delta === 1 ? 0 : count - 1;
  return (index + delta + count) % count;
}

/**
 * The group view's arrow keys. In the rail, up/down walk the groups (the list follows, its
 * highlight landing on `entry(group)`) and right/Tab step into the list; in the list, up/down
 * walk the rows and left/Tab step back to the rail. Both ends wrap.
 */
export function movePickerNav(
  nav: PickerNav,
  key: PickerNavKey,
  shape: {
    groupCount: number;
    rowCount: (group: number) => number;
    entry: (group: number) => number;
  },
): PickerNav {
  if (shape.groupCount === 0) return nav;
  if (nav.region === "rail") {
    if (key === "up" || key === "down") {
      const group = stepIndex(nav.group, shape.groupCount, key === "down" ? 1 : -1);
      return { region: "rail", group, row: shape.entry(group) };
    }
    if (key === "right" || key === "tab") return { ...nav, region: "list" };
    return nav;
  }
  if (key === "up" || key === "down") {
    return { ...nav, row: stepIndex(nav.row, shape.rowCount(nav.group), key === "down" ? 1 : -1) };
  }
  if (key === "left" || key === "tab") return { ...nav, region: "rail" };
  return nav;
}

/**
 * The group an ⌥1–9 (Alt+1–9 off macOS) chord jumps to, as a 0-based index, or null when the
 * event is not such a chord.
 *
 * Not ⌘/Ctrl+1–9: browsers reserve those for switching tabs and handle them before the page,
 * so the chord would leave the app instead of moving the picker. Alt reaches the page. The
 * digit is read from `code`, not `key`, because on macOS Option+1 types "¡" — the physical key
 * is the only stable thing about the chord.
 */
export function groupShortcutIndex(e: {
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): number | null {
  if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return null;
  const m = /^Digit([1-9])$/.exec(e.code);
  return m === null ? null : Number(m[1]) - 1;
}
