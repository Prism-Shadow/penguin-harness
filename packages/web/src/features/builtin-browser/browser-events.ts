/**
 * The agent browser's user-channel events, fanned out from the one `/api/events` connection
 * (state/sessions.tsx publishes here) to the browser layer (browser-layer.tsx), whose follower
 * and page host are the subscribers. Module level and free of dependencies, because the connection outlives every
 * page and the session list's store has no business knowing what the browser does with them.
 *
 * Each event names the server it came from, null for this one: a machine's user channel carries
 * the events of that machine's browser, which go to that machine's state (browser-servers.ts).
 */
import type { BuiltinBrowserServerEvent, ServerEvent } from "@prismshadow/penguin-server/api";

export function isBuiltinBrowserEvent(ev: ServerEvent): ev is BuiltinBrowserServerEvent {
  return (
    ev.type === "builtin_browser_tabs" ||
    ev.type === "builtin_browser_open" ||
    ev.type === "builtin_browser_session" ||
    ev.type === "builtin_browser_close" ||
    ev.type === "builtin_browser_activity" ||
    ev.type === "builtin_browser_metrics" ||
    ev.type === "builtin_browser_backend" ||
    ev.type === "builtin_browser_extension"
  );
}

type Listener = (ev: BuiltinBrowserServerEvent, server: string | null) => void;
type ResyncListener = (server: string | null) => void;

const listeners = new Set<Listener>();
const resyncListeners = new Set<ResyncListener>();

export function publishBuiltinBrowserEvent(
  ev: BuiltinBrowserServerEvent,
  server: string | null = null,
): void {
  for (const listener of [...listeners]) listener(ev, server);
}

export function subscribeBuiltinBrowserEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * A server's user channel reconnected past its replay buffer (`resync_required`): browser
 * events may have been lost with the rest, so the layer re-reads that server's registry and
 * drops activity marks nothing will ever clear.
 */
export function publishBuiltinBrowserResync(server: string | null = null): void {
  for (const listener of [...resyncListeners]) listener(server);
}

export function subscribeBuiltinBrowserResync(listener: ResyncListener): () => void {
  resyncListeners.add(listener);
  return () => {
    resyncListeners.delete(listener);
  };
}
