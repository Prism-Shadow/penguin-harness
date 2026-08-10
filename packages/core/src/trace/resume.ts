/**
 * Trace replay — the core of Session resume.
 *
 * Replay produces two results: the **history** injected via setHistory (committed turns only),
 * and the **carry-over** input resent with the first `run` after resume. Resume is **best-effort**:
 * Trace only records real messages, so synthesized carry-over (`[turn_aborted]` flattening, pairing
 * placeholders) is never written to Trace — replay reconstructs from the original messages
 * (unanswered input is resent as-is, pairing placeholders are resynthesized as needed). History is
 * guaranteed to be **structurally valid** (turns complete, tool_call pairs matched), not a
 * byte-for-byte match of what AgentHub actually received; incomplete model output (thinking/text)
 * is allowed to be lost.
 *
 * Messages are attributed to a Request by **position**, not by content inspection:
 *   - Input = user-side messages accumulated after the previous `request` `stop` (the first
 *     Request is `session_meta`) and before this `start` (messages are written to Trace before
 *     being sent with the request); user-side messages that land between `start` and `stop`
 *     (output from parallel tools completing during the request) count toward the **next** turn's
 *     input.
 *   - Output = assistant messages between this `start` and `stop`.
 *
 * Determination order: first check file-level compaction closure; then evaluate turn by turn
 * (completed turns go to history, others are dropped wholesale while keeping outputs paired with
 * already-committed tool_calls); finally, the remaining input is the carry-over, with pairing
 * backfill applied.
 * Docs: /docs/sessions-and-traces § "Session recovery".
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  emptyTokenCounts,
  isCompleteModelMessage,
  isEventMessage,
  isSessionMeta,
  toolCallOutput,
  userText,
} from "../omnimessage/index.js";
import type {
  CompactionEndPayload,
  CompleteModelMessage,
  OmniMessage,
  RequestBeginPayload,
  RequestEndPayload,
  SessionMetaMessage,
  TokenCounts,
  TokenUsagePayload,
  ToolCallPayload,
} from "../omnimessage/index.js";
import { buildContextSummaryText, extractSummary } from "../omnimessage/markers/index.js";

/** Replay result: all the state needed to resume a Session. */
export interface ResumeResult {
  /** Committed history (complete model_msg, in order), injected in one shot via setHistory; empty on compaction closure. */
  history: CompleteModelMessage[];
  /**
   * Pending input (carry-over): resent alongside new input with the first `run` after resume.
   * Already includes pairing-backfill placeholders — placeholders exist only in memory
   * (synthesized carry-over is never written to Trace) and are resynthesized on each resume.
   */
  carryOver: OmniMessage[];
  /** Compaction closure (file-level): this file's context is fully closed; resume starts a new, empty context. */
  contextClosed: boolean;
  /** Compaction closure in summarize mode: the reconstructed `[context_summary]` summary, prepended to the next run's input. */
  pendingSummary?: OmniMessage;
  /** Session-level cumulative Token carry-over (the session value from the last token_usage). */
  sessionTokens: TokenCounts;
  /** The request.total from the last token_usage (context usage figure). */
  lastRequestTotal: number;
  /** Session cumulative turn count carry-over (count of completed requests). */
  sessionTurns: number;
  /** Rendering view: this context's complete model_msg plus key event_msg entries (including interrupted turns and their markers); empty on compaction closure. */
  renderMessages: OmniMessage[];
  /** The file's first session_meta; null if missing (unresumable — the caller reports the error). */
  meta: SessionMetaMessage | null;
}

/** Content of the pairing-backfill placeholder output (the tool hadn't finished and no output was persisted before the process exited). */
const PROCESS_EXIT_PLACEHOLDER = "[interrupted: process exited before the tool finished]";

/** Options for `parseTraceLines`. */
export interface ParseTraceLinesOptions {
  /**
   * Handling of a malformed line **in the middle** of the content (the trailing truncated
   * line is always tolerated and ignored, see `parseTraceLines`):
   *   - "skip" (default): drop that line and keep every parseable record. Reading a Trace back
   *     is best-effort — the corruption already happened, and throwing away the whole file
   *     helps no one. Replay is built to stay structurally valid with records missing (crash
   *     tolerance, pairing backfill), so surviving records still resume.
   *   - "throw": rethrow the JSON parse error. For validating untrusted input where damage
   *     should be reported instead of silently repaired (server-side Trace import).
   */
  onMalformed?: "skip" | "throw";
  /** Called for each skipped malformed middle line (1-based line number). Not called for the tolerated trailing truncated line. */
  onSkip?: (lineNumber: number, error: unknown) => void;
}

/**
 * Parse Trace JSONL content. Tolerates a **truncated last line** left behind by an abnormal
 * process exit (that line is silently ignored). A malformed line in the **middle** — e.g. a
 * record torn by the pre-fix concurrent-append interleaving (#215) — is skipped by default
 * (reported via `onSkip`), keeping every parseable record; pass `onMalformed: "throw"` to
 * make middle corruption a hard error instead.
 */
export function parseTraceLines(content: string, options?: ParseTraceLinesOptions): OmniMessage[] {
  const onMalformed = options?.onMalformed ?? "skip";
  const lines = content.split("\n");
  // Index of the last non-empty line, found with one backward scan up front. The malformed
  // branch below runs once per skipped line in skip mode, so rescanning the remainder there
  // (slice + every) would make widely damaged content O(n^2) — seconds of synchronous CPU on
  // the server history path for a large non-JSONL file.
  let lastNonEmptyIndex = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.trim().length > 0) {
      lastNonEmptyIndex = i;
      break;
    }
  }
  const out: OmniMessage[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as OmniMessage);
    } catch (err) {
      if (i === lastNonEmptyIndex) break; // truncated tail: expected crash artifact, ignore silently
      if (onMalformed === "throw") throw err;
      options?.onSkip?.(i + 1, err);
    }
  }
  return out;
}

/** Maximum count of skipped line numbers spelled out in the readTraceTolerant diagnostic. */
const SKIPPED_LINES_SHOWN = 20;

/**
 * Read and parse a Trace file, best-effort: tolerates a truncated last line, and skips
 * malformed middle lines (files damaged by the pre-fix concurrent-append bug, #215) while
 * keeping every parseable record. Skipped lines are diagnosed once per read on stderr, with
 * the spelled-out line-number list capped (a heavily damaged file can skip thousands).
 */
export async function readTraceTolerant(path: string): Promise<OmniMessage[]> {
  const skipped: number[] = [];
  const messages = parseTraceLines(await readFile(path, "utf8"), {
    onSkip: (lineNumber) => skipped.push(lineNumber),
  });
  if (skipped.length > 0) {
    const shown = skipped.slice(0, SKIPPED_LINES_SHOWN);
    const ellipsis = skipped.length > shown.length ? ", …" : "";
    process.stderr.write(
      `[trace] skipped ${skipped.length} malformed line(s) [${shown.join(", ")}${ellipsis}] in ${path}\n`,
    );
  }
  return messages;
}

/** A located Trace file: its path, containing date-directory name, and index. */
export interface LocatedTraceFile {
  path: string;
  dateDir: string;
  index: number;
}

const TRACE_FILE_RE = /^(.+)_(\d{3})\.jsonl$/;

/**
 * Locate the **highest-index** Trace file for a Session (one Trace file corresponds to one
 * complete model context). Scans `<tracesDir>/<yyyy-mm-dd>/<sessionId>_<index3>.jsonl`; returns
 * null if no match is found.
 */
export async function findLatestTraceFile(
  tracesDir: string,
  sessionId: string,
): Promise<LocatedTraceFile | null> {
  let best: LocatedTraceFile | null = null;
  for (const dateDir of await listDirs(tracesDir)) {
    for (const file of await listFiles(join(tracesDir, dateDir))) {
      const match = TRACE_FILE_RE.exec(file);
      if (!match || match[1] !== sessionId) continue;
      const index = Number(match[2]);
      if (!best || index > best.index) {
        best = { path: join(tracesDir, dateDir, file), dateDir, index };
      }
    }
  }
  return best;
}

/**
 * The id of the most recent Session under this Agent, determined by the timestamp embedded in
 * session_id (ids are zero-padded, so lexical order equals chronological order). Returns null if
 * there are no Sessions.
 */
export async function latestSessionId(tracesDir: string): Promise<string | null> {
  const dateDirs = (await listDirs(tracesDir)).sort((a, b) => b.localeCompare(a));
  for (const dateDir of dateDirs) {
    const files = (await listFiles(join(tracesDir, dateDir))).sort((a, b) => b.localeCompare(a));
    for (const file of files) {
      const match = TRACE_FILE_RE.exec(file);
      if (!match) continue;
      if (await hasResumableTraceContent(join(tracesDir, dateDir, file))) {
        return match[1]!;
      }
    }
  }
  return null;
}

async function hasResumableTraceContent(file: string): Promise<boolean> {
  try {
    const messages = await readTraceTolerant(file);
    return messages.some((msg) => !isSessionMeta(msg));
  } catch {
    return false;
  }
}

async function listDirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return []; // traces directory doesn't exist yet: no Sessions
  }
}

async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}

function isRequestBegin(msg: OmniMessage): msg is OmniMessage<RequestBeginPayload> {
  return isEventMessage(msg) && (msg.payload as { type?: string }).type === "request_begin";
}

function isRequestEnd(msg: OmniMessage): msg is OmniMessage<RequestEndPayload> {
  return isEventMessage(msg) && (msg.payload as { type?: string }).type === "request_end";
}

function isCompactionEnd(msg: OmniMessage): msg is OmniMessage<CompactionEndPayload> {
  return isEventMessage(msg) && (msg.payload as { type?: string }).type === "compaction_end";
}

function toolCallOutputId(msg: OmniMessage): string | null {
  const p = msg.payload as { type?: string; tool_call_id?: string };
  return p.type === "tool_call_output" ? (p.tool_call_id ?? null) : null;
}

/**
 * Replay a Trace file (the current context), reconstructing history and carry-over input.
 * Input is the message sequence parsed by `readTraceTolerant`.
 */
export function resumeTrace(messages: OmniMessage[]): ResumeResult {
  const meta = (messages.find(isSessionMeta) as SessionMetaMessage | undefined) ?? null;
  const sessionTokens = lastSessionTokens(messages);
  const lastRequestTotal = lastRequestTotalOf(messages);

  // —— First check the file-level case: compaction closure (the file ends with a completed
  // compaction stop and no new file was opened, i.e. it's still the latest index at resume time)
  // — this file's context is fully closed, so the whole file is not replayed.
  const last = messages[messages.length - 1];
  if (last && isCompactionEnd(last)) {
    const p = last.payload;
    if (p.status === "completed") {
      const result: ResumeResult = {
        history: [],
        carryOver: [],
        contextClosed: true,
        sessionTokens,
        lastRequestTotal: 0, // new context has no usage yet
        sessionTurns: 0, // turn count resets after compaction completes
        renderMessages: [],
        meta,
      };
      if (p.mode !== "summarize") return result;
      // Reconstruct the summary from the compaction request's output (the assistant text of
      // the last completed Request). Always rebuilt in the current [context_summary] form —
      // extractSummary itself still accepts the old <summary> tags an old Trace may contain.
      const summaryText = extractSummary(lastCompletedRequestText(messages));
      if (summaryText !== "") {
        result.pendingSummary = userText(buildContextSummaryText(summaryText));
        return result;
      }
      // The compaction output extracts to an **empty** summary: only a pre-#83 engine could
      // have written such a "completed" closure (compaction now fails instead of committing an
      // empty summary, which would erase the task state). Mirror the current contract: void
      // the closure and fall through to turn-by-turn replay — the original context this file
      // still holds is restored, and the committed compaction turn stays in history like any
      // committed turn.
    }
  }

  // —— Turn-by-turn determination + pending-input convergence.
  const history: CompleteModelMessage[] = [];
  /** Pending-input buffer: user-side messages not yet sent with any committed Request. */
  let pending: OmniMessage[] = [];
  /** The current Request's input snapshot (frozen at begin) and its outputs. */
  let snapshot: OmniMessage[] = [];
  let outputs: CompleteModelMessage[] = [];
  let inRequest = false;
  /** Whether we're between a matched pair of compaction events: the compaction prompt in this
   * span is not conversational input and must not be resent as-is if uncommitted. */
  let inCompaction = false;
  /** Ids of tool_calls that are committed (in history) and ids of outputs that are paired (in
   * history input). */
  const committedCallIds = new Set<string>();
  const answeredIds = new Set<string>();
  let sessionTurns = 0;
  const renderMessages: OmniMessage[] = [];

  const placeholderFor = (id: string): CompleteModelMessage =>
    toolCallOutput({
      output: PROCESS_EXIT_PLACEHOLDER,
      toolCallId: id,
      stopReason: "aborted",
    }) as CompleteModelMessage;

  const dropUncommittedRound = (): void => {
    // Uncommitted turn: the whole turn is excluded from history. Its **original input** (user
    // text/images and structured tool output) goes back into the pending buffer as-is — best
    // effort to resend "the last input that got no response"; incomplete model output
    // (thinking/text) is allowed to be lost.
    // Exception: a failed compaction turn's compaction prompt is not conversational input and is
    // not reclaimed (structured output is still reclaimed, subject to eligibility filtering).
    const keep = inCompaction ? snapshot.filter((m) => toolCallOutputId(m) !== null) : snapshot;
    pending = [...keep, ...pending];
    snapshot = [];
    outputs = [];
    inRequest = false;
  };

  for (const msg of messages) {
    if (isSessionMeta(msg)) continue;

    if (isRequestBegin(msg)) {
      // Defensive: the previous turn had begin but no end (shouldn't happen mid-file — a process
      // exit only affects the tail) — treat it as uncommitted.
      if (inRequest) dropUncommittedRound();
      inRequest = true;
      snapshot = pending;
      pending = [];
      continue;
    }
    if (isRequestEnd(msg)) {
      if (msg.payload.status === "completed") {
        // Structural eligibility filter (same rule as the final carry-over): a tool_call_output
        // in the snapshot is kept only if it pairs with a tool_call that is **committed and not
        // yet answered** — tool output dispatched by a dropped turn gets persisted in the next
        // turn's input span, but its tool_call isn't in history, so keeping it as-is would create
        // an orphan tool_result with no preceding tool_use, which every request would be rejected
        // for by the provider after resume ("Replay Rules"' strict pairing guarantee).
        const eligible = snapshot.filter((m) => {
          const id = toolCallOutputId(m);
          return id === null || (committedCallIds.has(id) && !answeredIds.has(id));
        });
        // Structural repair (best-effort): a tool_call committed earlier but still unpaired — its
        // matching output was once sent as synthesized carry-over but **never written to Trace**
        // — resynthesize a placeholder before this turn's input, to keep the injected history
        // structurally valid (every assistant tool_use is followed by a user tool_result).
        const snapshotOutputIds = new Set(
          eligible.map(toolCallOutputId).filter((id): id is string => id !== null),
        );
        for (const id of committedCallIds) {
          if (answeredIds.has(id) || snapshotOutputIds.has(id)) continue;
          history.push(placeholderFor(id));
          answeredIds.add(id);
        }
        history.push(...(eligible as CompleteModelMessage[]), ...outputs);
        for (const id of snapshotOutputIds) answeredIds.add(id);
        for (const m of outputs) {
          const p = m.payload as Partial<ToolCallPayload>;
          if (p.type === "tool_call" && p.stop_reason === "completed" && p.tool_call_id) {
            committedCallIds.add(p.tool_call_id);
          }
        }
        // A committed request inside a compaction span enters history as usual (AgentHub
        // committed it — e.g. an invalid-summary attempt of a compaction that then failed),
        // but does not count as a Session turn: in-process only runTurn increments the
        // counter, never runCompactionRequest.
        if (!inCompaction) sessionTurns += 1;
        snapshot = [];
        outputs = [];
        inRequest = false;
      } else {
        dropUncommittedRound();
      }
      continue;
    }

    if (isCompleteModelMessage(msg)) {
      renderMessages.push(msg);
      const role = (msg.payload as { role?: string }).role;
      if (role === "user") {
        // All user-side messages go into the pending buffer: ones between begin/end (output from
        // parallel tools completing during the request) count toward the next turn's input.
        pending.push(msg);
      } else if (inRequest) {
        outputs.push(msg);
      }
      // Defensive: assistant messages outside a span (shouldn't happen) are excluded from
      // history, kept only for rendering.
      continue;
    }
    if (isEventMessage(msg)) {
      const t = (msg.payload as { type?: string }).type;
      if (t === "compaction_begin") inCompaction = true;
      else if (t === "compaction_end") inCompaction = false;
      else if (t === "abort" && (msg.origin?.length ?? 0) === 0) renderMessages.push(msg);
      // Other events (token_usage / approval_decision / session_tools / mcp_connect_*,
      // etc.) don't participate in turn determination and stay out of the render view —
      // the bootstrap records are re-emitted live by the next run when they matter.
    }
  }

  // File ends mid-request (begin but no end — the process exited during a request): treat as an
  // uncommitted turn.
  if (inRequest) dropUncommittedRound();

  // —— Structured resend eligibility filter: a tool_call_output in the pending input is kept
  // only if it pairs with a tool_call that is **committed and not yet answered**. Tool output
  // dispatched by an uncommitted turn itself (which may be persisted before or after that turn's
  // end — the tool and LLM streams run concurrently, so finishing order is unpredictable) is
  // dropped entirely: its tool_call isn't in history, so a structured resend would form an orphan
  // tool_result with no preceding tool_use, which the provider would reject.
  pending = pending.filter((m) => {
    const id = toolCallOutputId(m);
    return id === null || (committedCallIds.has(id) && !answeredIds.has(id));
  });

  // —— Pairing backfill: for any tool_call committed in history with no matching output in
  // either history or pending input, add an interrupted-state placeholder to pending input.
  // Placeholders exist only in memory (synthesized carry-over is never written to Trace) and are
  // resynthesized on each resume as needed.
  const pairedIds = new Set<string>(answeredIds);
  for (const m of pending) {
    const id = toolCallOutputId(m);
    if (id !== null) pairedIds.add(id);
  }
  const pairingBackfill: OmniMessage[] = [];
  for (const id of committedCallIds) {
    if (pairedIds.has(id)) continue;
    pairingBackfill.push(placeholderFor(id));
  }

  return {
    history,
    carryOver: [...pending, ...pairingBackfill],
    contextClosed: false,
    sessionTokens,
    lastRequestTotal,
    sessionTurns,
    renderMessages,
    meta,
  };
}

/** The session cumulative total from the last token_usage (zero if none). */
function lastSessionTokens(messages: OmniMessage[]): TokenCounts {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (!isEventMessage(msg)) continue;
    const p = msg.payload as Partial<TokenUsagePayload>;
    if (p.type === "token_usage" && p.session) return p.session;
  }
  return emptyTokenCounts();
}

/** The request.total from the last token_usage (context usage figure; 0 if none). */
function lastRequestTotalOf(messages: OmniMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (!isEventMessage(msg)) continue;
    const p = msg.payload as Partial<TokenUsagePayload>;
    if (p.type === "token_usage" && p.request) return p.request.total;
  }
  return 0;
}

/** Concatenated assistant text of the last completed Request (on compaction closure, this is the compaction request's output). */
function lastCompletedRequestText(messages: OmniMessage[]): string {
  let text = "";
  let current = "";
  let inRequest = false;
  for (const msg of messages) {
    if (isRequestBegin(msg)) {
      inRequest = true;
      current = "";
      continue;
    }
    if (isRequestEnd(msg)) {
      {
        // A completed request with empty text still overwrites (we take the text of “the last
        // completed request”, even if empty) — otherwise a textless compaction output would fall
        // back to an earlier turn's normal reply and get mistakenly injected as the summary. The
        // caller treats the resulting empty extract as a void closure (a pre-#83 trace shape)
        // and replays the original context instead.
        if (msg.payload.status === "completed") text = current;
        inRequest = false;
      }
      continue;
    }
    if (!inRequest || !isCompleteModelMessage(msg)) continue;
    const p = msg.payload as { type?: string; role?: string; text?: string };
    if (p.type === "text" && p.role === "assistant" && p.text) current += p.text;
  }
  return text;
}
