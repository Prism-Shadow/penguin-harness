/**
 * Write timeout for streamed responses: an event stream whose socket has stopped draining
 * for {@link STREAM_WRITE_TIMEOUT_MS} is destroyed.
 *
 * A peer that stops reading (a half-open connection, a stuck proxy, a frozen tab) fills the
 * socket, and from then on no write to that stream completes. The SSE handler's ordered
 * write chain parks behind the first stuck write, so every later event and every heartbeat
 * queues up for good, and the handler cannot end the response either: closing the stream
 * only queues behind the same stuck write, and @hono/node-server reads the body again only
 * on `drain`. The connection stays open, and the client, which sees an open connection,
 * never reconnects.
 *
 * Only the socket can be ended, and only the host holds it (`c.env.outgoing`, which the
 * HMR platform seam does not hand on to the routes). So the check lives here, beside the
 * request rather than inside the SSE handler. Destroying the response fires the stream's
 * abort, which runs the handler's own teardown (unsubscribe, stop the heartbeat, release
 * the revocation entry), and the client's EventSource sees a dropped connection and
 * reconnects with its last event id, which the channel's replay buffer answers.
 *
 * "Stopped draining" is precise: Node marks a response that refused a write as needing
 * `drain` and clears the mark when the socket empties. A slow peer that keeps reading
 * drains between checks and is left alone however far behind it is. An idle stream has
 * nothing to drain, so a quiet connection is never mistaken for a stuck one.
 */
import type { ServerResponse } from "node:http";
import type { MiddlewareHandler } from "hono";

/** How long a stream's writes may stay parked on a full socket before the socket is destroyed. */
export const STREAM_WRITE_TIMEOUT_MS = 30_000;
/** How often an open stream is looked at: the timeout is honoured to within one check. */
const CHECK_MS = 5_000;

/** Watches one streamed response until it closes. */
function watchWrites(outgoing: ServerResponse): void {
  let parkedSince: number | null = null;
  const drained = () => {
    parkedSince = null;
  };
  const check = setInterval(() => {
    if (!outgoing.writableNeedDrain) {
      parkedSince = null;
      return;
    }
    const now = Date.now();
    parkedSince ??= now;
    if (now - parkedSince >= STREAM_WRITE_TIMEOUT_MS) outgoing.destroy();
  }, CHECK_MS);
  check.unref?.();
  outgoing.on("drain", drained);
  outgoing.once("close", () => {
    clearInterval(check);
    outgoing.off("drain", drained);
  });
}

/**
 * Puts every event-stream response under {@link watchWrites}. Needs the Node bindings in
 * `c.env` (index.ts passes them on); without them (in-process `app.request()`) it does
 * nothing.
 */
export const streamWriteTimeout: MiddlewareHandler = async (c, next) => {
  await next();
  const outgoing = (c.env as { outgoing?: ServerResponse } | undefined)?.outgoing;
  if (outgoing === undefined || outgoing.destroyed) return;
  if (!c.res.headers.get("content-type")?.startsWith("text/event-stream")) return;
  watchWrites(outgoing);
};
