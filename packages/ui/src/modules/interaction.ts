/**
 * The logic behind the interactive variants — what a slash draft matches, how a table sorts and
 * narrows, when a field is wrong — kept pure, so the compositions stay a thin layer of state over
 * it and the package's tests call it directly (the suite has no DOM).
 */
import type { AttachmentChip, ModelFixture, PluginFixture } from "../fixtures";
import type { IconName } from "./parts";

// ---------------------------------------------------------------------------------------------
// The composer
// ---------------------------------------------------------------------------------------------

/** One row of the slash menu: a command, or an enabled plugin's skill under its `/name`. */
export interface SlashEntry {
  kind: "command" | "skill";
  /** With its slash: `/compact`, `/penguin-sdk`. */
  name: string;
  icon: IconName;
  description: string;
}

/**
 * The entries a draft opens the slash menu on: a draft that is a slash and the start of one word
 * matches the entries whose name starts with it, ignoring case. Anything else — no slash in front,
 * or a space after the word, which means it has been picked or typed out — opens nothing.
 */
export function slashMatches(entries: readonly SlashEntry[], draft: string): SlashEntry[] {
  if (!draft.startsWith("/") || /\s/.test(draft)) return [];
  const typed = draft.toLowerCase();
  return entries.filter((entry) => entry.name.toLowerCase().startsWith(typed));
}

/** `chips` with `more` appended, skipping any whose label is already there. */
export function attach(
  chips: readonly AttachmentChip[],
  more: readonly AttachmentChip[],
): AttachmentChip[] {
  const next = [...chips];
  for (const chip of more) {
    if (!next.some((held) => held.label === chip.label)) next.push(chip);
  }
  return next;
}

// ---------------------------------------------------------------------------------------------
// The models table
// ---------------------------------------------------------------------------------------------

/** The columns the models table sorts on. */
export type ModelSortKey = "model" | "context" | "cacheRead" | "output";

export interface ModelSort {
  key: ModelSortKey;
  dir: "asc" | "desc";
}

const MODEL_SORT_VALUE: Record<Exclude<ModelSortKey, "model">, (model: ModelFixture) => number> = {
  context: (model) => model.contextWindow,
  cacheRead: (model) => model.pricing.cacheRead,
  output: (model) => model.pricing.output,
};

/**
 * The models in `sort` order; ties keep the order they came in, so a re-sort never shuffles
 * equal rows. The model column sorts by display name.
 */
export function sortModels(models: readonly ModelFixture[], sort: ModelSort): ModelFixture[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  const key = sort.key;
  // Read the numeric column once, outside the comparator: a narrowed `sort.key` does not stay
  // narrowed inside a closure, and the lookup is the same for every pair anyway.
  const value = key === "model" ? null : MODEL_SORT_VALUE[key];
  const compare =
    value === null
      ? (a: ModelFixture, b: ModelFixture) => a.displayName.localeCompare(b.displayName)
      : (a: ModelFixture, b: ModelFixture) => value(a) - value(b);
  return models
    .map((model, index) => ({ model, index }))
    .sort((a, b) => compare(a.model, b.model) * sign || a.index - b.index)
    .map(({ model }) => model);
}

/**
 * What pressing a column head does: the column already sorted flips its direction; another one
 * takes over, names A to Z and numbers largest first — the order a reader scanning for the
 * biggest window or the dearest output wants.
 */
export function nextModelSort(current: ModelSort, key: ModelSortKey): ModelSort {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: key === "model" ? "asc" : "desc" };
}

/** The models whose name, id or provider holds every word of `query`, ignoring case. */
export function filterModels(models: readonly ModelFixture[], query: string): ModelFixture[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...models];
  return models.filter((model) => {
    const text = `${model.displayName} ${model.modelId} ${model.providerLabel}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

// ---------------------------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------------------------

/**
 * Whether a base URL (without its scheme, which the field prints ahead of it) is a host and a
 * path: a dotted host, a slash, then a path, with no spaces anywhere — `openrouter.ai/api/v1`.
 * An empty value is left to the field's `required` mark, not to this check.
 */
export function isHostAndPath(value: string): boolean {
  return /^[^\s/.]+(?:\.[^\s/.]+)+\/\S+$/.test(value.trim());
}

// ---------------------------------------------------------------------------------------------
// The Plugins page
// ---------------------------------------------------------------------------------------------

/**
 * The plugins a search and the filter column leave: the name or description holds the query, the
 * category is among `categories` and the kind among `kinds` — an empty set filters nothing, as
 * an untouched filter column does.
 */
export function filterPlugins(
  plugins: readonly PluginFixture[],
  query: string,
  categories: ReadonlySet<string>,
  kinds: ReadonlySet<PluginFixture["kind"]>,
): PluginFixture[] {
  const typed = query.trim().toLowerCase();
  return plugins.filter(
    (plugin) =>
      (typed === "" || `${plugin.name} ${plugin.description}`.toLowerCase().includes(typed)) &&
      (categories.size === 0 || categories.has(plugin.category)) &&
      (kinds.size === 0 || kinds.has(plugin.kind)),
  );
}

/** `set` with `item` added, or removed when it was there: a checkbox row's toggle. */
export function toggled<T>(set: ReadonlySet<T>, item: T): Set<T> {
  const next = new Set(set);
  if (next.has(item)) next.delete(item);
  else next.add(item);
  return next;
}
