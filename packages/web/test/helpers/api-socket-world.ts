/**
 * The page's API socket, as a page suite plays it: the streams the page opened, by path, and the
 * server events a test pushes into them. A suite swaps the socket module's `apiSocket` for this
 * one (draft-send.test.ts) so the page's own stream handlers are what receive the events; the
 * transport itself — frames, reconnects, deadlines — stays pinned by api-socket.test.ts.
 *
 * Calls are carried the way test/socket-stand-in.ts carries them: over the suite's own `fetch`,
 * answered in the socket's shape. A page's calls do not depend on which transport carries them,
 * and the app has one now.
 */
import type { ServerEvent } from "@prismshadow/penguin-server/api";
import type { StreamConnection, StreamHandlers } from "../../src/api/sse";
import { carryOverTestFetch } from "./carry";

interface OpenStream {
  path: string;
  handlers: StreamHandlers;
}

class ApiSocketWorld {
  readonly streams: OpenStream[] = [];

  /** The module's `apiSocket`, for the suite's `vi.mock` factory. */
  readonly apiSocket = {
    isOpen: () => true,
    isUnavailable: () => false,
    ready: async () => true,
    call: (
      method: string,
      url: string,
      opts?: { headers?: Record<string, string>; body?: unknown },
    ) => carryOverTestFetch(method, url, opts ?? {}),
    identityIs: () => undefined,
    identityChanged: () => undefined,
    report: () => ({
      state: "open",
      lastFrameAgoMs: 0,
      pendingCalls: [],
      streams: this.streams.map((stream) => stream.path),
    }),
    stream: (path: string, handlers: StreamHandlers): StreamConnection => {
      const entry: OpenStream = { path, handlers };
      this.streams.push(entry);
      return {
        close: () => {
          const at = this.streams.indexOf(entry);
          if (at !== -1) this.streams.splice(at, 1);
        },
      };
    },
  };

  /** Drops every stream: the page unmounted, or the next test is starting. */
  reset(): void {
    this.streams.length = 0;
  }

  /** One server event on every stream opened at `path`, the way the server pushes it. */
  push(path: string, event: ServerEvent): void {
    for (const stream of this.streams) {
      if (stream.path === path) stream.handlers.onServerEvent(event, null);
    }
  }

  /** One named event (`filled`, `progress`, …) on every stream whose path holds `pathPart`. */
  emit(pathPart: string, name: string, data: unknown): void {
    for (const stream of [...this.streams]) {
      if (stream.path.includes(pathPart)) stream.handlers.onEvent?.(name, data, null);
    }
  }
}

/** The one world a suite's socket mock and its page helpers share. */
export const socketWorld = new ApiSocketWorld();
