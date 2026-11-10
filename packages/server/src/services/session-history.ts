/**
 * A Session's history as both doors serve it: `GET …/sessions/:id/messages` and the images its
 * windowed pages reference, `GET …/sessions/:id/trace-image`.
 *
 * One handler for the Web App's route (`/api/sessions/:id/…`, http/routes/sessions.ts) and the
 * Agent API's (`/api/amsp/v1/sessions/:id/…`, amsp/routes.ts). Each door has already decided the
 * caller may read the Session; the only difference between them is where a page's image
 * references point, which is each door's own `trace-image` route (`imageBase`).
 *
 * The answer's assembly — the envelope captured before the read, the held inputs merged, images
 * by reference — is exported on its own (`captureHistoryEnvelope`, `historyResponse`): the
 * `history` stream (http/routes/history.ts) sends the same records, and a hub assembles a
 * machine Session's from its copy of the machine's lines (machines/history-sync.ts).
 *
 * `/messages` alone also answers the run form (`live=run`, see `MessagesLiveTail`): the live tail
 * carries the current run's records, and the read's records stop where that run starts
 * (`cutBeforeRun`).
 */
import type { AmspRecord } from "@prismshadow/penguin-core";
import type { Context } from "hono";
import type {
  HistoryMessage,
  SessionStatus,
  MessagesLiveTail,
  MessagesPageInfo,
  MessagesResponse,
} from "../api/types.js";
import type { SessionRow } from "../db/repos/sessions.js";
import { badRequest, parseNonNegativeInt } from "../http/validate.js";
import type { Channels } from "../hmr/capabilities.js";
import type { Traces } from "../mechanisms/traces.js";
import { envelopeDigest } from "../runtime/live-tail.js";
import type { RunStart } from "../runtime/live-tail.js";
import type { SessionManager } from "../runtime/session-manager.js";
import { decodeCursor } from "./message-window.js";
import { withImagesByReference } from "./trace-images.js";
import type { MessagesPageRequest, MessagesPageResult } from "./trace-service.js";

export interface SessionHistoryDeps {
  traceService: Pick<Traces, "readMessages" | "readMessagesPage" | "readTraceImage">;
  manager: Pick<
    SessionManager,
    "statusOf" | "liveFragments" | "liveRun" | "pendingInputs" | "pendingBootstrap"
  >;
  channels: Pick<Channels, "get">;
}

/** Unit-count bounds for windowed history reads (`tailLimit` / `limit`), and the `before` page's default. */
export const MESSAGES_PAGE_LIMIT_MAX = 1000;
export const MESSAGES_PAGE_LIMIT_DEFAULT = 200;

/** Parse one windowed-read unit-count param (positive integer, capped); a 400 otherwise. */
export function pageLimit(raw: string, name: string): number {
  if (!/^\d{1,4}$/.test(raw)) throw badRequest(`${name} must be a positive integer.`);
  const v = Number.parseInt(raw, 10);
  if (v < 1 || v > MESSAGES_PAGE_LIMIT_MAX) {
    throw badRequest(`${name} must be an integer between 1 and ${MESSAGES_PAGE_LIMIT_MAX}.`);
  }
  return v;
}

/** A record's envelope as the Trace and the stream carry it: its JSON, without the history read's `tracePosition`. */
function envelopeKey(message: AmspRecord): string {
  const { tracePosition: _tracePosition, ...envelope } = message as AmspRecord & {
    tracePosition?: unknown;
  };
  return JSON.stringify(envelope);
}

/**
 * Appends the running Task's already-published input messages that the Trace read has not
 * caught up to yet. Duplication is decided by exact envelope-JSON identity — the engine
 * writes the very same envelopes, and the client's overlap dedup uses the same rule — and
 * only the history tail can contain them (inputs are the newest records when this races).
 */
export function appendPendingInputs(messages: AmspRecord[], pending: AmspRecord[]): AmspRecord[] {
  if (pending.length === 0) return messages;
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
 * `query` reads one query parameter (the `history` stream takes the same grammar).
 */
export function messagesPageQuery(
  query: (name: string) => string | undefined,
): MessagesPageRequest | null {
  const rawTail = query("tailLimit");
  const rawBefore = query("before");
  const rawLimit = query("limit");
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
 * What a history read answers beside its records, captured before the read starts: the
 * running Task's live tail and its held inputs (see the comment in `captureHistoryEnvelope`),
 * the Session's status, and this server's clock.
 */
export interface HistoryEnvelope {
  live?: MessagesLiveTail;
  pendingInputs: AmspRecord[];
  status: SessionStatus;
  serverNowMs: number;
  /**
   * The run form only, and never sent: the cursor of the capture and the records the run it
   * found starts at — what the read's records are cut at once read (`runCutAfterRead`).
   */
  run?: { cursor: string; starts: readonly RunStart[] };
}

/**
 * Which live tail a read carries: `fragments`, the open streaming fragments while the Session
 * is busy (the Web App's, which reconciles the stream against history itself); `run`, the
 * current run's records whatever the Session is doing (`live=run`, see `MessagesLiveTail`).
 */
export type LiveTailForm = "fragments" | "run";

/**
 * The envelope of a read of `sessionId`, captured now — `/messages`, the `history` stream and a
 * machine's `history-lines` all take it from here. Call it synchronously before the Trace read
 * starts, with no await in between: the live-tail contract rests on that order. `kind` is the
 * read's: a tail or the whole transcript ends at the live edge; a `before` window, or a read that
 * is no window at all (`none`: a body, the fill), carries neither the live tail nor held inputs.
 * `form` is the live tail's (`LiveTailForm`); the run form's records are cut with
 * `runCutAfterRead` once read.
 */
export function captureHistoryEnvelope(
  deps: Pick<SessionHistoryDeps, "manager" | "channels">,
  sessionId: string,
  kind: "tail" | "before" | "full" | "none",
  form: LiveTailForm = "fragments",
): HistoryEnvelope {
  const status = deps.manager.statusOf(sessionId);
  const serverNowMs = Date.now();
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
  if (kind === "before" || kind === "none") return { pendingInputs: [], status, serverNowMs };
  if (form === "run") return captureRunEnvelope(deps, sessionId, status, serverNowMs);
  let live: MessagesLiveTail | undefined;
  if (status !== "idle") {
    live = {
      cursor: deps.channels.get(sessionId).lastEventId,
      fragments: deps.manager.liveFragments(sessionId),
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
  const pendingInputs = heldInputs(deps, sessionId);
  return { ...(live !== undefined ? { live } : {}), pendingInputs, status, serverNowMs };
}

/** The Task's held inputs and bootstrap records (see `captureHistoryEnvelope`). */
function heldInputs(deps: Pick<SessionHistoryDeps, "manager">, sessionId: string): AmspRecord[] {
  return [...deps.manager.pendingInputs(sessionId), ...deps.manager.pendingBootstrap(sessionId)];
}

/**
 * The run form's envelope (`captureHistoryEnvelope`, same tick): `live` whatever the status —
 * the cursor, the status at it, the open fragments and the current run's records (none while
 * idle). A busy Session's held inputs are the run's own records, so they are not offered as
 * well; an idle one's are, as in the other form (an aborted bootstrap's input).
 */
function captureRunEnvelope(
  deps: Pick<SessionHistoryDeps, "manager" | "channels">,
  sessionId: string,
  status: SessionStatus,
  serverNowMs: number,
): HistoryEnvelope {
  const cursor = deps.channels.get(sessionId).lastEventId;
  const run = deps.manager.liveRun(sessionId);
  const live: MessagesLiveTail = {
    cursor,
    status,
    fragments: deps.manager.liveFragments(sessionId),
    records: run?.records ?? [],
    ...(run !== null && run.omitted > 0 ? { omitted: run.omitted } : {}),
  };
  return {
    live,
    pendingInputs: status === "idle" ? heldInputs(deps, sessionId) : [],
    status,
    serverNowMs,
    run: { cursor, starts: run?.starts ?? [] },
  };
}

/** Whether channel event `id` was published after `cursor`: both `<epoch>-<seq>`, and only within one epoch. */
function publishedAfter(id: string, cursor: string): boolean {
  const split = (eventId: string): [string, number] => {
    const sep = eventId.lastIndexOf("-");
    return [eventId.slice(0, sep), Number(eventId.slice(sep + 1))];
  };
  const [epoch, seq] = split(id);
  const [cursorEpoch, cursorSeq] = split(cursor);
  return epoch === cursorEpoch && seq > cursorSeq;
}

/**
 * Where the run form's read is cut, decided once the read is done: at the starts the capture
 * found, and at every start published after the cursor — a run that began while the read was
 * in flight, or the first Trace record of a run that had streamed only fragments by the
 * capture. The read may already hold those, and the client gets them from the stream.
 */
export function runCutAfterRead(
  deps: Pick<SessionHistoryDeps, "manager">,
  sessionId: string,
  captured: NonNullable<HistoryEnvelope["run"]>,
): readonly RunStart[] {
  const later = (deps.manager.liveRun(sessionId)?.starts ?? []).filter((start) =>
    publishedAfter(start.id, captured.cursor),
  );
  return later.length === 0 ? captured.starts : [...captured.starts, ...later];
}

/**
 * `messages` up to (not including) the earliest record of `starts` they hold — the current
 * run's first record, or one of its user inputs when the read is a window that begins inside
 * the run — so that the run is shown from its own records alone. Records are matched by
 * envelope, as `appendPendingInputs` matches them, from the end; a read that holds none of
 * them lies wholly before the run and is kept whole. `starts[0]` is the earliest of them all:
 * found, nothing before it can be the run's.
 */
export function cutBeforeRun<M extends AmspRecord>(
  messages: M[],
  starts: readonly RunStart[],
): M[] {
  if (starts.length === 0) return messages;
  // Timestamps first: only a record stamped like a start is worth serializing.
  const timestamps = new Set(starts.map((start) => start.timestamp));
  const digests = new Set(starts.map((start) => start.digest));
  let cut = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    if (!timestamps.has(message.timestamp)) continue;
    const digest = envelopeDigest(envelopeKey(message));
    if (!digests.has(digest)) continue;
    cut = i;
    if (digest === starts[0]!.digest) break;
  }
  return cut < 0 ? messages : messages.slice(0, cut);
}

/** A windowed read's page facts as `MessagesResponse.page` carries them. */
export function messagesPageInfo(result: Omit<MessagesPageResult, "messages">): MessagesPageInfo {
  return {
    ...(result.before !== undefined ? { before: result.before } : {}),
    earlierTurns: result.prior.turns,
    units: result.units,
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
}

/**
 * The answer of one history read, from its records and the envelope captured before it: the
 * held inputs the Trace has not caught up to appended, and — on a windowed read (`page`) —
 * images by reference under `imageBase`. `/messages` answers it as it is; the `history` stream
 * sends the same records, elided. Records keep their order, so the first `messages.length` of
 * the answer are the read's own.
 */
export function historyResponse(
  read: { messages: HistoryMessage[]; page?: MessagesPageInfo },
  envelope: Pick<HistoryEnvelope, "live" | "pendingInputs">,
  sessionId: string,
  imageBase: string,
): MessagesResponse {
  const live = envelope.live !== undefined ? { live: envelope.live } : {};
  const merged = appendPendingInputs(read.messages, envelope.pendingInputs);
  if (read.page === undefined) return { messages: merged, ...live };
  // Images by reference, after the held inputs were merged: the dedup compares raw
  // envelopes, and a held input carries its image inline exactly as its Trace copy does.
  return {
    messages: merged.map((m) => withImagesByReference(sessionId, m, imageBase)),
    ...live,
    page: read.page,
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
  const page = messagesPageQuery((name) => c.req.query(name));
  const form: LiveTailForm = c.req.query("live") === "run" ? "run" : "fragments";
  const envelope = captureHistoryEnvelope(deps, row.sessionId, page?.kind ?? "full", form);
  // The run form's records stop where the current run starts: its records are in `live`.
  const cut = <M extends AmspRecord>(messages: M[]): M[] =>
    envelope.run !== undefined
      ? cutBeforeRun(messages, runCutAfterRead(deps, row.sessionId, envelope.run))
      : messages;
  if (page !== null) {
    const { messages, ...result } = await deps.traceService.readMessagesPage(
      row.projectId,
      row.agentId,
      row.sessionId,
      page,
    );
    return c.json(
      historyResponse(
        { messages: cut(messages), page: messagesPageInfo(result) },
        envelope,
        row.sessionId,
        imageBase,
      ) satisfies MessagesResponse,
    );
  }
  const messages = await deps.traceService.readMessages(row.projectId, row.agentId, row.sessionId);
  return c.json(
    historyResponse(
      { messages: cut(messages) },
      envelope,
      row.sessionId,
      imageBase,
    ) satisfies MessagesResponse,
  );
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
