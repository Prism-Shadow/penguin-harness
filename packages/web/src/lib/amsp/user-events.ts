/**
 * This server's user channel (`/api/events`), for the surfaces beside the Session list.
 *
 * The one connection is opened by the Session list's provider (state/sessions.tsx), which routes
 * every event into the list first and then hands it here. A page that lists Sessions of its own —
 * the archive page — listens instead of opening a second EventSource, so it hears exactly what
 * the list hears, in the same order.
 */
import type { ServerEvent } from "@prismshadow/penguin-server/api";

type Listener = (ev: ServerEvent) => void;

const listeners = new Set<Listener>();

/** Calls `fn` with every server event of this server's user channel until the returned function is called. */
export function subscribeUserEvents(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Hands one server event to every listener (the provider's call). */
export function publishUserEvent(ev: ServerEvent): void {
  for (const fn of [...listeners]) fn(ev);
}
