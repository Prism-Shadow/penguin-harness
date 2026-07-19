/**
 * context_engine — orchestrates the ReAct loop.
 *
 * context_engine only handles OmniMessage, orchestrating the flow of events between the
 * Human, LLM, and Environment interfaces, and writes every observable action to Trace.
 * The initial version keeps a linear message history.
 *
 * Human is the SDK's input/output boundary: there is no "Human implementation/interface".
 * Input is the Prompt list passed to `run`, plus the abort signal `signal` and the
 * per-tool approval callback `approve` in `RunOptions`; output is the OmniMessage stream
 * produced by `run`.
 *
 * Docs: packages/docs/content/agent-loop.{zh,en}.md (site path /docs/agent-loop) documents
 * the turn lifecycle, carry-over, reconnect and compaction implemented here.
 *
 * Approval is an **in-turn interaction** and tool calls are **async/incremental** (see
 * comment #24):
 *   - A single `run` call automatically runs the entire ReAct loop (no more resuming in batches);
 *   - Each tool_call is emitted as soon as its stream completes → `await approve` → if
 *     allowed, it runs via Environment;
 *   - Execution **does not block** continued consumption of the LLM stream or approval of
 *     the next tool (executions can overlap), but approvals still happen one at a time;
 *   - partial/complete `tool_call_output` is yielded in **completion order**;
 *   - once all tool outputs for the turn are ready, they become the next turn's LLM input;
 *     the Task ends once a turn produces no more tool_call.
 *
 * Implementation note: an internal queue merges "the LLM event stream + N concurrent tool
 * output streams" into a single yield sequence. GenerativeModel is a stateful object
 * (AgentHub maintains the history); each turn the engine only hands it the "new" messages:
 * the user Prompt on the first turn, and the previous turn's tool_call_output afterward.
 */
import {
  abortEvent,
  approvalDecision,
  assistantText,
  compactionBegin,
  compactionEnd,
  emptyTokenCounts,
  isCompleteModelMessage,
  isSessionMeta,
  partialText,
  requestBegin,
  requestEnd,
  subagentEvent,
  toolCallOutput,
  userText,
} from "../omnimessage/index.js";
import type {
  ApprovalDecision,
  CompactionMode,
  CompactionReason,
  OmniMessage,
  StopReason,
  TextPayload,
  ThinkingPayload,
  TokenCounts,
  TokenUsagePayload,
  ToolCallOutputPayload,
  ToolCallPayload,
} from "../omnimessage/index.js";
import type { ApproveFn, EnvironmentInterface, LLMInterface, LLMOutcome } from "../interfaces.js";

/** Trace sink: `write` a complete/event/meta message; `rotate` starts a new file (compaction splits files). */
export interface TraceSink {
  write(msg: OmniMessage): Promise<void>;
  /** Optional: start a new Trace file (index+1), used to record the new model context after compaction. */
  rotate?(): Promise<void>;
}

/**
 * Resolved context compaction settings (defaults filled in by the composition layer).
 * Docs: /docs/agent-loop § "Compaction".
 */
export interface CompactionSettings {
  /** Context token threshold (uses the most recent token_usage's request.total); <=0 disables it. */
  maxContextLength: number;
  /** Session cumulative turn threshold (counted per LLM Request, across Tasks); <=0 means no limit. */
  maxSessionTurns: number;
  mode: CompactionMode;
  /** Prompt used for summarize compaction. */
  prompt: string;
}

/** Result of one compaction run: status is a terminal state (completed / failed / aborted); carries the summary message when summarize succeeds. */
interface CompactionResult {
  status: StopReason;
  summary?: OmniMessage;
}

/**
 * Options for `run`.
 * Docs: /docs/agent-loop § "Inputs and outputs".
 */
export interface RunOptions {
  /** Abort signal (e.g. Ctrl-C). */
  signal?: AbortSignal;
  /** Per-tool approval callback; defaults to denying everything (conservative, to avoid accidental approval when unattended). */
  approve?: ApproveFn;
}

/**
 * Engine initial state (used for Session resumption): derived by replaying Trace, so the
 * resumed engine behaves the same as before the process
 * exited. Not passed when creating a normal new Session.
 */
export interface EngineInitialState {
  /** Pending input (carry-over): resent alongside new input on the first `run` after resumption (synthetic placeholders exist only in memory, never written to Trace). */
  carryOver?: OmniMessage[];
  /** Summary recovered from a completed summarize compaction: used as the prefix of the next `run` input (merged with the user Prompt). */
  pendingSummary?: OmniMessage;
  /** Carried-over Session cumulative turn count. */
  sessionTurns?: number;
  /** Carried-over Session cumulative token counts (handed to the new object when compaction swaps it in). */
  sessionTokens?: TokenCounts;
  /** Most recent token_usage's request.total (the context usage figure, keeps compaction threshold checks continuous). */
  lastRequestTotal?: number;
  /** Recovered from a completed compaction: the context is already closed, so rotate the Trace file (index+1, writing session_meta) before the first write. */
  pendingTraceRotation?: boolean;
}

export interface ContextEngineDeps {
  llm: LLMInterface;
  environment: EnvironmentInterface;
  /** Optional Trace writer; the writer is responsible for filtering out streaming partial_* messages. */
  trace?: TraceSink;
  /** Engine initial state (derived by replaying Trace on Session resumption). */
  initialState?: EngineInitialState;
  /** Maximum LLM turns for a single Task. Defaults to 100. */
  maxTurns?: number;
  /** Maximum automatic retries for LLM timeout/reconnect within a single run. Defaults to 2. */
  maxReconnects?: number;
  /** Linear backoff base (ms) before each reconnect retry; actual backoff = base × retry number. Defaults to 250. */
  reconnectBackoffMs?: number;
  /**
   * Creates a new LLM object after compaction (a fresh model context); the argument is the
   * current Session cumulative token counts, for the new object to carry forward
   * (token_usage.session stays continuous across compaction). Context compaction is
   * unavailable if this is not provided.
   */
  createLLM?: (sessionTokens: TokenCounts) => LLMInterface;
  /** Context compaction settings; only takes effect if provided together with `createLLM`. */
  compaction?: CompactionSettings;
  /** This Session's session_meta message; written at the start of the new Trace file after compaction splits it. */
  sessionMeta?: OmniMessage;
}

/** Whether compaction is possible; when not `ok`, `compact()` is a no-op and yields no messages (see ContextEngine.compactability). */
export type CompactAvailability = "ok" | "unsupported" | "empty" | "just_compacted";

/** Result of executing one LLM turn (the return value of runTurn). */
interface TurnResult {
  /** All tool outputs for this turn, reordered to match the original tool_call order (for the next turn's LLM input). */
  toolOutputs: OmniMessage[];
  /** tool_calls issued by the model this turn (in original order, real requests only). */
  toolCalls: OmniMessage<ToolCallPayload>[];
  /** Complete thinking/text segments produced by the model this turn (including partial segments finalized on interruption), for carry-over flattening. */
  assistantSegments: OmniMessage[];
  /** Terminal state of this turn's LLM request (completed / failed / aborted / timeout / malformed). */
  outcome: LLMOutcome;
}

/**
 * Merge queue: lets multiple concurrent producers (the LLM stream consumer + several tool
 * executions) push OmniMessage entries; a single consumer (run's generator) pulls and
 * yields them in push order. Finishes once all producers are done and the queue is drained.
 * Docs: /docs/message-flow § "The merge point: MergeQueue".
 */
class MergeQueue {
  private items: OmniMessage[] = [];
  private producers = 0;
  private wake: (() => void) | null = null;

  /** Registers a producer. */
  addProducer(): void {
    this.producers += 1;
  }

  /** Deregisters a producer (its stream has finished). */
  removeProducer(): void {
    this.producers -= 1;
    this.signal();
  }

  /** Pushes a message and wakes the consumer. */
  push(msg: OmniMessage): void {
    this.items.push(msg);
    this.signal();
  }

  private signal(): void {
    if (this.wake) {
      const w = this.wake;
      this.wake = null;
      w();
    }
  }

  /** Takes the next message; waits if empty but producers remain; returns null if empty and no producers remain. */
  async next(): Promise<OmniMessage | null> {
    for (;;) {
      if (this.items.length > 0) return this.items.shift()!;
      if (this.producers === 0) return null;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }
}

export class ContextEngine {
  private readonly maxTurns: number;
  private readonly maxReconnects: number;
  private readonly reconnectBackoffMs: number;
  /** Interruption cleanup: content to resend generated when the previous run was aborted, held on the engine across runs. */
  private pendingCarryOver: OmniMessage[] = [];
  /** Current LLM object; swapped for a new one created by `createLLM` after a successful compaction (a fresh model context). */
  private llm: LLMInterface;
  /** Session cumulative turn count: counted per LLM Request that produces token_usage, across Tasks; reset to zero after compaction completes. */
  private sessionTurns = 0;
  /** Whether the current context was produced by a compaction (`startNewContext`); this flag becomes meaningless once a new completed turn occurs. */
  private fromCompaction = false;
  /** Most recent token_usage's request.total, i.e. the current context usage figure. */
  private lastRequestTotal = 0;
  /** Most recent token_usage's session cumulative counts, handed to the new LLM object when compaction swaps it in. */
  private lastSessionTokens: TokenCounts = emptyTokenCounts();
  /** Summary produced by a Task-boundary compaction: used as the prefix of the next `run` input (merged with the next user Prompt). */
  private pendingSummary: OmniMessage | null = null;
  /**
   * Set to true once compaction completes: Trace rotation is deferred until the next
   * message that needs writing (see `write`) — so that if no further messages follow the
   * compaction, we don't create an empty file containing only session_meta.
   */
  private pendingTraceRotation = false;

  constructor(private readonly deps: ContextEngineDeps) {
    this.maxTurns = deps.maxTurns ?? 100;
    this.maxReconnects = deps.maxReconnects ?? 2;
    this.reconnectBackoffMs = deps.reconnectBackoffMs ?? 250;
    this.llm = deps.llm;
    // Session resumption: apply the initial state derived from replay.
    const init = deps.initialState;
    if (init) {
      this.pendingCarryOver = init.carryOver ?? [];
      this.pendingSummary = init.pendingSummary ?? null;
      this.sessionTurns = init.sessionTurns ?? 0;
      this.lastSessionTokens = init.sessionTokens ?? emptyTokenCounts();
      this.lastRequestTotal = init.lastRequestTotal ?? 0;
      this.pendingTraceRotation = init.pendingTraceRotation ?? false;
    }
  }

  /**
   * Runs a Task to completion, streaming out OmniMessage. `newMessages` is this call's
   * Prompt (only the newly added input, not the full history — history is maintained by the
   * stateful GenerativeModel); `opts.signal` is the abort signal, `opts.approve` is the
   * per-tool approval callback.
   * Docs: /docs/agent-loop § "The loop at a glance".
   */
  async *run(newMessages: OmniMessage[], opts?: RunOptions): AsyncGenerator<OmniMessage> {
    const signal = opts?.signal;
    // Default approval policy: deny (conservative). CLI/Web will inject a real callback (interactive or permission-mode based).
    const approve: ApproveFn = opts?.approve ?? (async () => "deny");

    // Merge the Task-boundary compaction summary (the new context's first input, merged with
    // this Prompt), the carry-over left over from the last interruption, and this call's new
    // input, to form this Request's input.
    const summary = this.pendingSummary;
    this.pendingSummary = null;
    const carryOver = this.pendingCarryOver;
    this.pendingCarryOver = [];
    const prefix = summary ? [summary, ...carryOver] : carryOver;
    const input = prefix.length ? [...prefix, ...newMessages] : newMessages;

    // Input is written to Trace (Prompt record, incl. audit trail) but not replayed to
    // the render layer. carry-over is not written to Trace: real messages (tool outputs etc.)
    // are already written when produced; synthetic content (flatten text, backfilled
    // placeholders) is **sent to the model only, never persisted** — Trace records only real
    // messages, and resumption replay best-effort reconstructs from original messages.
    // Exception: the compaction summary, which is the new
    // context's first input record, is written as usual.
    if (summary) await this.write(summary);
    for (const msg of newMessages) await this.write(msg);

    if (signal?.aborted) {
      // Aborted before the Request was issued: the input is held **as-is** as carry-over
      // (trailing-input semantics: input the Request never got to send is kept unchanged)
      // — not flattened, so replay matches in-process behavior and
      // multimodal input isn't lost. The message is already written to Trace, so it won't be
      // rewritten on the next send.
      this.pendingCarryOver = input;
      yield* this.emitAbort("aborted by user");
      return;
    }

    let turnCount = 0;
    // Each turn's LLM input: the first turn is the Prompt, later turns are the previous turn's
    // tool outputs.
    let nextInput: OmniMessage[] = input;

    for (;;) {
      // max_turns guard: emit a length notice and stop once exceeded.
      if (turnCount >= this.maxTurns) {
        // This turn's pending input (usually the previous turn's tool outputs) was never
        // submitted to the LLM: hold it as carry-over, to be resent merged with new input on
        // the next `run` (same as interruption-cleanup case A) — the previous turn's assistant
        // tool_call has already been committed by AgentHub, so discarding its paired output and
        // sending a fresh message would be rejected by the provider as an unanswered tool_use
        // (400, see issue #33).
        this.pendingCarryOver = nextInput;
        yield* this.emitMaxTurns();
        return;
      }
      turnCount += 1;

      // This turn's input. A timeout/malformed attempt is never committed to history by
      // AgentHub (an abnormally interrupted stream doesn't land in history), so reconnect
      // resends this turn's input unchanged, appending a `<turn_retried>` block carrying what
      // the failed attempt already produced — the model continues from there instead of
      // re-running tools; the tag is distinct from the user-interruption `<turn_aborted>`.
      const failedTurns: TurnResult[] = [];
      let attemptInput = nextInput;
      let reconnects = 0;
      let turn: TurnResult;

      for (;;) {
        // Both LLM and Environment handle errors internally and guarantee a complete, closed
        // output with no thrown exceptions; the engine doesn't handle exceptions —
        // it decides retry/resend purely from `outcome`.
        turn = yield* this.runTurn(attemptInput, approve, signal);

        // User interruption (the LLM stream was aborted, outcome=aborted, or `signal` fired
        // during tool execution): stop and hand control back to the user.
        if (signal?.aborted || turn.outcome.status === "aborted") {
          this.pendingCarryOver = this.buildCarryOver(attemptInput, turn);
          yield* this.emitAbort("aborted by user");
          return;
        }
        // Non-retryable error (auth/parameter etc.): stop and hand control back to the user;
        // the failure reason is written to the abort event / Trace.
        if (turn.outcome.status === "failed") {
          this.pendingCarryOver = this.buildCarryOver(attemptInput, turn);
          yield* this.emitAbort(`llm request error: ${turn.outcome.message ?? "unknown"}`);
          return;
        }
        // Completed normally.
        if (turn.outcome.status === "completed") break;

        // Only timeout / malformed remain: reconnect automatically within the same run. When
        // retries are exhausted or the backoff is interrupted, the retry input is held as-is as
        // carry-over (the original input is already written to Trace, so it isn't rewritten).
        // The frontend surfaces the retry process and count via request_end(timeout|malformed)
        // followed by the next request_begin.
        failedTurns.push(turn);
        attemptInput = this.withRetriedTurns(nextInput, failedTurns);
        if (reconnects >= this.maxReconnects) {
          this.pendingCarryOver = attemptInput;
          const reason = turn.outcome.status === "malformed" ? "malformed response" : "reconnect";
          yield* this.emitAbort(`${reason} failed after ${this.maxReconnects} retries`);
          return;
        }
        reconnects += 1;
        if (!(await this.backoff(reconnects, signal))) {
          this.pendingCarryOver = attemptInput;
          yield* this.emitAbort("aborted during reconnect backoff");
          return;
        }
      }

      // Compaction checkpoint: after every LLM Request produces token_usage. This also
      // applies mid-Task — when runTurn returns, all of this turn's
      // tool results are ready and paired with their tool_call.
      const midTask = turn.toolOutputs.length > 0;
      const compactionReason = this.compactionTrigger();
      if (compactionReason) {
        const mode = this.deps.compaction!.mode;
        if (mode === "discard") {
          // Once discarded, the current Task can't continue: if mid-Task, defer until this
          // Task ends.
          if (!midTask) {
            yield* this.discardContext(compactionReason);
            return;
          }
        } else {
          const result = yield* this.summarizeContext(
            compactionReason,
            midTask ? turn.toolOutputs : [],
            signal,
          );
          if (result.status === "aborted") {
            // User interrupted compaction: keep the original context; if mid-Task, hold the
            // tool outputs as carry-over per case A.
            if (midTask) {
              this.pendingCarryOver = this.buildCarryOver(attemptInput, turn);
              yield* this.emitAbort("aborted during compaction");
            }
            return;
          }
          if (result.status === "completed") {
            if (!midTask) {
              // Task boundary: the summary is merged with the next user Prompt as the new
              // context's first input.
              this.pendingSummary = result.summary!;
              return;
            }
            // Mid-Task: the summary itself becomes the new LLM object's first input (this
            // turn's tool results were already folded into the compaction request and absorbed
            // into the summary); continuation relies on the model's own next-step plan written
            // into the summary, with no hardcoded continuation instruction appended.
            await this.write(result.summary!);
            nextInput = [result.summary!];
            continue;
          }
          // failed: keep the original context and Trace index; the current Task continues and
          // retries on the next trigger (no fallback to discard).
        }
      }

      // No tool_call this turn -> the Task ends (the final reply has already been streamed out).
      if (!midTask) return;
      // Otherwise continue, using the tool outputs as the next turn's LLM input.
      nextInput = turn.toolOutputs;
    }
  }

  /**
   * User-initiated compaction request (e.g. a CLI command): reuses the automatic compaction
   * flow without checking thresholds (reason=manual). Only callable at a Task boundary (between
   * runs); streams out paired compaction events. No-op when compaction is not configured.
   *
   * Carry-over left over from an interruption is cleaned up here too: summarize folds it into
   * the compaction request (structured tool outputs keep their pairing with the already
   * committed tool_call, otherwise the compaction request itself would be rejected by the
   * provider as an unanswered tool_use, see issue #33; flatten text is absorbed into the
   * summary); discard drops the structured outputs paired with the old context, keeping only the
   * self-contained flatten text.
   */
  /**
   * Whether compaction is possible, and the **reason** when it isn't.
   *
   * `compact()` is a no-op and **yields no messages** in these cases; if the UI treats invoking
   * it as a successful start, it ends up waiting forever for a compaction banner that never
   * arrives — that's exactly how "/compact does nothing after an interruption" happens. Callers
   * (Web / CLI) should give feedback upfront based on this.
   *
   *   - `unsupported`: compaction capability is not configured;
   *   - `empty`: the current context hasn't completed a single turn (`sessionTurns` only
   *     increments when `token_usage` arrives — a turn only counts once the request finishes
   *     normally, so it's still 0 right after the first request is interrupted);
   *   - `just_compacted`: no new conversation since the last compaction. Both cases have
   *     `sessionTurns` === 0, but they mean two completely different things to the user and must
   *     not be conflated.
   */
  compactability(): CompactAvailability {
    if (!this.deps.compaction || !this.deps.createLLM) return "unsupported";
    if (this.sessionTurns > 0) return "ok";
    return this.fromCompaction ? "just_compacted" : "empty";
  }

  async *compact(opts?: { signal?: AbortSignal }): AsyncGenerator<OmniMessage> {
    if (!this.deps.compaction || !this.deps.createLLM) return;
    // The current context has no completed LLM turns: nothing to compact, return immediately.
    // This also guards against two /compact calls in a row — the new context is empty right
    // after the previous compaction, so running again would overwrite the not-yet-consumed
    // pendingSummary with an "empty summary," permanently losing the only record of the prior
    // conversation.
    if (this.sessionTurns === 0) return;
    if (this.deps.compaction.mode === "discard") {
      this.pendingCarryOver = this.pendingCarryOver.filter(
        (m) => (m.payload as { type?: string }).type !== "tool_call_output",
      );
      yield* this.discardContext("manual");
      return;
    }
    const result = yield* this.summarizeContext("manual", this.pendingCarryOver, opts?.signal);
    if (result.status === "completed") {
      this.pendingCarryOver = [];
      this.pendingSummary = result.summary!;
    }
  }

  /**
   * Linear backoff before a reconnect retry (base × retry number, numbering starts at 1);
   * returns false if the user interrupts during the backoff, so the caller can proceed to
   * interruption cleanup.
   */
  private backoff(attempt: number, signal?: AbortSignal): Promise<boolean> {
    const ms = this.reconnectBackoffMs * attempt;
    return new Promise<boolean>((resolve) => {
      if (signal?.aborted) {
        resolve(false);
        return;
      }
      const onAbort = (): void => {
        clearTimeout(timer);
        resolve(false);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve(true);
      }, ms);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  /**
   * Runs one LLM turn: consumes the LLM stream, approving each complete tool_call immediately;
   * "allow" runs it concurrently (without blocking further stream consumption/approval), "deny"
   * feeds back an aborted output. partial/complete tool_call_output is yielded in completion
   * order. Returns all of this turn's tool outputs (for the next turn) and whether it was
   * interrupted midway.
   * Docs: /docs/agent-loop § "Lifecycle of a turn".
   */
  private async *runTurn(
    input: OmniMessage[],
    approve: ApproveFn,
    signal?: AbortSignal,
  ): AsyncGenerator<OmniMessage, TurnResult> {
    const queue = new MergeQueue();
    // Tool outputs are collected in **completion order** (for streaming yield to the frontend);
    // the tool_calls' **original order** is recorded separately, and reordered back to original
    // order when fed into the next LLM turn (async tool calls: feedback order is preserved).
    const toolOutputs: OmniMessage[] = [];
    const toolCalls: OmniMessage<ToolCallPayload>[] = [];
    const callOrder: string[] = [];
    // This turn's complete thinking/text segments produced by the model (including partial
    // segments finalized on interruption), for carry-over flatten.
    const assistantSegments: OmniMessage[] = [];
    // This turn's LLM terminal state: taken from streamGenerate's generator return value.
    let outcome: LLMOutcome = { status: "completed" };

    // Driver task: consumes the LLM stream + approves one at a time + dispatches tool
    // execution. It is itself a producer.
    queue.addProducer();
    const drive = (async () => {
      try {
        // Request boundary events (replayability): start is
        // emitted when the request is issued, stop carries the terminal state at completion —
        // replay mechanically determines from these whether the turn was committed by AgentHub.
        const startEvt = requestBegin();
        queue.push(startEvt);
        await this.write(startEvt);
        // Iterate manually to capture the generator's **return value** (LLMOutcome); LLM
        // guarantees it never throws.
        const gen = this.llm.streamGenerate({
          newMessages: input,
          ...(signal ? { signal } : {}),
        });
        for (;;) {
          const res = await gen.next();
          if (res.done) {
            outcome = res.value;
            const stopEvt = requestEnd(outcome.status);
            queue.push(stopEvt);
            await this.write(stopEvt);
            break;
          }
          const msg = res.value;
          queue.push(msg);
          await this.write(msg);
          // token_usage means "this Request completed normally": record the context usage /
          // Session cumulative counts, and increment the Session turn count (counted per LLM
          // Request, across Tasks; used for compaction threshold checks).
          if (this.observeTokenUsage(msg)) this.sessionTurns += 1;
          // Collect complete thinking/text segments (including partial segments finalized on
          // interruption), for carry-over flatten.
          if (
            isCompleteModelMessage(msg) &&
            (msg.payload.type === "thinking" || msg.payload.type === "text")
          ) {
            assistantSegments.push(msg);
          }
          // Approve as soon as each real, complete tool_call finishes streaming. A tool_call
          // synthesized to close out an interruption carries a non-"completed" stop_reason (see
          // finishInterrupted): its arguments weren't fully emitted, and it exists only
          // for structural closure and observability — it isn't dispatched for execution, isn't
          // added to this turn's ledger, and gets no paired output backfilled: such a tool_call
          // was never committed to history by AgentHub, so there's nothing to pair. This turn
          // must then end with a non-completed outcome (only interruption closure produces such
          // a tool_call): timeout/malformed is cleaned up by reconnect resending the flatten
          // carry-over, failed/aborted exits directly.
          if (isCompleteModelMessage(msg) && msg.payload.type === "tool_call") {
            const tc = msg as OmniMessage<ToolCallPayload>;
            if (tc.payload.stop_reason !== "completed") continue;
            const toolCallId = tc.payload.tool_call_id;
            callOrder.push(toolCallId);
            toolCalls.push(tc);
            // Already interrupted: stop dispatching new tools, but keep consuming until the LLM
            // returns its outcome (the LLM will close out quickly and return aborted).
            if (signal?.aborted) continue;
            // The approval callback is injected externally (RunOptions.approve): any throw
            // collapses to deny (conservative), so the exception never escapes the engine —
            // otherwise it would propagate through session.run without building carry-over,
            // leaving the already-committed tool_use unanswered.
            let decision: ApprovalDecision;
            try {
              decision = await approve(tc);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              process.stderr.write(`[penguin] approve callback threw: ${message}; denying.\n`);
              decision = "deny";
            }
            if (signal?.aborted) continue;
            // approve is a callback; context_engine emits its decision as an approval_decision
            // OmniMessage: pushed to the stream for frontend rendering, and written to Trace.
            const decisionMsg = approvalDecision(decision, toolCallId);
            queue.push(decisionMsg);
            await this.write(decisionMsg);
            if (decision !== "allow") {
              // User denied: feed back an aborted output, indicating the tool call was
              // manually canceled.
              const denied = toolCallOutput({
                output: "Tool call denied by user.",
                toolCallId,
                stopReason: "aborted",
              });
              queue.push(denied);
              await this.write(denied);
              toolOutputs.push(denied);
              continue;
            }
            // Approved: run concurrently, without blocking further consumption of the LLM
            // stream or approval of the next tool.
            queue.addProducer();
            void this.executeOne(tc, queue, toolOutputs, signal, approve).finally(() => {
              queue.removeProducer();
            });
          }
        }
      } finally {
        queue.removeProducer();
      }
    })();

    // Single consumer: yield merged messages one at a time until all producers are done and
    // the queue is drained.
    for (;;) {
      const msg = await queue.next();
      if (msg === null) break;
      yield msg;
    }
    // Wait for the driver task to fully finish (state settles).
    await drive;

    // Feed into the next turn: reordered to the original tool_call order (each tool_call has
    // exactly one output, see the executeOne invariant).
    const byId = new Map<string, OmniMessage>();
    for (const out of toolOutputs) {
      const id = (out.payload as { tool_call_id?: string }).tool_call_id;
      if (id !== undefined) byId.set(id, out);
    }
    const orderedOutputs: OmniMessage[] = [];
    const seen = new Set<string>();
    for (const id of callOrder) {
      if (seen.has(id)) continue; // Dedupe: feed back exactly one output per tool_call_id, to preserve pairing
      seen.add(id);
      const out = byId.get(id);
      if (out) orderedOutputs.push(out);
    }
    return { toolOutputs: orderedOutputs, toolCalls, assistantSegments, outcome };
  }

  /**
   * Executes a single approved tool: streams its partial/complete tool_call_output (through the
   * queue), and collects the complete tool_call_output into toolOutputs.
   *
   * Environment is contracted to handle all errors internally: it guarantees exactly one
   * complete `tool_call_output` to close out and never throws. But since
   * EnvironmentInterface can be injected by consumers via a public API, if a contract-violating
   * exception escapes, this fire-and-forget promise would take down the process with an
   * unhandled rejection, and the missing output would leave the already-committed tool_use
   * unanswered (the next request gets rejected by the provider) — so a boundary safety net is
   * kept here, collapsing a contract-violating exception into a failed output. This guarantees
   * exactly one complete output per tool enters toolOutputs, keeping tool_use and tool_result
   * paired.
   */
  private async executeOne(
    toolCall: OmniMessage<ToolCallPayload>,
    queue: MergeQueue,
    toolOutputs: OmniMessage[],
    signal?: AbortSignal,
    approve?: ApproveFn,
  ): Promise<void> {
    let completed = false;
    try {
      for await (const out of this.deps.environment.executeTool({
        toolCall,
        ...(signal ? { signal } : {}),
        // Pass through the parent approval callback: run_subagent uses this so the child
        // Session inherits the parent Agent's approval mode.
        ...(approve ? { approve } : {}),
      })) {
        queue.push(out);
        // Nested-session messages carrying an origin: forwarded to the frontend as a stream;
        // their content is not written to the parent Trace (the child Session has its own
        // Trace). When a direct child session's (origin length 1) session_meta arrives, write a
        // subagent pointer event to the parent Trace (recording only the child Session id), so
        // reopening the session can recursively expand child Traces — pointers for grandchild
        // sessions are recorded by the child Trace itself, so only depth 1 is recognized here.
        // Never fed back — a child session's tool_call_output has no pairing with the parent's
        // tool_call, and feeding it back by mistake would be rejected by the Provider.
        if (out.origin && out.origin.length > 0) {
          if (isSessionMeta(out) && out.origin.length === 1) {
            await this.write(subagentEvent(out.origin[0]!));
          }
          continue;
        }
        await this.write(out);
        if (isCompleteModelMessage(out) && out.payload.type === "tool_call_output") {
          toolOutputs.push(out);
          completed = true;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (completed) {
        // Thrown only after the complete output was ready: pairing is intact, so just warn.
        process.stderr.write(`[penguin] environment threw after tool output: ${message}\n`);
        return;
      }
      const failed = toolCallOutput({
        output: `[tool error] ${message}`,
        toolCallId: toolCall.payload.tool_call_id,
        stopReason: "failed",
      });
      queue.push(failed);
      await this.write(failed);
      toolOutputs.push(failed);
    }
  }

  /** Max turns reached: emits a failed notice (streaming fragments + complete text) for CLI/frontend rendering. */
  private async *emitMaxTurns(): AsyncGenerator<OmniMessage> {
    // Reduce leading newlines: avoid stacking extra newlines before the text (comment #15).
    const text = `[reached max turns (${this.maxTurns}); stopping]`;
    const partials = [
      partialText("start"),
      partialText("delta", text),
      partialText("stop", "", "failed"),
    ];
    for (const partial of partials) {
      yield partial;
      await this.write(partial);
    }
    const note = assistantText(text, "failed");
    yield note;
    await this.write(note);
  }

  // -------------------------------------------------------------------------
  // Context compaction
  // -------------------------------------------------------------------------

  /**
   * Checks the compaction threshold: triggers once context usage (the most recent
   * token_usage's request.total) or the Session cumulative turn count **reaches** the threshold
   * (>=) — e.g. maxSessionTurns=1 compacts as soon as turn 1 completes, without waiting for the
   * next Task; when both are configured, either reaching its threshold triggers compaction.
   * Never triggers when compaction is not configured.
   * Docs: /docs/agent-loop § "Compaction".
   */
  private compactionTrigger(): CompactionReason | null {
    const settings = this.deps.compaction;
    if (!settings || !this.deps.createLLM) return null;
    if (settings.maxContextLength > 0 && this.lastRequestTotal >= settings.maxContextLength) {
      return "context";
    }
    if (settings.maxSessionTurns > 0 && this.sessionTurns >= settings.maxSessionTurns) {
      return "turns";
    }
    return null;
  }

  /** Records context usage and Session cumulative counts from a token_usage event; returns whether the message is a token_usage. */
  private observeTokenUsage(msg: OmniMessage): boolean {
    if (msg.type !== "event_msg") return false;
    const payload = msg.payload as Partial<TokenUsagePayload>;
    if (payload.type !== "token_usage") return false;
    if (payload.request) this.lastRequestTotal = payload.request.total;
    if (payload.session) this.lastSessionTokens = payload.session;
    return true;
  }

  /**
   * `discard` compaction: sends no compaction request, simply discards the old context —
   * swaps in a new LLM object and splits a new Trace file, with the next turn's input used
   * unchanged as the new object's first input. Only runs at a Task boundary (deferred by the
   * caller while mid-Task).
   */
  private async *discardContext(reason: CompactionReason): AsyncGenerator<OmniMessage> {
    yield* this.emitCompactionBegin(reason, "discard");
    yield* this.emitCompactionEnd(reason, "discard", "completed");
    await this.startNewContext();
  }

  /**
   * `summarize` compaction: appends the compaction Prompt to the **old** LLM object (first
   * folding in all of this turn's tool results when mid-Task, to keep tool_use/tool_result
   * pairing), then extracts the `<summary>` and wraps it as `<context_summary>` user text. The
   * compaction request's streamed output is not pushed to the Human output stream (it emits
   * paired compaction events, plus the compaction request's `token_usage` — positioned between
   * the two events, so the frontend can count compaction cost into its stats), but it is written
   * to the old Trace. timeout/malformed reconnect via the existing retry mechanism, collapsing
   * to failed once retries are exhausted; on failure/abort, the original context and Trace index
   * are kept — it does not fall back to discard.
   * Docs: /docs/agent-loop § "Compaction".
   */
  private async *summarizeContext(
    reason: CompactionReason,
    pendingToolOutputs: OmniMessage[],
    signal?: AbortSignal,
  ): AsyncGenerator<OmniMessage, CompactionResult> {
    const settings = this.deps.compaction!;
    yield* this.emitCompactionBegin(reason, "summarize");

    // Compaction request input: this turn's tool results (mid-Task) or leftover interruption
    // carry-over, plus the compaction Prompt. The compaction exchange is written to the old
    // Trace (traceable but not pushed to the user); tool results were already written when
    // executed and aren't recorded again, while carry-over's not-yet-written synthetic content
    // (flatten text, backfilled placeholders) and the compaction Prompt are written now.
    const prompt = userText(settings.prompt);
    const input = [...pendingToolOutputs, prompt];
    await this.write(prompt);

    let reconnects = 0;
    for (;;) {
      if (signal?.aborted) {
        yield* this.emitCompactionEnd(reason, "summarize", "aborted");
        return { status: "aborted" };
      }
      const attempt = await this.runCompactionRequest(input, signal);
      if (attempt.status === "completed") {
        // The compaction request's token_usage is pushed to the Human output stream (already
        // written to Trace in runCompactionRequest, so here it's only yielded, not rewritten);
        // the frontend uses this to count compaction cost into stats and display it on the
        // compaction-complete line.
        if (attempt.usage) yield attempt.usage;
        // Lenient extraction: if the output lacks a <summary> tag, use the entire compaction
        // output as-is rather than treating it as a failure.
        const summary = userText(
          `<context_summary>\n${extractSummary(attempt.text)}\n</context_summary>`,
        );
        yield* this.emitCompactionEnd(reason, "summarize", "completed");
        await this.startNewContext();
        return { status: "completed", summary };
      }
      if (attempt.status === "aborted" || attempt.status === "failed") {
        yield* this.emitCompactionEnd(reason, "summarize", attempt.status);
        return { status: attempt.status };
      }
      // timeout / malformed: retried via reconnect. The compaction request was never committed
      // by AgentHub (case B), so the original input is resent unchanged.
      if (reconnects >= this.maxReconnects) {
        yield* this.emitCompactionEnd(reason, "summarize", "failed");
        return { status: "failed" };
      }
      reconnects += 1;
      const ok = await this.backoff(reconnects, signal);
      if (!ok) {
        yield* this.emitCompactionEnd(reason, "summarize", "aborted");
        return { status: "aborted" };
      }
    }
  }

  /**
   * Issues one compaction request (an ordinary LLM Request): consumes the old LLM object's
   * streamed output but **does not push it to the Human output stream** (except `token_usage`
   * — captured and handed back via the return value for summarizeContext to yield); complete
   * messages and events are written to the old Trace; complete text segments are collected as
   * the compaction output. Token usage is counted into the Session cumulative totals (recorded
   * via observeTokenUsage, for the new object to carry forward).
   */
  private async runCompactionRequest(
    input: OmniMessage[],
    signal?: AbortSignal,
  ): Promise<{ status: StopReason; text: string; usage: OmniMessage | null }> {
    // The compaction request is itself an ordinary Request, emitting paired request events —
    // written to the (old) Trace only, not pushed to the stream, keeping the compaction process
    // invisible to Human.
    await this.write(requestBegin());
    const gen = this.llm.streamGenerate({
      newMessages: input,
      ...(signal ? { signal } : {}),
    });
    let text = "";
    let usage: OmniMessage | null = null;
    for (;;) {
      const res = await gen.next();
      if (res.done) {
        await this.write(requestEnd(res.value.status));
        return { status: res.value.status, text, usage };
      }
      const msg = res.value;
      await this.write(msg);
      if (this.observeTokenUsage(msg)) usage = msg;
      if (isCompleteModelMessage(msg) && msg.payload.type === "text") {
        text += (msg.payload as TextPayload).text;
      }
    }
  }

  /**
   * Opens a new model context after successful compaction: swaps in a new LLM object (carrying
   * forward the Session cumulative token counts), resets the Session turn count and context
   * usage counter. Trace **does not** split files immediately — that's deferred until the next
   * message that needs writing, when it rotates and opens with a session_meta (see `write`),
   * avoiding an empty file if no further messages follow the compaction.
   */
  private async startNewContext(): Promise<void> {
    this.pendingTraceRotation = true;
    this.llm = this.deps.createLLM!(this.lastSessionTokens);
    this.sessionTurns = 0;
    this.lastRequestTotal = 0;
    // Lets compactability() distinguish "just compacted" from "hasn't chatted yet" — both have
    // sessionTurns === 0, but they mean two completely different things to the user (being told
    // "no completed conversation turns yet" right after compacting is as good as saying nothing).
    this.fromCompaction = true;
  }

  /** Yields and records a compaction start event (carrying reason/mode/current context usage/Session cumulative turns). */
  private async *emitCompactionBegin(
    reason: CompactionReason,
    mode: CompactionMode,
  ): AsyncGenerator<OmniMessage> {
    const msg = compactionBegin({
      reason,
      mode,
      context: this.lastRequestTotal,
      turns: this.sessionTurns,
    });
    yield msg;
    await this.write(msg);
  }

  /** Yields and records a compaction stop event (carrying the result status; non-completed means compaction was abandoned). */
  private async *emitCompactionEnd(
    reason: CompactionReason,
    mode: CompactionMode,
    status: StopReason,
  ): AsyncGenerator<OmniMessage> {
    const msg = compactionEnd({ reason, mode, status });
    yield msg;
    await this.write(msg);
  }

  /** Interruption: emits an abort event. Cleanup/resending is managed centrally by `run` via carry-over; the LLM history is never touched again. */
  private async *emitAbort(reason: string): AsyncGenerator<OmniMessage> {
    const msg = abortEvent(reason);
    yield msg;
    await this.write(msg);
  }

  /**
   * Builds the interruption resend content (carry-over, interruption cleanup)
   * based on the LLM's terminal state. Used only for the **exit** cleanup of
   * aborted / failed (reconnect retry doesn't go through here — retry input is assembled by
   * withRetriedTurns, appending `<turn_retried>` with the failed attempt's output, distinct
   * from the user-interruption `<turn_aborted>`):
   * - Model output completed (case A, outcome=completed): AgentHub already committed an
   *   assistant turn containing `tool_call`, so it can only be resent as a structured
   *   `tool_call_output` to pair with it (cannot flatten, or the already-committed tool_call
   *   would be left unanswered and rejected).
   * - Model output incomplete (case B): the `tool_call_output` in this turn's input (paired
   *   with the previous completed turn) is kept as-is; the text input and this turn's
   *   thinking/text/tool call/result are flattened into a single `<turn_aborted>` plain-text
   *   user message.
   * Docs: /docs/agent-loop § "Interruption and carry-over".
   */
  private buildCarryOver(attemptInput: OmniMessage[], turn: TurnResult): OmniMessage[] {
    if (turn.outcome.status === "completed") {
      // Case A: every **committed** tool_call must have a paired output. If execution was
      // interrupted and some tool_calls were committed but never dispatched/completed, backfill
      // an interrupted-state placeholder for each, avoiding an unanswered tool_use in the next
      // turn that the provider would reject.
      const haveIds = new Set(
        turn.toolOutputs.map((o) => (o.payload as { tool_call_id?: string }).tool_call_id),
      );
      const backfill = turn.toolCalls
        .filter((tc) => !haveIds.has(tc.payload.tool_call_id))
        .map((tc) =>
          toolCallOutput({
            output: "[interrupted: tool aborted by user]",
            toolCallId: tc.payload.tool_call_id,
            stopReason: "aborted",
          }),
        );
      // Placeholders are sent to the model only and not written to Trace (synthetic carry-over
      // isn't persisted); resumption replay re-synthesizes placeholders as needed to guarantee
      // pairing (pairing fallback). Real outputs were already
      // written when produced.
      return backfill.length ? [...turn.toolOutputs, ...backfill] : turn.toolOutputs;
    }
    return this.flattenCarryOver(
      attemptInput,
      turn.assistantSegments,
      turn.toolCalls,
      turn.toolOutputs,
    );
  }

  /**
   * Case B: flattens this attempt's input and its produced content into carry-over. Structured
   * `tool_call_output` in the input (paired with the previous completed turn) is kept as-is;
   * everything else (text input, model thinking/text, this attempt's tool calls/results) is
   * transcribed into a single `<turn_aborted>` plain-text user message (includes all
   * completed and incomplete messages, including partial thinking/text). If the input text is
   * itself already a `<turn_aborted>` block (from a previous attempt or a previous run's
   * carry-over), its content is unwrapped and merged in, keeping a single-level structure.
   *
   * TODO(multimodal): only text input is currently kept — `image_url` / `inline_data` input is
   * lost during flatten (the `<turn_aborted>` structure has no corresponding transcription yet);
   * multimodal carry-over support to be added later.
   */
  private flattenCarryOver(
    attemptInput: OmniMessage[],
    assistantSegments: OmniMessage[],
    toolCalls: OmniMessage<ToolCallPayload>[],
    toolOutputs: OmniMessage[],
  ): OmniMessage[] {
    const structured = attemptInput.filter(
      (m) => (m.payload as { type?: string }).type === "tool_call_output",
    );
    const textInputs = attemptInput.filter((m) => (m.payload as { type?: string }).type === "text");
    const flattened = userText(
      this.buildTurnAbortedText(textInputs, assistantSegments, toolCalls, toolOutputs),
    );
    // flatten is sent to the model only and not written to Trace (synthetic carry-over isn't
    // persisted): resumption replay resends the discarded turn's **original input** as-is
    // (best-effort), with no dependency on this synthetic message.
    return [...structured, flattened];
  }

  /** Transcribes the interrupted turn's input, model thinking/text, and tool calls/results into a single `<turn_aborted>` plain-text block. */
  private buildTurnAbortedText(
    textInputs: OmniMessage[],
    assistantSegments: OmniMessage[],
    toolCalls: OmniMessage<ToolCallPayload>[],
    toolOutputs: OmniMessage[],
  ): string {
    const lines: string[] = ["<turn_aborted>"];
    for (const m of textInputs) {
      const t = (m.payload as TextPayload).text;
      // If this text is itself already a synthetic block — a previous run's `<turn_aborted>`,
      // or this turn's reconnect-appended `<turn_retried>` — extract its inner lines and merge
      // them in directly, avoiding layered nesting / unbounded growth (keeping a single-level
      // structure).
      const inner = unwrapSyntheticBlock(t);
      if (inner !== null) {
        if (inner) lines.push(inner);
      } else {
        lines.push(`  <user_input>${t}</user_input>`);
      }
    }
    lines.push(...transcribeTurnLines(assistantSegments, toolCalls, toolOutputs));
    lines.push("</turn_aborted>");
    return lines.join("\n");
  }

  /**
   * Assembles the reconnect retry input: the original input is kept as-is (structure and
   * multimodal content preserved), with a `<turn_retried>` text appended at the end carrying
   * each failed attempt's thinking/text and tool calls/results produced so far; if nothing has
   * been produced yet, it's just the original input. The synthetic message is sent to the model
   * only and not written to Trace (same rule as flatten carry-over).
   * Docs: /docs/agent-loop § "Automatic reconnect".
   */
  private withRetriedTurns(input: OmniMessage[], failedTurns: TurnResult[]): OmniMessage[] {
    const lines = failedTurns.flatMap((t) =>
      transcribeTurnLines(t.assistantSegments, t.toolCalls, t.toolOutputs),
    );
    if (lines.length === 0) return input;
    return [...input, userText(["<turn_retried>", ...lines, "</turn_retried>"].join("\n"))];
  }

  /**
   * Trace writes are **best-effort**: observability should never interrupt the ReAct
   * loop, so write failures only warn rather than throw. The first write after compaction first
   * performs the deferred Trace rotation: splitting the file and opening it with session_meta.
   */
  private async write(msg: OmniMessage): Promise<void> {
    if (!this.deps.trace) return;
    if (this.pendingTraceRotation) {
      this.pendingTraceRotation = false;
      try {
        if (this.deps.trace.rotate) await this.deps.trace.rotate();
        if (this.deps.sessionMeta) await this.deps.trace.write(this.deps.sessionMeta);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[trace] rotate failed: ${message}\n`);
      }
    }
    try {
      await this.deps.trace.write(msg);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[trace] write failed: ${message}\n`);
    }
  }
}

/**
 * If the text is an engine-synthesized whole block (`<turn_aborted>` or `<turn_retried>`),
 * strips the outer tags and returns the inner lines (may be an empty string); otherwise returns
 * null. Both kinds of synthetic blocks use identical inner markup (thinking/text/tool_call/
 * tool_call_output), so it can be merged directly into a new block while keeping a single-level
 * structure.
 */
function unwrapSyntheticBlock(text: string): string | null {
  const m = /^<(turn_aborted|turn_retried)>\n?([\s\S]*?)\n?<\/\1>\s*$/.exec(text);
  return m ? m[2]! : null;
}

/** Transcribes the model's produced thinking/text and tool calls/results into tagged lines (shared by `<turn_aborted>`/`<turn_retried>`). */
function transcribeTurnLines(
  assistantSegments: OmniMessage[],
  toolCalls: OmniMessage<ToolCallPayload>[],
  toolOutputs: OmniMessage[],
): string[] {
  const lines: string[] = [];
  // The model's produced thinking/text (including partial segments finalized on interruption),
  // written in production order.
  for (const seg of assistantSegments) {
    const p = seg.payload as { type?: string };
    if (p.type === "thinking") {
      lines.push(`  <thinking>${(seg.payload as ThinkingPayload).thinking}</thinking>`);
    } else if (p.type === "text") {
      lines.push(`  <text>${(seg.payload as TextPayload).text}</text>`);
    }
  }
  for (const tc of toolCalls) {
    const p = tc.payload;
    lines.push(`  <tool_call name="${p.name}" id="${p.tool_call_id}">${p.arguments}</tool_call>`);
  }
  for (const out of toolOutputs) {
    const p = out.payload as ToolCallOutputPayload;
    lines.push(
      `  <tool_call_output id="${p.tool_call_id}" status="${p.stop_reason ?? "completed"}">${p.output}</tool_call_output>`,
    );
  }
  return lines;
}

/**
 * Extracts the summary within `<summary></summary>` from compaction output; when the tag is
 * missing, leniently uses the entire output as-is (not treated as a failure). Also used by
 * Session resumption's "compaction closure" replay to
 * reconstruct the `<context_summary>` pending input from the old Trace's compaction output.
 */
export function extractSummary(raw: string): string {
  const match = /<summary>([\s\S]*?)<\/summary>/.exec(raw);
  return (match ? match[1]! : raw).trim();
}
