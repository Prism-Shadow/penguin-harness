/**
 * Which model groups stay in view on the models page (pure decisions, unit tested), on the
 * sidebar nav's model (lib/nav-group-collapse.ts): every group is either PINNED, always shown,
 * or COLLAPSIBLE, inside the area one full-width chevron bar under the pinned groups folds away.
 * The main gateways and first-party vendors are pinned by default; the user moves a group across
 * with the lock on its header, or by dropping it on a header in the other area. Both areas keep
 * the page's group order. While a search is active both areas show and the bar is hidden.
 *
 * Global storage keys, not per Project, like the nav's: which groups a user keeps in view is a
 * preference of this browser, and the built-in groups are the same in every Project. A
 * user-defined group is pinned by its name, so the choice follows that name into any Project
 * that has a group of it, and is inert where none does. Storage is injectable (vitest runs in
 * Node, no localStorage); nothing stored, unrecognized values and throwing storage all fall back
 * to the defaults.
 */

/** Groups pinned until the user says otherwise; every other group, a later or user-defined one included, starts collapsible. */
export const DEFAULT_PINNED_MODEL_GROUPS: ReadonlySet<string> = new Set([
  "tokendance",
  "penguin-go",
  "deepseek",
  "openrouter",
  "google",
  "openai",
  "anthropic",
]);

/**
 * The user's pin choices that differ from the defaults, by group id: true = pinned, false =
 * collapsible. A group absent here takes its default, so a group added in a later release
 * arrives where its own default puts it.
 */
export type ModelGroupPins = Readonly<Record<string, boolean>>;

export function isModelGroupPinned(id: string, pins: ModelGroupPins): boolean {
  return pins[id] ?? DEFAULT_PINNED_MODEL_GROUPS.has(id);
}

/** The two areas, each keeping the order `groups` has (the page's, whatever order the pins were made in). */
export function splitModelGroups<T>(
  groups: readonly T[],
  idOf: (group: T) => string,
  pins: ModelGroupPins,
): { pinned: T[]; collapsible: T[] } {
  const pinned: T[] = [];
  const collapsible: T[] = [];
  for (const group of groups) {
    if (isModelGroupPinned(idOf(group), pins)) pinned.push(group);
    else collapsible.push(group);
  }
  return { pinned, collapsible };
}

/**
 * What the page lays out: the groups shown above the bar, and the bar with the groups it folds —
 * or no bar at all, while a search is active (every match shows, in both areas, the pinned
 * first) or when nothing is collapsible.
 */
export interface ModelGroupLayout<T> {
  shown: T[];
  fold: { groups: T[]; folded: boolean } | null;
}

export function modelGroupLayout<T>(
  groups: readonly T[],
  idOf: (group: T) => string,
  pins: ModelGroupPins,
  { searching, folded }: { searching: boolean; folded: boolean },
): ModelGroupLayout<T> {
  const { pinned, collapsible } = splitModelGroups(groups, idOf, pins);
  if (searching) return { shown: [...pinned, ...collapsible], fold: null };
  if (collapsible.length === 0) return { shown: pinned, fold: null };
  return { shown: pinned, fold: { groups: collapsible, folded } };
}

/**
 * The pins after a group is dropped on another group's header: it takes the target's area, so a
 * drop across the bar pins or unpins it, and a drop within one area changes nothing (the same
 * `pins` comes back).
 */
export function pinsAfterDrop(
  pins: ModelGroupPins,
  dragged: string,
  target: string,
): ModelGroupPins {
  return withModelGroupPinned(pins, dragged, isModelGroupPinned(target, pins));
}

/**
 * `pins` with one group pinned or unpinned — the write both the lock and a cross-area drop make.
 * A choice that matches the default is removed rather than stored, so only deviations are kept;
 * a call that changes nothing returns `pins` itself, and callers skip the write on that identity.
 */
export function withModelGroupPinned(
  pins: ModelGroupPins,
  id: string,
  pinned: boolean,
): ModelGroupPins {
  if (isModelGroupPinned(id, pins) === pinned) return pins;
  const next: Record<string, boolean> = { ...pins };
  if (pinned === DEFAULT_PINNED_MODEL_GROUPS.has(id)) delete next[id];
  else next[id] = pinned;
  return next;
}

/** Minimal storage interface (the subset of localStorage used here); tests inject an in-memory implementation. */
export interface ModelGroupPinStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The pin choices' single global key; holds ModelGroupPins as a JSON object. */
export const MODEL_GROUP_PINS_KEY = "penguin.modelsPinnedGroups";

/**
 * Reads the stored choices. Only a boolean under a non-empty key is kept; anything else — absent,
 * unparseable, not an object, throwing storage — reads as no choices, i.e. the defaults.
 * `localStorage` is resolved inside the try: merely touching it throws where site data is
 * blocked, and this runs from a useState initializer.
 */
export function initialModelGroupPins(storage?: ModelGroupPinStorage): ModelGroupPins {
  try {
    const raw = (storage ?? localStorage).getItem(MODEL_GROUP_PINS_KEY);
    const parsed: unknown = JSON.parse(raw ?? "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const pins: Record<string, boolean> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (id !== "" && typeof value === "boolean") pins[id] = value;
    }
    return pins;
  } catch {
    return {};
  }
}

/** Writes the choices on every change (best-effort: quota limits / private browsing fail silently). */
export function storeModelGroupPins(pins: ModelGroupPins, storage?: ModelGroupPinStorage): void {
  try {
    (storage ?? localStorage).setItem(MODEL_GROUP_PINS_KEY, JSON.stringify(pins));
  } catch {
    /* best-effort persistence */
  }
}

/** The collapse area's single global key; holds "expanded" / "collapsed". */
export const MODEL_GROUPS_FOLD_KEY = "penguin.modelsGroupsFolded";

/**
 * Whether the collapse area is folded. Folded is the default — only an explicit "expanded"
 * opens it — so a first visit shows the pinned groups and the bar, and nothing else.
 */
export function initialModelGroupsFolded(storage?: ModelGroupPinStorage): boolean {
  try {
    return (storage ?? localStorage).getItem(MODEL_GROUPS_FOLD_KEY) !== "expanded";
  } catch {
    return true;
  }
}

/** Writes the fold on every toggle (best-effort, like the pins). */
export function storeModelGroupsFolded(folded: boolean, storage?: ModelGroupPinStorage): void {
  try {
    (storage ?? localStorage).setItem(MODEL_GROUPS_FOLD_KEY, folded ? "collapsed" : "expanded");
  } catch {
    /* best-effort persistence */
  }
}
