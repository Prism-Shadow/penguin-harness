/**
 * Expansion state for the models page's vendor groups (pure decisions, unit tested).
 *
 * The page stores the set of EXPANDED provider ids rather than collapsed ones: groups
 * are derived only after the model rows load (user-defined groups arrive with that
 * async response), so a collapsed-set default cannot express "everything collapsed
 * except DeepSeek" without knowing every group id up front. An expanded set survives
 * late-arriving groups — anything not in it simply renders collapsed.
 *
 * The user's toggles persist per Project in localStorage (#224 follow-up: DeepSeek-only
 * is the first-visit default, not a per-visit reset), mirroring the sidebar's persisted
 * group-collapse sets — a `penguin.…` key namespaced by projectId holding a JSON array
 * of ids. Unlike the sidebar sets, whose default IS the empty set, the default here is
 * non-empty, so "nothing stored / invalid" (fall back to the default) is distinguished
 * from a stored empty array (the user collapsed everything; honored as-is). Storage is
 * injectable (draft-cache.ts convention: vitest runs in Node, no localStorage); search
 * force-open below stays derived and never writes storage.
 */

/**
 * Provider ids expanded on first visit (nothing persisted yet): DeepSeek only — the
 * default model's provider and the first group in MODEL_PROVIDERS, so the page opens
 * with exactly its top group unfolded. Returns a fresh Set per call (React state must
 * never share a module-level mutable instance).
 */
export function defaultExpandedProviders(): Set<string> {
  return new Set(["deepseek"]);
}

/**
 * Whether a vendor group renders expanded. While a search query is active every group
 * still rendered holds at least one match (groupModelRows drops matchless groups when
 * searching), and a match hidden inside a collapsed group would look like a missing
 * result — so searching forces groups open. Derived only: the stored set is untouched,
 * and clearing the query restores the user's own expand/collapse choices.
 */
export function isGroupExpanded(
  expanded: ReadonlySet<string>,
  providerId: string,
  searching: boolean,
): boolean {
  return searching || expanded.has(providerId);
}

/** Immutable toggle of one provider id in the expanded set (state-updater shape; the input set is never mutated). */
export function toggleExpandedProvider(
  expanded: ReadonlySet<string>,
  providerId: string,
): Set<string> {
  const next = new Set(expanded);
  if (next.has(providerId)) next.delete(providerId);
  else next.add(providerId);
  return next;
}

/** Minimal storage interface (the subset of localStorage used here); tests inject an in-memory implementation. */
export interface ExpansionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Storage key of one Project's expanded-group set (sidebar key-naming convention,
 * `penguin.sidebarCollapsedGroups.<projectId>` &c.). Provider ids — including
 * user-defined group names — are Project-scoped, hence one key per Project.
 */
export const expandedGroupsKey = (projectId: string): string =>
  `penguin.modelsExpandedGroups.${projectId}`;

/** Serialized form of an expanded set: a JSON array of provider ids. */
export function serializeExpandedProviders(expanded: ReadonlySet<string>): string {
  return JSON.stringify([...expanded]);
}

/**
 * Parses a stored raw value. Returns null — not the default — for "nothing usable"
 * (absent, malformed JSON, non-array): the caller owns the fallback. A valid array
 * yields the set of its string elements (junk elements dropped), so a stored `[]`
 * round-trips to the empty set: "user collapsed everything" is a persisted choice,
 * never replaced by the default.
 */
export function parseExpandedProviders(raw: string | null): Set<string> | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return null;
  }
}

/**
 * Reads a Project's persisted expanded set; no Project yet, nothing stored, or
 * corrupted storage falls back to the DeepSeek-only default. Stored ids of
 * since-deleted groups pass through unpruned — harmless, expansion is a pure
 * membership test and a group no longer rendered is never asked about.
 */
export function loadExpandedProviders(
  projectId: string | null,
  storage: ExpansionStorage = localStorage,
): Set<string> {
  if (projectId === null) return defaultExpandedProviders();
  try {
    return (
      parseExpandedProviders(storage.getItem(expandedGroupsKey(projectId))) ??
      defaultExpandedProviders()
    );
  } catch {
    return defaultExpandedProviders();
  }
}

/** Writes a Project's expanded set on every toggle (best-effort: quota limits / private browsing fail silently). */
export function saveExpandedProviders(
  projectId: string | null,
  expanded: ReadonlySet<string>,
  storage: ExpansionStorage = localStorage,
): void {
  if (projectId === null) return;
  try {
    storage.setItem(expandedGroupsKey(projectId), serializeExpandedProviders(expanded));
  } catch {
    /* best-effort persistence (quota limits / private browsing) */
  }
}
