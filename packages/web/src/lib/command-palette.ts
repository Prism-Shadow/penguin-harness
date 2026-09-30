/**
 * Command palette pure logic: the action filter, kept apart from the component so it is
 * testable without a DOM. The chord that opens the palette is the registry's `palette.toggle`
 * (lib/shortcuts), matched by the window dispatcher.
 */

export interface PaletteAction {
  id: string;
  label: string;
  /** Searchable words beyond the label (an English alias under a Chinese label, say). */
  keywords?: readonly string[];
  run: () => void;
}

/**
 * Palette filtering, VSCode-style-lite: every whitespace-separated query token must appear
 * (case-insensitive substring) in the label or a keyword, in any order. Predictable over
 * fuzzy for a handful of actions; an empty query lists everything in registration order.
 */
export function filterPaletteActions<A extends { label: string; keywords?: readonly string[] }>(
  actions: readonly A[],
  query: string,
): A[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...actions];
  return actions.filter((a) => {
    const hay = [a.label, ...(a.keywords ?? [])].join(" ").toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
}
