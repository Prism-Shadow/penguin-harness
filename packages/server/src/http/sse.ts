/**
 * SSE endpoint adapter:
 * writes the runtime/channel event stream as an SSE response, shared by both the Session
 * channel and the user channel — over HTTP. When the socket transported the call, the same
 * stream is answered as the frames it already are (socket/stream-answer.ts): no SSE text is
 * written or parsed on that transport.
 *
 * - Response headers: text/event-stream, no-cache, `X-Accel-Buffering: no` (disables
 *   buffering on reverse proxies);
 * - Heartbeat: a named `ping` event (`data: {}`, no `id:` line) right after the initial
 *   events and every 20s after. A browser hides comment lines from the page, so only an
 *   event lets it tell a quiet stream from a dead one (web api/sse.ts); without an id it
 *   moves neither Last-Event-ID nor the replay cursor. A peer that stops reading is cut off
 *   by the host's idle timeout ({@link STREAM_IDLE_MS}, app.ts);
 *   User and machine-aggregate streams also send a `heartbeat` server event.
 * - Replay protocol: a fresh subscription without Last-Event-ID does not replay the buffer
 *   (history is served by the messages endpoint) — it only sends the initial events the
 *   caller supplied (pending approvals / hello). With a Last-Event-ID that hits the buffer,
 *   replay resumes from there; on a miss, `resync_required` is sent first, then the
 *   connection continues. An AMSP stream answers a miss before it starts instead: an HTTP
 *   409 `resync_required`, and no stream. A page cannot set headers on an EventSource it
 *   opens itself, so the id may come as the `lastEventId` query parameter instead; the
 *   header wins.
 * - Revocation: a stream is authorised at connect and never again by the request path, so
 *   an authenticated route hands over {@link SseRevocation} — the registry that can end
 *   this stream from outside, and the check the heartbeat runs on it.
 * Docs: /docs/server-api § "Delivery Guarantees".
 */
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import type { ServerEvent } from "../api/types.js";
import { HttpError } from "./errors.js";
import type { Channel, ChannelEvent, ChannelListener } from "../runtime/channel.js";
import type { LiveStreams } from "../auth/live-streams.js";
import type { Auth } from "../mechanisms/identity.js";
import { bearerToken, sessionCookies } from "../auth/middleware.js";
import { answerOf } from "../socket/stream-answer.js";
import type { StreamAnswer } from "../socket/stream-answer.js";

/** The beat both the named ping and the `heartbeat` server event are written on (machines/event-hub.ts times the hub's silence by it). */
export const HEARTBEAT_MS = 20_000;

/** An event stream's socket that sends nothing for this long is destroyed (app.ts): two missed beats. */
export const STREAM_IDLE_MS = 2 * HEARTBEAT_MS;

/** The heartbeat frame: named so a page can see it, id-less so it moves no cursor. */
const PING = { event: "ping", data: "{}" } as const;

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
  /**
   * Also write a `heartbeat` server event every beat, not only the id-less `ping` event. Set on
   * the user channel, whose readers (a browser tab, and the hub reading a machine's events)
   * must be able to tell a live stream from a silent one — the socket's ping and the comment
   * line both being invisible to a stream's consumer.
   */
  heartbeatEvent?: boolean;
  /**
   * Write the channel as AMSP (amsp/session-stream.ts): its records and the `ping` beat only.
   * A channel event with a name — the Web App's `server_event` — is never written, and a
   * `Last-Event-ID` the buffer no longer holds (evicted, or of an epoch before a restart) is
   * refused before the stream starts, with {@link resyncRequired}, instead of the `server_event`
   * the internal stream writes. Initial events and the heartbeat event do not apply.
   */
  amsp?: boolean;
}

/**
 * The answer to an AMSP resume the buffer cannot serve: the reader reads the history again and
 * opens the stream without an id.
 */
export const resyncRequired = (): HttpError =>
  new HttpError(
    409,
    "resync_required",
    "The id to resume from has left the server's buffer: read the history, then open the stream without it.",
  );

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
  // A browser's cookie carries the port it reached this server on (sessionCookieName), and a
  // plain one may ride beside it; the session this stream watches is the first one that is
  // live, as authMiddleware picked it.
  const cookies =
    bearerToken(c.req.header("authorization")) !== null
      ? []
      : sessionCookies(getCookie(c), c.req.url);
  const token =
    cookies.find((cookie) => deps.auth.sessionIsLive(cookie.token))?.token ??
    cookies[0]?.token ??
    null;
  return {
    userId: user.userId,
    streams: deps.liveStreams,
    sessionIsLive: () => token === null || deps.auth.sessionIsLive(token),
  };
}

/** What the adapter reads of a channel. */
export type StreamedChannel = Pick<Channel, "subscribe" | "replayAfter" | "sendTo">;

/** Stream out a Channel as an SSE response. */
export function sseEndpoint(
  c: Context,
  channel: StreamedChannel,
  opts: SseEndpointOptions = {},
): Response {
  // The header wins: the browser sets it on its own reconnects, and it is newer than the id
  // the page wrote into the URL when it opened this EventSource.
  const lastEventId = c.req.header("Last-Event-ID") ?? c.req.query("lastEventId");
  // AMSP refuses a resume it cannot serve while it can still answer with a status: once the
  // stream has started, only its frames are left.
  if (opts.amsp === true && lastEventId !== undefined && !channel.replayAfter(lastEventId).hit) {
    throw resyncRequired();
  }
  // A stream the socket transported is answered directly, as the frames it already are
  // (socket/stream-answer.ts); an HTTP reader gets the SSE text below, as ever.
  const answered = answerOf(c.req.raw);
  if (answered !== null) return channelAnswered(c, channel, opts, answered);
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
      // Write serialization: SSE events must be written fully and in order. A write to a peer
      // that stopped reading never completes; the host's idle timeout then destroys the
      // socket, which aborts the stream and lands in finish() below.
      let chain: Promise<void> = Promise.resolve();
      const enqueue = (write: () => Promise<unknown>): void => {
        chain = chain
          .then(async () => {
            if (!closed) await write();
          })
          .catch(() => finish());
      };
      const listener: ChannelListener = (evt: ChannelEvent) => {
        // AMSP carries records alone: a named channel event is the Web App's own.
        if (opts.amsp === true && evt.event !== undefined) return;
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
      // (task_state snapshot / pending approvals / hello) -> ping -> live stream.
      if (lastEventId !== undefined) {
        const replay = channel.replayAfter(lastEventId);
        if (!replay.hit) {
          if (opts.amsp === true) {
            // Checked before the stream started; should the buffer have moved since, end the
            // stream: the reader reopens it with the same id and is answered the 409.
            finish();
            return;
          } else {
            const resync: ServerEvent = { type: "resync_required" };
            channel.sendTo(listener, resync, "server_event");
          }
        } else {
          for (const evt of replay.events) listener(evt);
        }
      }
      if (opts.amsp !== true) {
        for (const event of opts.initialEvents ?? []) {
          channel.sendTo(listener, event, "server_event");
        }
      }
      // The first beat goes out at once, so a client knows from the first second that this
      // stream pings — not only after the first interval has passed.
      enqueue(() => stream.writeSSE(PING));

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
        enqueue(() => stream.writeSSE(PING));
        if (opts.heartbeatEvent === true && opts.amsp !== true) {
          // Unicast: the beat is this subscriber's own liveness, so it consumes a seq (as any
          // event does) but is neither buffered nor broadcast to the channel's other readers.
          const beat: ServerEvent = { type: "heartbeat" };
          channel.sendTo(listener, beat, "server_event");
        }
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

/**
 * The same stream as {@link sseEndpoint}'s, answered on the socket directly
 * (socket/stream-answer.ts): the events go out as the frames they already are, in the same
 * order — buffered replay (or resync_required), initial events, ping, live stream — with no
 * SSE text written. What the HTTP stream gets from its host — its abort, its finally — this
 * stream gets from the call's own Request signal, which is the one release path on that
 * transport; the route's Response carries nothing, and serve.ts drops it.
 */
function channelAnswered(
  c: Context,
  channel: StreamedChannel,
  opts: SseEndpointOptions,
  answer: StreamAnswer,
): Response {
  const lastEventId = c.req.header("Last-Event-ID") ?? c.req.query("lastEventId");
  const revocation = opts.revocation;
  let closed = false;
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let finish: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    finish = () => {
      if (closed) return;
      closed = true;
      if (heartbeat !== null) clearInterval(heartbeat);
      unsubscribe?.();
      resolve();
    };
  });

  // Claimed before anything that can throw and released when the stream ends — a finally
  // could not do it, for this stream outlives the return: the registry holds an entry for
  // exactly as long as the connection lives, and one left behind would name a stream
  // nobody could close again.
  const release = revocation?.streams.add(revocation.userId, finish) ?? (() => {});
  void done.then(() => {
    release();
    answer.end("closed");
  });
  try {
    answer.start(200, { "content-type": "text/event-stream" });
    const listener: ChannelListener = (evt: ChannelEvent) => {
      if (opts.amsp === true && evt.event !== undefined) return;
      answer.event(
        // Event id is an opaque string generated by the channel (`<epoch>-<seq>`), passed through as-is.
        evt.event ?? "message",
        evt.id,
        evt.data,
      );
    };

    unsubscribe = channel.subscribe(listener);
    // Subscribe first (to avoid dropping events in a race with broadcasts), then replay
    // synchronously — event order as above: the answer has begun, so nothing is dropped.
    if (lastEventId !== undefined) {
      const replay = channel.replayAfter(lastEventId);
      if (!replay.hit) {
        if (opts.amsp === true) {
          // As on HTTP: refused before the answer started; a buffer that moved since ends it.
          finish();
          return new Response(null, { status: 200 });
        } else {
          const resync: ServerEvent = { type: "resync_required" };
          channel.sendTo(listener, resync, "server_event");
        }
      } else {
        for (const evt of replay.events) listener(evt);
      }
    }
    if (opts.amsp !== true) {
      for (const event of opts.initialEvents ?? []) {
        channel.sendTo(listener, event, "server_event");
      }
    }
    // The first beat goes out at once, so a client knows from the first second that this
    // stream pings — not only after the first interval has passed.
    answer.event(PING.event, null, PING.data);

    heartbeat = setInterval(() => {
      // The same re-check as the HTTP heartbeat: one beat bounds how long a window whose
      // session was revoked keeps streaming, and the check must not renew the session.
      if (revocation !== undefined && !revocation.sessionIsLive()) {
        finish();
        return;
      }
      answer.event(PING.event, null, PING.data);
      if (opts.heartbeatEvent === true && opts.amsp !== true) {
        // Unicast: the beat is this subscriber's own liveness, so it consumes a seq (as any
        // event does) but is neither buffered nor broadcast to the channel's other readers.
        const beat: ServerEvent = { type: "heartbeat" };
        channel.sendTo(listener, beat, "server_event");
      }
    }, HEARTBEAT_MS);

    // The one release path (socket/serve.ts): a cancel frame, the socket closing, the
    // client lagging past the watermark — the call's Request is aborted, and this stream
    // ends exactly as the aborted hono stream ends the HTTP one.
    answer.signal.addEventListener("abort", finish, { once: true });
    if (answer.signal.aborted) finish();
  } catch (err) {
    // What the HTTP stream answers with a dropped connection, this answers with a clean
    // end: the client re-issues, and the route's own error handling answers that.
    finish();
    throw err;
  }
  return new Response(null, { status: 200 });
}
