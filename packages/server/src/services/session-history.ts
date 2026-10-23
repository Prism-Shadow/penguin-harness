/**
 * A Session's history as both doors serve it: `GET …/sessions/:id/messages` and the images its
 * windowed pages reference, `GET …/sessions/:id/trace-image`.
 *
 * One handler for the Web App's route (`/api/sessions/:id/…`, http/routes/sessions.ts) and the
 * Agent API's (`/api/amsp/v1/sessions/:id/…`, amsp/routes.ts). Each door has already decided the
 * caller may read the Session; the only difference between them is where a page's image
 * references point, which is each door's own `trace-image` route (`imageBase`).
 */
import type { AmspRecord } from "@prismshadow/penguin-core";
import type { Context } from "hono";
import type { MessagesLiveTail, MessagesPageInfo, MessagesResponse } from "../api/types.js";
import type { SessionRow } from "../db/repos/sessions.js";
import { badRequest, parseNonNegativeInt } from "../http/validate.js";
import type { Channels } from "../hmr/capabilities.js";
import type { Traces } from "../mechanisms/traces.js";
import type { SessionManager } from "../runtime/session-manager.js";
import { decodeCursor } from "./message-window.js";
import { withImagesByReference } from "./trace-images.js";
import type { MessagesPageRequest } from "./trace-service.js";

export interface SessionHistoryDeps {
  traceService: Pick<Traces, "readMessages" | "readMessagesPage" | "readTraceImage">;
  manager: Pick<
    SessionManager,
    "statusOf" | "liveFragments" | "pendingInputs" | "pendingBootstrap"
  >;
  channels: Pick<Channels, "get">;
}

/** Unit-count bounds for windowed history reads (`tailLimit` / `limit`), and the `before` page's default. */
const MESSAGES_PAGE_LIMIT_MAX = 1000;
const MESSAGES_PAGE_LIMIT_DEFAULT = 200;

/** Parse one windowed-read unit-count param (positive integer, capped). */
function pageLimit(raw: string, name: string): number {
  if (!/^\d{1,4}$/.test(raw)) throw badRequest(`${name} must be a positive integer.`);
  const v = Number.parseInt(raw, 10);
  if (v < 1 || v > MESSAGES_PAGE_LIMIT_MAX) {
    throw badRequest(`${name} must be an integer between 1 and ${MESSAGES_PAGE_LIMIT_MAX}.`);
  }
  return v;
}

/**
 * Appends the running Task's already-published input messages that the Trace read has not
 * caught up to yet. Duplication is decided by exact envelope-JSON identity — the engine
 * writes the very same envelopes, and the client's overlap dedup uses the same rule — and
 * only the history tail can contain them (inputs are the newest records when this races).
 */
function appendPendingInputs(messages: AmspRecord[], pending: AmspRecord[]): AmspRecord[] {
  if (pending.length === 0) return messages;
  const envelopeKey = (message: AmspRecord): string => {
    const { tracePosition: _tracePosition, ...envelope } = message as AmspRecord & {
      tracePosition?: unknown;
    };
    return JSON.stringify(envelope);
  };
  const tail = new Set(messages.slice(-50).map(envelopeKey));
  const missing = pending.filter((message) => !tail.has(envelopeKey(message)));
  return missing.length > 0 ? [...messages, ...missing] : messages;
}

/**
 * Parse GET /messages windowed-read params. No params → null: the legacy full-transcript
 * read, byte-identical to the pre-pagination response (other consumers depend on it).
 * `tailLimit=<n>` → the newest n units; `before=<cursor>[&limit=<n>]` → the n units
 * preceding the cursor. The two forms are mutually exclusive, and `limit` belongs to
 * `before` alone — mixing them is a caller bug worth a loud 400 rather than a guess.
 */
function messagesPageQuery(c: Context): MessagesPageRequest | null {
  const rawTail = c.req.query("tailLimit");
  const rawBefore = c.req.query("before");
  const rawLimit = c.req.query("limit");
  if (rawTail === undefined && rawBefore === undefined) {
    if (rawLimit !== undefined) throw badRequest("limit requires before.");
    return null;
  }
  if (rawTail !== undefined) {
    if (rawBefore !== undefined) throw badRequest("tailLimit and before are mutually exclusive.");
    if (rawLimit !== undefined) throw badRequest("limit only applies to before requests.");
    return { kind: "tail", limit: pageLimit(rawTail, "tailLimit") };
  }
  const cursor = decodeCursor(rawBefore!);
  if (cursor === null) {
    throw badRequest("before must be a cursor of the form <shardIndex>:<ordinal>.");
  }
  return {
    kind: "before",
    cursor,
    limit: rawLimit !== undefined ? pageLimit(rawLimit, "limit") : MESSAGES_PAGE_LIMIT_DEFAULT,
  };
}

/**
 * `GET …/sessions/:id/messages` for a Session the door has resolved. `imageBase` is where the
 * door serves a Session's routes (`/api/sessions`, `/api/amsp/v1/sessions`): a windowed page's
 * image references point at that door's own `trace-image` route.
 */
export async function sessionMessages(
  c: Context,
  deps: SessionHistoryDeps,
  row: SessionRow,
  imageBase: string,
): Promise<Response> {
  const page = messagesPageQuery(c);
  // Live tail (running/compacting sessions only): capture the channel cursor and the
  // open-fragment snapshot together, synchronously — no await between the two, and both
  // BEFORE the trace read starts. That ordering is what makes the client contract safe
  // (see MessagesLiveTail in api/types.ts): every published event with id <= cursor is
  // already reflected in `fragments`, and partial_* messages never reach the Trace, so
  // the client may drop its buffered partials at/or before the cursor and seed from
  // `fragments` without loss or duplication. Complete messages are never dropped by the
  // cursor — the client's overlap dedup against `messages` decides for them — so a
  // complete message whose trace append is still in flight when the read starts is not
  // lost either.
  //
  // Windowed reads keep the same contract on TAIL pages only: a tail page ends at the
  // transcript's live edge, so the attachment's semantics are identical. A `before`
  // page is immutable history — attaching in-flight fragments to it would seed them at
  // the wrong position — so it never carries `live`.
  let live: MessagesLiveTail | undefined;
  let pendingInputs: AmspRecord[] = [];
  if (page?.kind !== "before") {
    if (deps.manager.statusOf(row.sessionId) !== "idle") {
      live = {
        cursor: deps.channels.get(row.sessionId).lastEventId,
        fragments: deps.manager.liveFragments(row.sessionId),
      };
    }
    // The Task's inputs (published at launch) and its streamed bootstrap records
    // (mcp_connect pair / tool_list_ready): the engine's Trace writes for both land
    // only after the first run's connect, so a client rebuilding during that window
    // would otherwise see neither its own message nor the connecting status — a
    // silent blank while a slow MCP server times out. Appended below when the trace
    // read hasn't caught up; `before` pages are immutable history and never carry
    // them (same rule as `live`). NOT gated on running: a run aborted mid-bootstrap
    // wrote nothing to the Trace, and its held input is the only copy a reload can
    // show until the next run persists it (the holds survive idle for exactly that
    // case — see the manager's request_begin clear).
    pendingInputs = [
      ...deps.manager.pendingInputs(row.sessionId),
      ...deps.manager.pendingBootstrap(row.sessionId),
    ];
  }
  if (page !== null) {
    const result = await deps.traceService.readMessagesPage(
      row.projectId,
      row.agentId,
      row.sessionId,
      page,
    );
    const info: MessagesPageInfo = {
      ...(result.before !== undefined ? { before: result.before } : {}),
      earlierTurns: result.prior.turns,
      prior: {
        subagentTokens: result.prior.subagentTokens,
        elapsedMs: result.prior.elapsedMs,
        apiMs: result.prior.apiMs,
        toolMs: result.prior.toolMs,
        sessionTokens: result.prior.sessionTokens,
        contextTokens: result.prior.contextTokens,
      },
      ...(result.contextModel !== undefined ? { contextModel: result.contextModel } : {}),
      ...(result.agentState !== undefined ? { agentState: result.agentState } : {}),
    };
    // Images by reference, after the held inputs were merged: the dedup compares raw
    // envelopes, and a held input carries its image inline exactly as its Trace copy does.
    const messages = appendPendingInputs(result.messages, pendingInputs).map((m) =>
      withImagesByReference(row.sessionId, m, imageBase),
    );
    return c.json({
      messages,
      ...(live !== undefined ? { live } : {}),
      page: info,
    } satisfies MessagesResponse);
  }
  const messages = await deps.traceService.readMessages(row.projectId, row.agentId, row.sessionId);
  return c.json({
    messages: appendPendingInputs(messages, pendingInputs),
    ...(live !== undefined ? { live } : {}),
  } satisfies MessagesResponse);
}

/**
 * `GET …/sessions/:id/trace-image`: one image of one Trace record, the URL a windowed history
 * page puts in place of an inline data URL (services/trace-images.ts). The record never changes,
 * so the answer is immutable; only inert raster types are ever served (the page references
 * nothing else).
 */
export async function sessionTraceImage(
  c: Context,
  deps: SessionHistoryDeps,
  row: SessionRow,
): Promise<Response> {
  const intQuery = (name: string, min: number): number | undefined => {
    const raw = c.req.query(name);
    if (raw === undefined) return undefined;
    const v = parseNonNegativeInt(raw);
    if (v === null || v < min) {
      throw badRequest(`${name} must be an integer of at least ${min}.`);
    }
    return v;
  };
  const fileIndex = intQuery("file", 1);
  const ordinal = intQuery("ordinal", 0);
  if (fileIndex === undefined || ordinal === undefined) {
    throw badRequest("file and ordinal are required.");
  }
  const image = await deps.traceService.readTraceImage(
    row.projectId,
    row.agentId,
    row.sessionId,
    fileIndex,
    ordinal,
    intQuery("i", 0),
  );
  return c.body(new Uint8Array(image.bytes), 200, {
    "content-type": image.mime,
    "x-content-type-options": "nosniff",
    "cache-control": "private, max-age=31536000, immutable",
  });
}
