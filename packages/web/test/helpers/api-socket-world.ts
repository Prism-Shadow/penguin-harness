/**
 * The page's API socket, as a page suite plays it: the streams the page opened, by path, and the
 * server events a test pushes into them. A suite swaps the socket module's `apiSocket` for this
 * one (draft-send.test.ts) so the page's own stream handlers are what receive the events; the
 * transport itself — frames, reconnects, deadlines — stays pinned by api-socket.test.ts.
 *
 * One-shot calls stay on fetch (`isOpen()` false, as before the first handshake): a page's calls
 * do not depend on which transport carries them.
 */
import type { ServerEvent } from "@prismshadow/penguin-server/api";
import type { StreamConnection, StreamHandlers } from "../../src/api/sse";

interface OpenStream {
  path: string;
  handlers: StreamHandlers;
}

class ApiSocketWorld {
  readonly streams: OpenStream[] = [];

  /** The module's `apiSocket`, for the suite's `vi.mock` factory. */
  readonly apiSocket = {
    isOpen: () => false,
    isUnavailable: () => false,
    ready: async () => false,
    call: () => Promise.reject(new Error("socket_closed")),
    identityIs: () => undefined,
    identityChanged: () => undefined,
    report: () => ({
      state: "closed",
      lastFrameAgoMs: null,
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
}

/** The one world a suite's socket mock and its page helpers share. */
export const socketWorld = new ApiSocketWorld();
