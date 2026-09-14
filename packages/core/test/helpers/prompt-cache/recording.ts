/**
 * The recorder: a scripted provider stream, and the wire form of every request it sees.
 *
 * `recordingModel` returns a real `GenerativeModel` with one thing replaced — the provider
 * client's stream, which reads from a script instead of the network. Everything else runs for
 * real: the model builds the UniConfig, AgentHub merges the input into its stateful history, and
 * the recorded request is the output of the provider's own transforms. A `RecordedRequest` is
 * therefore the bytes the client would have put on the wire, not the internal UniMessage form.
 *
 * The other files here read those recordings. `diagnostics.ts` says why two consecutive requests
 * stopped being one growing prefix; `simulator.ts` says what a provider with Anthropic's cache
 * rules would actually have read back; `fixtures.ts` holds the scenery the Session suites share.
 */
import type { UniConfig, UniEvent, UniMessage } from "@prismshadow/agenthub";
import type { GenerativeModelConfig } from "../../../src/interfaces/index.js";
import { GenerativeModel } from "../../../src/llm/index.js";

/** Response tokens reported by every scripted reply (the input side is what the tests steer). */
const SCRIPTED_RESPONSE_TOKENS = 1;
/** Input tokens a scripted reply reports when it names none. */
const DEFAULT_PROMPT_TOKENS = 10;

// ---- The script -----------------------------------------------------------

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

// ---- What a recording holds -----------------------------------------------

/** One request as the provider client would have sent it. */
export interface RecordedRequest {
  index: number;
  /**
   * Which context issued the request (the recording model's `label`). A scenario that runs
   * several models — a compaction rotation, a subagent's child session — tags each one so a
   * report can tell the cache lines apart; a single-model scenario leaves it off.
   */
  label?: string;
  /** The full message list handed to the client (AgentHub's stateful history plus this turn). */
  messages: UniMessage[];
  /** The resolved UniConfig for this request. */
  config: UniConfig;
  /** The messages in the provider's own request shape. */
  wire: unknown[];
  /** The request config in the provider's own shape (tools, system, thinking, cache control). */
  wireConfig: Record<string, unknown>;
}

/** Extras a recording model carries beyond the script. */
export interface RecordingOptions {
  /** Context label stamped on every request this model records (see RecordedRequest.label). */
  label?: string;
  /**
   * Called with each request the moment it is issued. Several models running in one scenario
   * each keep their own `requests` array, so this is what puts their requests in one issue
   * order — the order a provider would have seen them in.
   */
  onRequest?: (request: RecordedRequest) => void;
}

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

// ---- Recording ------------------------------------------------------------

/**
 * A real `GenerativeModel` with its provider client's stream replaced by a script. Everything
 * else runs for real: the model builds the UniConfig, AgentHub merges the input into its
 * stateful history, and the recorded request is the output of the provider's own transforms.
 */
export function recordingModel(
  config: GenerativeModelConfig,
  script: ScriptedReply[],
  options: RecordingOptions = {},
): { model: GenerativeModel; requests: RecordedRequest[] } {
  const model = new GenerativeModel(config);
  const auto = autoClientOf(model);
  const requests: RecordedRequest[] = [];
  const pending = [...script];

  auto._client._streamingResponseInternal = async function* (
    streamOptions: StreamOptions,
  ): AsyncGenerator<UniEvent> {
    const index = requests.length;
    // Recorded before anything is yielded: AgentHub stamps `created_at` onto the message
    // objects and the harness hands the same objects to the next request.
    const request: RecordedRequest = {
      index,
      ...(options.label !== undefined ? { label: options.label } : {}),
      messages: deepCopy(streamOptions.messages),
      config: deepCopy(streamOptions.config),
      wire: deepCopy(await auto.transformUniMessageToModelInput(streamOptions.messages)),
      wireConfig: deepCopy(auto.transformUniConfigToModelConfig(streamOptions.config)),
    };
    requests.push(request);
    options.onRequest?.(request);
    const reply = pending.shift();
    if (!reply) throw new Error(`prompt-cache script exhausted at request ${index}`);
    yield* replyEvents(reply, streamOptions.signal);
  };

  return { model, requests };
}

/** The live client's committed history, in the provider's request shape. */
export async function wireHistoryOf(model: GenerativeModel): Promise<unknown[]> {
  const auto = autoClientOf(model);
  return deepCopy(await auto.transformUniMessageToModelInput(auto.getHistory()));
}

// ---- The scripted stream --------------------------------------------------

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
