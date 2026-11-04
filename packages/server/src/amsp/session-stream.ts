/**
 * AMSP's Session stream: one handler behind both doors.
 *
 *   GET /api/amsp/v1/sessions/:sessionId/stream   the key door (routes.ts), gated by the Agent's key
 *   GET /api/sessions/:sessionId/amsp             the cookie door (http/routes/sessions.ts), the
 *                                                 same Project access as the Web App's `/stream`
 *
 * It subscribes to the Session's channel and writes what AMSP is made of: every record with its
 * `id:` and `event: ping` on the 20-second beat. A `Last-Event-ID` (or `lastEventId`) the buffer
 * no longer holds is refused before any stream starts: 409 `resync_required`, the API's JSON
 * error, after which the reader reads the history and subscribes afresh. Nothing the Web App's
 * internal stream adds is written: no `server_event` (task state, approval requests, titles, goal
 * progress), no initial snapshot, no replay of pending approvals — approvals are the
 * `…/approvals` resource. The internal stream, `GET /api/sessions/:sessionId/stream`, writes what
 * it always wrote.
 */
import type { Context } from "hono";
import { sseEndpoint } from "../http/sse.js";
import type { SseRevocation, StreamedChannel } from "../http/sse.js";

export function amspSessionStream(
  c: Context,
  channel: StreamedChannel,
  revocation?: SseRevocation,
): Response {
  return sseEndpoint(c, channel, { amsp: true, ...(revocation ? { revocation } : {}) });
}
