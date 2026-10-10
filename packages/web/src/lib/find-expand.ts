/**
 * Find-in-page: which regions have their collapsed work groups opened for a search.
 *
 * A work group mounts its rows only while it is open (features/chat/work-group.tsx), so a match
 * inside a group the reader collapsed is text the search cannot see. While a query is live, the
 * find bar (components/find/find-bar.tsx) names the regions it searches here, and the groups
 * inside exactly those regions render their rows whether or not the reader opened them. Each
 * group's own open/closed state is untouched, so clearing the list folds them back as they were.
 *
 * The flag is per region element, not global: Ctrl+F in the Session list opens nothing in the
 * conversation, and a search of the conversation leaves the subagent panel alone. A region's
 * owner (message-stream.tsx) reads its own entry with `useRegionRevealed` and hands it to its
 * groups through `FindRevealContext`, so the store has one subscriber per transcript rather than
 * one per group.
 *
 * Only the rows mount, not each row's body (a tool call's output, a thinking step's text): those
 * stay behind their own disclosure, so a reveal costs the row heads of the scoped transcript.
 *
 * The other thing a transcript withholds, history beyond the loaded window, is not hidden but
 * absent; the region says so with `data-find-more` (lib/find-dom.ts).
 */
import { createContext, useSyncExternalStore } from "react";
import type { RefObject } from "react";

let revealed: ReadonlySet<Element> = new Set();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/**
 * Opens the collapsed groups inside exactly these regions; an empty list folds every one back.
 * Only the find bar writes this. Writing the set it already holds notifies nobody.
 */
export function revealCollapsedIn(regions: readonly Element[]): void {
  if (regions.length === revealed.size && regions.every((region) => revealed.has(region))) return;
  revealed = new Set(regions);
  for (const listener of listeners) listener();
}

/** Whether the find bar has the collapsed groups inside `region` open. */
export function useRegionRevealed(region: RefObject<Element | null>): boolean {
  return useSyncExternalStore(
    subscribe,
    () => region.current !== null && revealed.has(region.current),
    () => false,
  );
}

/** What a region's owner hands its work groups: whether the find bar has them open. */
export const FindRevealContext = createContext(false);
