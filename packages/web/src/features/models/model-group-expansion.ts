/**
 * Expansion state for the models page's vendor groups (pure decisions, unit tested).
 *
 * The page stores the set of EXPANDED provider ids rather than collapsed ones: groups
 * are derived only after the model rows load (user-defined groups arrive with that
 * async response), so a collapsed-set default cannot express "everything collapsed
 * except DeepSeek" without knowing every group id up front. An expanded set survives
 * late-arriving groups — anything not in it simply renders collapsed. Not persisted,
 * matching the previous collapse behavior.
 */

/**
 * Provider ids expanded on first paint: DeepSeek only — the default model's provider and
 * the first group in MODEL_PROVIDERS, so the page opens with exactly its top group
 * unfolded. Returns a fresh Set per call (React state must never share a module-level
 * mutable instance).
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
