/**
 * Prompt-cache awareness helpers.
 *
 * What these measure: the harness's half of prompt caching. A provider serves a cached prefix
 * only when the next request repeats the previous one byte for byte from the front — tools,
 * then the system prompt, then the messages — so every request the engine assembles has to be
 * a pure extension of the one before it. `recordingModel` drives a real `GenerativeModel`
 * whose provider client is replaced by a scripted stream, records each request in the exact
 * shape the client would put on the wire (the provider transforms, not the internal UniMessage
 * form), and `diagnoseCacheMiss` reports the earliest divergence between two consecutive
 * requests the way a provider's cache diagnostics report a miss reason.
 *
 * What they deliberately do not measure: everything the provider owns — cache lifetime, the
 * lookback over recent breakpoints, the minimum cacheable prefix size, and whether a prefix
 * that could hit actually did. Those need a live endpoint. The invariants here hold offline,
 * and they are the only half the harness controls.
 */
import type { UniConfig, UniEvent, UniMessage } from "@prismshadow/agenthub";
import type { GenerativeModelConfig } from "../../src/interfaces/index.js";
import { GenerativeModel } from "../../src/llm/index.js";

/** Response tokens reported by every scripted reply (the input side is what the tests steer). */
const SCRIPTED_RESPONSE_TOKENS = 1;
/** Input tokens a scripted reply reports when it names none. */
const DEFAULT_PROMPT_TOKENS = 10;
/** Rough characters-per-token ratio, only used to size the input a divergence invalidates. */
const CHARS_PER_TOKEN = 4;
/** Request config keys that do not take part in the cached prefix. */
const NON_PREFIX_CONFIG_KEYS = ["max_tokens", "stream"];

/**
 * One scripted assistant reply. The blocks are emitted in the order a Claude response streams
 * them: thinking (closed by its signature), then text, then the tool calls.
 */
export interface ScriptedReply {
  text?: string;
  thinking?: { text: string; signature: string };
  toolCalls?: { id: string; name: string; args: Record<string, unknown> }[];
  /** Uncached input tokens this request reports (the compaction threshold reads this). */
  promptTokens?: number;
  /** Cache-read input tokens this request reports. */
  cachedTokens?: number;
  /**
   * How the request ends: cleanly, with a transport drop after the text (the engine
   * reconnects), or hanging after the text until the caller's signal aborts it.
   */
  outcome?: "completed" | "retryable-after-text" | "abort-after-text";
}

/** One request as the provider client would have sent it. */
export interface RecordedRequest {
  index: number;
  /** The full message list handed to the client (AgentHub's stateful history plus this turn). */
  messages: UniMessage[];
  /** The resolved UniConfig for this request. */
  config: UniConfig;
  /** The messages in the provider's own request shape. */
  wire: unknown[];
  /** The request config in the provider's own shape (tools, system, thinking, cache control). */
  wireConfig: Record<string, unknown>;
}

/** The earliest divergence between two consecutive requests, in provider precedence order. */
export type CacheMissReason =
  | { type: "none" }
  | { type: "model_changed" }
  | { type: "system_changed" }
  | { type: "tools_changed"; detail: string }
  /** thinking / output_config / tool_choice / speed / betas / cache_control — everything
   * prompt-affecting except max_tokens. */
  | { type: "parameters_changed"; keys: string[] }
  | {
      type: "messages_changed";
      index: number;
      detail: string;
      cache_missed_input_estimate: number;
    };

interface StreamOptions {
  messages: UniMessage[];
  config: UniConfig;
  signal?: AbortSignal;
}

/** The AutoLLMClient surface these helpers use (private to GenerativeModel, public at runtime). */
interface AutoClientHandle {
  transformUniMessageToModelInput(messages: UniMessage[], signal?: AbortSignal): Promise<unknown[]>;
  transformUniConfigToModelConfig(config: UniConfig): Record<string, unknown>;
  getHistory(): UniMessage[];
  _client: { _streamingResponseInternal(options: StreamOptions): AsyncGenerator<UniEvent> };
}

const autoClientOf = (model: GenerativeModel): AutoClientHandle =>
  (model as unknown as { client: AutoClientHandle }).client;

const deepCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const json = (value: unknown): string => JSON.stringify(value ?? null);

/**
 * A real `GenerativeModel` with its provider client's stream replaced by a script. Everything
 * else runs for real: the model builds the UniConfig, AgentHub merges the input into its
 * stateful history, and the recorded request is the output of the provider's own transforms.
 */
export function recordingModel(
  config: GenerativeModelConfig,
  script: ScriptedReply[],
): { model: GenerativeModel; requests: RecordedRequest[] } {
  const model = new GenerativeModel(config);
  const auto = autoClientOf(model);
  const requests: RecordedRequest[] = [];
  const pending = [...script];

  auto._client._streamingResponseInternal = async function* (
    options: StreamOptions,
  ): AsyncGenerator<UniEvent> {
    const index = requests.length;
    // Recorded before anything is yielded: AgentHub stamps `created_at` onto the message
    // objects and the harness hands the same objects to the next request.
    requests.push({
      index,
      messages: deepCopy(options.messages),
      config: deepCopy(options.config),
      wire: deepCopy(await auto.transformUniMessageToModelInput(options.messages)),
      wireConfig: deepCopy(auto.transformUniConfigToModelConfig(options.config)),
    });
    const reply = pending.shift();
    if (!reply) throw new Error(`prefix-cache script exhausted at request ${index}`);
    yield* replyEvents(reply, options.signal);
  };

  return { model, requests };
}

/** The live client's committed history, in the provider's request shape. */
export async function wireHistoryOf(model: GenerativeModel): Promise<unknown[]> {
  const auto = autoClientOf(model);
  return deepCopy(await auto.transformUniMessageToModelInput(auto.getHistory()));
}

/** Resolves once the signal aborts (a scripted request that hangs until it is cut). */
function untilAborted(signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!signal) return;
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

/**
 * The UniEvents one scripted reply streams, built the way the Claude client builds them: a
 * start event carrying the input usage, thinking deltas closed by a signature, text deltas,
 * each tool call as partial deltas followed by its complete item, and a stop event carrying
 * the finish reason and the response usage.
 */
async function* replyEvents(reply: ScriptedReply, signal?: AbortSignal): AsyncGenerator<UniEvent> {
  const promptTokens = reply.promptTokens ?? DEFAULT_PROMPT_TOKENS;
  const cachedTokens = reply.cachedTokens ?? 0;
  if (signal?.aborted) return;
  yield {
    role: "assistant",
    event_type: "start",
    content_items: [],
    usage_metadata: {
      cached_tokens: cachedTokens,
      prompt_tokens: promptTokens,
      thoughts_tokens: null,
      response_tokens: null,
    },
    finish_reason: null,
  };

  if (reply.thinking) {
    if (signal?.aborted) return;
    yield delta([{ type: "thinking", thinking: reply.thinking.text }]);
    if (signal?.aborted) return;
    // The signature arrives as an empty delta and closes the block, as Claude's
    // signature_delta does.
    yield delta([
      { type: "thinking", thinking: "", fidelity: { signature: reply.thinking.signature } },
    ]);
  }

  if (reply.text) {
    if (signal?.aborted) return;
    yield delta([{ type: "text", text: reply.text }]);
  }

  if (reply.outcome === "retryable-after-text") {
    // A transport drop: no finish reason, nothing committed to AgentHub's history, and the
    // engine's reconnect ladder takes it (an unclassifiable error stays retryable).
    throw new Error("socket hang up");
  }
  if (reply.outcome === "abort-after-text") {
    await untilAborted(signal);
    return;
  }

  for (const call of reply.toolCalls ?? []) {
    if (signal?.aborted) return;
    yield {
      role: "assistant",
      event_type: "start",
      content_items: [
        { type: "partial_tool_call", name: call.name, arguments: "", tool_call_id: call.id },
      ],
      usage_metadata: null,
      finish_reason: null,
    };
    if (signal?.aborted) return;
    // Argument fragments carry no id, exactly as Claude's input_json_delta does; the
    // translator attributes them to the call that opened last.
    yield delta([
      {
        type: "partial_tool_call",
        name: "",
        arguments: JSON.stringify(call.args),
        tool_call_id: "",
      },
    ]);
    if (signal?.aborted) return;
    // The complete item at the block's stop: AgentHub keeps this one in the committed
    // message and drops the partials, while the harness translator emits the tool card from it.
    yield delta([
      { type: "tool_call", name: call.name, arguments: call.args, tool_call_id: call.id },
    ]);
  }

  if (signal?.aborted) return;
  yield {
    role: "assistant",
    event_type: "stop",
    content_items: [],
    usage_metadata: {
      cached_tokens: cachedTokens,
      prompt_tokens: promptTokens,
      thoughts_tokens: null,
      response_tokens: SCRIPTED_RESPONSE_TOKENS,
    },
    finish_reason: (reply.toolCalls?.length ?? 0) > 0 ? "tool_call" : "stop",
  };
}

const delta = (contentItems: UniEvent["content_items"]): UniEvent => ({
  role: "assistant",
  event_type: "delta",
  content_items: contentItems,
  usage_metadata: null,
  finish_reason: null,
});

/**
 * The earliest level at which `next` stops being an extension of `prev`, in the order a
 * provider invalidates them: model, system, tools, the remaining prompt-affecting parameters,
 * then the messages. `max_tokens` is excluded — it does not take part in the cached prefix.
 */
export function diagnoseCacheMiss(prev: RecordedRequest, next: RecordedRequest): CacheMissReason {
  const before = prefixConfig(prev.wireConfig);
  const after = prefixConfig(next.wireConfig);
  if (json(before.model) !== json(after.model)) return { type: "model_changed" };
  if (json(before.system) !== json(after.system)) return { type: "system_changed" };
  if (json(before.tools) !== json(after.tools)) {
    return { type: "tools_changed", detail: describeToolChange(before.tools, after.tools) };
  }
  const keys = changedKeys(before, after, ["model", "system", "tools"]);
  if (keys.length > 0) return { type: "parameters_changed", keys };
  return diagnoseMessages(prev.wire, next.wire);
}

/** `diagnoseCacheMiss` over each consecutive pair: entry i describes request i -> i+1. */
export function diagnoseSeries(requests: RecordedRequest[]): CacheMissReason[] {
  const reasons: CacheMissReason[] = [];
  for (let i = 1; i < requests.length; i += 1) {
    reasons.push(diagnoseCacheMiss(requests[i - 1]!, requests[i]!));
  }
  return reasons;
}

/** A compact per-request table, for the message of a failing assertion. */
export function formatDiagnostics(requests: RecordedRequest[], reasons: CacheMissReason[]): string {
  const rows = requests.map((request, i) => [
    `#${request.index}`,
    `messages=${request.wire.length}`,
    thinkingLabel(request.wireConfig),
    i === 0 ? "(first request)" : describeReason(reasons[i - 1]),
  ]);
  const widths = [0, 1, 2].map((col) => Math.max(...rows.map((row) => row[col]!.length)));
  const lines = rows.map((row) =>
    row.map((cell, col) => (col < 3 ? cell.padEnd(widths[col]!) : cell)).join("  "),
  );
  return ["prompt-cache diagnostics:", ...lines].join("\n");
}

/** The config keys that take part in the cached prefix. */
function prefixConfig(wireConfig: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...wireConfig };
  for (const key of NON_PREFIX_CONFIG_KEYS) delete copy[key];
  return copy;
}

function changedKeys(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  skip: string[],
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of skip) keys.delete(key);
  return [...keys].filter((key) => json(before[key]) !== json(after[key])).sort();
}

function describeToolChange(before: unknown, after: unknown): string {
  const prev = Array.isArray(before) ? before : [];
  const next = Array.isArray(after) ? after : [];
  const names = (list: unknown[]): string[] =>
    list.map((tool) => String((tool as { name?: unknown }).name ?? "?"));
  const prevNames = names(prev);
  const nextNames = names(next);
  if (json(prevNames) !== json(nextNames)) {
    return `names [${prevNames.join(", ")}] -> [${nextNames.join(", ")}]`;
  }
  for (let i = 0; i < prev.length; i += 1) {
    if (json(prev[i]) !== json(next[i])) return `"${prevNames[i]}" definition changed`;
  }
  return "tool list changed";
}

function diagnoseMessages(prev: unknown[], next: unknown[]): CacheMissReason {
  for (let i = 0; i < prev.length; i += 1) {
    if (i >= next.length) {
      return {
        type: "messages_changed",
        index: i,
        detail: `history shrank from ${prev.length} to ${next.length} messages`,
        cache_missed_input_estimate: missedInput(next, i),
      };
    }
    if (json(prev[i]) !== json(next[i])) {
      return {
        type: "messages_changed",
        index: i,
        detail: describeMessageChange(i, prev[i], next[i]),
        cache_missed_input_estimate: missedInput(next, i),
      };
    }
  }
  return { type: "none" };
}

/** Roughly how much input sits after the divergence, and so has to be read again. */
function missedInput(next: unknown[], index: number): number {
  return Math.ceil(JSON.stringify(next.slice(index)).length / CHARS_PER_TOKEN);
}

function describeMessageChange(index: number, prev: unknown, next: unknown): string {
  const prevBlocks = blocksOf(prev);
  const nextBlocks = blocksOf(next);
  const prevRole = roleOf(prev);
  const nextRole = roleOf(next);
  const role = prevRole === nextRole ? prevRole : `${prevRole} -> ${nextRole}`;
  const count = Math.max(prevBlocks.length, nextBlocks.length);
  let at = count;
  for (let i = 0; i < count; i += 1) {
    if (json(prevBlocks[i]) !== json(nextBlocks[i])) {
      at = i;
      break;
    }
  }
  return `${role} message #${index}, block ${at}: ${blockType(prevBlocks[at])} -> ${blockType(
    nextBlocks[at],
  )}`;
}

const roleOf = (message: unknown): string =>
  String((message as { role?: unknown } | undefined)?.role ?? "?");

function blocksOf(message: unknown): unknown[] {
  const content = (message as { content?: unknown } | undefined)?.content;
  if (Array.isArray(content)) return content;
  return content === undefined ? [] : [content];
}

const blockType = (block: unknown): string =>
  block === undefined ? "absent" : String((block as { type?: unknown }).type ?? "?");

function thinkingLabel(wireConfig: Record<string, unknown>): string {
  const thinking = wireConfig.thinking as { type?: string; display?: string } | undefined;
  const effort = (wireConfig.output_config as { effort?: string } | undefined)?.effort;
  const mode = thinking ? `${thinking.type ?? "?"}/${thinking.display ?? "?"}` : "off";
  return `thinking=${mode} effort=${effort ?? "-"}`;
}

function describeReason(reason: CacheMissReason | undefined): string {
  if (!reason) return "?";
  if (reason.type === "tools_changed") return `tools_changed (${reason.detail})`;
  if (reason.type === "parameters_changed") {
    return `parameters_changed [${reason.keys.join(", ")}]`;
  }
  if (reason.type === "messages_changed") {
    return (
      `messages_changed at #${reason.index} (${reason.detail}), ` +
      `~${reason.cache_missed_input_estimate} input tokens after the divergence`
    );
  }
  return reason.type;
}
