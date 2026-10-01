/**
 * The Web App's `api/sse.ts`, swapped in by the gallery's Vite config: the same two
 * subscriptions, fed by the demo store's channels instead of an EventSource. A Session
 * subscription is told the run-state snapshot and every pending approval first, as the server
 * does on connect, and a running Session's script then streams on it.
 */
import type { StreamHandlers as AppStreamHandlers } from "./types";
import { getStore } from "./store";

export type StreamHandlers = AppStreamHandlers;

export interface StreamConnection {
  close: () => void;
}

/** Subscribes to a Session's output stream (GET /api/sessions/:sessionId/stream). */
export function openSessionStream(sessionId: string, handlers: StreamHandlers): StreamConnection {
  const store = getStore();
  const channel = store.channel(sessionId);
  if (!channel) {
    setTimeout(() => handlers.onError?.(true), 0);
    return { close: () => undefined };
  }
  const unsubscribe = channel.subscribe(handlers);
  let open = true;
  setTimeout(() => {
    if (!open) return;
    handlers.onOpen?.();
    store.onSubscribe(sessionId, handlers);
  }, 0);
  return {
    close: () => {
      open = false;
      unsubscribe();
    },
  };
}

/** Subscribes to the user-level server event stream (GET /api/events). */
export function openUserEvents(
  handlers: StreamHandlers,
  machineId: string | null = null,
): StreamConnection {
  void machineId;
  const store = getStore();
  const unsubscribe = store.userChannel.subscribe(handlers);
  let open = true;
  setTimeout(() => {
    if (!open) return;
    handlers.onOpen?.();
    handlers.onServerEvent({ type: "hello" }, null);
  }, 0);
  return {
    close: () => {
      open = false;
      unsubscribe();
    },
  };
}
