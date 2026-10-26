/**
 * Whether this window's own content is on screen yet: the gate the app shell's remote reads wait
 * behind.
 *
 * What this server holds renders first, from this server alone; what a remote machine or the
 * public internet holds is asked for after that (the machines' Agent lists and event stream
 * behind the sidebar, their scheduled tasks, the release check, a pinned balance). Asked at the
 * same moment, those reads would compete with the first screen for the connection and the
 * server, and none of them is what the person opened the window for. The Session list raises
 * the gate when its first list is on screen — or when there is no list to wait for — and it
 * stays raised for the window's lifetime.
 */
import { useSyncExternalStore } from "react";

let shown = false;
const listeners = new Set<() => void>();

/** This window's own content is on screen: the remote reads waiting behind it may start. */
export function noteLocalShown(): void {
  if (shown) return;
  shown = true;
  for (const listener of [...listeners]) listener();
}

/** Whether {@link noteLocalShown} has been said. */
export function localShown(): boolean {
  return shown;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** {@link localShown}, for a render. */
export function useLocalShown(): boolean {
  return useSyncExternalStore(subscribe, localShown, localShown);
}
