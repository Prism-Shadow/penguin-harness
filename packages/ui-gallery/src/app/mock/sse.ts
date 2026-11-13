/**
 * The Web App's `api/sse.ts`, swapped in by the gallery's Vite config: the same subscriptions,
 * fed by the demo store's channels instead of an EventSource. A Session subscription is told the
 * run-state snapshot and every pending approval first, as the server does on connect, and a
 * running Session's script then streams on it. A history read is the demo's `/messages` answer
 * for the same query, sent as the history stream sends a window: its page, its records, done —
 * every demo Session is on this server, so there is no progress to report and nothing to fill.
 */
import type { StreamHandlers as AppStreamHandlers } from "./types";
import type {
  HistoryPage,
  HistoryProgress,
  HistoryRecords,
  HistoryStreamError,
  MessagesResponse,
  ServerEvent,
} from "@prismshadow/penguin-server/api";
import { ApiError } from "./errors";
import { router } from "./routes";
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

/** The app's beat on a history read; the demo answers at once, so nothing reads it. */
export const HISTORY_STREAM_BEAT_MS = 5_000;

/** A history read's query, as the app declares it. */
export type HistoryStreamQuery =
  | { kind: "tail"; limit: number; budget?: number; fill?: boolean }
  | { kind: "before"; cursor: string; limit: number; budget?: number }
  | { kind: "full" }
  | { kind: "fill"; file: number; agent?: string };

/** A history read's handlers, as the app declares them. */
export interface HistoryStreamHandlers {
  onProgress?: (progress: HistoryProgress) => void;
  onPage?: (page: HistoryPage) => void;
  onRecords?: (frame: HistoryRecords, kind: "records" | "part") => void;
  onDone?: (windowId: string | null) => void;
  onFilled?: () => void;
  onError: (error: HistoryStreamError) => void;
}

/** The `/messages` query a history read stands for. */
function messagesQuery(query: HistoryStreamQuery): string {
  if (query.kind === "tail") return `?tailLimit=${query.limit}`;
  if (query.kind === "before") {
    return `?before=${encodeURIComponent(query.cursor)}&limit=${query.limit}`;
  }
  return "";
}

let windows = 0;

/** Reads a Session's history: the demo's window for the query, then done (and filled at once). */
export function openHistoryStream(
  sessionId: string,
  query: HistoryStreamQuery,
  handlers: HistoryStreamHandlers,
): StreamConnection {
  let open = true;
  void (async () => {
    await Promise.resolve();
    if (!open) return;
    if (query.kind === "fill") {
      handlers.onFilled?.();
      return;
    }
    let answer: MessagesResponse;
    try {
      const path = `/api/sessions/${encodeURIComponent(sessionId)}/messages${messagesQuery(query)}`;
      const result = await router.dispatch(getStore(), "GET", path, undefined);
      answer = (result.kind === "json" ? result.body : { messages: [] }) as MessagesResponse;
    } catch (error) {
      if (!open) return;
      handlers.onError(
        error instanceof ApiError
          ? { code: error.code, message: error.message }
          : { code: "internal", message: String(error) },
      );
      return;
    }
    if (!open) return;
    const windowId = `demo-${(windows += 1)}`;
    const text = answer.messages.map((m) => `${JSON.stringify(m)}\n`).join("");
    handlers.onPage?.({
      windowId,
      count: answer.messages.length,
      bytes: text.length,
      ...(answer.page !== undefined ? { page: answer.page } : {}),
      ...(answer.live !== undefined ? { live: answer.live } : {}),
      serverNowMs: Date.now(),
    });
    if (text !== "") handlers.onRecords?.({ windowId, offset: 0, text }, "records");
    handlers.onDone?.(windowId);
    if (query.kind === "tail" && query.fill === true) handlers.onFilled?.();
  })();
  return {
    close: () => {
      open = false;
    },
  };
}

/** Reads a folded value's whole: the demo's history folds nothing, so there is none to read. */
export function openTraceBodyStream(
  sessionId: string,
  ref: string,
  handlers: HistoryStreamHandlers,
): StreamConnection {
  void sessionId;
  void ref;
  let open = true;
  setTimeout(() => {
    if (open) handlers.onError({ code: "not_found", message: "The demo folds no history values." });
  }, 0);
  return {
    close: () => {
      open = false;
    },
  };
}
