/**
 * Trace service.
 *
 * History messages: all of the Session's index files concatenated in order
 * (readTraceTolerant, tolerating a truncated last line and skipping malformed
 * middle lines), containing only the complete messages and events that were
 * actually written to Trace (naturally excluding partial_*); in-flight
 * increments are continued by SSE.
 * Performance analysis is derived from a single Trace file: nearest-neighbor
 * pairing of request_begin/end, tool call duration pairing, reconnect / compaction
 * counts, and Token trend.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  attachedFileLine,
  attachedImageLine,
  isSessionMeta,
  isSteeredBackgroundNotice,
  matchAttachedFileLine,
  matchAttachedImageLine,
  modelVisiblePath,
  parseBackgroundTaskDoneMessage,
  parseTraceLines,
  parseUserSteeringText,
  readTraceTolerant,
  resumeTrace,
  scratchpadDir,
  tracesDir,
} from "@prismshadow/penguin-core";
import type { CompactionMode, OmniMessage } from "@prismshadow/penguin-core";
import type {
  AgentTraceSessionEntry,
  AgentTracesResponse,
  RequestSpan,
  SessionCategory,
  SessionCategoryCounts,
  SessionContextParts,
  HistoryMessage,
  TracePosition,
  ToolCallSpan,
  TraceAnalysisResponse,
  TraceEventsResponse,
  TraceFileInfo,
  TraceImportResponse,
  TraceModelSegment,
  TraceOtherSpan,
  TraceTaskStats,
  TraceToolSpan,
  UsageTrendPointInTrace,
} from "../api/types.js";
import type { SessionRow, SessionsRepo } from "../db/repos/sessions.js";
import type { TraceFileRow, TraceSessionRow } from "../db/repos/trace-index.js";
import { HttpError } from "../http/errors.js";
import { formatLocalDate } from "../internal/dates.js";
import type { SessionSources } from "../runtime/session-sources.js";
import {
  cloneScanState,
  deserializePrefix,
  encodeCursor,
  finalizeScan,
  initialScanState,
  scanMessages,
  serializePrefix,
} from "./message-window.js";
import type {
  ChildAggregate,
  MessageCursor,
  ScanState,
  WindowPriorStats,
} from "./message-window.js";
import { buildContextBreakdown, emptyContextBreakdown } from "./context-breakdown.js";
import { sessionIdCreatedAt } from "./session-service.js";
import { TraceIndexService, traceFilePath } from "./trace-index.js";
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Config } from "../config.js";

const TRACE_FILE_RE = /^(.+)_(\d{3})\.jsonl$/;

/**
 * session_id an imported Trace file may declare: same alphabet as resource ids plus a length
 * cap. The value becomes part of the target **filename**, so this is a path-traversal defense,
 * checked right next to the path construction — never trust the caller to have validated it.
 */
const IMPORT_SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** Recursion depth cap for sub-session expansion (run_subagent depth is already constrained by the SDK; this is just a defensive backstop against cycles). */
const MAX_SUBAGENT_DEPTH = 4;

function forkSessionId(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `session-${formatLocalDate(date)}-${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}-${randomUUID().replaceAll("-", "").slice(0, 8)}`;
}

function isAssistantText(msg: OmniMessage): boolean {
  const p = msg.payload as { type?: string; role?: string; text?: unknown };
  return (
    msg.type === "model_msg" &&
    p.type === "text" &&
    p.role === "assistant" &&
    typeof p.text === "string" &&
    p.text.trim() !== ""
  );
}

function isTaskStartingUser(msg: OmniMessage): boolean {
  const p = msg.payload as { type?: string; role?: string; text?: unknown };
  if (msg.type !== "model_msg") return false;
  if (p.type === "image_url") return true;
  if (p.type !== "text" || p.role !== "user" || typeof p.text !== "string") return false;
  if (parseUserSteeringText(p.text) !== null) return false;
  // A steered background notice rides inside the running Task exactly like steering; only
  // the unstamped form (an idle-launched notice task's own input) starts a Task.
  if (isSteeredBackgroundNotice(p.text)) return false;
  return !p.text.startsWith("[context_summary]") && !p.text.startsWith("<context_summary>");
}

function rewriteForkText(text: string, sourceScratchpad: string, forkScratchpad: string): string {
  const source = modelVisiblePath(sourceScratchpad).replace(/\/$/, "");
  const target = modelVisiblePath(forkScratchpad).replace(/\/$/, "");
  const rewriteTarget = (value: string): string | null => {
    if (value === source) return target;
    if (value.startsWith(`${source}/`)) return `${target}${value.slice(source.length)}`;
    return null;
  };
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      const image = matchAttachedImageLine(trimmed);
      if (image !== null) {
        const rewritten = rewriteTarget(image);
        return rewritten === null ? line : line.replace(trimmed, attachedImageLine(rewritten));
      }
      const file = matchAttachedFileLine(trimmed);
      if (file !== null) {
        const rewritten = rewriteTarget(file);
        return rewritten === null ? line : line.replace(trimmed, attachedFileLine(rewritten));
      }
      return line;
    })
    .join("\n");
}

function positioned(
  messages: readonly OmniMessage[],
  fileIndex: number,
  fromOrdinal = 0,
): HistoryMessage[] {
  return messages.map((msg, i) => ({
    ...msg,
    tracePosition: { fileIndex, ordinal: fromOrdinal + i },
  }));
}

interface LocatedFile {
  path: string;
  date: string;
  index: number;
  /** Last observed size from the index row (the page-stats cache write guard). */
  sizeBytes: number;
}

/** A windowed history read's request shape (see readMessagesPage). */
export type MessagesPageRequest =
  { kind: "tail"; limit: number } | { kind: "before"; cursor: MessageCursor; limit: number };

/** A windowed history read's result (route maps it onto MessagesResponse.page). */
export interface MessagesPageResult {
  messages: OmniMessage[];
  /** Cursor of the window's first unit; absent = the window reaches the beginning. */
  before?: string;
  /** Cumulative stats before the window (earlierTurns = prior.turns). */
  prior: WindowPriorStats;
}

export interface ForkTraceResult {
  sessionId: string;
  createdAt: string;
}

/**
 * Per-request expansion context: `projectScanned` caps the miss-path force reconcile at
 * one per request; `ancestry` guards cycles; `raw` memoizes each child session's
 * concatenated shard messages so the window expansion and the subagent-token
 * aggregation never read the same child twice within one request.
 */
interface ExpandCtx {
  projectScanned: boolean;
  ancestry: Set<string>;
  depth: number;
  raw: Map<string, OmniMessage[] | null>;
}

/**
 * A **direct sub-session pointer** (the `subagent` event in the parent Trace) ->
 * the sub-session's Session id. The pointer only
 * records the Session id; the sub-session's Agent is located within the Project by
 * its Trace file.
 */
function subagentPointer(msg: OmniMessage): string | null {
  if (msg.type !== "event_msg") return null;
  const p = msg.payload as { type?: string; session_id?: unknown };
  if (p.type !== "subagent" || typeof p.session_id !== "string" || p.session_id === "") {
    return null;
  }
  return p.session_id;
}

/**
 * Read-only slice of the Session index the paginated listing consults (SessionsRepo
 * structurally satisfies it; injected so service tests need no full app): one indexed
 * query answers title / archived / workspace / client for every DB-tracked Session of
 * the Agent.
 */
export interface TraceSessionIndex {
  listByAgent(projectId: string, agentId: string): SessionRow[];
  /** One row by id, from anywhere in the install — the import path's uniqueness check (see importTraceFile). Optional, like the index itself: narrow tests stub only what they read. */
  findById?(sessionId: string): SessionRow | null;
  /** Registers an imported Trace as a Session of the receiving Agent (see importTraceFile); optional for the same reason. */
  insertOrIgnore?(row: SessionRow): void;
}

/** TraceService wiring (the trace-file index is required: every listing/locating path serves from it — no directory walks). */
/** One Session's classification result (see classify): its sidebar category + Workspace path ("" = unknown). */
interface TraceSessionFacts {
  category: SessionCategory;
  workspace: string;
}

@Component()
export class TraceService {
  @Use() private readonly config!: Config;
  private get root(): string {
    return this.config.root;
  }
  @Use() private readonly index!: TraceIndexService;
  /** DB rows supplying titles / archived / workspace / client (narrow tests may omit). */
  @Use() private readonly sessions?: SessionsRepo;
  /** The shared in-process Session-origin registry, single source of truth for `source` (narrow tests may omit). */
  @Use() private readonly sources?: SessionSources;
  /**
   * Test observability: called with the path of every Trace shard this service reads
   * from disk (windowed-read tests assert an old-window request never touches the
   * newest shard and vice versa). Production wiring leaves it unset.
   */
  observeShardRead?: (path: string) => void;

  /**
   * All of this Session's Trace files (sorted by index ascending), served from the
   * index. An empty answer force-reconciles once and retries before being believed:
   * disk is the source of truth, and a gate blind spot (a backdated write, or an
   * in-place append, which moves no directory mtime — see trace-index's header) must
   * cost one extra scan, never a false 404. Note this retry only covers a WHOLE-session
   * miss: a session with some shards indexed and a later one missed is served as-is.
   */
  private async locateAll(
    projectId: string,
    agentId: string,
    sessionId: string,
  ): Promise<LocatedFile[]> {
    await this.index.reconcileAgent(projectId, agentId);
    let rows = this.index.repo.listFilesBySession(projectId, agentId, sessionId);
    if (rows.length === 0) {
      await this.index.reconcileAgent(projectId, agentId, { force: true });
      rows = this.index.repo.listFilesBySession(projectId, agentId, sessionId);
    }
    return rows.map((r) => ({
      path: traceFilePath(this.root, r),
      date: r.date,
      index: r.fileIndex,
      sizeBytes: r.sizeBytes,
    }));
  }

  /** All shard reads funnel through here (deps.observeShardRead is the windowed-read tests' proof of which files were touched). */
  private async readShard(path: string): Promise<OmniMessage[]> {
    this.observeShardRead?.(path);
    return readTraceTolerant(path);
  }

  /** Deletes all of this Session's Trace files (called when the Session is deleted); the index rows go with them. */
  async deleteSessionTraces(projectId: string, agentId: string, sessionId: string): Promise<void> {
    const files = await this.locateAll(projectId, agentId, sessionId);
    for (const file of files) {
      await fs.rm(file.path, { force: true });
    }
    this.index.removeSession(projectId, agentId, sessionId);
  }

  /**
   * History messages: all index files concatenated in order, with sub-sessions
   * **expanded in place**.
   *
   * The parent Trace only records a `subagent` pointer event at the spawn point
   * (recording just the child Session id; the content lives in the child
   * Session's own Trace). Here the pointer is used to locate the child Trace
   * within the Project, read it recursively, and splice the child messages —
   * tagged with an origin chain — back in at the pointer's position, so that when
   * the session is reopened, the frontend can re-attach the sub-session to the
   * run_subagent tool card via origin (the child Trace's first `session_meta`,
   * once given an origin, takes the same shape as what's forwarded over the live
   * stream). When expansion succeeds, the pointer event itself is no longer
   * emitted; when the child Trace is missing (deleted), the pointer event is kept
   * so API consumers can still know it existed.
   */
  async readMessages(
    projectId: string,
    agentId: string,
    sessionId: string,
  ): Promise<HistoryMessage[]> {
    const ctx: ExpandCtx = {
      projectScanned: false,
      ancestry: new Set([sessionId]),
      depth: 0,
      raw: new Map(),
    };
    const files = await this.locateAll(projectId, agentId, sessionId);
    const out: OmniMessage[] = [];
    for (const file of files) {
      const raw = await this.readShard(file.path);
      out.push(...(await this.expandMessages(projectId, positioned(raw, file.index), ctx)));
    }
    return out;
  }

  /**
   * Locates a subagent pointer's owning Agent within the Project: a single index
   * lookup (the old implementation walked EVERY Agent's whole traces tree to build a
   * sessionId → agentId map per readMessages call). On a miss, the whole Project is
   * force-reconciled ONCE per readMessages call and the lookup retried — a child
   * Trace written by an external process is one scan away, never invisible.
   */
  private async resolveChildAgent(
    projectId: string,
    childSid: string,
    ctx: { projectScanned: boolean },
  ): Promise<string | null> {
    const hit = this.index.repo.findAgentBySession(projectId, childSid);
    if (hit !== null || ctx.projectScanned) return hit;
    ctx.projectScanned = true;
    await this.index.reconcileProject(projectId, { force: true });
    return this.index.repo.findAgentBySession(projectId, childSid);
  }

  /** A child session's concatenated raw shard messages, memoized per request; null = no Trace located. */
  private async readChildRaw(
    projectId: string,
    childSid: string,
    ctx: ExpandCtx,
  ): Promise<OmniMessage[] | null> {
    const cached = ctx.raw.get(childSid);
    if (cached !== undefined) return cached;
    const childAgent = await this.resolveChildAgent(projectId, childSid, ctx);
    let raw: OmniMessage[] | null = null;
    if (childAgent) {
      const files = await this.locateAll(projectId, childAgent, childSid);
      if (files.length > 0) {
        raw = [];
        for (const file of files) raw.push(...(await this.readShard(file.path)));
      }
    }
    ctx.raw.set(childSid, raw);
    return raw;
  }

  /**
   * Expand subagent pointers within one message span (the whole transcript on the full
   * path, one window on the paged path — same recursive shape either way).
   */
  private async expandMessages(
    projectId: string,
    messages: readonly OmniMessage[],
    ctx: ExpandCtx,
  ): Promise<OmniMessage[]> {
    const out: OmniMessage[] = [];
    for (const msg of messages) {
      // The depth cap guards against runaway recursion; ancestry guards against a
      // cyclic pointer (a tampered Trace pointing to itself/an ancestor is not expanded).
      const childSid = ctx.depth < MAX_SUBAGENT_DEPTH ? subagentPointer(msg) : null;
      if (!childSid || ctx.ancestry.has(childSid)) {
        out.push(msg);
        continue;
      }
      const raw = await this.readChildRaw(projectId, childSid, ctx);
      let nested: OmniMessage[] = [];
      if (raw !== null) {
        ctx.ancestry.add(childSid);
        nested = await this.expandMessages(projectId, raw, { ...ctx, depth: ctx.depth + 1 });
        ctx.ancestry.delete(childSid);
      }
      // Child Trace missing (deleted): keep the pointer event, since the sub-session's content can't be recovered.
      if (nested.length === 0) {
        out.push(msg);
        continue;
      }
      for (const m of nested) out.push({ ...m, origin: [childSid, ...(m.origin ?? [])] });
    }
    return out;
  }

  /**
   * A subagent pointer's subtree aggregate for the window scanner (message-window.ts):
   * descendant token_usage request totals plus the subtree's max timestamp — the same
   * contributions the expanded messages make to the Web's parent-level stats tracker.
   * The recursion mirrors expandMessages' depth/ancestry rules exactly, so an
   * unexpandable pointer contributes nothing on both paths.
   */
  private async aggregateChild(
    projectId: string,
    childSid: string,
    ctx: ExpandCtx,
  ): Promise<ChildAggregate | null> {
    if (ctx.depth >= MAX_SUBAGENT_DEPTH || ctx.ancestry.has(childSid)) return null;
    const raw = await this.readChildRaw(projectId, childSid, ctx);
    if (raw === null || raw.length === 0) return null;
    let requestTokens = 0;
    let maxTsMs: number | null = null;
    ctx.ancestry.add(childSid);
    for (const msg of raw) {
      const ms = Date.parse(msg.timestamp);
      if (Number.isFinite(ms) && (maxTsMs === null || ms > maxTsMs)) maxTsMs = ms;
      const p = msg.payload as { type?: string; request?: { total?: number } };
      if (msg.type === "event_msg" && p.type === "token_usage") {
        requestTokens += typeof p.request?.total === "number" ? p.request.total : 0;
        continue;
      }
      const grandchild = subagentPointer(msg);
      if (grandchild !== null) {
        const agg = await this.aggregateChild(projectId, grandchild, {
          ...ctx,
          depth: ctx.depth + 1,
        });
        if (agg !== null) {
          requestTokens += agg.requestTokens;
          if (agg.maxTsMs !== null && (maxTsMs === null || agg.maxTsMs > maxTsMs)) {
            maxTsMs = agg.maxTsMs;
          }
        }
      }
    }
    ctx.ancestry.delete(childSid);
    return { requestTokens, maxTsMs };
  }

  /**
   * End-of-shard scan states for files[0..upto] (cumulative from the transcript's
   * beginning), served from the trace_files.page_stats cache. A missing/stale record
   * costs one read of THAT shard — once ever: every shard here is immutable (rotation
   * opens a new shard; the newest shard never appears in a prefix, because windows are
   * suffixes and their first shard is always read anyway). The write-back is guarded on
   * the indexed size, so an externally rewritten shard can only invalidate, never
   * poison, the cache.
   */
  private async prefixStates(
    projectId: string,
    agentId: string,
    sessionId: string,
    files: LocatedFile[],
    upto: number,
    ctx: ExpandCtx,
  ): Promise<ScanState[]> {
    const states: ScanState[] = [];
    for (let j = 0; j <= upto; j++) {
      const file = files[j]!;
      const cached = deserializePrefix(
        this.index.repo.getPageStats(projectId, agentId, sessionId, file.index),
      );
      if (cached !== null) {
        states.push(cached);
        continue;
      }
      const state = cloneScanState(j === 0 ? initialScanState() : states[j - 1]!);
      const messages = await this.readShard(file.path);
      await scanMessages(
        state,
        messages,
        () => {},
        (sid) => this.aggregateChild(projectId, sid, ctx),
      );
      this.index.repo.setPageStats(
        projectId,
        agentId,
        sessionId,
        file.index,
        file.sizeBytes,
        serializePrefix(state),
      );
      states.push(state);
    }
    return states;
  }

  /**
   * Windowed history read (the `tailLimit` / `before` forms of GET /messages). The
   * window is a run of whole units — cut points and unit semantics live in
   * message-window.ts — assembled by reading ONLY the shards the window overlaps
   * (plus, once ever per old shard, the prefix-cache backfill above). Subagent
   * pointers are expanded exactly as the full path expands them, but only within the
   * window: children referenced by older windows load when those windows do.
   */
  async readMessagesPage(
    projectId: string,
    agentId: string,
    sessionId: string,
    req: MessagesPageRequest,
  ): Promise<MessagesPageResult> {
    const files = await this.locateAll(projectId, agentId, sessionId);
    const empty = (): MessagesPageResult => ({
      messages: [],
      prior: initialScanState().totals,
    });
    if (files.length === 0) return empty();
    const ctx: ExpandCtx = {
      projectScanned: false,
      ancestry: new Set([sessionId]),
      depth: 0,
      raw: new Map(),
    };

    // The window's exclusive end: the newest shard's end (tail), or the cursor (before).
    let endPos: number;
    let endOrdinal: number | null = null; // null = to the shard's end
    if (req.kind === "tail") {
      endPos = files.length - 1;
    } else {
      endPos = files.findIndex((f) => f.index === req.cursor.fileIndex);
      // Cursor shard no longer on disk (external deletion — locateAll already
      // force-retried): the history it pointed into is gone; report end-of-history
      // rather than a guess at what used to precede it.
      if (endPos < 0) return empty();
      endOrdinal = req.cursor.ordinal;
    }

    const prefixes = await this.prefixStates(projectId, agentId, sessionId, files, endPos - 1, ctx);

    // Walk backward from the end, scanning whole shards (each from its cached carry-in)
    // until the window has more units than requested or the beginning is reached.
    const shardMessages = new Map<number, OmniMessage[]>();
    let boundaries: Array<{ pos: number; ordinal: number; stats: WindowPriorStats }> = [];
    let startPos = endPos + 1;
    while (boundaries.length <= req.limit && startPos > 0) {
      startPos -= 1;
      const messages = await this.readShard(files[startPos]!.path);
      shardMessages.set(startPos, messages);
      const state = cloneScanState(startPos === 0 ? initialScanState() : prefixes[startPos - 1]!);
      const shardBoundaries: Array<{ pos: number; ordinal: number; stats: WindowPriorStats }> = [];
      const to = startPos === endPos && endOrdinal !== null ? endOrdinal : messages.length;
      await scanMessages(
        state,
        messages,
        (ordinal, stats) => shardBoundaries.push({ pos: startPos, ordinal, stats }),
        (sid) => this.aggregateChild(projectId, sid, ctx),
        0,
        Math.min(to, messages.length),
      );
      boundaries = [...shardBoundaries, ...boundaries];
    }

    // Window start: the last `limit` units, or the very beginning (preamble included)
    // when the whole remaining history fits — then there is no `before` cursor.
    let start: { pos: number; ordinal: number };
    let before: string | undefined;
    let prior: WindowPriorStats;
    if (boundaries.length > req.limit) {
      const wb = boundaries[boundaries.length - req.limit]!;
      start = { pos: wb.pos, ordinal: wb.ordinal };
      before = encodeCursor({ fileIndex: files[wb.pos]!.index, ordinal: wb.ordinal });
      prior = wb.stats;
    } else {
      start = { pos: 0, ordinal: 0 };
      prior = initialScanState().totals;
    }

    const windowRaw: HistoryMessage[] = [];
    for (let pos = start.pos; pos <= endPos; pos++) {
      const messages = shardMessages.get(pos) ?? (await this.readShard(files[pos]!.path));
      const from = pos === start.pos ? start.ordinal : 0;
      const to =
        pos === endPos && endOrdinal !== null
          ? Math.min(endOrdinal, messages.length)
          : messages.length;
      for (let i = from; i < to; i++) {
        windowRaw.push({
          ...messages[i]!,
          tracePosition: { fileIndex: files[pos]!.index, ordinal: i },
        });
      }
    }
    const expanded = await this.expandMessages(projectId, windowRaw, ctx);
    return { messages: expanded, ...(before !== undefined ? { before } : {}), prior };
  }

  /**
   * Clone a source Session through one completed root-assistant reply. The supplied position
   * names the reply record itself; this method validates it against raw Trace structure and
   * chooses the exclusive cut after the request's closing records but before a later Task or
   * compaction. Earlier shards stay intact so the fork renders the same history, while core
   * resumes from the selected shard exactly as it would after a restart.
   */
  async forkSessionTrace(
    projectId: string,
    agentId: string,
    sourceSessionId: string,
    position: TracePosition,
  ): Promise<ForkTraceResult> {
    const invalid = (message: string) => new HttpError(400, "invalid_fork_position", message);
    const files = await this.locateAll(projectId, agentId, sourceSessionId);
    const targetFilePos = files.findIndex((file) => file.index === position.fileIndex);
    if (targetFilePos < 0) throw invalid("The selected reply no longer exists in this Session.");

    const shards: OmniMessage[][] = [];
    for (let i = 0; i <= targetFilePos; i++) shards.push(await this.readShard(files[i]!.path));
    const targetShard = shards[targetFilePos]!;
    const target = targetShard[position.ordinal];
    if (!target || !isAssistantText(target)) {
      throw invalid("The fork position must identify a completed assistant reply.");
    }

    // A compaction's assistant summary is a real model message in Trace but never a visible
    // assistant reply. Reject a forged position inside that hidden span.
    let inCompaction = false;
    for (let filePos = 0; filePos <= targetFilePos; filePos++) {
      const messages = shards[filePos]!;
      const stop = filePos === targetFilePos ? position.ordinal : messages.length;
      for (let i = 0; i < stop; i++) {
        const p = messages[i]!.payload as { type?: string };
        if (messages[i]!.type === "event_msg" && p.type === "compaction_begin") {
          inCompaction = true;
        } else if (messages[i]!.type === "event_msg" && p.type === "compaction_end") {
          inCompaction = false;
        }
      }
    }
    if (inCompaction) throw invalid("A compaction summary cannot be used as a fork point.");

    let cutOrdinal = position.ordinal + 1;
    let completedRequest = false;
    for (let i = position.ordinal + 1; i < targetShard.length; i++) {
      const msg = targetShard[i]!;
      const p = msg.payload as { type?: string; status?: string };
      // The next user Task and housekeeping compaction both belong after the selected reply.
      if (isTaskStartingUser(msg) || (msg.type === "event_msg" && p.type === "compaction_begin")) {
        break;
      }
      // A Task may contain several assistant segments/requests. Only the final visible reply
      // gets a footer-level fork action; an intermediate segment is not a safe boundary.
      if (isAssistantText(msg)) {
        throw invalid("The selected record is not the final assistant reply of its Task.");
      }
      cutOrdinal = i + 1;
      if (msg.type === "event_msg" && p.type === "request_end") {
        if (p.status === "completed") completedRequest = true;
        else throw invalid("The selected assistant reply belongs to an incomplete request.");
      }
    }
    if (!completedRequest) throw invalid("The selected assistant reply has not completed yet.");

    const resumed = resumeTrace(targetShard.slice(0, cutOrdinal));
    if (
      resumed.contextClosed ||
      resumed.carryOver.length > 0 ||
      !resumed.history.some((message) => message === target)
    ) {
      throw invalid("The selected reply is not a complete resumable Task boundary.");
    }

    const firstMeta = shards.flat().find(isSessionMeta);
    if (!firstMeta) throw invalid("The source Trace has no session metadata.");

    const created = new Date();
    const createdAt = created.toISOString();
    const newSessionId = forkSessionId(created);
    const scratchpadRoot = scratchpadDir(this.root, projectId, agentId);
    const sourceScratchpad = path.join(scratchpadRoot, sourceSessionId);
    const forkScratchpad = path.join(scratchpadRoot, newSessionId);
    const written: string[] = [];

    const rewrite = (msg: OmniMessage): OmniMessage => {
      if (isSessionMeta(msg)) {
        const sourcePrompt = msg.payload.system_prompt;
        const sourceVisible = modelVisiblePath(sourceScratchpad);
        const forkVisible = modelVisiblePath(forkScratchpad);
        const payload = {
          ...msg.payload,
          session_id: newSessionId,
          system_prompt: sourcePrompt
            .split(sourceSessionId)
            .join(newSessionId)
            .split(sourceVisible)
            .join(forkVisible),
        };
        delete payload.source;
        return { ...msg, payload };
      }
      const p = msg.payload as { type?: string; role?: string; text?: unknown };
      if (
        msg.type === "model_msg" &&
        p.type === "text" &&
        p.role === "user" &&
        typeof p.text === "string"
      ) {
        return {
          ...msg,
          payload: {
            ...msg.payload,
            text: rewriteForkText(p.text, sourceScratchpad, forkScratchpad),
          },
        } as OmniMessage;
      }
      return msg;
    };

    try {
      // Snapshot the whole Session scratchpad: besides composer attachments it may contain
      // recovery archives or temporary files explicitly referenced by the retained history.
      try {
        const stat = await fs.stat(sourceScratchpad);
        if (stat.isDirectory()) {
          await fs.mkdir(scratchpadRoot, { recursive: true });
          await fs.cp(sourceScratchpad, forkScratchpad, {
            recursive: true,
            force: false,
            errorOnExist: true,
          });
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }

      for (let filePos = 0; filePos <= targetFilePos; filePos++) {
        const sourceFile = files[filePos]!;
        const sourceMessages = shards[filePos]!;
        const limit = filePos === targetFilePos ? cutOrdinal : sourceMessages.length;
        const records = sourceMessages.slice(0, limit).map(rewrite);
        if (!isSessionMeta(records[0]!)) {
          throw invalid(`Trace shard ${sourceFile.index} does not start with session metadata.`);
        }
        const dir = path.join(tracesDir(this.root, projectId, agentId), sourceFile.date);
        await fs.mkdir(dir, { recursive: true });
        const file = path.join(
          dir,
          `${newSessionId}_${String(sourceFile.index).padStart(3, "0")}.jsonl`,
        );
        const body = records.map((record) => JSON.stringify(record)).join("\n") + "\n";
        await fs.writeFile(file, body, { encoding: "utf8", flag: "wx" });
        written.push(file);
        this.index.registerImportedFile({
          projectId,
          agentId,
          sessionId: newSessionId,
          fileIndex: sourceFile.index,
          date: sourceFile.date,
          sizeBytes: Buffer.byteLength(body, "utf8"),
          records,
        });
      }
      return { sessionId: newSessionId, createdAt };
    } catch (err) {
      await Promise.all(written.map((file) => fs.rm(file, { force: true }).catch(() => undefined)));
      await fs.rm(forkScratchpad, { recursive: true, force: true }).catch(() => undefined);
      this.index.removeSession(projectId, agentId, newSessionId);
      throw err;
    }
  }

  /**
   * Composition of the Session's current model context, read from its **newest** Trace shard —
   * one shard is one complete context (see context-breakdown.ts). A Session with no Trace yet
   * answers with zeros rather than a 404: "nothing in the context" is a true statement about it,
   * and the caller is a display that would have to invent the same answer.
   */
  async contextBreakdown(
    projectId: string,
    agentId: string,
    sessionId: string,
  ): Promise<SessionContextParts> {
    const files = await this.locateAll(projectId, agentId, sessionId);
    const newest = files.reduce<LocatedFile | null>(
      (best, f) => (best === null || f.index > best.index ? f : best),
      null,
    );
    if (newest === null) return emptyContextBreakdown();
    return buildContextBreakdown(await this.readShard(newest.path));
  }

  /** List of Trace files (index / date / size / mtime). */
  async listTraceFiles(
    projectId: string,
    agentId: string,
    sessionId: string,
  ): Promise<TraceFileInfo[]> {
    const files = await this.locateAll(projectId, agentId, sessionId);
    const out: TraceFileInfo[] = [];
    for (const file of files) {
      const stat = await fs.stat(file.path);
      out.push({
        index: file.index,
        date: file.date,
        sizeBytes: stat.size,
        mtime: stat.mtime.toISOString(),
      });
    }
    return out;
  }

  /** Reads events from the Trace file at the given index, paginated by line (for loading large files in pages). */
  async readEvents(
    projectId: string,
    agentId: string,
    sessionId: string,
    index: number,
    offset: number,
    limit: number,
  ): Promise<TraceEventsResponse> {
    const messages = await this.readFileByIndex(projectId, agentId, sessionId, index);
    return {
      events: messages.slice(offset, offset + limit),
      offset,
      limit,
      total: messages.length,
    };
  }

  /** Performance analysis: derived from a single Trace file. */
  async analyze(
    projectId: string,
    agentId: string,
    sessionId: string,
    index: number,
  ): Promise<TraceAnalysisResponse> {
    const messages = await this.readFileByIndex(projectId, agentId, sessionId, index);

    const requests: RequestSpan[] = [];
    let openRequest: RequestSpan | null = null;
    const toolCalls: ToolCallSpan[] = [];
    const openToolCalls = new Map<string, ToolCallSpan>();
    let reconnectCount = 0;
    let compactionCount = 0;
    const usageTrend: UsageTrendPointInTrace[] = [];
    // Timeline (serial-duration estimation): Trace records completion times; model
    // messages are produced
    // serially (autoregressive decoding), so each segment's start = the previous
    // event's time (the request's first segment = request_begin); a tool's
    // approval/execution runs in parallel with model decoding, on its own lane;
    // prevSerialTs is cleared after request_end, and the next request_begin
    // restarts the count (which presumes all of the previous round's
    // tool_call_output have already come back).
    const modelSegments: TraceModelSegment[] = [];
    const toolSpans: TraceToolSpan[] = [];
    const otherSpans: TraceOtherSpan[] = [];
    const openSpansById = new Map<string, TraceToolSpan>();
    // Open mcp_connect_begin (first-run MCP connect + discovery), closed by its end event
    // into a synthetic tool span so the timeline shows the wait ahead of the next Task.
    let openMcpConnect: { beginTs: string } | null = null;
    let prevSerialTs: string | null = null;
    // Task grouping: one user turn contains multiple Request rounds (the Agent
    // loop sends another round each time it calls a tool); the turn ends once the
    // model produces only text with no further tool call. Consecutive Requests are
    // merged into one Task on this basis, and each Task gets its own independent
    // timeline — different Tasks can be far apart in time (the user is thinking or
    // has stepped away), and sharing one timeline would leave large gaps.
    // Compaction forms its own turn: both compaction_begin/compaction_end break a
    // continuation, so the compaction request becomes its own Task, and the
    // request that resumes after compaction starts yet another Task.
    let taskIndex = -1;
    let continuation = false; // The previous round's Request called a tool -> the next request_begin continues the same Task
    /** Inside the image run that follows a `[user_steering]` text (see the turn-start rule below). */
    let steeringImages = false;
    let sawToolCallThisRequest = false;
    // Compaction interval (compaction_begin..compaction_end): the compaction
    // request's request_begin/request_end and token_usage all fall inside it (see
    // core context-engine's summarize flow), which is used to exclude the
    // compaction request entirely from TPS — matching the same convention as
    // compactionActive in the Chat page's task-stats.
    let compactionActive = false;
    // The active compaction's mode, read off its `compaction_begin`, so the turn can be
    // reported as the operation it actually was: `discard` drops the old context outright and
    // compacts nothing, so calling it a compaction turn in the UI reads wrong. Null outside a
    // compaction and for a `compaction_begin` carrying no recognizable mode — the DTO field is
    // then simply left absent, which consumers read as the historical `summarize`.
    let compactionMode: CompactionMode | null = null;
    // Token / duration totals per Task (computed server-side over the whole file:
    // frontend events are fetched in pages, so summing them there would be
    // mismatched).
    const taskStats = new Map<number, TraceTaskStats>();
    const ensureTask = (ti: number): TraceTaskStats => {
      let t = taskStats.get(ti);
      if (t === undefined) {
        t = {
          taskIndex: ti,
          messageFrom: -1,
          messageTo: -1,
          startTs: "",
          endTs: "",
          tokens: { cacheRead: 0, cacheWrite: 0, output: 0 },
          llmMs: 0,
        };
        taskStats.set(ti, t);
      }
      return t;
    };

    /**
     * Which turn each message belongs to: **decided definitively in one
     * sequential pass**, not left for the frontend to guess by timestamp.
     *
     * Timestamp boundaries can't be pulled apart — the same millisecond can
     * contain "the previous turn's last reply, compaction_begin, the compaction
     * prompt, and the next turn's request_begin" all at once, so assigning by
     * time would inevitably misfile this turn's reply into the next turn.
     *
     * Rule (a turn = one user turn; `request_end` is the end of some Request
     * within a turn):
     *   - The **starting marker** of a new turn: the main session's user Prompt
     *     (outside compaction), or compaction_begin (compaction forms its own
     *     turn). Messages after the marker and before that turn's first
     *     `request_begin` (subsequent images from a multi-image send, the
     *     compaction prompt) are always held pending, waiting for
     *     `request_begin` to settle the new taskIndex before the whole span is
     *     assigned at once — they belong to the **new** turn, not the tail of
     *     the previous one.
     *   - Other messages belong to the current taskIndex: tool output and
     *     approval decisions arriving after request_end still belong to this
     *     turn (they're the results of tools this turn's Request initiated).
     */
    const msgTask: number[] = new Array<number>(messages.length).fill(-1);
    /** The pending new turn's starting point (message index); settled once request_begin determines the taskIndex. */
    let pendingFrom: number | null = null;

    for (let mi = 0; mi < messages.length; mi++) {
      const msg = messages[mi]!;
      const p = msg.payload as Record<string, unknown> & { type?: string };
      // The timeline only looks at the main session (a Trace itself never contains origin messages; this is a defensive skip).
      const hasOrigin = msg.origin !== undefined && msg.origin.length > 0;

      // Starting marker of a new turn: the main session's user Prompt (outside
      // compaction) -> a new user turn; compaction_begin -> a compaction turn
      // (compaction forms its own turn). A single send can be "text + multiple
      // images" = multiple messages; only the **first** one counts (once
      // pendingFrom is set, it's not changed again), otherwise the turn's start
      // would shift to the last image.
      // Mid-run steering (`[user_steering]`-wrapped user text, delivered between turns of a
      // running Task): never a turn starter — same exclusion idea as the compaction summary —
      // and it forces the next request to be a continuation (a steering-only continuation
      // turn has no preceding tool call, but it is still the same Task).
      const isMainUserText =
        !hasOrigin &&
        msg.type === "model_msg" &&
        p.type === "text" &&
        p.role === "user" &&
        typeof p.text === "string";
      const isSteeringText = isMainUserText && parseUserSteeringText(p.text as string) !== null;
      // A background completion notice injected into the running Task gets the same
      // treatment as steering. Recognized by the delivery stamp (`delivery: steering` on
      // its block), or by POSITION for notices written by a pre-stamp core: a Task never
      // ends while the just-ended request's tool calls still await their continuation
      // (sawToolCallThisRequest — the same fact that forces the continuation below), so a
      // notice landing in that gap is in-task even without the stamp. The Web reducer and
      // the message-window scanner apply the identical fallback — the four turn
      // implementations must agree on legacy data too. An unstamped notice after a
      // no-tool turn keeps its independent turn: there an idle launch is genuinely
      // possible and only the stamp (written by new cores) can tell the two apart.
      const noticeParsed = isMainUserText ? parseBackgroundTaskDoneMessage(p.text as string) : null;
      const isInjectedNotice =
        noticeParsed !== null &&
        (noticeParsed.done.delivery === "steering" || sawToolCallThisRequest);
      // The continuation force only applies to a gap delivery (between two requests of the
      // running Task). A notice drained at run start rides behind a fresh user Prompt —
      // pendingFrom is then already open for the new turn, whose own `continuation = false`
      // must win, or the new turn would merge into the previous one.
      if ((isSteeringText || isInjectedNotice) && pendingFrom === null) continuation = true;
      // Images sent with a steering message ride immediately behind its text, exactly as a
      // Prompt's images ride behind theirs — and they inherit its exclusion: still the same
      // Task, so `steeringImages` keeps the window open across the whole run of them and
      // anything else on the main session closes it (an images-only Prompt after a steering
      // message is a genuine new turn). A subagent's messages pass through without closing it:
      // they belong to another session's stream and say nothing about this one's grouping.
      // The Web answers the same "what is one Task" question over the live stream — see
      // `openSteering` in web/src/lib/omni/stream-model.ts; the two need to stay in step.
      const isImage = !hasOrigin && msg.type === "model_msg" && p.type === "image_url";
      if (!hasOrigin && !isSteeringText && !(isImage && steeringImages)) steeringImages = false;
      if (isSteeringText) steeringImages = true;
      const startsUserTurn =
        !hasOrigin &&
        !compactionActive &&
        !isSteeringText &&
        !isInjectedNotice &&
        !steeringImages &&
        msg.type === "model_msg" &&
        ((p.type === "text" && p.role === "user") || p.type === "image_url");
      const startsCompactionTurn =
        !hasOrigin && msg.type === "event_msg" && p.type === "compaction_begin";
      if (startsUserTurn || startsCompactionTurn) {
        if (pendingFrom === null) pendingFrom = mi;
        // A user Prompt **always starts a new turn**: judging continuation solely
        // by "did the previous turn call a tool" isn't enough — if the previous
        // turn ended in a retryable status (given up after exhausting retries),
        // retryable would leave continuation at true, and this new message would
        // get merged into that failed turn, smearing the two turns' messages /
        // Tokens / TPS / duration together.
        if (startsUserTurn) continuation = false;
      }
      // A main-session message that isn't pending belongs to the current turn immediately (taskIndex < 0 = before the first request_begin, e.g. session_meta).
      if (!hasOrigin && pendingFrom === null) msgTask[mi] = taskIndex;

      if (msg.type === "event_msg") {
        if (p.type === "request_begin") {
          if (!hasOrigin) {
            prevSerialTs = msg.timestamp;
            if (!continuation) taskIndex++; // Not a continuation -> a new Task
            sawToolCallThisRequest = false;
          }
          // Settle taskIndex before opening the span: the span belongs directly to
          // the current Task. Nearest-neighbor pairing: if the previous begin was
          // never closed (process exited mid-run), the span is left open.
          openRequest = { beginTs: msg.timestamp, taskIndex };
          if (compactionActive) openRequest.compaction = true;
          requests.push(openRequest);
          if (!hasOrigin) {
            const t = ensureTask(taskIndex);
            if (compactionActive) {
              t.compaction = true; // This turn is a compaction turn
              // Carried alongside the flag, never instead of it: the flag stays the sole gate
              // on "is this a compaction turn" for clients that predate the mode.
              if (compactionMode !== null) t.compactionMode = compactionMode;
            }
            // This turn's duration starts at the first request_begin. It doesn't
            // use the timestamp of the user Prompt / compaction summary or other
            // user text: `[context_summary]` is created during compaction but only
            // written to disk on the next run, so resuming the next day would
            // stretch the first turn out by a whole day for no reason; the Prompt
            // to request-dispatch gap is only ever milliseconds anyway.
            if (t.startTs === "") t.startTs = msg.timestamp;
            // The new turn's taskIndex is only settled here: the pending span
            // (user Prompt / multiple images / compaction prompt) is assigned in
            // full to **this** turn — they're the start of the new turn, not the
            // tail of the previous one.
            if (pendingFrom !== null) {
              for (let k = pendingFrom; k < mi; k++) {
                if (messages[k]!.origin === undefined) msgTask[k] = taskIndex;
              }
              pendingFrom = null;
            }
            msgTask[mi] = taskIndex;
          }
        } else if (p.type === "approval_decision") {
          if (!hasOrigin && typeof p.tool_call_id === "string") {
            const span = openSpansById.get(p.tool_call_id);
            if (span && span.approvalTs === undefined) {
              span.approvalTs = msg.timestamp;
              if (typeof p.decision === "string") span.decision = p.decision;
              // Approval wait time is subtracted out of the LLM generation
              // duration: core does `await approve(tc)` inside the streaming loop,
              // so the entire manual wait sits between request_begin and
              // request_end (see RequestSpan.approvalWaitMs). Without subtracting
              // it, "5s generation + 55s approval wait" would show 100 tok/s as 8 tok/s.
              if (openRequest) {
                const wait = Date.parse(msg.timestamp) - Date.parse(span.callTs);
                if (Number.isFinite(wait) && wait > 0) {
                  openRequest.approvalWaitMs = (openRequest.approvalWaitMs ?? 0) + wait;
                }
              }
            }
          }
        } else if (p.type === "request_end") {
          const status = typeof p.status === "string" ? p.status : undefined;
          // A status core reconnects on within the same run (context-engine's retry
          // loop) leaves the resent Request in **the same user turn**: it must
          // continue the turn, otherwise a single blip would split that turn's
          // Tokens/duration/TPS across two Tasks and inflate the Task count.
          //
          // This list must track the engine's: `retryable` is the one reconnecting
          // status today (both loops share RETRY_STATUSES). The legacy spellings keep
          // pre-convergence Traces analyzable — in that era timeout/malformed always
          // reconnected, while `failed` reconnected in the turn loop but ended a
          // compaction attempt (the then fail-fast compaction policy), hence the
          // compactionActive guard on it.
          const retryable =
            status === "retryable" ||
            status === "timeout" ||
            status === "malformed" ||
            (status === "failed" && !compactionActive);
          if (!hasOrigin) {
            prevSerialTs = null;
            continuation = sawToolCallThisRequest || retryable;
          }
          if (retryable) reconnectCount++;
          if (openRequest) {
            openRequest.endTs = msg.timestamp;
            const dur = Date.parse(msg.timestamp) - Date.parse(openRequest.beginTs);
            if (Number.isFinite(dur)) {
              openRequest.durationMs = dur;
              openRequest.activeMs = Math.max(0, dur - (openRequest.approvalWaitMs ?? 0));
            }
            if (status !== undefined) openRequest.status = status;
            // TPS denominator: accumulated per the turn a Request belongs to. A
            // compaction request counts too — it belongs to **its own compaction
            // turn** (compaction forms its own turn), so it neither pollutes a
            // user turn's TPS, nor does the compaction turn fail to report its own
            // generation speed accurately. A failed retry's duration is counted as
            // well — it belongs to the same turn as the retry that eventually
            // succeeded, and "how long this turn took to produce these tokens"
            // should include the retries by definition.
            if (!hasOrigin && openRequest.activeMs !== undefined) {
              ensureTask(openRequest.taskIndex).llmMs += openRequest.activeMs;
            }
            openRequest = null;
          }
        } else if (p.type === "mcp_connect_begin") {
          if (!hasOrigin) openMcpConnect = { beginTs: msg.timestamp };
        } else if (p.type === "mcp_connect_end") {
          // The connect pair becomes an "other" span (not a tool span — nothing was
          // called) attached to the FOLLOWING Task (taskIndex + 1: Task 0 at file start;
          // after an in-file resume, the next Task), so the timeline renders the
          // pre-request connect wait inside that Task's group under its own lane.
          if (!hasOrigin && openMcpConnect) {
            const q = p as { status?: string };
            const failed = q.status !== "completed";
            otherSpans.push({
              key: `mcp-connect-${openMcpConnect.beginTs}`,
              name: "mcp connect",
              startTs: openMcpConnect.beginTs,
              endTs: msg.timestamp,
              taskIndex: taskIndex + 1,
              ...(failed ? { failed: true } : {}),
            });
            openMcpConnect = null;
          }
        } else if (p.type === "compaction_begin") {
          compactionCount++;
          // Compaction forms its own turn: otherwise, if the previous turn called
          // a tool, continuation would still be true and the compaction request
          // would get merged into the previous Task.
          if (!hasOrigin) {
            continuation = false;
            compactionActive = true;
            const mode = p.mode;
            compactionMode = mode === "summarize" || mode === "discard" ? mode : null;
          }
        } else if (p.type === "compaction_end") {
          // Both ends of compaction break a continuation. This closing one can't
          // be skipped: if the compaction request itself exhausts its retries and
          // ends in timeout, the retryable check above would mark it as "continued",
          // and without clearing it here, the next user turn after compaction
          // would get merged into this compaction Task.
          if (!hasOrigin) {
            continuation = false;
            compactionActive = false;
            compactionMode = null;
          }
        } else if (p.type === "token_usage") {
          const request = p.request as
            | { total?: number; cache_read?: number; cache_write?: number; output?: number }
            | undefined;
          const session = p.session as { total?: number } | undefined;
          usageTrend.push({
            ts: msg.timestamp,
            requestTotal: request?.total ?? 0,
            sessionTotal: session?.total ?? 0,
          });
          if (!hasOrigin) {
            const t = ensureTask(taskIndex);
            // Cumulative usage for this turn (a running total): those tokens were
            // actually paid for, so the cost can't be dropped. `tokens.output` also
            // doubles as the numerator for output TPS — compaction's output
            // belongs to **its own compaction turn** (compaction forms its own
            // turn), so a user turn's TPS isn't polluted by it, while the
            // compaction turn can still accurately report "how fast the summary
            // was generated".
            t.tokens.cacheRead += request?.cache_read ?? 0;
            t.tokens.cacheWrite += request?.cache_write ?? 0;
            t.tokens.output += request?.output ?? 0;
            if (!compactionActive) {
              // The context snapshot only takes non-compaction Requests: tokens
              // consumed by compaction aren't the post-compaction context
              // footprint. A later write overwrites an earlier one -> this
              // naturally leaves behind the snapshot of the Task's **last**
              // non-compaction Request = the context footprint at the end of this
              // turn. Accumulating would be wrong: each Request's input carries
              // the entire history afresh (see TraceTaskStats).
              t.context = {
                cacheRead: request?.cache_read ?? 0,
                cacheWrite: request?.cache_write ?? 0,
                output: request?.output ?? 0,
              };
            }
          }
        }
        continue;
      }
      if (msg.type !== "model_msg") continue;
      // Model serial segments: assistant-side thinking/text/tool_call (a user input sent instantaneously occupies no segment).
      if (
        !hasOrigin &&
        prevSerialTs !== null &&
        (p.type === "thinking" ||
          p.type === "tool_call" ||
          (p.type === "text" && p.role === "assistant"))
      ) {
        const segment: TraceModelSegment = {
          kind: p.type === "thinking" ? "thinking" : p.type === "tool_call" ? "tool_call" : "text",
          startTs: prevSerialTs,
          endTs: msg.timestamp,
          taskIndex,
        };
        if (p.type === "tool_call" && typeof p.tool_call_id === "string") {
          segment.toolCallId = p.tool_call_id;
          if (typeof p.name === "string") segment.name = p.name;
        }
        modelSegments.push(segment);
        prevSerialTs = msg.timestamp;
      }
      if (p.type === "tool_call" && typeof p.tool_call_id === "string") {
        if (!hasOrigin) sawToolCallThisRequest = true; // This turn called a tool -> the next turn continues the same Task
        const callStop = typeof p.stop_reason === "string" ? p.stop_reason : undefined;
        const span: ToolCallSpan = {
          toolCallId: p.tool_call_id,
          name: typeof p.name === "string" ? p.name : "",
          startTs: msg.timestamp,
        };
        if (callStop !== undefined) span.stopReason = callStop;
        openToolCalls.set(p.tool_call_id, span);
        toolCalls.push(span);
        // The timeline lane only accepts calls that "will actually be executed":
        // an interrupt-compensation tool_call (stop_reason other than completed)
        // never gets an approval/output, and putting it on a lane would render as
        // a phantom "executing" state spanning the whole timeline — so it's
        // skipped outright.
        if (!hasOrigin && (callStop === undefined || callStop === "completed")) {
          const timeline: TraceToolSpan = {
            toolCallId: p.tool_call_id,
            name: typeof p.name === "string" ? p.name : "",
            callTs: msg.timestamp,
            taskIndex,
          };
          openSpansById.set(p.tool_call_id, timeline);
          toolSpans.push(timeline);
        }
      } else if (p.type === "tool_call_output" && typeof p.tool_call_id === "string") {
        const span = openToolCalls.get(p.tool_call_id);
        if (span && span.endTs === undefined) {
          span.endTs = msg.timestamp;
          const dur = Date.parse(msg.timestamp) - Date.parse(span.startTs);
          if (Number.isFinite(dur)) span.durationMs = dur;
          if (typeof p.stop_reason === "string") span.stopReason = p.stop_reason;
        }
        const timeline = openSpansById.get(p.tool_call_id);
        if (timeline && timeline.outputTs === undefined) {
          timeline.outputTs = msg.timestamp;
          if (typeof p.stop_reason === "string") timeline.stopReason = p.stop_reason;
        }
      }
    }

    // A pending span that never got a request_begin (interrupted right after the
    // user sent it / the process exited): it's a turn that never got to run,
    // and forms its own turn — reattaching it to the previous turn would smear
    // two separate user sends together.
    if (pendingFrom !== null) {
      taskIndex++;
      for (let k = pendingFrom; k < messages.length; k++) {
        if (messages[k]!.origin === undefined) msgTask[k] = taskIndex;
      }
      ensureTask(taskIndex);
    }

    // Each turn's message index range and end-of-turn time are always derived from
    // the per-message assignment done above (same source, so they never disagree
    // with each other). Messages before the first request_begin (session_meta)
    // have taskIndex -1 and are assigned to the first turn, otherwise they'd have
    // nowhere to sit on the page. The turn duration's **starting point** isn't
    // decided here — it was already settled at request_begin (duration only looks
    // at LLM requests; timestamps of the user Prompt / compaction summary or other
    // user text don't participate, see TraceTaskStats.startTs).
    const firstTask = [...taskStats.keys()].sort((a, b) => a - b)[0];
    for (let k = 0; k < messages.length; k++) {
      let ti = msgTask[k]!;
      if (ti < 0) {
        if (firstTask === undefined) continue;
        ti = firstTask;
        msgTask[k] = ti;
      }
      const t = ensureTask(ti);
      if (t.messageFrom < 0 || k < t.messageFrom) t.messageFrom = k;
      if (k > t.messageTo) t.messageTo = k;
      // Flag the compaction turn from its own `compaction_begin` rather than only from the
      // compaction request: a `discard` issues no request at all (core emits begin/end
      // back-to-back, see context-engine's discardContext), so keying off request_begin alone
      // left a discarded round as a bare, unlabelled card. Attribution has resolved the owning
      // turn by this pass, and for `summarize` it lands on the same turn the request-side path
      // already flagged. Subagent messages are skipped for the same reason the main loop skips
      // them — a child's compaction is not this turn's.
      const cur = messages[k]!;
      const cp = cur.payload as { type?: string; mode?: unknown };
      const fromSubagent = cur.origin !== undefined && cur.origin.length > 0;
      if (!fromSubagent && cur.type === "event_msg" && cp.type === "compaction_begin") {
        t.compaction = true;
        if (cp.mode === "summarize" || cp.mode === "discard") t.compactionMode = cp.mode;
      }
      // session_meta is only **listed** in the first turn, and doesn't count
      // toward the end-of-turn time: it's metadata written when the session was
      // created, and its timestamp has nothing to do with this turn (it also gets
      // rewritten verbatim at the start of a new file after compaction splits the file).
      if (messages[k]!.type === "session_meta") continue;
      const ts = messages[k]!.timestamp;
      if (t.endTs === "" || ts > t.endTs) t.endTs = ts;
    }

    const tasks = [...taskStats.values()].sort((a, b) => a.taskIndex - b.taskIndex);
    // Total elapsed time = **the sum of each turn's duration**, matching exactly
    // the scope shown per-turn below (**including compaction turns** — their wall
    // clock time genuinely elapsed, each turn's card has its own duration, and the
    // overall total is their sum, so the numbers must add up). It is not "last
    // message timestamp minus first message timestamp": that would be the whole
    // file's wall-clock span, counting in the gaps **between** turns (the user
    // thinking, stepping out for coffee, coming back the next day) — none of which
    // is time the Agent spent working. A degenerate turn with no Request has an
    // empty startTs and counts as 0.
    // Note this uses a different convention from the Session's cumulative elapsed
    // time on the Chat page: that one only accumulates user turns (compaction
    // after a turn ends doesn't count toward the turn).
    const elapsedMs = tasks.reduce((sum, t) => {
      const span = Date.parse(t.endTs) - Date.parse(t.startTs);
      return sum + (Number.isFinite(span) ? Math.max(0, span) : 0);
    }, 0);
    return {
      elapsedMs,
      requests,
      tasks,
      toolCalls,
      modelSegments,
      toolSpans,
      otherSpans,
      reconnectCount,
      compactionCount,
      usageTrend,
    };
  }

  /**
   * Agent-level browsing, served from the trace-file index (one mtime-gated reconcile,
   * then pure DB — no directory walks, no head-reads). Without `paging`: the legacy full
   * drill-down (newest first: Agent -> date -> Session -> Trace files; sizes are the
   * index's last observed values). With `paging`: session-group-centric — Sessions
   * ordered by id descending (ids embed a timestamp, so that is reverse chronological),
   * optionally filtered to one sidebar `category` — every Session is listed whichever
   * client created it — and only the returned slice gets per-file `fs.stat` for
   * fresh sizes (written back to the index).
   */
  async agentTraces(
    projectId: string,
    agentId: string,
    paging?: { offset: number; limit: number } | null,
    opts: { category?: SessionCategory } = {},
  ): Promise<AgentTracesResponse> {
    await this.index.reconcileAgent(projectId, agentId);
    const files = this.index.repo.listFilesByAgent(projectId, agentId);
    if (paging) return this.agentTracesPage(projectId, agentId, files, paging, opts);
    const byDate = new Map<string, Map<string, { index: number; sizeBytes: number }[]>>();
    for (const f of files) {
      const sessions =
        byDate.get(f.date) ?? new Map<string, { index: number; sizeBytes: number }[]>();
      const list = sessions.get(f.sessionId) ?? [];
      list.push({ index: f.fileIndex, sizeBytes: f.sizeBytes });
      sessions.set(f.sessionId, list);
      byDate.set(f.date, sessions);
    }
    return {
      dates: [...byDate.keys()]
        .sort()
        .reverse()
        .map((date) => ({
          date,
          // session_id embeds a timestamp, so reverse lexicographic order is reverse chronological order.
          sessions: [...byDate.get(date)!.entries()]
            .sort((a, b) => b[0].localeCompare(a[0]))
            .map(([sessionId, list]) => ({
              sessionId,
              files: list.sort((a, b) => a.index - b.index),
            })),
        })),
    };
  }

  /**
   * Classification (no IO): `archived` comes exactly from the DB row; the origin comes
   * from the shared sources registry, else from the Session's registration-time facts
   * (trace_sessions — the reconciler head-read its earliest shard once when the file
   * first appeared, so by listing time every indexed Session is classified exactly).
   */
  private classify(
    sessionId: string,
    row: SessionRow | undefined,
    facts: TraceSessionRow | undefined,
  ): TraceSessionFacts {
    const known = this.sources?.get(sessionId);
    // Registry answer (including null = known user-created) wins — it can be fresher
    // (subagent registration happens at spawn, before any reconcile); else the stored facts.
    const source = known !== undefined ? known : (facts?.source ?? undefined);
    const category: SessionCategory =
      (row?.archivedAt ?? null) !== null
        ? "archived"
        : source === "subagent" || source === "schedule"
          ? source
          : "active";
    return { category, workspace: row?.workspace ?? facts?.workspace ?? "" };
  }

  /** The paginated listing behind agentTraces: pure index reads; per-file stat only for the returned slice (sizes written back). */
  private async agentTracesPage(
    projectId: string,
    agentId: string,
    files: TraceFileRow[],
    paging: { offset: number; limit: number },
    opts: { category?: SessionCategory },
  ): Promise<AgentTracesResponse> {
    const bySession = new Map<string, TraceFileRow[]>();
    for (const f of files) {
      const list = bySession.get(f.sessionId) ?? [];
      list.push(f);
      bySession.set(f.sessionId, list);
    }
    // One indexed query per source: the Agent's DB rows (title / archived / workspace /
    // client) and the registration-time facts.
    const rows = new Map(
      (this.sessions?.listByAgent(projectId, agentId) ?? []).map((r) => [r.sessionId, r]),
    );
    const factsBySession = new Map(
      this.index.repo.listSessionsByAgent(projectId, agentId).map((r) => [r.sessionId, r]),
    );
    const ids = [...bySession.keys()].sort((a, b) => b.localeCompare(a));
    // Classify every group once; the same result drives the category filter, the
    // counts AND the returned fields, so a row can never appear in a bucket its own
    // `category` denies. Every Session is listed whichever client created it.
    const counts: SessionCategoryCounts = { active: 0, subagent: 0, schedule: 0, archived: 0 };
    const workspaceCounts: Record<string, SessionCategoryCounts> = {};
    const factsById = new Map<string, TraceSessionFacts>();
    const visible: string[] = [];
    for (const id of ids) {
      const facts = this.classify(id, rows.get(id), factsBySession.get(id));
      factsById.set(id, facts);
      visible.push(id);
      counts[facts.category] += 1;
      const ws = (workspaceCounts[facts.workspace] ??= {
        active: 0,
        subagent: 0,
        schedule: 0,
        archived: 0,
      });
      ws[facts.category] += 1;
    }
    const filtered =
      opts.category === undefined
        ? visible
        : visible.filter((id) => factsById.get(id)!.category === opts.category);
    const page = filtered.slice(paging.offset, paging.offset + paging.limit);
    const sessions: AgentTraceSessionEntry[] = [];
    for (const sessionId of page) {
      const shard = bySession.get(sessionId)!.sort((a, b) => a.fileIndex - b.fileIndex);
      // Fresh sizes for the returned page only (an actively-appended shard grows without
      // moving any directory mtime): bounded metadata stats, written back to the index.
      const withSize = await Promise.all(
        shard.map(async (f) => {
          let sizeBytes = f.sizeBytes;
          try {
            sizeBytes = (await fs.stat(traceFilePath(this.root, f))).size;
            if (sizeBytes !== f.sizeBytes) {
              this.index.repo.updateFileSize(projectId, agentId, sessionId, f.fileIndex, sizeBytes);
            }
          } catch {
            /* Vanished mid-request: serve the last observed size; the next reconcile settles the rows. */
          }
          return { index: f.fileIndex, date: f.date, sizeBytes };
        }),
      );
      const facts = factsById.get(sessionId)!;
      // Title: DB row first (?? sends both "no row" and "row with NULL title" onward);
      // else the registration-time first-prompt fallback stored in trace_sessions.
      const title = rows.get(sessionId)?.title ?? factsBySession.get(sessionId)?.title ?? undefined;
      sessions.push({
        sessionId,
        ...(title !== undefined ? { title } : {}),
        category: facts.category,
        workspace: facts.workspace,
        files: withSize,
      });
    }
    return { dates: [], sessions, totalSessions: filtered.length, counts, workspaceCounts };
  }

  private async readFileByIndex(
    projectId: string,
    agentId: string,
    sessionId: string,
    index: number,
  ): Promise<OmniMessage[]> {
    const file = await this.locateByIndex(projectId, agentId, sessionId, index);
    return readTraceTolerant(file.path);
  }

  private async locateByIndex(
    projectId: string,
    agentId: string,
    sessionId: string,
    index: number,
  ): Promise<LocatedFile> {
    const files = await this.locateAll(projectId, agentId, sessionId);
    const file = files.find((f) => f.index === index);
    if (!file) {
      throw new HttpError(
        404,
        "trace_not_found",
        `This Session has no Trace file with index ${index}.`,
      );
    }
    return file;
  }

  /** Raw bytes of the Trace file at the given index (export/download: the file is served verbatim). */
  async readFileRaw(
    projectId: string,
    agentId: string,
    sessionId: string,
    index: number,
  ): Promise<Buffer> {
    const file = await this.locateByIndex(projectId, agentId, sessionId, index);
    return fs.readFile(file.path);
  }

  /**
   * Imports an uploaded Trace file (raw JSONL content). Validates the content itself —
   * parseable JSONL whose first record is a `session_meta` carrying a filename-safe
   * `session_id` (400 invalid_trace otherwise) — then writes it under the Agent's traces
   * directory as a **new Session**: a session id the Agent already has is rejected with
   * 409 `trace_session_exists` (splicing a further index into an existing Session would
   * corrupt its concatenated transcript, silently become its resume point, and could
   * collide with a live Writer's rotation), so the imported file is always index 1. The
   * date dir comes from the first record's timestamp (falling back to now), formatted as
   * a **local** date — the same convention as core's Trace Writer — so an export →
   * import round-trip lands in the same date dir on non-UTC servers.
   */
  async importTraceFile(
    projectId: string,
    agentId: string,
    content: string,
  ): Promise<TraceImportResponse> {
    const invalid = (message: string) => new HttpError(400, "invalid_trace", message);
    let records: OmniMessage[];
    try {
      // Strict parse: import is the gate for user-supplied files, so a malformed middle
      // line is reported as 400 rather than silently dropped (read paths skip it instead).
      records = parseTraceLines(content, { onMalformed: "throw" });
    } catch {
      throw invalid("The file is not valid Trace JSONL.");
    }
    if (records.length === 0) throw invalid("The file contains no Trace records.");
    const first = records[0]!;
    if (!isSessionMeta(first))
      throw invalid("The first record of a Trace file must be session_meta.");
    // The payload type declares session_id: string, but the value came from user-supplied JSON —
    // re-check the runtime shape before it becomes part of a filename.
    const sessionId: unknown = (first.payload as { session_id?: unknown }).session_id;
    if (typeof sessionId !== "string" || !IMPORT_SESSION_ID_RE.test(sessionId)) {
      throw invalid("session_meta carries a missing or invalid session_id.");
    }
    const duplicate = () =>
      new HttpError(
        409,
        "trace_session_exists",
        `A Session with id ${sessionId} already exists here; a duplicate Trace cannot be imported.`,
      );
    // A Session id is the identity everywhere — the sessions table keys on it, the frontend
    // dedupes rows by it, and /chat/:sessionId routes by it — so the check spans the whole
    // install, not just the receiving Agent. Importing the same Trace under a second Agent
    // used to "succeed" into a Session nothing could own: no row could be inserted beside
    // the existing one, and the list folded the two into a single conversation, leaving a
    // group's count one above the rows it could ever show.
    if ((await this.locateAll(projectId, agentId, sessionId)).length > 0) throw duplicate();
    if (this.sessions?.findById?.(sessionId)) throw duplicate();
    const ts = Date.parse(first.timestamp);
    const date = formatLocalDate(Number.isNaN(ts) ? new Date() : new Date(ts));
    const index = 1;
    const dir = path.join(tracesDir(this.root, projectId, agentId), date);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${sessionId}_${String(index).padStart(3, "0")}.jsonl`);
    const body = content.replace(/\n+$/, "") + "\n";
    try {
      // Normalize to exactly one trailing newline (the JSONL convention the writer
      // follows). `wx` closes the check-then-write race: two concurrent imports of the
      // same new session id both pass the locateAll check, but only one can create the
      // file — the loser's EEXIST maps to the same 409 as the pre-check.
      await fs.writeFile(file, body, { encoding: "utf8", flag: "wx" });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") throw duplicate();
      throw err;
    }
    // Write-time registration: this path knows the file's identity and already holds the
    // parsed records, so the index row + session facts land synchronously (no re-read).
    this.index.registerImportedFile({
      projectId,
      agentId,
      sessionId,
      fileIndex: index,
      date,
      sizeBytes: Buffer.byteLength(body, "utf8"),
      records,
    });
    this.indexImportedSession(projectId, agentId, sessionId);
    return { sessionId, index, date };
  }

  /**
   * Registers an imported Trace as a **Session of the receiving Agent**, from the facts the
   * registration above just head-read (no second parse).
   *
   * Without this the import produced a Trace file and nothing else: the conversation list is
   * served straight from the sessions table, so an imported Trace stayed invisible unless
   * "show CLI sessions" was on — that filter adopts Sessions this server never created, and
   * a file the user deliberately imported is not one of those. Hence `client: "web"`: an
   * imported conversation is a conversation of this install.
   *
   * `approvalMode` is backfilled with the default (a Trace does not record it), and the
   * origin is recorded in the shared registry so the row lands in the right sidebar
   * category. Facts too old or too broken to name a model are skipped rather than inserted
   * half-formed — the Trace file itself is already written and readable either way.
   */
  private indexImportedSession(projectId: string, agentId: string, sessionId: string): void {
    const sessions = this.sessions;
    if (!sessions) return;
    const facts = this.index.repo.getSession(sessionId);
    if (!facts?.metaRead || facts.provider === null || facts.modelId === null) return;
    if (facts.source !== null) this.sources?.set(sessionId, facts.source);
    const createdAt = sessionIdCreatedAt(sessionId) ?? facts.firstTs ?? new Date().toISOString();
    sessions.insertOrIgnore?.({
      sessionId,
      projectId,
      agentId,
      provider: facts.provider,
      modelId: facts.modelId,
      workspace: facts.workspace,
      approvalMode: "allow-all",
      title: facts.title,
      client: "web",
      hasTrace: true,
      createdAt,
      // Nothing has run here yet: the imported conversation reads as last-active when it
      // was created, until it is resumed on this install.
      lastActiveAt: createdAt,
    });
  }
}
