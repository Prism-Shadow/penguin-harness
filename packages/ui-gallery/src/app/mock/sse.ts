/**
 * The Web App's `api/sse.ts`, swapped in by the gallery's Vite config: the same two
 * subscriptions, fed by the demo store's channels instead of an EventSource. A Session
 * subscription is told the run-state snapshot and every pending approval first, as the server
 * does on connect, and a running Session's script then streams on it.
 */
import type { StreamHandlers as AppStreamHandlers } from "./types";
import type { ServerEvent } from "@prismshadow/penguin-server/api";
import { getStore } from "./store";

export type StreamHandlers = AppStreamHandlers;

export interface StreamConnection {
  close: () => void;
}

/** The app's beat on its streams; the demo's channels never go silent, so nothing reads it. */
export const STREAM_HEARTBEAT_MS = 20_000;

/** The machines aggregate's handlers, as the app declares them. */
export interface MachineStreamHandlers {
  onMachineEvent: (machineId: string, event: ServerEvent, eventId: string | null) => void;
  onHubEvent?: (event: ServerEvent, eventId: string | null) => void;
  onOpen?: () => void;
  onError?: (closed: boolean) => void;
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
/**
 * Subscribes to the Project's machines aggregate (GET /api/projects/:projectId/machines/events).
 * The demo has no remote machine to stream from: the stream opens and says hello, as the hub
 * does on a fresh subscribe, and stays quiet.
 */
export function openMachineEvents(
  projectId: string,
  handlers: MachineStreamHandlers,
): StreamConnection {
  void projectId;
  let open = true;
  setTimeout(() => {
    if (!open) return;
    handlers.onOpen?.();
    handlers.onHubEvent?.({ type: "hello" }, null);
  }, 0);
  return {
    close: () => {
      open = false;
    },
  };
}
