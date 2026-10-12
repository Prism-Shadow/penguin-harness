/**
 * AmspTranslator: the Session's live stream, projected onto AMSP.
 *
 * What a run handler subscribes to is the Session's channel (runtime/channel.ts): OmniMessage
 * envelopes as the engine yields them, and the server's own events (`server_event`). This class
 * turns one channel event at a time into the AMSP events it stands for — usually one, often none —
 * and ends the run with exactly one `run.done` when the Session goes idle. It is pure: no I/O, a
 * clock passed in, nothing read but what it is fed.
 *
 * The rules it keeps (the protocol reference spells them out):
 * - Fragments and complete items are forwarded as they are, never reconciled: `partial_*`
 *   start/delta become `K.delta`, a `stop` fragment becomes nothing, and the complete message
 *   becomes `K.done`. No `.done` is built from fragments; a tool call's `arguments` stay the raw
 *   JSON string.
 * - The run's own input — the envelopes the run handler submitted, which the manager publishes at
 *   launch — is dropped, and nothing on the channel counts before it: whatever the Session
 *   published earlier (an idle `task_state` a child's state change re-published, a background
 *   child's output) is not this run's.
 * - Request ordinals, held usage and the compaction flag are kept per origin: a child Session
 *   counts its own requests and never disturbs the main Session's.
 * - Usage: a `token_usage` precedes its `request_end` and is stamped on that `request.done`, or,
 *   inside a compaction, summed onto its `compaction.done`. `run.done.usage` sums every stamped
 *   usage of the run, children's included; `session_usage` is the main Session's cumulative count
 *   as the engine last reported it.
 * - Inside a compaction the summary rides as `summary.*`; the compaction request's thinking is
 *   not forwarded (only `summary.*` items sit between `compaction.started` and
 *   `compaction.done`).
 * - `run.done.status`: the main Session's `abort` wins (`aborted`, its error code); else its last
 *   unrecovered terminal record — a non-completed `request_end` with no planned retry, or a
 *   non-completed `compaction_end` no later request followed — with that record's error; else
 *   `fatal` without an error when the main Session's last assistant text ended `fatal` (the
 *   engine's max-turns notice); else `completed`.
 */
import type {
  AbortPayload,
  ApprovalDecisionPayload,
  CompactionBeginPayload,
  CompactionEndPayload,
  ErrorInfo,
  HookPayload,
  ImageUrlPayload,
  InlineDataPayload,
  InlineThinkingPayload,
  McpConnectBeginPayload,
  McpConnectEndPayload,
  OmniMessage,
  PartialTextPayload,
  PartialThinkingPayload,
  PartialToolCallOutputPayload,
  PartialToolCallPayload,
  RequestEndPayload,
  SessionMetaPayload,
  TextPayload,
  ThinkingPayload,
  TokenCounts as OmniTokenCounts,
  TokenUsagePayload,
  ToolCallOutputPayload,
  ToolCallPayload,
  ToolListReadyPayload,
} from "@prismshadow/penguin-core";
import type { AmspError, AmspEvent, RunDone, StopReason, TokenCounts } from "@prismshadow/amsp";
import type { ServerEvent } from "../api/types.js";
import type { ChannelEvent } from "../runtime/channel.js";

/** The terminal record a run's status is read from (main Session only). */
interface Terminal {
  status: StopReason;
  error?: AmspError;
}

/** `{ at, origin? }`, the head every AMSP event carries. */
type Head = { at: string; origin?: string[] };

const zero = (): TokenCounts => ({ cache_read: 0, cache_write: 0, output: 0, total: 0 });

function counts(c: OmniTokenCounts): TokenCounts {
  return { cache_read: c.cache_read, cache_write: c.cache_write, output: c.output, total: c.total };
}

function add(a: TokenCounts, b: TokenCounts): TokenCounts {
  return {
    cache_read: a.cache_read + b.cache_read,
    cache_write: a.cache_write + b.cache_write,
    output: a.output + b.output,
    total: a.total + b.total,
  };
}

/** The record's error pair as AMSP's one error shape; absent when the record names no cause. */
function errorOf(p: ErrorInfo): AmspError | undefined {
  if (p.error_code === undefined && p.error_message === undefined) return undefined;
  return { code: p.error_code ?? "unknown", message: p.error_message ?? "" };
}

/** `error` as an optional property: spread into an event so an absent error leaves no key. */
function errorProp(error: AmspError | undefined): { error?: AmspError } {
  return error === undefined ? {} : { error };
}

export interface AmspTranslatorOptions {
  /** The clock server-originated events (`run.done`, `approval.requested`) are stamped with. */
  now?: () => Date;
}

export class AmspTranslator {
  private readonly now: () => Date;
  /** The submitted input envelopes, serialized: each is dropped once when its echo arrives. */
  private readonly echoes: string[];
  /** Whether this run's input has been seen on the channel: nothing before it is this run's. */
  private started = false;
  private finished = false;
  /** Per origin (joined chain; "" = the main Session): the current request ordinal. */
  private readonly ordinals = new Map<string, number>();
  /** Per origin: the `token_usage` waiting for its `request_end`. */
  private readonly heldUsage = new Map<string, TokenCounts>();
  /** Per origin inside a compaction: the usage its attempts have reported so far. */
  private readonly compactions = new Map<string, TokenCounts | null>();
  private requests = 0;
  private usage: TokenCounts = zero();
  private sessionUsage: TokenCounts | null = null;
  private abort: AmspError | null = null;
  private terminal: Terminal | null = null;
  /** stop_reason of the main Session's last assistant `text` (the max-turns notice ends `fatal`). */
  private lastMainText: StopReason | null = null;

  /**
   * `input` is exactly what the run handler hands `startTask`: the manager publishes those
   * envelopes at launch, and their serialized form is how their echo is recognized.
   */
  constructor(input: readonly OmniMessage[], opts: AmspTranslatorOptions = {}) {
    this.now = opts.now ?? (() => new Date());
    this.echoes = input.map((m) => JSON.stringify(m));
  }

  /** Whether `run.done` has been produced; nothing is translated after it. */
  get done(): boolean {
    return this.finished;
  }

  /**
   * Opens the run without waiting for the input's echo: for a handler that followed the Session
   * to a new id (a Trace-less self-heal), whose channel received the input before the handler
   * could subscribe to it.
   */
  begin(): void {
    this.started = true;
  }

  /** One channel event in, the AMSP events it stands for out (possibly none). */
  feed(evt: ChannelEvent): AmspEvent[] {
    if (this.finished) return [];
    if (evt.event === "server_event") {
      return this.started ? this.serverEvent(JSON.parse(evt.data) as ServerEvent) : [];
    }
    if (evt.event !== undefined) return [];
    const echo = this.echoes.indexOf(evt.data);
    if (echo >= 0) {
      this.echoes.splice(echo, 1);
      this.started = true;
      return [];
    }
    if (!this.started) return [];
    return this.message(JSON.parse(evt.data) as OmniMessage);
  }

  /**
   * Ends the run on a failure of the server's own (the handler could not go on driving it): a
   * `run.done` `fatal` carrying `error`, with the usage counted so far.
   */
  fail(error: AmspError): RunDone {
    this.finished = true;
    return this.runDone("fatal", error);
  }

  private serverEvent(event: ServerEvent): AmspEvent[] {
    if (event.type === "task_state") {
      // `running` is re-published mid-run (queue, steering, children's state): only idle ends it.
      return event.state === "idle" ? [this.finish()] : [];
    }
    if (event.type === "approval_request") {
      const call = event.toolCall.payload;
      return [
        {
          type: "approval.requested",
          at: this.now().toISOString(),
          ...(event.origin !== undefined && event.origin.length > 0
            ? { origin: [...event.origin] }
            : {}),
          tool_call: {
            tool_call_id: call.tool_call_id,
            name: call.name,
            arguments: call.arguments,
          },
        },
      ];
    }
    return [];
  }

  private finish(): RunDone {
    this.finished = true;
    if (this.abort !== null) return this.runDone("aborted", this.abort);
    if (this.terminal !== null) return this.runDone(this.terminal.status, this.terminal.error);
    if (this.lastMainText === "fatal") return this.runDone("fatal");
    return this.runDone("completed");
  }

  private runDone(status: StopReason, error?: AmspError): RunDone {
    return {
      type: "run.done",
      at: this.now().toISOString(),
      status,
      ...errorProp(error),
      requests: this.requests,
      usage: { ...this.usage },
      session_usage: this.sessionUsage === null ? null : { ...this.sessionUsage },
    };
  }

  private message(msg: OmniMessage): AmspEvent[] {
    const origin = msg.origin !== undefined && msg.origin.length > 0 ? [...msg.origin] : undefined;
    const key = origin === undefined ? "" : origin.join("/");
    const main = origin === undefined;
    const head: Head = { at: msg.timestamp, ...(origin !== undefined ? { origin } : {}) };
    const compacting = this.compactions.has(key);

    if (msg.type === "session_meta") {
      const p = msg.payload as SessionMetaPayload;
      const contextWindow = p.model_context_window;
      return [
        {
          type: "context.opened",
          ...head,
          session_id: p.session_id,
          provider: p.provider,
          model_id: p.model_id,
          context_window: typeof contextWindow === "number" ? contextWindow : "unknown",
        },
      ];
    }

    const kind = (msg.payload as { type: string }).type;
    switch (kind) {
      case "partial_text": {
        const p = msg.payload as PartialTextPayload;
        if (p.event_type === "stop") return [];
        return compacting
          ? [{ type: "summary.delta", ...head, text: p.text }]
          : [{ type: "text.delta", ...head, role: "assistant", text: p.text }];
      }
      case "text": {
        const p = msg.payload as TextPayload;
        const stop = p.stop_reason ?? "completed";
        if (p.role === "user") {
          return [
            {
              type: "text.done",
              ...head,
              role: "user",
              text: p.text,
              stop_reason: stop,
              ...(p.sender !== undefined ? { sender: p.sender } : {}),
            },
          ];
        }
        if (compacting) return [{ type: "summary.done", ...head, text: p.text, stop_reason: stop }];
        if (main) this.lastMainText = stop;
        return [{ type: "text.done", ...head, role: "assistant", text: p.text, stop_reason: stop }];
      }
      case "partial_thinking": {
        const p = msg.payload as PartialThinkingPayload;
        if (p.event_type === "stop" || compacting) return [];
        return [{ type: "thinking.delta", ...head, thinking: p.thinking }];
      }
      case "thinking": {
        const p = msg.payload as ThinkingPayload;
        if (compacting) return [];
        return [
          {
            type: "thinking.done",
            ...head,
            thinking: p.thinking,
            stop_reason: p.stop_reason ?? "completed",
          },
        ];
      }
      case "partial_tool_call": {
        const p = msg.payload as PartialToolCallPayload;
        if (p.event_type === "stop") return [];
        return [
          {
            type: "tool_call.delta",
            ...head,
            tool_call_id: p.tool_call_id,
            name: p.name,
            arguments: p.arguments,
          },
        ];
      }
      case "tool_call": {
        const p = msg.payload as ToolCallPayload;
        return [
          {
            type: "tool_call.done",
            ...head,
            tool_call_id: p.tool_call_id,
            name: p.name,
            arguments: p.arguments,
            stop_reason: p.stop_reason ?? "completed",
          },
        ];
      }
      case "partial_tool_call_output": {
        const p = msg.payload as PartialToolCallOutputPayload;
        if (p.event_type === "stop") return [];
        return [
          {
            type: "tool_result.delta",
            ...head,
            tool_call_id: p.tool_call_id,
            output: p.output ?? "",
            ...(p.images !== undefined ? { images: [...p.images] } : {}),
          },
        ];
      }
      case "tool_call_output": {
        const p = msg.payload as ToolCallOutputPayload;
        return [
          {
            type: "tool_result.done",
            ...head,
            tool_call_id: p.tool_call_id,
            output: p.output,
            ...(p.images !== undefined ? { images: [...p.images] } : {}),
            stop_reason: p.stop_reason ?? "completed",
          },
        ];
      }
      case "image_url": {
        const p = msg.payload as ImageUrlPayload;
        return [{ type: "image_url.done", ...head, role: "user", image_url: p.image_url }];
      }
      case "inline_data": {
        const p = msg.payload as InlineDataPayload;
        return [
          {
            type: "inline_data.done",
            ...head,
            role: p.role,
            mime_type: p.mime_type,
            data: p.data,
            stop_reason: p.stop_reason ?? "completed",
          },
        ];
      }
      case "inline_thinking": {
        const p = msg.payload as InlineThinkingPayload;
        return [
          {
            type: "inline_thinking.done",
            ...head,
            mime_type: p.mime_type,
            data: p.data,
            stop_reason: p.stop_reason ?? "completed",
          },
        ];
      }
      case "approval_decision": {
        const p = msg.payload as ApprovalDecisionPayload;
        return [
          { type: "approval.decided", ...head, tool_call_id: p.tool_call_id, decision: p.decision },
        ];
      }
      case "abort": {
        const p = msg.payload as AbortPayload;
        if (main) {
          this.abort = {
            code: p.error_code ?? "user_abort",
            message: p.error_message ?? p.reason ?? "The run was interrupted.",
          };
        }
        return [];
      }
      case "request_begin": {
        const n = (this.ordinals.get(key) ?? 0) + 1;
        this.ordinals.set(key, n);
        this.requests += 1;
        // The run went on: a compaction that failed at a Task boundary was not its end.
        if (main) this.terminal = null;
        return [{ type: "request.started", ...head, request: n }];
      }
      case "token_usage": {
        const p = msg.payload as TokenUsagePayload;
        const request = counts(p.request);
        if (compacting) {
          const sum = this.compactions.get(key) ?? null;
          this.compactions.set(key, sum === null ? request : add(sum, request));
        } else {
          this.heldUsage.set(key, request);
        }
        if (main) this.sessionUsage = counts(p.session);
        return [];
      }
      case "request_end": {
        const p = msg.payload as RequestEndPayload;
        const usage = this.heldUsage.get(key) ?? null;
        this.heldUsage.delete(key);
        if (usage !== null) this.usage = add(this.usage, usage);
        const error = errorOf(p);
        if (main && p.status !== "completed" && p.retry_in_ms === undefined) {
          this.terminal = { status: p.status, ...errorProp(error) };
        }
        return [
          {
            type: "request.done",
            ...head,
            request: this.ordinals.get(key) ?? 0,
            status: p.status,
            usage,
            ...errorProp(error),
            ...(p.attempt !== undefined ? { attempt: p.attempt } : {}),
            ...(p.retry_in_ms !== undefined ? { retry_in_ms: p.retry_in_ms } : {}),
          },
        ];
      }
      case "compaction_begin": {
        const p = msg.payload as CompactionBeginPayload;
        this.compactions.set(key, null);
        return [
          {
            type: "compaction.started",
            ...head,
            reason: p.reason,
            mode: p.mode,
            context: p.context,
            turns: p.turns,
          },
        ];
      }
      case "compaction_end": {
        const p = msg.payload as CompactionEndPayload;
        const usage = this.compactions.get(key) ?? null;
        this.compactions.delete(key);
        if (usage !== null) this.usage = add(this.usage, usage);
        const error = errorOf(p);
        if (main && p.status !== "completed") {
          this.terminal = { status: p.status, ...errorProp(error) };
        }
        return [
          {
            type: "compaction.done",
            ...head,
            reason: p.reason,
            mode: p.mode,
            status: p.status,
            usage,
            ...errorProp(error),
            ...(p.attempt !== undefined ? { attempt: p.attempt } : {}),
          },
        ];
      }
      case "hook": {
        const p = msg.payload as HookPayload;
        return [
          {
            type: "hook.fired",
            ...head,
            hook: p.hook,
            name: p.name,
            ...(p.decision !== undefined ? { decision: p.decision } : {}),
            ...(p.reason !== undefined ? { reason: p.reason } : {}),
            ...(p.output !== undefined ? { output: { ...p.output } } : {}),
          },
        ];
      }
      case "mcp_connect_begin": {
        const p = msg.payload as McpConnectBeginPayload;
        return [{ type: "mcp_connect.started", ...head, servers: [...p.servers] }];
      }
      case "mcp_connect_end": {
        const p = msg.payload as McpConnectEndPayload;
        return [
          {
            type: "mcp_connect.done",
            ...head,
            status: p.status,
            results: p.results.map((r) => ({
              server: r.server,
              transport: r.transport,
              status: r.status,
              duration_ms: r.duration_ms,
              ...(r.tools !== undefined ? { tools: r.tools } : {}),
              ...errorProp(errorOf(r)),
            })),
            ...errorProp(errorOf(p)),
          },
        ];
      }
      case "tool_list_ready": {
        const p = msg.payload as ToolListReadyPayload;
        return [{ type: "tools.ready", ...head, tools: p.tools.map((t) => ({ ...t })) }];
      }
      // `subagent` pointers are Trace-only; anything else is not part of AMSP.
      default:
        return [];
    }
  }
}
