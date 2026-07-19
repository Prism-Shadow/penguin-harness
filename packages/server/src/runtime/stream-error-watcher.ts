/**
 * Error capture within the message stream: LLM request
 * failures and tool execution failures are **both never expressed via throw** — core
 * converges them into the message stream (LLM and Environment handle errors
 * internally and never throw), so a try/catch can't catch a single one. This watcher
 * hooks onto SessionManager's drive, inspects messages one by one, and fishes them out
 * into error_records (source = `llm` / `environment`), matching usage-recorder's shape:
 * recognizes only a few payload types, no-op on the rest. **One instance per run/compact**
 * (its state wraps up accordingly, see close).
 *
 * LLM (source = `llm`): reads the status of `request_end` —
 * - `failed` → unexpected (not retryable: auth failure, invalid params, etc., needs a human);
 * - `timeout` / `malformed` → expected (the engine already reconnects and retries, part
 *   of normal operation);
 * - `aborted` / `completed` are not recorded (the former is a user-initiated interrupt,
 *   not an error).
 *
 * The message uses the real reason: `request_end` only carries status, and **the only
 * place core carries the actual failure-reason text is the `abort` event's reason**
 * (e.g. `llm request error: 401 …` / `malformed response failed after N retries`). So a
 * `request_end` failure is first held pending, not persisted immediately, and is
 * resolved at the next request boundary:
 * - Immediately followed by `abort` → use its reason as the message (the real reason);
 * - Immediately followed by `request_begin` (the engine is retrying) → no reason text
 *   left to wait for, use the status text;
 * - Still unresolved when the run ends → close persists it as a fallback.
 * Exception: when reason is a user-interrupt message (`aborted …`), it's not trusted —
 * "the user clicked stop during backoff" isn't the reason for this timeout, so the
 * status text is used instead (that timeout is a genuine failure and is still recorded).
 * Pending state is bucketed by origin: subagent messages interleave with the parent
 * session's (even more so with parallel subagents), and mixing them up would misattribute.
 *
 * Environment (source = `environment`): reads `tool_call_output`'s stop_reason ∈
 * {failed, timeout} → expected (the error is fed back to the model, and the Agent
 * adjusts on its own; `aborted` is denial/interruption, not recorded).
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
type LlmFailure = "failed" | "timeout" | "malformed";

/** LLM failure state → error code, classification, and fallback message (used when the abort reason isn't available). */
const LLM_FAILURES: Record<LlmFailure, { code: string; kind: ErrorKind; text: string }> = {
  failed: { code: "llm_failed", kind: "unexpected", text: "LLM 请求失败（不可重试）。" },
  timeout: { code: "llm_timeout", kind: "expected", text: "LLM 请求超时（引擎重连重试）。" },
  malformed: {
    code: "llm_malformed",
    kind: "expected",
    text: "LLM 响应无法解析（引擎重连重试）。",
  },
};

/** Recorded tool failure states (`aborted` = denial/interruption, not an error). */
type ToolFailure = "failed" | "timeout";

function isLlmFailure(s: unknown): s is LlmFailure {
  return s === "failed" || s === "timeout" || s === "malformed";
}

function isToolFailure(s: unknown): s is ToolFailure {
  return s === "failed" || s === "timeout";
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
  if (!output) return "工具执行失败（无输出）。";
  if (output.length <= MESSAGE_MAX) return output;
  return `…${output.slice(output.length - (MESSAGE_MAX - 1))}`;
}

export class StreamErrorWatcher {
  /** LLM failures awaiting a real reason: origin → failure state (see file header; each session has at most one in-flight Request). */
  private readonly pending = new Map<string, LlmFailure>();
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
    const p = msg.payload as { type?: string; status?: StopReason; reason?: string | null };
    const key = originKey(msg);
    if (p.type === "request_end") {
      this.flush(key); // Defensive: if a previous failure is still pending (normally resolved by request_begin), persist it first
      if (isLlmFailure(p.status)) this.pending.set(key, p.status);
      return;
    }
    // A new attempt begins (the engine is retrying): no reason text left to wait for the previous failure, persist using the status text.
    if (p.type === "request_begin") {
      this.flush(key);
      return;
    }
    // Interrupted/failed exit: reason is core's only failure-reason text.
    if (p.type === "abort") {
      this.flush(key, typeof p.reason === "string" ? p.reason : null);
    }
  }

  /**
   * Persist a pending LLM failure (no-op if none is pending); `reason` is the abort
   * message that arrived afterward. Pending state is already bucketed by origin, so
   * `key` is exactly "the session that produced this failure" — attribution is looked
   * up from it (see file header).
   */
  private flush(key: string, reason?: string | null): void {
    const status = this.pending.get(key);
    if (status === undefined) return;
    this.pending.delete(key);
    const spec = LLM_FAILURES[status];
    const trimmed = reason?.trim();
    // A user-interrupt message isn't a failure reason (see file header); fall back to the status text.
    const message = trimmed && !isUserAbortReason(trimmed) ? trimmed : spec.text;
    this.errors.record({
      source: "llm",
      err: message,
      ctx: this.ctxFor(key),
      code: spec.code,
      kind: spec.kind,
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
    this.errors.record({
      source: "environment",
      err: toolFailureText(p.output ?? ""),
      ctx: this.ctxFor(origin),
      // The tool name goes into code: so the stats dashboard's "most common error code" and table can show which tool failed.
      code: `tool_${p.stop_reason}:${name ?? "unknown"}`,
      kind: "expected",
    });
  }
}
