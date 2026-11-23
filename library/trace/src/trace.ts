/**
 * The traces mechanisms: what a node may require, declared apart from what implements it.
 */
import type { CompactionMode } from "@prismshadow/amsp";
import type { ElidedBody } from "@prismshadow/penguin-core/interfaces";

import { Interface } from "@prismshadow/penguin-core/kernel";

import type { SessionStatus } from "@prismshadow/penguin-library-session";
import type { ErrorDetails } from "@prismshadow/penguin-library-http/errors";

import type { TraceFileRow, TraceSessionRow } from "./repos/trace-index.js";
import type {
  AbortPayload,
  ApprovalDecisionPayload,
  CompactionBeginPayload,
  CompactionEndPayload,
  ImageUrlPayload,
  InlineDataPayload,
  InlineThinkingPayload,
  McpConnectBeginPayload,
  McpConnectEndPayload,
  AmspRecord,
  AmspPayload,
  PartialTextPayload,
  PartialThinkingPayload,
  PartialToolCallOutputPayload,
  PartialToolCallPayload,
  RequestBeginPayload,
  RequestEndPayload,
  SessionMetaPayload,
  SubagentPayload,
  TextPayload,
  ThinkingPayload,
  TokenUsagePayload,
  ToolCallOutputPayload,
  ToolCallPayload,
  ToolListReadyPayload,
} from "@prismshadow/penguin-core";

/** TraceIndexStore: the mechanism TraceIndexRepo implements. */
/** From packages/server: the trace reading/writing vocabulary — the api DTOs the
 * trace routes return and the service's window/page shapes. The contract names them,
 * so the types live with the contract. */

export type SessionCategory = "active" | "archived";

export interface AgentTracesResponse {
  dates: AgentTraceDateGroup[];
  /** Present only when the request paginates: the requested slice of Session groups, newest first. */
  sessions?: AgentTraceSessionEntry[];
  /** Present only when the request paginates: session-group count of the paged (category-filtered) set. */
  totalSessions?: number;
  /** Present only when the request paginates: per-category totals over all of the Agent's session groups. */
  counts?: SessionCategoryCounts;
  /** Present only when the request paginates: `counts` broken down by Workspace path ("" = unknown). */
  workspaceCounts?: Record<string, SessionCategoryCounts>;
}

export type HistoryMessage = AmspRecord & { tracePosition?: TracePosition; elided?: ElidedBody[] };

/** One Trace file of a Session or a descendant: `${agentId}/${sessionId}/${fileIndex}`. */
export type HistoryFileKey = string;

/**
 * One run of a Trace file the hub holds: bytes [lo, hi), from a line start to just after a
 * `\n`, vouched for by the hashes of its edges. Every run is checked on its own, so a hub that
 * holds several runs (a window, then older pages, then part of the fill) is sent none of them.
 */
export interface HistoryHeldRange {
  lo: number;
  /** Records before `lo` (the ordinal of the first record at or after it). */
  loOrd: number;
  hi: number;
  /** sha256 (base64url) of bytes [lo, min(hi, lo + 4 KiB)). */
  loAnchor: string;
  /** sha256 (base64url) of bytes [max(lo, hi − 4 KiB), hi). */
  hiAnchor: string;
}

/**
 * What the hub holds of one Trace file, sent as `have=` (base64url JSON of the array) so the
 * machine sends only what is missing: the file's identity, every run held (`ranges`), and a
 * line held in part. The single-run form (`lo`…`hiAnchor` beside `k`, no `ranges`) is still
 * read while the hub moves to `ranges`; it names one run, the top one.
 */
export interface HistoryHave extends Partial<HistoryHeldRange> {
  k: HistoryFileKey;
  /** The file's inode as a decimal string: NTFS file ids pass 2^53, which a JSON number cannot carry. */
  ino: string;
  /** The device the file lives on, decimal: a hint, never compared (overlayfs can change it across a restart). */
  dev?: string;
  /** Whole milliseconds, or 0 where the machine keeps no birth time; compared only when both sides know one. */
  birthtimeMs: number;
  /** Every run held, in any order. */
  ranges?: HistoryHeldRange[];
  /**
   * A line held in part: bytes [off, off + len) of the line starting at `off`, whose sha256 is
   * `anchor`. The machine sends the rest of it from `off + len` — before `ready` when it is a light
   * line of the window, after it otherwise; a partial that does not check is dropped and the line
   * sent whole.
   */
  partial?: { off: number; len: number; anchor: string };
}

/**
 * One run of records the window takes from one file, in window order: records [from, to) by
 * ordinal, bytes [from, to) by offset (blank and malformed lines inside the run are skipped as
 * the tolerant reader skips them). `origin` null: the Session's own records, which carry their
 * `tracePosition`; otherwise the child Session chain its records are tagged with, outer to
 * inner, prepended to any `origin` a line carries.
 */
export interface HistorySegment {
  k: HistoryFileKey;
  from: [offset: number, ordinal: number];
  to: [offset: number, ordinal: number];
  origin: string[] | null;
}

/**
 * A window record whose line is heavy, in its final web form — `tracePosition` or `origin` set,
 * images by reference, bodies elided, its `elided` entries attached — so the hub can deliver
 * the window before that line's bytes arrive. `[offset, offset + length)` is its line.
 */
export interface HistoryStub {
  k: HistoryFileKey;
  ordinal: number;
  offset: number;
  length: number;
  record: HistoryMessage;
}

export interface SessionContextParts {
  systemPrompt: number;
  toolDefs: number;
  userMessages: number;
  assistantMessages: number;
  toolRequests: number;
  toolResults: number;
  /** Sum of the six parts. */
  total: number;
  /** Tools ranked by the context their traffic occupies, descending; at most five. */
  topTools: ContextToolShare[];
  /** Files ranked by the context their file-tool traffic occupies, descending; at most five. */
  topFiles: ContextFileShare[];
  /**
   * A completed compaction closed the context these figures describe, and the next one has not
   * been written yet: the composition is of what was compacted away, not of what the model now
   * carries. The same state in which the chat page's context ring shows `—`.
   */
  contextClosed: boolean;
}

export interface TraceAnalysisResponse {
  /**
   * Sum of all turns' durations (**including compaction turns**, same scope as `tasks` — the
   * global figure is just the sum of the per-turn figures below; gaps between turns where the
   * user is thinking or away are not counted). Computed server-side over the entire file: the
   * frontend's events are paginated, so self-aggregation would undercount.
   */
  elapsedMs: number;
  /**
   * The file's model-API time: the sum of the turns' `llmMs` (human approval wait deducted,
   * compaction requests included, so the scope matches `elapsedMs`).
   */
  apiMs: number;
  /**
   * The file's tool wall time: the sum of the turns' `toolMs` (parallel tools counted once
   * within a turn). Summed per turn rather than unioned across the file, so the global figure
   * stays the sum of the per-turn figures, exactly as `elapsedMs` is. May overlap `apiMs` —
   * see `TraceTaskStats.toolMs`.
   */
  toolMs: number;
  /**
   * The file's cost in USD: the sum of the turns' `cost` (compaction turns included, the
   * scope every total here shares). Absent exactly when the turns carry no `cost`.
   */
  cost?: number;
  /**
   * `cost` split by pricing bucket: every Request's Tokens at the rates and tier its share of
   * `cost` was priced at, summed per bucket over the file. Present exactly when `cost` is; the
   * turns carry no split.
   */
  costParts?: CostParts;
  /**
   * The model's context window as the file's head `session_meta` records it
   * (`model_context_window`), for the context ring. The panel no longer reads every event, so the
   * analysis carries it; absent when the head records none (an older server, or a file without
   * one), and the panel then falls back as it always has.
   */
  modelContextWindow?: number | string;
  requests: RequestSpan[];
  /** Token / duration aggregated per Task (used directly by the Trace page's context ring and per-turn TPS). */
  tasks: TraceTaskStats[];
  toolCalls: ToolCallSpan[];
  /** Execution timeline: model serial segments (LLM lane). */
  modelSegments: TraceModelSegment[];
  /** Execution timeline: each tool's approval/execution phases (independent lane, can overlap with model decoding). */
  toolSpans: TraceToolSpan[];
  /** Execution timeline: non-tool auxiliary phases (their own "other" lanes — currently the first run's MCP connect + discovery). */
  otherSpans: TraceOtherSpan[];
  /** Number of request_end events with status ∈ {timeout, malformed}. */
  reconnectCount: number;
  /** Number of compaction_begin events. */
  compactionCount: number;
  usageTrend: UsageTrendPointInTrace[];
}

export interface TraceEventsResponse {
  events: AmspRecord[];
  offset: number;
  limit: number;
  /**
   * Record count of the file (basis for pagination), in the ordinals `tracePosition` and the
   * analysis' `messageFrom` / `messageTo` use: malformed lines are not records.
   */
  total: number;
}

export interface TraceFileInfo {
  /** Trace file index (one file corresponds to one complete model context). */
  index: number;
  /** Date subdirectory it belongs to (yyyy-mm-dd). */
  date: string;
  sizeBytes: number;
  mtime: string;
}

export interface TraceImportResponse {
  /** Session id taken from the imported file's `session_meta`. */
  sessionId: string;
  /** Allocated file index: always 1 — an import creates a new Session (a duplicate session id is rejected with 409 `trace_session_exists`). */
  index: number;
  /** Date directory the file landed in (local yyyy-mm-dd from the first record's timestamp, matching the Trace Writer's convention). */
  date: string;
}

export interface TracePosition {
  /** Trace shard index (`001` on disk becomes `1`). */
  fileIndex: number;
  /** Zero-based record ordinal within the parsed shard. */
  ordinal: number;
}

export interface ForkTraceResult {
  sessionId: string;
  createdAt: string;
  /**
   * The model the fork resumes on: the `session_meta` of the shard the cut falls in. Each shard
   * records its own context's model, so a source that switched models mid-way forks onto the
   * model that was serving the selected reply, not the one the source runs on today.
   */
  provider: string;
  modelId: string;
}

export interface HistoryTraceFile {
  agentId: string;
  sessionId: string;
  fileIndex: number;
  path: string;
  /** Inode and device, decimal: an NTFS file id passes 2^53. */
  ino: string;
  dev: string;
  birthtimeMs: number;
  /** Bytes, as the line index last saw the file. */
  size: number;
  /** One past the last `\n`: whole lines end here; an unterminated tail lies beyond. */
  scanned: number;
  /** Each record's first byte and one past its last, by ordinal (trace-line-index.ts). */
  starts: number[];
  ends: number[];
  /** A rotated shard (its Session has a newer one): it never changes again. */
  final: boolean;
}

export interface ImportedSession {
  sessionId: string;
  files: readonly { date: string; index: number; body: string }[];
}

export interface HistoryWindowRead {
  messages: HistoryMessage[];
  sources: RecordSource[];
  /** The window's page facts; absent for the full transcript. */
  page?: Omit<MessagesPageResult, "messages">;
}

export type MessagesPageRequest = (
  { kind: "tail"; limit: number } | { kind: "before"; cursor: MessageCursor; limit: number }
) & {
  /**
   * The window's byte budget as the `history` stream sends its records — images by reference
   * and bodies elided (core's history-elision.ts) — capped at MESSAGES_PAGE_MAX_BYTES. Absent:
   * MESSAGES_PAGE_MAX_BYTES of records with their bodies whole, as `/messages` serves them.
   */
  budget?: number;
};

export interface MessagesPageResult {
  /** The window's records with their `tracePosition`, images still inline (the route references them). */
  messages: AmspRecord[];
  /** Cursor of the window's first unit; absent = the window reaches the beginning. */
  before?: string;
  /** Cumulative stats before the window (earlierTurns = prior.turns). */
  prior: WindowPriorStats;
  /** The units (Tasks) the window holds: the scanner's boundaries from its start on. */
  units: number;
  /**
   * The model of the context the window starts in: the `session_meta` heading the shard its
   * first unit lies in. One shard is one model context, and a window that starts partway into
   * one does not hold that record. Absent for an empty transcript.
   */
  contextModel?: { provider: string; modelId: string };
  /** Agent State directory from the same context's metadata, for memory-change detection. */
  agentState?: string;
}

export interface MessageCursor {
  fileIndex: number;
  ordinal: number;
}

/**
 * Live in-progress tail of a running Session, carried by `MessagesResponse.live`.
 *
 * Contract (see runtime/live-tail.ts and the GET /messages route): the server captures
 * `cursor` and `fragments` atomically — in one synchronous tick, before starting the
 * trace read — while the Session is running/compacting.
 *   - `cursor`: the Session channel's most recently assigned SSE event id
 *     (`<epoch>-<seq>`); every event published up to and including this id is already
 *     reflected in `fragments`.
 *   - `fragments`: one synthetic `partial_* start` AmspRecord per open streaming
 *     fragment, whose payload carries the full accumulated content so far (text/thinking
 *     prefix, tool-call name + accumulated arguments, tool-output prefix + images), with
 *     the original `origin` chain preserved.
 *
 * Client usage (the bundled Web App's connect-first flow): after applying `messages`,
 * when the cursor's epoch matches the epoch of the SSE events seen on the current
 * connection, drop every buffered **partial** event with seq <= cursor (its content is
 * already inside `fragments`), feed `fragments` through the normal reducer path, then
 * replay the rest of the buffer. Buffered **complete** messages are never dropped by the
 * cursor — the regular overlap dedup decides for them — so nothing is lost even when a
 * complete message's trace append is still in flight at read time.
 *
 * The run form (`live=run` on a full or tail read, for a client that shows a run under way
 * the way it was streamed — the CLI chat): `live` is attached whether or not the Session
 * runs, and adds `status` and `records`, captured in the same tick as `cursor`. `messages`
 * then ends before the current run's first record (a window that begins inside the run, at its
 * input or a later goal round, holds none of it) and holds no held inputs while a run is under
 * way (they are in `records`); a run that began after the cursor, while the read was in
 * flight, is cut at its first record as well. Client usage: subscribe first, read
 * second; render `messages`, then `records`, then the stream's frames — dropping, within
 * the cursor's epoch, every record frame and `task_state` with seq <= cursor (they are in
 * `messages`, `records` and `status`) and handling every other server event. No overlap
 * dedup is needed.
 */
export interface MessagesLiveTail {
  cursor: string;
  fragments: AmspRecord[];
  /** Run form only: the Session's status at the cursor. */
  status?: SessionStatus;
  /**
   * Run form only: the current run's records (one Task with the Tasks a stop hook or a goal
   * loop continues it with, or one compaction outside a Task) in the order they were published, each streamed fragment's deltas folded into its `start`
   * (which carries the content accumulated so far), its `stop` and complete message kept as
   * published — the run's stream, deltas folded. Empty while idle.
   */
  records?: AmspRecord[];
  /** Run form only: how many of the run's oldest records the server no longer holds (its byte cap); absent when none. */
  omitted?: number;
}

/**
 * Pagination envelope of a windowed `GET /messages` (`tailLimit` / `before` requests
 * only; the parameterless full read never carries it). A window is a run of whole
 * message-bearing units — one unit = one Task in the Web reducer's sense, opened by a
 * main-session user prompt — cut so that no pairing (tool_call/output), compaction span
 * or steering group ever splits across windows. Besides the unit count, a window stops
 * before the unit that would take its serialized messages past 4 MiB, but always holds at
 * least one unit; such a window carries `before` like any other, with fewer units than
 * asked for.
 */
export interface MessagesPageInfo {
  /**
   * Cursor of this window's first unit (`<shardIndex>:<ordinal>`): pass it back as
   * `before=` to fetch the previous window. Stable across requests and compaction —
   * rotation opens a NEW shard and closed shards are immutable. Absent = this window
   * reaches the very beginning of the transcript (no older history).
   */
  before?: string;
  /**
   * Outline turns (the Web conversation outline's entry rule) opened BEFORE this
   * window: the client offsets its global "round N" numbering by this, so a partial
   * window never mis-numbers. 0 when the window starts at the beginning.
   */
  earlierTurns: number;
  /**
   * How many units (Tasks) the window holds, as the window was cut: the same boundaries the
   * cut is made at (message-window.ts `scanMessages`), so a client that pages until it has N
   * Tasks on screen counts what `tailLimit` / `limit` count — a prompt with its images, or two
   * sends merged into one, is one. At most the `tailLimit` / `limit` asked for; fewer when the
   * byte budget cut the window short or the history begins inside it.
   */
  units: number;
  /**
   * Cumulative stats accrued before this window, seeded into the client's stats
   * tracker so header chips and per-turn cumulative rows equal a full load:
   * finished-Task elapsed, subagent token totals, and the last main-session
   * session/context token readings.
   */
  prior: {
    subagentTokens: number;
    elapsedMs: number;
    /**
     * Model-API time and tool wall time accrued before this window, the breakdown of
     * `elapsedMs` the chat header shows under it. Seeded together with their total: seeding
     * one alone would put a full elapsed time beside components covering only the window.
     * The two may overlap and do not partition `elapsedMs` (see `TraceTaskStats.toolMs`).
     */
    apiMs: number;
    toolMs: number;
    sessionTokens: number;
    contextTokens: number;
  };
  /**
   * The model of the context this window starts in — what the `session_meta` heading that
   * context's Trace file names, or the model a completed switch's `session_update` ahead of the
   * window's start in that file names (the next file not opened yet). A Session can switch
   * models between contexts, and a window that starts partway into one does not hold that
   * record: the client seeds it, so the Tasks ahead of the window's first `session_meta` have
   * their model, and a switch further down the window is told from a plain rotation. Absent
   * when the Session has no Trace yet.
   */
  contextModel?: { provider: string; modelId: string };
  /**
   * Agent State directory recorded by the starting context's `session_meta`. Seeds memory
   * change detection when that record falls before the window. Absent without a Trace.
   */
  agentState?: string;
}

/** Message history: the full messages and events from concatenating all of this Session's Trace files in order (excludes partial_*). */
export interface MessagesResponse {
  /**
   * On windowed requests, images are served by reference: in every record that carries a
   * `tracePosition`, an inline PNG / JPEG / GIF / WebP `data:` URL — a user `image_url`, or
   * an entry of a tool output's `images` — is replaced by
   * `/api/sessions/<sessionId>/trace-image?file=<fileIndex>&ordinal=<ordinal>[&i=<k>]`
   * (`i` = the index into `images`), an immutable, access-checked image response. Expanded
   * subagent messages, held inputs not yet in the Trace, other image types and the
   * parameterless full read keep their data URLs.
   */
  messages: HistoryMessage[];
  /**
   * Present only while the Session is running/compacting: the in-progress stream tail
   * (open streaming fragments + the channel cursor they cover), so a client joining
   * mid-stream can render the currently streaming message. Omitted when idle. On
   * windowed requests it rides TAIL pages only — a `before` page is immutable history
   * and never carries it.
   */
  live?: MessagesLiveTail;
  /**
   * Present exactly on windowed requests (`tailLimit` / `before`): `messages` is then
   * the requested window (subagent pointers inside it expanded as usual) rather than
   * the full transcript. See MessagesPageInfo.
   */
  page?: MessagesPageInfo;
}

// ---------------------------------------------------------------------------
// History streams (a remote Session's history, newest first, cached on the hub)
// ---------------------------------------------------------------------------
//
// Two legs, both stream calls over the API socket with `x-flow: credit`:
//   - machine leg, `GET /api/sessions/:id/history-lines` (served by every server; the hub
//     calls it over its machine socket): the window's envelope and layout, then the Trace
//     lines the hub does not hold, whole lines only, newest first;
//   - web leg, `GET /api/sessions/:id/history` and `…/trace-body?ref=` (every server): the
//     window as whole-record lines with progress, bulky bodies elided.

/** One Trace file the window or the fill reads, as the machine sees it now. */
export interface HistoryFileFact {
  k: HistoryFileKey;
  /**
   * The file's identity: the inode (decimal, see HistoryHave.ino), the device (a hint, never
   * compared), the birth time (0 where the platform keeps none: it then reads the change time,
   * which every append moves). A held copy is the same file while `sameHistoryFile`
   * (history-wire.ts) says so; its content is checked by its runs' anchors.
   */
  ino: string;
  dev?: string;
  birthtimeMs: number;
  size: number;
  /** Record count by the tolerant reader's rule (blank and unparseable lines are no record). */
  records: number;
  /** A rotated shard: it never changes again, and a whole copy is good for good. */
  final: boolean;
  /** The hub's `have` for this file did not validate: drop the copy, the lines come from scratch. */
  reset?: true;
}

/** The machine leg's first event, `window`. */
export interface HistoryLinesWindow {
  /** The Session's owning Project, for the hub's offline access check. Older machines omit it. */
  projectId?: string;
  /** What `/messages` answers beside the records, captured before any file is read. */
  envelope: {
    page?: MessagesPageInfo;
    live?: MessagesLiveTail;
    pendingInputs: AmspRecord[];
    serverNowMs: number;
    status: SessionStatus;
  };
  /** Every Trace file of the Session and its descendants; a file the hub holds that is absent here is gone. */
  files: HistoryFileFact[];
  layout: HistorySegment[];
  stubs: HistoryStub[];
  /** Bytes (of `text`) and lines this stream will send in each phase. */
  totals: Record<"window" | "heavy" | "fill", { bytes: number; lines: number }>;
}

/** `lines`: whole lines of file `k` from byte `off`; `ord` = records before `off`. */
export interface HistoryLinesFrame {
  k: HistoryFileKey;
  off: number;
  ord: number;
  text: string;
  /** `text` is base64 (bytes that are not valid UTF-8). */
  b64?: true;
}

/** `part`: a piece of one line of file `k`, in order; `ord` = records before that line. */
export interface HistoryPartFrame {
  k: HistoryFileKey;
  /** The first byte of the line this part belongs to. */
  line: number;
  off: number;
  ord: number;
  text: string;
  last: boolean;
  b64?: true;
}

/**
 * `window-part`: a piece of the `window` event's JSON text, for a window larger than one frame
 * (FRAME_TEXT_BUDGET). The pieces come in order before anything else; joined, their texts are
 * the `HistoryLinesWindow` JSON, and the piece with `last` completes it.
 */
export interface HistoryWindowPart {
  text: string;
  last: boolean;
}

/**
 * Event names of the machine leg (`history-lines`), in order: `window` (or its `window-part`s),
 * the window's light `lines`/`part`s (with the rest of one the hub held in part), `ready` (the
 * hub can assemble the window), the rest of every other line the hub held in part, the heavy
 * lines and the fill, `done`. `ping` beats from the start,
 * planning included; `error` (HistoryStreamError) ends a stream that cannot be served, such as a
 * `body` ref into no line of the Session. Every event's data is at most FRAME_TEXT_BUDGET of text
 * plus its JSON envelope.
 */
export type HistoryLinesEvent =
  "window" | "window-part" | "lines" | "part" | "ready" | "done" | "error" | "ping";

/** The web leg's `progress` event: at most every 250 ms, and only when a number changed. */
export interface HistoryProgress {
  phase: "window" | "heavy" | "fill";
  /** The machine the bytes come from; null for this server's own Session. */
  machineId: string | null;
  doneBytes: number;
  totalBytes: number;
  doneLines: number;
  totalLines: number;
  /**
   * The hub waits on the machine: `not_connected` (out of reach, the hub reconnects) and
   * `retrying` (connected and silent, the hub asks again), each with its attempt and the time of
   * the next; or `slow` — connected and beating, but the machine has sent nothing else for a
   * minute (a route stuck over there): nothing is retried, `attempt` and `nextAt` are 0, and the
   * stream goes on. Null again once bytes move.
   */
  waiting: null | {
    reason: "not_connected" | "retrying" | "slow";
    attempt: number;
    nextAt: number;
  };
}

/** The web leg's `page` event: what the window holds beside its records. */
export interface HistoryPage {
  windowId: string;
  /** Records the window carries. */
  count: number;
  /** Bytes of their lines. */
  bytes: number;
  page?: MessagesPageInfo;
  live?: MessagesLiveTail;
  serverNowMs: number | null;
}

/**
 * The web leg's `records` event (whole lines, each one `HistoryMessage` JSON, `offset` counting
 * the window's text so far) and `part` event (a piece of one record longer than a frame, with
 * `last` ending it).
 */
export interface HistoryRecords {
  windowId: string;
  offset: number;
  text: string;
  last?: boolean;
}

/** The web leg's `error` event: terminal; the reader stops and shows it. */
export interface HistoryStreamError {
  code: string;
  message: string;
  details?: ErrorDetails;
}

/** Event names of the web leg (`history`, `trace-body`); `ping` is the beat. */
export type HistoryStreamEvent =
  "progress" | "page" | "records" | "part" | "done" | "filled" | "error" | "ping";

/** From packages/server (api/types.ts): the trace DTOs' own vocabulary (spans, cost parts,
 * category counts, window stats). */

export interface CostParts {
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

export interface RequestSpan {
  beginTs: string;
  endTs?: string;
  durationMs?: number;
  status?: string;
  /** The Task it belongs to (same convention as modelSegments/toolSpans). */
  taskIndex: number;
  /** Compaction request (falls between compaction_begin and compaction_end): excluded from TPS, see TraceTaskStats. */
  compaction?: boolean;
  /**
   * Total human approval wait time within this Request. core does `await approve(tc)` inside
   * the streaming loop — if approval doesn't return, the next chunk isn't consumed and
   * `request_end` can't be emitted either, so the entire human wait falls inside the span
   * (see context-engine's runTurn). Tool **execution** is not included (`void executeOne`,
   * doesn't block the loop).
   */
  approvalWaitMs?: number;
  /** LLM generation duration = durationMs − approvalWaitMs (≥ 0): only this can be used as the TPS denominator, not durationMs. */
  activeMs?: number;
  /**
   * The thinking level this request went out at, as its `request_begin` records it. Absent
   * when no level was sent, and on Traces written before the field — unknown, not a level.
   */
  thinkingLevel?: string;
}

export interface TraceTaskStats {
  taskIndex: number;
  /**
   * This turn is a **compaction turn** (compaction forms its own turn); the UI marks it with
   * a badge accordingly. It's treated the same as a user turn: it has Token /
   * cost / duration / TPS, and **counts normally toward global stats** — the global totals are
   * just the sum of the per-turn cards below, the two scopes match, so adding up the per-turn
   * numbers must equal the total.
   */
  compaction?: boolean;
  /**
   * Which kind of compaction turn it is, from the turn's `compaction_begin`. Additive beside
   * the flag rather than folded into it: `compaction` stays the sole gate on "is this a
   * compaction turn", so a client that only knows the boolean keeps working unchanged, and one
   * that reads this can name the turn for what it did — the two modes are different operations,
   * and only `summarize` actually compacts anything (`discard` drops the old context outright).
   * Absent on a turn analyzed before this field existed, or whose `compaction_begin` carried no
   * mode; treat an absent value as `summarize`, which is what the badge said before the split.
   */
  compactionMode?: CompactionMode;
  /**
   * A short label for the round navigator: the first non-empty line of the user text that
   * started this turn, with harness marker blocks and attachment lines removed, whitespace
   * collapsed, at most 120 characters (the view truncates it further to fit). Absent when no
   * user text started the turn — a summarize compaction turn, an image-only send — or none of
   * its lines is left (only attachment lines).
   */
  prompt?: string;
  /**
   * This turn's message index range within the **entire file** (inclusive). A single
   * sequential scan on the server tells which turn each message belongs to; the frontend
   * attributes messages by this, **no longer guessing by timestamp** — the same millisecond
   * can pack "previous turn's last reply + compaction start + compaction prompt + next turn's
   * request_begin", which time boundaries can't separate, misattributing this turn's reply to
   * the next turn.
   */
  messageFrom: number;
  messageTo: number;
  /**
   * This turn's duration span: `startTs` = the moment of this turn's **first `request_begin`**
   * — duration only looks at LLM requests, not the timestamp of user text like the user
   * Prompt / compaction summary (`[context_summary]` is created during compaction but only
   * persisted on the next run; resuming the next day would inflate the first turn by a whole
   * day for no reason); `endTs` = the moment of the last non-session_meta message in the
   * range. For a degenerate turn with no Request at all (interrupted right after sending),
   * `startTs` is an empty string and duration counts as 0.
   */
  startTs: string;
  endTs: string;
  /**
   * Context usage at the end of this Task = the three-bucket Token snapshot of the last
   * **non-compaction** Request (same convention as the Chat page's `contextNow`). Note this
   * must not be the sum of this Task's Requests — each Request's input carries the full
   * history again, so summing double-counts the context, and a few rounds of tool calls
   * would blow past the context window. A pure-compaction Task (no non-compaction Request)
   * has no value here.
   */
  context?: { cacheRead: number; cacheWrite: number; output: number };
  /**
   * This turn's **cumulative** usage (the sum of the three buckets over every Request in this
   * Task), for Token stats and cost conversion. Two different figures from `context`: that one
   * is a snapshot (how much is occupied right now), this one is a ledger (how much this turn
   * spent in total). Includes compaction requests — compaction tokens are real money spent and
   * must be counted; consistent with the Chat page's tokensByBucket.
   */
  tokens: { cacheRead: number; cacheWrite: number; output: number };
  /**
   * This turn's cost in USD: each Request's three buckets at the Project's current rates for
   * the file's model, at the tier that Request's own timestamp fell in — the rule and the
   * price lookup the cost center applies to the usage row the same `token_usage` produced,
   * so this figure, the toolbar's and the cost center's agree on what a request cost. Present
   * on every turn of a priced file (a turn with no Request reads 0); absent when the model has
   * no pricing or the file's head names no provider, and then absent from the response's
   * total as well.
   */
  cost?: number;
  /**
   * Total LLM generation duration for this turn (the denominator for output TPS; human
   * approval wait already deducted). The numerator is simply `tokens.output`: since
   * compaction forms its own turn, each turn's output tokens are just its own Requests'
   * output — there's no second figure to reconcile.
   */
  llmMs: number;
  /**
   * Wall-clock time this turn spent executing tools: the **union** of its tool spans'
   * execution intervals (`approvalTs ?? callTs` to `outputTs`), so tools running in parallel
   * are counted once instead of summed. Two exclusions, both deliberate: the human approval
   * wait (`callTs` to `approvalTs`) is not tool work, and the argument-generation segment is
   * the model streaming arguments, already counted in `llmMs`. A span with no `outputTs` —
   * still running when the file ended, or interrupted — contributes nothing rather than being
   * extrapolated to now.
   *
   * This and `llmMs` may **overlap**: a tool started in the background keeps running while the
   * model decodes. They are two measured components of the turn's duration, not a partition of
   * it, and they need not add up to the turn's span (approval waits and harness overhead belong
   * to neither). Never derive one by subtracting the other from the duration.
   */
  toolMs: number;
}

export interface ToolCallSpan {
  toolCallId: string;
  name: string;
  startTs: string;
  endTs?: string;
  durationMs?: number;
  /** The paired tool_call_output's `status` (completed / aborted / fatal); absent while the call has no output. */
  status?: string;
}

export interface TraceModelSegment {
  kind: "thinking" | "text" | "tool_call";
  startTs: string;
  endTs: string;
  /** Given when kind=tool_call. */
  toolCallId?: string;
  name?: string;
  /** The Task it belongs to (a single user turn can contain multiple Requests): the frontend groups by this, each Task on its own independent timeline. */
  taskIndex: number;
}

export interface TraceToolSpan {
  toolCallId: string;
  name: string;
  callTs: string;
  approvalTs?: string;
  decision?: string;
  outputTs?: string;
  /** The tool_call_output's `status` (completed / aborted / fatal); absent while unclosed. */
  status?: string;
  /** The Task that initiated this tool (grouped with its tool_call segment): async output belongs to this Task even if it arrives after request_end. */
  taskIndex: number;
}

export interface TraceOtherSpan {
  /** Unique bar key (e.g. `mcp-connect-<beginTs>`). */
  key: string;
  /** Lane label, e.g. "mcp connect". */
  name: string;
  startTs: string;
  endTs: string;
  /** Attached to the Task that follows the phase (same grouping convention as toolSpans). */
  taskIndex: number;
  /** True when the phase ended with failures (some servers unreachable) or was aborted. */
  failed?: boolean;
}

export interface UsageTrendPointInTrace {
  ts: string;
  requestTotal: number;
  sessionTotal: number;
}

export interface AgentTraceDateGroup {
  date: string;
  sessions: AgentTraceSessionGroup[];
}

export interface AgentTraceSessionEntry {
  sessionId: string;
  /**
   * Display title, resolved only for the returned page: the sessions DB title when one
   * exists, else derived from the Session's first user prompt (bounded head-read of the
   * earliest shard); absent when neither yields one (the client falls back to its
   * default title — raw session ids are never rendered).
   */
  title?: string;
  /**
   * Sidebar category of this Session, from the same bounded classification the listing
   * filters and counts with: archived exactly from the DB row; origin from the shared
   * in-process registry / previously observed session_meta; a DB-untracked Session this
   * process has not yet head-read falls into `active` until a page surfaces it (its
   * head-read then registers the true origin for subsequent requests).
   */
  category: SessionCategory;
  /** Workspace path locked at creation (DB row or observed session_meta); "" when unknown — the client's merged temp-group fallback. */
  workspace: string;
  /** Sorted by index ascending (a higher index is newer). */
  files: AgentTraceSessionFile[];
}

export type SessionCategoryCounts = Record<SessionCategory, number>;

export interface ContextToolShare {
  name: string;
  tokens: number;
}

export interface ContextFileShare {
  /**
   * Workspace-relative when the file is inside the Session's Workspace; otherwise absolute, with
   * the home directory shortened to `~`. Spellings that resolve to the same file are one row.
   */
  path: string;
  tokens: number;
  /** How many calls of each file tool named the file in this context. */
  ops: { read: number; edit: number; write: number };
}

/** Where one returned record was read from. */
export interface RecordSource {
  agentId: string;
  sessionId: string;
  fileIndex: number;
  ordinal: number;
  /**
   * The origin chain the history expansion prepended to the line's own `origin`, outer to
   * inner; null for the Session's own records, which carry a `tracePosition` instead.
   */
  chain: string[] | null;
}

/** Cumulative totals at a point in the trace (all values are "before this point"). */
export interface WindowPriorStats {
  /** Outline entries opened before this point (the Web outline's global numbering offset). */
  turns: number;
  /** Sum of subagent token_usage request totals (all descendant sessions) before this point. */
  subagentTokens: number;
  /** Sum of finished Tasks' elapsed time before this point (the Web's sessionElapsedMs basis). */
  elapsedMs: number;
  /**
   * Sum of finished Tasks' model-API time before this point (the Web's sessionLlmMs basis):
   * paired request spans with the human approval wait deducted, compaction requests excluded —
   * the same scope `elapsedMs` uses, so the component and its total cover the same turns.
   */
  apiMs: number;
  /**
   * Sum of finished Tasks' tool wall time before this point (the Web's sessionToolMs basis):
   * per Task the union of its tool execution intervals, so parallel tools count once. Overlaps
   * `apiMs` when a tool runs on while the model decodes; the two never partition `elapsedMs`.
   */
  toolMs: number;
  /** The last main-session token_usage `session.total` seen before this point (0 = none). */
  sessionTokens: number;
  /** The last main-session NON-compaction token_usage `request.total` before this point (context occupancy basis). */
  contextTokens: number;
}

export interface AgentTraceSessionGroup {
  sessionId: string;
  files: AgentTraceFileRef[];
}

export interface AgentTraceSessionFile {
  index: number;
  date: string;
  sizeBytes: number;
}

export interface AgentTraceFileRef {
  index: number;
  sizeBytes: number;
}

@Interface()
export abstract class TraceIndexStore {
  abstract upsertFile(row: TraceFileRow): void;
  abstract updateFileSize(
    projectId: string,
    agentId: string,
    sessionId: string,
    fileIndex: number,
    sizeBytes: number,
  ): void;
  abstract getPageStats(
    projectId: string,
    agentId: string,
    sessionId: string,
    fileIndex: number,
  ): string | null;
  abstract setPageStats(
    projectId: string,
    agentId: string,
    sessionId: string,
    fileIndex: number,
    sizeBytes: number,
    pageStats: string,
  ): void;
  abstract deleteFile(
    projectId: string,
    agentId: string,
    sessionId: string,
    fileIndex: number,
  ): void;
  abstract listFilesByAgent(projectId: string, agentId: string): TraceFileRow[];
  abstract listFilesBySession(
    projectId: string,
    agentId: string,
    sessionId: string,
  ): TraceFileRow[];
  abstract findAgentBySession(projectId: string, sessionId: string): string | null;
  abstract upsertSession(row: TraceSessionRow): void;
  abstract getSession(sessionId: string): TraceSessionRow | null;
  abstract listSessionsByAgent(projectId: string, agentId: string): TraceSessionRow[];
  abstract deleteBySession(sessionId: string): void;
  abstract deleteByAgent(projectId: string, agentId: string): void;
  abstract deleteByProject(projectId: string): void;
}

/** TraceIndex: the mechanism TraceIndexService implements. */
@Interface()
export abstract class TraceIndex {
  abstract readonly counters: { gateStats: number; dirScans: number; headReads: number };
  abstract reconcileAgent(
    projectId: string,
    agentId: string,
    opts?: { force?: boolean },
  ): Promise<void>;
  abstract reconcileProject(projectId: string, opts?: { force?: boolean }): Promise<void>;
  abstract registerImportedFile(args: {
    projectId: string;
    agentId: string;
    sessionId: string;
    fileIndex: number;
    date: string;
    sizeBytes: number;
    records: AmspRecord[];
  }): void;
  abstract removeSession(projectId: string, agentId: string, sessionId: string): void;
  abstract removeAgent(projectId: string, agentId: string): void;
  abstract removeProject(projectId: string): void;
}

export interface OwnedSubagent {
  sessionId: string;
  agentId: string | null;
  spawnedAt: string;
  position: string;
  turnKey: string;
  alias: string | null;
  title: string | null;
}

/** Traces: the mechanism TraceService implements. */
@Interface()
export abstract class Traces {
  abstract observeShardRead?: ((path: string) => void) | undefined;
  abstract ownedSubagents(parent: {
    projectId: string;
    agentId: string;
    sessionId: string;
    createdAt: string;
  }): Promise<OwnedSubagent[]>;
  abstract subagentChildren(
    projectId: string,
    agentId: string,
    sessionId: string,
  ): Promise<Array<{ sessionId: string; agentId: string | null; spawnedAt: string }>>;
  abstract deleteSessionTraces(
    projectId: string,
    agentId: string,
    sessionId: string,
  ): Promise<void>;
  abstract readMessages(
    projectId: string,
    agentId: string,
    sessionId: string,
  ): Promise<HistoryMessage[]>;
  abstract readMessagesPage(
    projectId: string,
    agentId: string,
    sessionId: string,
    req: MessagesPageRequest,
  ): Promise<MessagesPageResult>;
  abstract readHistoryWindow(
    projectId: string,
    agentId: string,
    sessionId: string,
    req: MessagesPageRequest | { kind: "full" },
  ): Promise<HistoryWindowRead>;
  abstract historyTraceFiles(
    projectId: string,
    agentId: string,
    sessionId: string,
  ): Promise<HistoryTraceFile[]>;
  abstract forkSessionTrace(
    projectId: string,
    agentId: string,
    sourceSessionId: string,
    position: TracePosition,
  ): Promise<ForkTraceResult>;
  abstract contextBreakdown(
    projectId: string,
    agentId: string,
    sessionId: string,
  ): Promise<SessionContextParts>;
  abstract listTraceFiles(
    projectId: string,
    agentId: string,
    sessionId: string,
  ): Promise<TraceFileInfo[]>;
  abstract readEvents(
    projectId: string,
    agentId: string,
    sessionId: string,
    index: number,
    offset: number,
    limit: number,
  ): Promise<TraceEventsResponse>;
  abstract readTraceImage(
    projectId: string,
    agentId: string,
    sessionId: string,
    fileIndex: number,
    ordinal: number,
    slot: number | undefined,
  ): Promise<{ mime: string; bytes: Buffer }>;
  abstract analyze(
    projectId: string,
    agentId: string,
    sessionId: string,
    index: number,
  ): Promise<TraceAnalysisResponse>;
  /**
   * The same analysis of one Trace file's records read elsewhere — a machine's file from the
   * hub's copy (machines/history-routes.ts) — priced with `projectId`'s rates.
   */
  abstract analyzeRecords(
    projectId: string,
    messages: readonly AmspRecord[],
  ): Promise<TraceAnalysisResponse>;
  abstract agentTraces(
    projectId: string,
    agentId: string,
    paging: { offset: number; limit: number } | null,
    opts?: { category?: SessionCategory },
  ): Promise<AgentTracesResponse>;
  abstract readFileRaw(
    projectId: string,
    agentId: string,
    sessionId: string,
    index: number,
  ): Promise<Buffer<ArrayBufferLike>>;
  abstract importTraceFile(
    projectId: string,
    agentId: string,
    content: string,
  ): Promise<TraceImportResponse>;
  abstract importSessions(
    projectId: string,
    agentId: string,
    sessions: readonly ImportedSession[],
  ): Promise<{ imported: number; skipped: string[] }>;
}
