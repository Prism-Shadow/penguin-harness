/**
 * The traces mechanisms: what a node may require, declared apart from what implements it.
 */
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
