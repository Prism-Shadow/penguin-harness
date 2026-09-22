/**
 * SSE endpoint adapter:
 * writes the runtime/channel event stream as an SSE response, shared by both the Session
 * channel and the user channel.
 *
 * - Response headers: text/event-stream, no-cache, `X-Accel-Buffering: no` (disables
 *   buffering on reverse proxies);
 * - Heartbeat: writes a `: ping` comment line every 20s; the connection is torn down on write failure;
 * - Replay protocol: a fresh subscription without Last-Event-ID does not replay the buffer
 *   (history is served by the messages endpoint) — it only sends the initial events the
 *   caller supplied (pending approvals / hello). With a Last-Event-ID that hits the buffer,
 *   replay resumes from there; on a miss, `resync_required` is sent first, then the
 *   connection continues.
 * - Revocation: a stream is authorised at connect and never again by the request path, so
 *   an authenticated route hands over {@link SseRevocation} — the registry that can end
 *   this stream from outside, and the check the heartbeat runs on it.
 * Docs: /docs/server-api § "Delivery Guarantees".
 */
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import type { ServerEvent } from "../api/types.js";
import type { Channel, ChannelEvent, ChannelListener } from "../runtime/channel.js";
import type { LiveStreams } from "../auth/live-streams.js";
import type { Auth } from "../mechanisms/identity.js";
import { SESSION_COOKIE, bearerToken } from "../auth/middleware.js";

const HEARTBEAT_MS = 20_000;

/** How the session behind one connection reaches the stream it authorised. */
export interface SseRevocation {
  /** The user this connection was authenticated as. */
  userId: string;
  /** Holds the stream for as long as it is open (auth/live-streams.ts). */
  streams: LiveStreams;
  /** Whether the session behind this connection still exists and has not expired. Never renews it. */
  sessionIsLive(): boolean;
}

export interface SseEndpointOptions {
  /** Initial server events to send privately after the subscription is established (in order): pending-approval replay / user channel hello. */
  initialEvents?: ServerEvent[];
  /** Omitted only where there is no authenticated session to revoke. */
  revocation?: SseRevocation;
}

/**
 * The revocation wiring an authenticated SSE route hands {@link sseEndpoint}. One
 * definition, so a new streaming route cannot be wired half-way — with a registry entry
 * but no re-check, or the other way round.
 */
export function streamRevocation(
  c: Context,
  user: { userId: string },
  deps: { liveStreams: LiveStreams; auth: Auth },
): SseRevocation {
  // Bearer first, cookie otherwise — the precedence authMiddleware authenticated this
  // request with. A Bearer-authenticated stream (the CLI, an Agent's own tools) carries no
  // session row at all: its credential is the boot's local API token, which lives as long
  // as the process does. There is nothing for the heartbeat to re-check there, so it
  // leaves that connection alone instead of ending it on a lookup that can only miss.
  const token =
    bearerToken(c.req.header("authorization")) !== null
      ? null
      : (getCookie(c, SESSION_COOKIE) ?? null);
  return {
    userId: user.userId,
    streams: deps.liveStreams,
    sessionIsLive: () => token === null || deps.auth.sessionIsLive(token),
  };
}

/** Stream out a Channel as an SSE response. */
export function sseEndpoint(c: Context, channel: Channel, opts: SseEndpointOptions = {}): Response {
  const lastEventIdHeader = c.req.header("Last-Event-ID");
  const revocation = opts.revocation;
  c.header("X-Accel-Buffering", "no");
  c.header("Cache-Control", "no-cache");

  return streamSSE(c, async (stream) => {
    let closed = false;
    let finish: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      finish = () => {
        if (closed) return;
        closed = true;
        resolve();
      };
    });

    // Claimed before anything that can throw and released in the finally below, so the
    // registry holds an entry for exactly as long as the connection lives: one left
    // behind would name a stream nobody can close again.
    const release = revocation?.streams.add(revocation.userId, finish) ?? (() => {});
    let unsubscribe: (() => void) | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    try {
      // Write serialization: SSE events must be written fully and in order; any write failure tears down the connection.
      let chain: Promise<void> = Promise.resolve();
      const enqueue = (write: () => Promise<unknown>): void => {
        chain = chain
          .then(async () => {
            if (!closed) await write();
          })
          .catch(() => finish());
      };
      const listener: ChannelListener = (evt: ChannelEvent) => {
        enqueue(() =>
          stream.writeSSE({
            data: evt.data,
            // Event id is an opaque string generated by the channel (`<epoch>-<seq>`), passed through as-is.
            id: evt.id,
            ...(evt.event !== undefined ? { event: evt.event } : {}),
          }),
        );
      };

      unsubscribe = channel.subscribe(listener);
      // Subscribe first (to avoid dropping events in a race with broadcasts), then replay
      // synchronously — event order: buffered replay (or resync_required) -> initial events
      // (task_state snapshot / pending approvals / hello) -> live stream.
      if (lastEventIdHeader !== undefined) {
        const replay = channel.replayAfter(lastEventIdHeader);
        if (!replay.hit) {
          const resync: ServerEvent = { type: "resync_required" };
          channel.sendTo(listener, resync, "server_event");
        } else {
          for (const evt of replay.events) listener(evt);
        }
      }
      for (const event of opts.initialEvents ?? []) {
        channel.sendTo(listener, event, "server_event");
      }

      heartbeat = setInterval(() => {
        // The heartbeat is the one beat an open stream already has, so re-asking whether
        // the session behind it still exists costs nothing extra — and it bounds how long
        // a window whose session was revoked keeps streaming to a single interval, no
        // matter which caller dropped the rows or whether it remembered the registry. The
        // check must not renew the session: sliding the expiry from here would keep a
        // window nobody has touched signed in for as long as it stays open.
        if (revocation !== undefined && !revocation.sessionIsLive()) {
          finish();
          return;
        }
        enqueue(() => stream.write(": ping\n\n"));
      }, HEARTBEAT_MS);

      stream.onAbort(() => finish());
      await done;
    } finally {
      if (heartbeat !== null) clearInterval(heartbeat);
      unsubscribe?.();
      release();
    }
  });
}
