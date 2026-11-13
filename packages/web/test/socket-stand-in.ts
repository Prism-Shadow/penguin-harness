/**
 * The socket, for the node suite: the real module, plus the page's socket a node host lacks.
 *
 * The Web App has one transport for its API calls: apiFetch hands every path that is not the
 * runtime's own to `apiSocket.call()` and nothing fetches beside it (src/api/client.ts), so
 * that a page's requests queue behind one connection instead of each taking one of the
 * browser's six. Off a page there is no socket at all — Node has no WebSocket, and
 * src/api/socket.ts is constructed unavailable without `location` — so without this file every
 * call in every suite would be refused with `network_error`, and no suite could drive the
 * app's real request path.
 *
 * So this module re-exports the real one (`ApiSocket`, `SocketTimeoutError`, the types) and
 * supplies the page's `apiSocket`:
 *
 * - A suite that plays a page — it stubs `WebSocket` with its own scripted one
 *   (test/fake-socket.ts, machines-events-stream.test.ts) — gets the real client, opened on
 *   that, so the frames those tests assert are the frames the product would put on the wire.
 * - Every other suite gets a stand-in whose `call()` carries the request over the global
 *   `fetch` the test stubbed (test/helpers/carry.ts) and answers in the socket's own shape.
 *   Everything above it — apiFetch, apiRequest, the routing to a machine, the error mapping,
 *   the 401 rule — is the product's own.
 *
 * vitest.config.ts points the app's own imports of `src/api/socket` here; a suite may mock
 * this module to reach the transport directly (draft-send.test.ts does, for the streams).
 *
 * Streams on the stand-in are as silent as they are on a page with no socket (those suites
 * drive them through their stores), and the identity calls are no-ops.
 */
export * from "../src/api/socket";
import { ApiSocket } from "../src/api/socket";
import { carryOverTestFetch } from "./helpers/carry";

/** Who the page is signed in as, asked as api/socket.ts asks it. */
async function whoAmI(): Promise<string | null> {
  const res = await globalThis.fetch("/api/me", { credentials: "same-origin" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`/api/me answered ${res.status}`);
  const body = (await res.json()) as { user?: { userId?: string } };
  return body.user?.userId ?? null;
}

/** The stand-in: every call goes over the test's fetch, streams are silent, no identity to settle. */
const standIn = {
  call: (
    method: string,
    url: string,
    opts?: { headers?: Record<string, string>; body?: unknown },
  ) => carryOverTestFetch(method, url, opts ?? {}),
  ready: async (): Promise<boolean> => true,
  isOpen: (): boolean => true,
  isUnavailable: (): boolean => false,
  stream: () => ({ close: () => undefined }),
  identityIs: (): void => undefined,
  identityChanged: (): void => undefined,
  report: () => ({
    state: "open" as const,
    lastFrameAgoMs: 0,
    pendingCalls: [] as string[],
    streams: [] as string[],
  }),
};

/**
 * The page's socket: the real client when this suite scripted a WebSocket of its own (see
 * `FakeSocket.scripted`) and a `location` to open on, the stand-in everywhere else — jsdom
 * included, whose own `location` and `WebSocket` would otherwise have the real client try to
 * reach a server no suite is running. Read at module load, which the suites that play a page
 * arrange with `vi.resetModules()` and a dynamic import.
 */
const scripted = (globalThis as { WebSocket?: { scripted?: unknown } }).WebSocket;
export const apiSocket =
  scripted?.scripted === true && typeof location !== "undefined"
    ? new ApiSocket(
        () => `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/socket`,
        whoAmI,
      )
    : standIn;
