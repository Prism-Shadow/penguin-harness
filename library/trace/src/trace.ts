/**
 * The traces mechanisms: what a node may require, declared apart from what implements it.
 */
import type { CompactionMode } from "@prismshadow/amsp";
import type { ElidedBody } from "@prismshadow/penguin-core/interfaces";

import { Interface } from "@prismshadow/penguin-core/kernel";

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

/** Traces: the mechanism TraceService implements. */
@Interface()
export abstract class Traces {
  abstract observeShardRead?: ((path: string) => void) | undefined;
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
