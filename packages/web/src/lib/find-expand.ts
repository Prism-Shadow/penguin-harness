/**
 * The one piece of state a search needs the transcript to know about: that a find is running,
 * so collapsed content has to be in the document to be findable.
 *
 * The transcript deliberately withholds rendered bodies — a `work-group` mounts its rows only
 * while it is open (features/chat/work-group.tsx), and the stream itself keeps a window of the
 * most recent messages (lib/omni/stream-controller.ts). The first of those is *this* module's
 * business: what a reader searched for is usually inside the thing they collapsed, and a search
 * that came back empty because the text was never mounted would be a lie the UI tells. While
 * this flag is set, every collapsible body renders whether or not the reader opened it; clearing
 * it puts them back exactly as they were, because each one's own open/closed state is untouched
 * — it was always a separate fact from "is it rendered".
 *
 * The second (the stream window) cannot be fixed this way — old messages are gone, not hidden,
 * and the region says so with `data-find-more` (lib/find-dom.ts), which is what the find bar's
 * "load earlier messages" row is built on.
 *
 * The store is module-level state read through `useSyncExternalStore`, following
 * lib/notification-pref.ts: the value is a primitive, so the snapshot *is* the value and the
 * subscriber set is the whole mechanism. Only the find bar writes it, and it is written once per
 * open/close or query change rather than per keystroke's result — an empty query is not a search,
 * and expanding every collapsed group to highlight nothing would be the search rearranging the
 * page for no reason.
 */

let active = false;
const listeners = new Set<() => void>();

export function subscribeFindActive(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Whether a search is running right now (see the module header: a non-empty query). */
export function readFindActive(): boolean {
  return active;
}

/**
 * In tests and outside React, the flag is read and written directly; inside React it is read
 * with `useSyncExternalStore(subscribeFindActive, readFindActive)`.
 */
export function writeFindActive(value: boolean): void {
  if (active === value) return;
  active = value;
  for (const listener of listeners) listener();
}

/** Reset for tests: the module outlives every render, so a test that leaves it set leaks into the next one. */
export function resetFindActive(): void {
  writeFindActive(false);
}
