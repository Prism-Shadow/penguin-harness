/**
 * Error capture within the message stream: LLM request
 * failures and tool execution failures are **both never expressed via throw** — core
 * converges them into the message stream (LLM and Environment handle errors
 * internally and never throw), so a try/catch can't catch a single one. This watcher
 * hooks onto SessionManager's drive, inspects messages one by one, and fishes them out
 * into error_records (source = `llm` / `environment` / `compaction`), matching
 * usage-recorder's shape:
 * recognizes only a few payload types, no-op on the rest. **One instance per run/compact**
 * (its state wraps up accordingly, see close).
 *
 * LLM (source = `llm`): reads the status of `request_end` —
 * - `auth` → unexpected (`llm_auth`): the credential was rejected, the engine never retries
 *   it, and only a human holding the key can fix it. Its own code rather than the failed
 *   bucket, because dedup is `(source, code, Project)` over a short window: sharing a code
 *   with a class that now fires on every recovered blip would let a real credential failure
 *   be swallowed as a duplicate of something already handled.
 * - `failed` → depends on whether the retry ladder carried it. The engine reconnects on
 *   `failed` too, so the same status covers both "a gateway hiccup nobody needed to know
 *   about" and "the run died on it":
 *     - another attempt followed (a `request_begin` resolved the pending record) → expected
 *       (`llm_failed_retried`), same footing as timeout/malformed: recorded for the record,
 *       not raised at an operator;
 *     - nothing followed but the end of the run (an `abort`, or close) → unexpected
 *       (`llm_failed`): the retries did not recover it, the user lost the turn, needs a human.
 * - `timeout` / `malformed` → expected (the engine already reconnects and retries, part
 *   of normal operation);
 * - `aborted` / `completed` are not recorded (the former is a user-initiated interrupt,
 *   not an error).
 *
 * The message uses the real reason: `request_end` carries the failure detail on
 * non-completed statuses (`message`, from LLMOutcome), and the `abort` event's reason is
 * core's failure-reason prose (e.g. `llm request error: 401 …` / `malformed response
 * failed after N retries`). A `request_end` failure is first held pending (status + its
 * own detail), not persisted immediately, and is resolved at the next request boundary:
 * - Immediately followed by `abort` → use its reason as the message (the real reason);
 * - Immediately followed by `request_begin` (the engine is retrying — no abort will ever
 *   arrive) → use the staged request_end's own `message` (the real detail, e.g. a quota
 *   code), falling back to the generic status text when it carried none. This boundary is
 *   also what tells a survived `failed` from an exhausted one (see the classification above);
 * - Still unresolved when the run ends → close persists it the same way.
 * Exception: when reason is a user-interrupt message (`aborted …`), it's not trusted —
 * "the user clicked stop during backoff" isn't the reason for this timeout, so the
 * status text is used instead (that timeout is a genuine failure and is still recorded).
 * Pending state is bucketed by origin: subagent messages interleave with the parent
 * session's (even more so with parallel subagents), and mixing them up would misattribute.
 *
 * Environment (source = `environment`): reads `tool_call_output`'s stop_reason ∈
 * {failed, timeout} → expected (the error is fed back to the model, and the Agent
 * adjusts on its own; `aborted` is denial/interruption, not recorded). Exactly one shape is
 * dropped: a command tool's ordinary non-zero exit, which is how a shell command reports
 * information rather than a fault — see isOrdinaryCommandExit; the same tools' environment
 * faults (killed by a signal, spawn failure, tool timeout) still record.
 * `tool_call_output` only has tool_call_id, no tool name, so `tool_call_id → tool name`
 * is cached (tool_call always arrives before its output), and the tool name is written
 * into code (`tool_failed:exec_command`) — so the stats dashboard's "most common error
 * code" and the error table can show at a glance which tool failed.
 *
 * **Attribution (ctx) is recorded against the session that actually produced the error,
 * not always the parent Session**: a subagent's LLM failures and tool failures also flow
 * through this same stream (carrying origin); if we simply reused the parent ctx passed
 * in at construction, filtering errors by Agent would always show 0 for the child Agent
 * and an inflated count for the parent — both attribution stats and the troubleshooting
 * target would be wrong. So we recognize `session_meta` carrying origin (a subagent's
 * first message, always arriving before any of its failures), registering
 * `origin → {agentId, sessionId}` (agentId derived from the agent_state path, matching
 * SessionManager.registerChildSession's convention); at persist time we look up the
 * message's origin: a hit records the subagent, a miss (a main-session message, or
 * session_meta hasn't arrived yet) falls back to the parent ctx. projectId is always
 * taken from the parent — a subagent is necessarily in the same Project.
 */
import { isEventMessage, isModelMessage, isSessionMeta } from "@prismshadow/penguin-core";
import path from "node:path";
import type { OmniMessage, SessionMetaMessage, StopReason } from "@prismshadow/penguin-core";
import { MESSAGE_MAX } from "./error-recorder.js";
import type { ErrorContext, ErrorKind, ErrorSink } from "./error-recorder.js";

/** Cap on the tool-name cache (bounded, to prevent unbounded growth over a long run; over the limit, evicts the oldest by registration order). */
export const TOOL_NAMES_MAX = 1000;

/**
 * Cap on the subagent-identity cache (bounded, same reasoning as TOOL_NAMES_MAX: prevent
 * unbounded growth over a long run). The number of in-flight subagents is naturally
 * bounded by the subagent concurrency limit and falls far short of this value; over the
 * limit, evicts the oldest by registration order (those subagents have long since
 * settled, so even if a failure still arrives, it just falls back to the parent ctx —
 * i.e., the pre-fix behavior).
 */
export const ORIGIN_CTX_MAX = 200;

/** Recorded LLM failure states (`aborted` / `completed` are not errors and aren't included here). */
type LlmFailure = "failed" | "timeout" | "malformed" | "auth";

/** Error code, classification, and fallback message (the last used when no abort reason is available). */
interface FailureSpec {
  code: string;
  kind: ErrorKind;
  text: string;
}

/** LLM failure state → its spec, for a failure the retry ladder did NOT carry (see the file header). */
const LLM_FAILURES: Record<LlmFailure, FailureSpec> = {
  // Reached here only when no further attempt followed: the ladder ran out (or the run ended
  // on it), so the user lost the turn and someone should look. A `failed` that was retried
  // takes LLM_FAILED_RETRIED instead.
  failed: {
    code: "llm_failed",
    kind: "unexpected",
    text: "LLM request failed and the retries did not recover it.",
  },
  // Its own code, not the failed bucket: dedup is `(source, code, Project)` over a short
  // window, and `llm_failed_retried` can now fire on any recovered blip — sharing a bucket
  // would let a genuine credential failure be dropped as a duplicate of one.
  auth: {
    code: "llm_auth",
    kind: "unexpected",
    text: "LLM request rejected: the provider did not accept the credentials.",
  },
  timeout: {
    code: "llm_timeout",
    kind: "expected",
    text: "LLM request timed out (the engine reconnects and retries).",
  },
  malformed: {
    code: "llm_malformed",
    kind: "expected",
    text: "LLM response could not be parsed (the engine reconnects and retries).",
  },
};

/**
 * A `failed` the engine went on to retry: expected, exactly like timeout/malformed — the
 * engine's defined handling path absorbed it and the user never lost anything, so it belongs
 * in the record but not in an operator's queue. Its own code so the exhausted case keeps
 * `llm_failed` to itself and neither can dedup the other away.
 */
const LLM_FAILED_RETRIED: FailureSpec = {
  code: "llm_failed_retried",
  kind: "expected",
  text: "LLM request failed (the engine reconnects and retries).",
};

/** Recorded tool failure states (`aborted` = denial/interruption, not an error). */
type ToolFailure = "failed" | "timeout";

function isLlmFailure(s: unknown): s is LlmFailure {
  return s === "failed" || s === "timeout" || s === "malformed" || s === "auth";
}

function isToolFailure(s: unknown): s is ToolFailure {
  return s === "failed" || s === "timeout";
}

/**
 * The command tools. Both funnel their exit status through core's `resultForExit`, which maps
 * *any* non-zero exit to `failed` — and a non-zero exit is how shell commands return
 * information, not a fault: `grep` exits 1 when nothing matches, `test -f` when the file is
 * absent, `diff` when files differ. Recording those made the cost center's error table mostly a
 * log of ordinary Agent work, burying the real errors and eating the row cap that exists to
 * protect them. (Only the row cap: the recorder's dedup key carries the error code, so this
 * noise could ever have crowded out only *itself*.) The Agent sees the failure in the tool
 * output and adjusts — nothing about it needs a human.
 *
 * Both belong here: `input_command` is how a backgrounded `exec_command` is polled for its
 * eventual exit, so covering only one would record the *same* command's non-zero exit when it
 * finishes in the background and drop it when it finishes in the foreground.
 */
const COMMAND_TOOLS: ReadonlySet<string> = new Set(["exec_command", "input_command"]);

/**
 * `resultForExit`'s terminal marker for an ordinary non-zero exit. Anchored to the end because
 * the marker is a `note`, which Environment appends after the (possibly truncated) output — a
 * command's own stdout may contain anything, including this text.
 */
const ORDINARY_EXIT_NOTE = /\[exit code: [^\]\n]*\]\s*$/;

/**
 * Whether a command-tool failure is just an ordinary non-zero exit — the one failure shape the
 * error table is better off without (see COMMAND_TOOLS).
 *
 * The discrimination is by note rather than by tool name, because `failed` from these tools is
 * not only "the command exited non-zero": it also covers termination by signal (an OOM kill, a
 * segfault), a spawn failure (nonexistent workdir, EMFILE, an unresolvable shell), a missing
 * command session manager, and a tool timeout. Those are config/environment faults — the
 * recorder's own "needs a human" category — and no amount of Agent self-correction resolves
 * them, so they must keep landing in the table. `resultForExit` writes the exit code as the
 * output's last note, which tells the two apart precisely.
 *
 * An unknown name (tool_call evicted from the cache, or never seen) still qualifies: only these
 * two tools ever emit that marker, so dropping it beats recording a nameless
 * `tool_failed:unknown` for exactly the noise this exists to remove.
 */
function isOrdinaryCommandExit(name: string | undefined, output: string): boolean {
  if (name !== undefined && !COMMAND_TOOLS.has(name)) return false;
  return ORDINARY_EXIT_NOTE.test(output);
}

/** A user-interrupt abort message (core's `aborted by user` / `aborted during …`): not a failure reason. */
function isUserAbortReason(reason: string): boolean {
  return /^aborted\b/i.test(reason);
}

/** The session a message belongs to (last origin element; empty string for the main session) — both pending state and the tool-name cache are bucketed by it. */
function originKey(msg: OmniMessage): string {
  const origin = msg.origin;
  return origin && origin.length > 0 ? origin[origin.length - 1]! : "";
}

/**
 * Take the **tail** of the tool output (not the head) as the message: core appends the
 * failure reason (`[tool error] …` / `[tool timeout: …]` / exit code) at the end of the
 * output, so truncating from the head would leave only a chunk of normal stdout and
 * drop the reason.
 */
function toolFailureText(output: string): string {
  if (!output) return "Tool execution failed (no output).";
  if (output.length <= MESSAGE_MAX) return output;
  return `…${output.slice(output.length - (MESSAGE_MAX - 1))}`;
}

export class StreamErrorWatcher {
  /** LLM failures awaiting a real reason: origin → failure state + the request_end's own detail (see file header; each session has at most one in-flight Request). */
  private readonly pending = new Map<string, { status: LlmFailure; message?: string }>();
  /** Names of in-flight tool calls: `origin \0 tool_call_id` → tool name (dequeued once output arrives). */
  private readonly toolNames = new Map<string, string>();
  /** Subagent identity: origin → that subagent's `{agentId, sessionId}` (see the file header's attribution section). */
  private readonly originCtx = new Map<string, { agentId: string; sessionId: string }>();

  constructor(
    private readonly errors: ErrorSink,
    private readonly ctx: ErrorContext,
  ) {}

  /** Consume one outgoing message; messages irrelevant to this watcher are a no-op. */
  observe(msg: OmniMessage): void {
    if (isSessionMeta(msg)) {
      this.registerOrigin(msg);
      return;
    }
    if (isModelMessage(msg)) {
      this.observeTool(msg);
      return;
    }
    if (isEventMessage(msg)) this.observeLlm(msg);
  }

  /** run/compact wrap-up: persist any still-pending failure (that never got its abort), and clear caches (prevents leaks). */
  close(): void {
    for (const key of [...this.pending.keys()]) this.flush(key);
    this.pending.clear();
    this.toolNames.clear();
    this.originCtx.clear();
  }

  // —— Attribution (see file header) ——

  /**
   * Register a subagent's identity: `session_meta` carrying origin is the subagent's
   * first message, always arriving before any of its failures. agentId is derived from
   * the absolute agent_state path (`<…>/<agentId>/agent_state`) — matching
   * SessionManager.registerChildSession's convention; not registered if the path is
   * malformed (that subagent's failures fall back to the parent ctx — better to
   * misattribute than write into a nonexistent agentId). The main session's session_meta
   * (no origin) is already the parent ctx and isn't registered.
   */
  private registerOrigin(msg: SessionMetaMessage): void {
    const key = originKey(msg);
    if (!key) return; // Main session
    const agentId = path.basename(path.dirname(msg.payload.agent_state));
    if (!agentId || agentId === "." || agentId === "..") return;
    // Bounded (re-registering refreshes registration order; over the limit, evicts the oldest).
    this.originCtx.delete(key);
    this.originCtx.set(key, { agentId, sessionId: key });
    if (this.originCtx.size > ORIGIN_CTX_MAX) {
      const oldest = this.originCtx.keys().next().value;
      if (oldest !== undefined) this.originCtx.delete(oldest);
    }
  }

  /**
   * The attribution to persist for this origin: a registered subagent hit → record its
   * own Agent/Session; a miss (a main-session message, or session_meta hasn't arrived
   * yet) → fall back to the parent ctx passed at construction. projectId is always taken
   * from the parent (a subagent is necessarily in the same Project).
   */
  private ctxFor(key: string): ErrorContext {
    const child = this.originCtx.get(key);
    if (!child) return this.ctx;
    return { projectId: this.ctx.projectId, agentId: child.agentId, sessionId: child.sessionId };
  }

  // —— LLM ——

  private observeLlm(msg: OmniMessage): void {
    const p = msg.payload as {
      type?: string;
      status?: StopReason;
      reason?: string | null;
      message?: string;
    };
    const key = originKey(msg);
    if (p.type === "compaction_end") {
      this.observeCompactionEnd(msg, key);
      return;
    }
    if (p.type === "request_end") {
      this.flush(key); // Defensive: if a previous failure is still pending (normally resolved by request_begin), persist it first
      if (isLlmFailure(p.status)) {
        this.pending.set(key, {
          status: p.status,
          // The event's own failure detail (LLMOutcome.message): the message of record when
          // no abort follows (the retry path).
          ...(typeof p.message === "string" && p.message.trim() ? { message: p.message } : {}),
        });
      }
      return;
    }
    // A new attempt begins (the engine is retrying): no reason text left to wait for the
    // previous failure, persist using the status text — and this is the proof the ladder
    // carried it, which is what downgrades a `failed` from unexpected to expected.
    if (p.type === "request_begin") {
      this.flush(key, null, true);
      return;
    }
    // Interrupted/failed exit: reason is core's only failure-reason text. No attempt follows
    // an abort, so a `failed` resolved here is one the retries did not recover.
    if (p.type === "abort") {
      this.flush(key, typeof p.reason === "string" ? p.reason : null);
    }
  }

  /**
   * Persist a pending LLM failure (no-op if none is pending); `reason` is the abort
   * message that arrived afterward, and `retried` says whether another attempt followed
   * (only a `request_begin` proves that). Pending state is already bucketed by origin, so
   * `key` is exactly "the session that produced this failure" — attribution is looked
   * up from it (see file header).
   *
   * `retried` defaults to false so every other resolution — an abort, the defensive flush at
   * the next request_end, or close() at the end of the run — is read as "nothing came after
   * this failure". That is the conservative direction: at worst a recovered blip is escalated,
   * never a lost turn silently downgraded.
   */
  private flush(key: string, reason?: string | null, retried = false): void {
    const entry = this.pending.get(key);
    if (entry === undefined) return;
    this.pending.delete(key);
    const spec =
      retried && entry.status === "failed" ? LLM_FAILED_RETRIED : LLM_FAILURES[entry.status];
    const trimmed = reason?.trim();
    // Message priority: the abort reason (core's failure prose) → the staged request_end's
    // own detail (the retry path: no abort ever arrives) → the generic status text. A
    // user-interrupt message isn't a failure reason (see file header).
    const message = trimmed && !isUserAbortReason(trimmed) ? trimmed : (entry.message ?? spec.text);
    this.errors.record({
      source: "llm",
      err: message,
      ctx: this.ctxFor(key),
      code: spec.code,
      kind: spec.kind,
    });
  }

  /**
   * A failed compaction becomes its own error record (source = `compaction`) — a compaction
   * is an ordinary LLM request whose failures (unusable summary and transport alike) core
   * retries under the standard budget, so a `failed` end means the retries ran out
   * (issue #170). This is the single record a failed compaction produces: the compaction
   * request's own request_begin/request_end pair is written to Trace only and never reaches
   * this stream, so the llm-source records above cannot double-count it. `completed` is not
   * an error and `aborted` is a user interrupt — neither is recorded. kind is unexpected for
   * the same reason `llm_failed` is: the budget is exhausted, and while the original context
   * is kept, the trigger still holds — the session keeps re-entering compaction until a
   * human changes something. The message carries the attempts and burned output tokens so
   * the cost center shows what the failure cost.
   */
  private observeCompactionEnd(msg: OmniMessage, key: string): void {
    const p = msg.payload as {
      mode?: string;
      reason?: string;
      status?: StopReason;
      attempts?: number;
      output_tokens?: number;
    };
    if (p.status !== "failed") return;
    const attempts =
      typeof p.attempts === "number" && p.attempts > 0
        ? ` after ${p.attempts} attempt${p.attempts === 1 ? "" : "s"}`
        : "";
    const tokens =
      typeof p.output_tokens === "number" && p.output_tokens > 0
        ? ` (${p.output_tokens} output tokens spent)`
        : "";
    this.errors.record({
      source: "compaction",
      err: `${p.mode ?? "summarize"} compaction failed${attempts}${tokens}; trigger ${p.reason ?? "unknown"}, original context kept.`,
      ctx: this.ctxFor(key),
      code: "compaction_failed",
      kind: "unexpected",
    });
  }

  // —— Environment (tool execution) ——

  private observeTool(msg: OmniMessage): void {
    const p = msg.payload as {
      type?: string;
      name?: string;
      output?: string;
      tool_call_id?: string;
      stop_reason?: StopReason;
    };
    if (typeof p.tool_call_id !== "string") return;
    const origin = originKey(msg); // The session that made this call (both attribution and the tool-name cache are bucketed by it)
    const key = `${origin}\0${p.tool_call_id}`;

    if (p.type === "tool_call" && typeof p.name === "string") {
      // tool_call arrives before its output: record the tool name (bounded, re-registering refreshes registration order).
      this.toolNames.delete(key);
      this.toolNames.set(key, p.name);
      if (this.toolNames.size > TOOL_NAMES_MAX) {
        const oldest = this.toolNames.keys().next().value;
        if (oldest !== undefined) this.toolNames.delete(oldest);
      }
      return;
    }
    if (p.type !== "tool_call_output") return;

    const name = this.toolNames.get(key);
    this.toolNames.delete(key); // This call has settled: dequeue it, the cache only keeps in-flight calls
    if (!isToolFailure(p.stop_reason)) return; // completed / aborted (denial, user interrupt) are not errors
    const output = p.output ?? "";
    if (isOrdinaryCommandExit(name, output)) return; // a shell's exit status is information, not a fault
    this.errors.record({
      source: "environment",
      err: toolFailureText(output),
      ctx: this.ctxFor(origin),
      // The tool name goes into code: so the stats dashboard's "most common error code" and table can show which tool failed.
      code: `tool_${p.stop_reason}:${name ?? "unknown"}`,
      kind: "expected",
    });
  }
}
