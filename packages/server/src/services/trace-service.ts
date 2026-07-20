/**
 * Trace service.
 *
 * History messages: all of the Session's index files concatenated in order
 * (readTraceTolerant, tolerating a truncated last line), containing only the
 * complete messages and events that were actually written to Trace (naturally
 * excluding partial_*); in-flight increments are continued by SSE.
 * Performance analysis is derived from a single Trace file: nearest-neighbor
 * pairing of request_begin/end, tool call duration pairing, reconnect / compaction
 * counts, and Token trend.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { agentsDir, readTraceTolerant, tracesDir } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import type {
  AgentTracesResponse,
  RequestSpan,
  ToolCallSpan,
  TraceAnalysisResponse,
  TraceEventsResponse,
  TraceFileInfo,
  TraceModelSegment,
  TraceTaskStats,
  TraceToolSpan,
  UsageTrendPointInTrace,
} from "../api/types.js";
import { HttpError } from "../http/errors.js";

const TRACE_FILE_RE = /^(.+)_(\d{3})\.jsonl$/;

/** Recursion depth cap for sub-session expansion (run_subagent depth is already constrained by the SDK; this is just a defensive backstop against cycles). */
const MAX_SUBAGENT_DEPTH = 4;

interface LocatedFile {
  path: string;
  date: string;
  index: number;
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

async function listDirs(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}

export class TraceService {
  constructor(private readonly root: string) {}

  /** All of this Session's Trace files (sorted by index ascending). */
  private async locateAll(
    projectId: string,
    agentId: string,
    sessionId: string,
  ): Promise<LocatedFile[]> {
    const dir = tracesDir(this.root, projectId, agentId);
    const out: LocatedFile[] = [];
    for (const dateDir of await listDirs(dir)) {
      for (const file of await listFiles(path.join(dir, dateDir))) {
        const match = TRACE_FILE_RE.exec(file);
        if (!match || match[1] !== sessionId) continue;
        out.push({ path: path.join(dir, dateDir, file), date: dateDir, index: Number(match[2]) });
      }
    }
    return out.sort((a, b) => a.index - b.index);
  }

  /** Deletes all of this Session's Trace files (called when the Session is deleted). */
  async deleteSessionTraces(projectId: string, agentId: string, sessionId: string): Promise<void> {
    const files = await this.locateAll(projectId, agentId, sessionId);
    for (const file of files) {
      await fs.rm(file.path, { force: true });
    }
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
  ): Promise<OmniMessage[]> {
    return this.readMessagesExpanded(projectId, agentId, sessionId, {
      index: null,
      ancestry: new Set([sessionId]),
      depth: 0,
    });
  }

  /**
   * A Project-wide session location index (sessionId -> agentId): built by
   * scanning every Agent's traces directory. Built lazily the first time a
   * subagent pointer is encountered, then reused across the whole readMessages
   * call — rescanning per pointer would blow up into tens of thousands of readdir
   * calls under multiple sub-sessions plus recursive expansion.
   */
  private async buildSessionIndex(projectId: string): Promise<Map<string, string>> {
    const index = new Map<string, string>();
    for (const agentId of await listDirs(agentsDir(this.root, projectId))) {
      const dir = tracesDir(this.root, projectId, agentId);
      for (const dateDir of await listDirs(dir)) {
        for (const file of await listFiles(path.join(dir, dateDir))) {
          const match = TRACE_FILE_RE.exec(file);
          if (match && !index.has(match[1]!)) index.set(match[1]!, agentId);
        }
      }
    }
    return index;
  }

  private async readMessagesExpanded(
    projectId: string,
    agentId: string,
    sessionId: string,
    ctx: { index: Map<string, string> | null; ancestry: Set<string>; depth: number },
  ): Promise<OmniMessage[]> {
    const files = await this.locateAll(projectId, agentId, sessionId);
    const out: OmniMessage[] = [];
    for (const file of files) {
      for (const msg of await readTraceTolerant(file.path)) {
        // The depth cap guards against runaway recursion; ancestry guards against a
        // cyclic pointer (a tampered Trace pointing to itself/an ancestor is not expanded).
        const childSid = ctx.depth < MAX_SUBAGENT_DEPTH ? subagentPointer(msg) : null;
        if (!childSid || ctx.ancestry.has(childSid)) {
          out.push(msg);
          continue;
        }
        ctx.index ??= await this.buildSessionIndex(projectId);
        const childAgent = ctx.index.get(childSid);
        let nested: OmniMessage[] = [];
        if (childAgent) {
          ctx.ancestry.add(childSid);
          nested = await this.readMessagesExpanded(projectId, childAgent, childSid, {
            ...ctx,
            depth: ctx.depth + 1,
          });
          ctx.ancestry.delete(childSid);
        }
        // Child Trace missing (deleted): keep the pointer event, since the sub-session's content can't be recovered.
        if (nested.length === 0) {
          out.push(msg);
          continue;
        }
        for (const m of nested) out.push({ ...m, origin: [childSid, ...(m.origin ?? [])] });
      }
    }
    return out;
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
    const openSpansById = new Map<string, TraceToolSpan>();
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
    let sawToolCallThisRequest = false;
    // Compaction interval (compaction_begin..compaction_end): the compaction
    // request's request_begin/request_end and token_usage all fall inside it (see
    // core context-engine's summarize flow), which is used to exclude the
    // compaction request entirely from TPS — matching the same convention as
    // compactionActive in the Chat page's task-stats.
    let compactionActive = false;
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
      const startsUserTurn =
        !hasOrigin &&
        !compactionActive &&
        msg.type === "model_msg" &&
        ((p.type === "text" && p.role === "user") || p.type === "image_url");
      const startsCompactionTurn =
        !hasOrigin && msg.type === "event_msg" && p.type === "compaction_begin";
      if (startsUserTurn || startsCompactionTurn) {
        if (pendingFrom === null) pendingFrom = mi;
        // A user Prompt **always starts a new turn**: judging continuation solely
        // by "did the previous turn call a tool" isn't enough — if the previous
        // turn ended in timeout/malformed (given up after exhausting retries),
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
            if (compactionActive) t.compaction = true; // This turn is a compaction turn
            // This turn's duration starts at the first request_begin. It doesn't
            // use the timestamp of the user Prompt / compaction summary or other
            // user text: `<context_summary>` is created during compaction but only
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
          // timeout/malformed is automatically reconnected by core within the same
          // run (context-engine's retry loop); the resent Request still belongs to
          // **the same user turn**: it must continue the turn, otherwise a single
          // timeout would split that turn's Tokens/duration/TPS across two Tasks.
          const retryable = status === "timeout" || status === "malformed";
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
        } else if (p.type === "compaction_begin") {
          compactionCount++;
          // Compaction forms its own turn: otherwise, if the previous turn called
          // a tool, continuation would still be true and the compaction request
          // would get merged into the previous Task.
          if (!hasOrigin) {
            continuation = false;
            compactionActive = true;
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
      reconnectCount,
      compactionCount,
      usageTrend,
    };
  }

  /** Level-by-level browsing (newest first): Agent -> date -> Session -> Trace files. */
  async agentTraces(projectId: string, agentId: string): Promise<AgentTracesResponse> {
    const dir = tracesDir(this.root, projectId, agentId);
    const dates = (await listDirs(dir)).sort().reverse();
    const out: AgentTracesResponse = { dates: [] };
    for (const date of dates) {
      const bySession = new Map<string, { index: number; sizeBytes: number }[]>();
      for (const file of await listFiles(path.join(dir, date))) {
        const match = TRACE_FILE_RE.exec(file);
        if (!match) continue;
        const sessionId = match[1]!;
        const stat = await fs.stat(path.join(dir, date, file));
        const files = bySession.get(sessionId) ?? [];
        files.push({ index: Number(match[2]), sizeBytes: stat.size });
        bySession.set(sessionId, files);
      }
      if (bySession.size === 0) continue;
      out.dates.push({
        date,
        // session_id embeds a timestamp, so reverse lexicographic order is reverse chronological order.
        sessions: [...bySession.entries()]
          .sort((a, b) => b[0].localeCompare(a[0]))
          .map(([sessionId, files]) => ({
            sessionId,
            files: files.sort((a, b) => a.index - b.index),
          })),
      });
    }
    return out;
  }

  private async readFileByIndex(
    projectId: string,
    agentId: string,
    sessionId: string,
    index: number,
  ): Promise<OmniMessage[]> {
    const files = await this.locateAll(projectId, agentId, sessionId);
    const file = files.find((f) => f.index === index);
    if (!file) {
      throw new HttpError(
        404,
        "trace_not_found",
        `This Session has no Trace file with index ${index}.`,
      );
    }
    return readTraceTolerant(file.path);
  }
}
