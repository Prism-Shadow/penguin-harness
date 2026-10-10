/**
 * GenerativeModel pure unit tests (no network).
 *
 * Covers two core pieces of logic:
 *   1. Merging OmniMessage[] into one UniMessage (including throwing on mixed roles, and
 *      mapping each content type);
 *   2. Translating UniEvent[] into OmniMessage[] (partial_* ordering, complete messages,
 *      token_usage, tool_call_id passthrough).
 * As well as helper functions for token conversion, UniConfig construction, and retry
 * determination.
 */
import { describe, expect, it } from "vitest";
import {
  EmptyResponseError,
  StreamProtocolError,
  ThinkingLevel,
  ToolCallArgumentParseError,
  UnsupportedParameterError,
} from "@prismshadow/mmsp";
import type {
  EventContentItem,
  Fidelity,
  FinishReason,
  UniConfig,
  UniEvent,
  UniMessage,
  UsageMetadata,
} from "@prismshadow/mmsp";
import type { LLMOutcome, ThinkingLevelName } from "../src/interfaces/index.js";

import {
  EventTranslator,
  GenerativeModel,
  MIN_OUTPUT_TOKENS,
  ToolCallIdAllocator,
  buildUniConfig,
  isAuthenticationError,
  isFastModeUnsupportedError,
  isUnusableResponseError,
  isFatalProviderRejection,
  FAST_MODE_UNSUPPORTED_GUIDANCE,
  mapThinkingLevel,
  mergeOmniToUniMessage,
  stripToolCallIdSuffix,
  toolDefinitionsToSchemas,
  translateEvents,
  usageToTokenCounts,
} from "../src/llm/index.js";
import {
  assistantText,
  buildBackgroundTaskDoneMessage,
  imageUrlMessage,
  inlineData,
  inlineThinking,
  thinkingMessage,
  toolCall,
  toolCallOutput,
  userSteeringText,
  userText,
} from "../src/omnimessage/index.js";
import type {
  OmniMessage,
  TextPayload,
  ThinkingPayload,
  ToolCallPayload,
  TokenUsagePayload,
} from "../src/omnimessage/index.js";

// MMSP's public stream, built by hand: `delta` events carrying one item each, closed by one
// `stop` event. An item streams as its fragments followed by its done item.

const NO_USAGE: UsageMetadata = {
  cached_tokens: 0,
  prompt_tokens: 0,
  thoughts_tokens: 0,
  response_tokens: 0,
};

/** One `delta` event carrying one item — the only shape a delta event has. */
function delta(item: EventContentItem): UniEvent {
  return {
    role: "assistant",
    event_type: "delta",
    content_items: [item],
    usage_metadata: null,
    finish_reason: null,
  };
}

/** The one `stop` event that ends every successful stream: no items, the usage and the finish reason. */
function stop(finishReason: FinishReason = "stop", usage: UsageMetadata = NO_USAGE): UniEvent {
  return {
    role: "assistant",
    event_type: "stop",
    content_items: [],
    usage_metadata: usage,
    finish_reason: finishReason,
  };
}

/** A text item as it streams: its fragments, then the done item holding their join. */
function text(chunks: string[], fidelity?: Fidelity): UniEvent[] {
  return [
    ...chunks.map((chunk) => delta({ type: "text.delta", text: chunk })),
    delta({ type: "text.done", text: chunks.join(""), ...(fidelity ? { fidelity } : {}) }),
  ];
}

/** A thinking item as it streams. */
function thinking(chunks: string[], fidelity?: Fidelity): UniEvent[] {
  return [
    ...chunks.map((chunk) => delta({ type: "thinking.delta", thinking: chunk })),
    delta({ type: "thinking.done", thinking: chunks.join(""), ...(fidelity ? { fidelity } : {}) }),
  ];
}

/**
 * A tool call as it streams: the name and id on the first fragment only, the arguments JSON
 * in fragments, then the done item holding the parsed arguments.
 */
function call(name: string, id: string, fragments: string[], fidelity?: Fidelity): UniEvent[] {
  return [
    ...fragments.map((args, i) =>
      delta({
        type: "tool_call.delta",
        name: i === 0 ? name : "",
        arguments: args,
        tool_call_id: i === 0 ? id : "",
      }),
    ),
    delta({
      type: "tool_call.done",
      name,
      arguments: JSON.parse(fragments.join("") || "{}") as Record<string, unknown>,
      tool_call_id: id,
      ...(fidelity ? { fidelity } : {}),
    }),
  ];
}

/** The stream every seam fake answers with: one word of text, then the stop event. */
function okStream(usage: UsageMetadata = { ...NO_USAGE, prompt_tokens: 1, response_tokens: 1 }) {
  return (async function* (): AsyncGenerator<UniEvent> {
    yield* text(["ok"]);
    yield stop("stop", usage);
  })();
}

const typeOf = (m: OmniMessage): string => (m.payload as { type?: string }).type ?? "";

describe("mergeOmniToUniMessage", () => {
  it("merges same-role messages into one UniMessage and maps content types", () => {
    const uni = mergeOmniToUniMessage([
      userText("hello"),
      imageUrlMessage("https://example.com/a.png"),
      inlineData("user", Buffer.from("xyz").toString("base64"), "image/png"),
    ]);
    expect(uni.role).toBe("user");
    expect(uni.content_items).toHaveLength(3);
    expect(uni.content_items[0]).toEqual({ type: "text.done", text: "hello" });
    expect(uni.content_items[1]).toEqual({
      type: "image_url.done",
      image_url: "https://example.com/a.png",
    });
    const inline = uni.content_items[2]!;
    expect(inline.type).toBe("inline_data.done");
    if (inline.type === "inline_data.done") {
      expect(inline.mime_type).toBe("image/png");
      expect(Buffer.isBuffer(inline.data)).toBe(true);
      expect(inline.data.toString()).toBe("xyz");
    }
  });

  it("maps assistant thinking and inline_thinking content", () => {
    const uni = mergeOmniToUniMessage([
      thinkingMessage("step by step"),
      inlineThinking(Buffer.from("sig").toString("base64"), "application/octet-stream"),
    ]);
    expect(uni.role).toBe("assistant");
    expect(uni.content_items).toHaveLength(2);
    expect(uni.content_items[0]).toEqual({
      type: "thinking.done",
      thinking: "step by step",
    });
    const inline = uni.content_items[1]!;
    expect(inline.type).toBe("inline_thinking.done");
    if (inline.type === "inline_thinking.done") {
      expect(inline.mime_type).toBe("application/octet-stream");
      expect(Buffer.isBuffer(inline.data)).toBe(true);
      expect(inline.data.toString()).toBe("sig");
    }
  });

  it("maps assistant tool_call OmniMessage (args JSON string → object)", () => {
    const uni = mergeOmniToUniMessage([
      toolCall({
        name: "exec_command",
        arguments: '{"cmd":"ls -la"}',
        toolCallId: "call_1",
      }),
    ]);
    expect(uni.role).toBe("assistant");
    const item = uni.content_items[0]!;
    expect(item).toEqual({
      type: "tool_call.done",
      name: "exec_command",
      arguments: { cmd: "ls -la" },
      tool_call_id: "call_1",
    });
  });

  it("maps tool_call_output to tool_result with role user and preserves id", () => {
    const uni = mergeOmniToUniMessage([
      toolCallOutput({ output: "total 0", toolCallId: "call_1" }),
    ]);
    expect(uni.role).toBe("user");
    expect(uni.content_items[0]).toEqual({
      type: "tool_result.done",
      text: "total 0",
      tool_call_id: "call_1",
    });
  });

  it("maps tool_call_output images to tool_result.images (data URL array)", () => {
    const dataUrl = "data:image/png;base64,AAAA";
    const uni = mergeOmniToUniMessage([
      toolCallOutput({ output: "image/png, 4 B", toolCallId: "call_img", images: [dataUrl] }),
    ]);
    expect(uni.role).toBe("user");
    expect(uni.content_items[0]).toEqual({
      type: "tool_result.done",
      text: "image/png, 4 B",
      images: [dataUrl],
      tool_call_id: "call_img",
    });
  });

  it("an injected request input (tool outputs + steered notice + steering) collapses into ONE user message", () => {
    // The engine's next-input assembly appends background notices and steering behind the
    // turn's tool outputs — several user-side OmniMessages. On the wire they must be a
    // single user UniMessage (content_items in input order): what MMSP receives always
    // alternates user / assistant, and an injection can never produce two adjacent user
    // messages. The per-message granularity exists only at the OmniMessage/Trace layer.
    const notice = buildBackgroundTaskDoneMessage(
      {
        kind: "command",
        id: "proc-1",
        status: "completed",
        detail: "exit code 0",
        delivery: "steering",
      },
      "Background command finished",
    );
    const uni = mergeOmniToUniMessage([
      toolCallOutput({ output: "total 0", toolCallId: "call_1" }),
      userText(notice, "harness"),
      userText(userSteeringText("also check the tests")),
    ]);
    expect(uni.role).toBe("user");
    expect(uni.content_items.map((c) => c.type)).toEqual([
      "tool_result.done",
      "text.done",
      "text.done",
    ]);
    const texts = uni.content_items.filter((c) => c.type === "text.done");
    expect((texts[0] as { text: string }).text).toBe(notice);
    expect((texts[1] as { text: string }).text).toContain("[user_steering]");
  });

  it("throws on mixed roles", () => {
    expect(() => mergeOmniToUniMessage([userText("hi"), thinkingMessage("reasoning")])).toThrow(
      /mixed roles/,
    );
  });

  it("throws on empty input", () => {
    expect(() => mergeOmniToUniMessage([])).toThrow();
  });
});

describe("usageToTokenCounts", () => {
  it("maps cached→cache_read, prompt→cache_write, thoughts+response→output", () => {
    const usage: UsageMetadata = {
      cached_tokens: 5,
      prompt_tokens: 10,
      thoughts_tokens: 3,
      response_tokens: 7,
    };
    // cache_read = 5; cache_write = 10 (non-cached input); output = 3 + 7 = 10; total = 25.
    expect(usageToTokenCounts(usage)).toEqual({
      cache_read: 5,
      cache_write: 10,
      output: 10,
      total: 25,
    });
  });

  it("treats nulls as zero", () => {
    const usage: UsageMetadata = {
      cached_tokens: null,
      prompt_tokens: null,
      thoughts_tokens: null,
      response_tokens: null,
    };
    expect(usageToTokenCounts(usage)).toEqual({
      cache_read: 0,
      cache_write: 0,
      output: 0,
      total: 0,
    });
  });
});

describe("translateEvents", () => {
  it("emits text partials (start/delta/stop), a complete text, and token_usage", () => {
    const { messages, requestTokens, sessionTokens } = translateEvents([
      ...text(["Hel", "lo"]),
      stop("stop", { cached_tokens: 0, prompt_tokens: 12, thoughts_tokens: 0, response_tokens: 4 }),
    ]);

    // partial start, two deltas, partial stop, complete text, token_usage.
    expect(messages.map(typeOf)).toEqual([
      "partial_text",
      "partial_text",
      "partial_text",
      "partial_text",
      "text",
      "token_usage",
    ]);

    // partial events: start (empty) → delta "Hel" → delta "lo" → stop.
    const ptexts = messages
      .filter((m) => typeOf(m) === "partial_text")
      .map((m) => m.payload as { event_type: string; text: string });
    expect(ptexts).toEqual([
      {
        type: "partial_text",
        role: "assistant",
        event_type: "start",
        text: "",
        stop_reason: "completed",
      },
      {
        type: "partial_text",
        role: "assistant",
        event_type: "delta",
        text: "Hel",
        stop_reason: "completed",
      },
      {
        type: "partial_text",
        role: "assistant",
        event_type: "delta",
        text: "lo",
        stop_reason: "completed",
      },
      {
        type: "partial_text",
        role: "assistant",
        event_type: "stop",
        text: "",
        stop_reason: "completed",
      },
    ]);

    // complete text message: the done item's text, stop_reason completed (finish_reason "stop").
    const complete = messages.find((m) => typeOf(m) === "text")!.payload as TextPayload;
    expect(complete.text).toBe("Hello");
    expect(complete.role).toBe("assistant");
    expect(complete.stop_reason).toBe("completed");

    // token accounting: request total = 12 + 4 = 16.
    expect(requestTokens.total).toBe(16);
    expect(requestTokens.output).toBe(4);
    expect(sessionTokens).toEqual(requestTokens);

    const tu = messages.at(-1)!.payload as TokenUsagePayload;
    expect(tu.type).toBe("token_usage");
    expect(tu.request.total).toBe(16);
    expect(tu.session.total).toBe(16);
  });

  it("streams a tool call from its fragments and completes it from its done item, preserving the id", () => {
    const { messages } = translateEvents([
      ...call("exec_command", "c1", ["", '{"cmd":"ls', ' -la"}']),
      stop("tool_call"),
    ]);
    expect(messages.map(typeOf)).toEqual([
      "partial_tool_call", // start
      "partial_tool_call", // delta
      "partial_tool_call", // delta
      "partial_tool_call", // stop
      "tool_call", // complete
      "token_usage",
    ]);

    // partial start carries name, no args; deltas carry arg fragments.
    const partials = messages
      .filter((m) => typeOf(m) === "partial_tool_call")
      .map((m) => m.payload as { event_type: string; arguments: string; tool_call_id: string });
    expect(partials[0]!.event_type).toBe("start");
    expect(partials[0]!.arguments).toBe("");
    expect(partials[1]!.arguments).toBe('{"cmd":"ls');
    expect(partials[2]!.arguments).toBe(' -la"}');
    expect(partials[3]!.event_type).toBe("stop");
    expect(partials.every((p) => p.tool_call_id === "c1")).toBe(true);

    // complete tool_call: the done item's parsed arguments, re-serialized.
    const tc = messages.find((m) => typeOf(m) === "tool_call")!.payload as ToolCallPayload;
    expect(tc.name).toBe("exec_command");
    expect(tc.tool_call_id).toBe("c1");
    expect(tc.arguments).toBe('{"cmd":"ls -la"}');
    expect(tc.stop_reason).toBe("completed");
  });

  it("reads the complete call off the done item alone: the fragments are never reconciled against it", () => {
    // The fragments are what the provider streamed, the done item is the call; MMSP guarantees
    // the two agree, and the translator takes the done item's word for it either way.
    const { messages } = translateEvents([
      delta({
        type: "tool_call.delta",
        name: "exec_command",
        arguments: '{ "cmd" : "ls" }',
        tool_call_id: "c1",
      }),
      delta({
        type: "tool_call.done",
        name: "exec_command",
        arguments: { cmd: "ls" },
        tool_call_id: "c1",
      }),
      stop("tool_call"),
    ]);
    const tc = messages.find((m) => typeOf(m) === "tool_call")!.payload as ToolCallPayload;
    expect(tc.arguments).toBe('{"cmd":"ls"}');
  });

  it("does not write name on delta or stop tool-call partials", () => {
    const { messages } = translateEvents([
      ...call("exec_command", "c1", ["", '{"cmd":"ls"}']),
      stop("tool_call"),
    ]);
    const partials = messages.filter((m) => typeOf(m) === "partial_tool_call") as {
      payload: { event_type: string; name: string };
    }[];
    const start = partials.find((p) => p.payload.event_type === "start")!;
    const delta_ = partials.find((p) => p.payload.event_type === "delta")!;
    const stop_ = partials.find((p) => p.payload.event_type === "stop")!;
    expect(start.payload.name).toBe("exec_command"); // start still carries name.
    expect(delta_.payload.name).toBe(""); // delta does not carry name.
    expect(stop_.payload.name).toBe(""); // stop does not carry name.
  });

  it("argument fragments belong to the call streaming now, whatever id they carry", () => {
    // A call's name and id come once, on its first fragment; later fragments carry neither
    // (some gateways put an id of their own on them). Every partial goes out under the call's id.
    const { messages } = translateEvents([
      delta({
        type: "tool_call.delta",
        name: "exec_command",
        arguments: "",
        tool_call_id: "real1",
      }),
      delta({ type: "tool_call.delta", name: "", arguments: '{"cmd":"l', tool_call_id: "" }),
      delta({ type: "tool_call.delta", name: "", arguments: 's"}', tool_call_id: "other" }),
      delta({
        type: "tool_call.done",
        name: "exec_command",
        arguments: { cmd: "ls" },
        tool_call_id: "real1",
      }),
      stop("tool_call"),
    ]);
    const partials = messages
      .filter((m) => typeOf(m) === "partial_tool_call")
      .map((m) => m.payload as { event_type: string; arguments: string; tool_call_id: string });
    expect(partials.map((p) => p.event_type)).toEqual(["start", "delta", "delta", "stop"]);
    expect(partials.every((p) => p.tool_call_id === "real1")).toBe(true);
    expect(messages.filter((m) => typeOf(m) === "tool_call")).toHaveLength(1);
  });

  it("emits each complete tool_call as soon as its done item arrives, before the next call starts", () => {
    // The engine starts approval/execution on the first call while the second still streams.
    const { messages } = translateEvents([
      ...call("exec_command", "t1", ['{"cmd":"a"}']),
      ...call("exec_command", "t2", ['{"cmd":"b"}']),
      stop("tool_call"),
    ]);
    const idxT1Complete = messages.findIndex(
      (m) => typeOf(m) === "tool_call" && (m.payload as ToolCallPayload).tool_call_id === "t1",
    );
    const idxT2Start = messages.findIndex(
      (m) =>
        typeOf(m) === "partial_tool_call" &&
        (m.payload as { tool_call_id?: string }).tool_call_id === "t2",
    );
    expect(idxT1Complete).toBeGreaterThanOrEqual(0);
    expect(idxT1Complete).toBeLessThan(idxT2Start);
    expect(
      messages
        .filter((m) => typeOf(m) === "tool_call")
        .map((m) => (m.payload as ToolCallPayload).tool_call_id),
    ).toEqual(["t1", "t2"]);
  });

  it("emits thinking partials and a complete thinking message before text", () => {
    const { messages } = translateEvents([
      ...thinking(["Let me", " think"]),
      ...text(["Answer"]),
      stop(),
    ]);
    expect(messages.map(typeOf).filter((t) => t === "thinking" || t === "text")).toEqual([
      "thinking",
      "text",
    ]);
    const think = messages.find((m) => typeOf(m) === "thinking")!.payload as ThinkingPayload;
    expect(think.thinking).toBe("Let me think");
    // The thinking item is closed before the text item opens: partial_thinking stop precedes
    // partial_text start.
    const idxThinkStop = messages.findIndex(
      (m) =>
        typeOf(m) === "partial_thinking" &&
        (m.payload as { event_type?: string }).event_type === "stop",
    );
    const idxTextStart = messages.findIndex(
      (m) =>
        typeOf(m) === "partial_text" &&
        (m.payload as { event_type?: string }).event_type === "start",
    );
    expect(idxThinkStop).toBeGreaterThanOrEqual(0);
    expect(idxThinkStop).toBeLessThan(idxTextStart);
  });

  it("keeps the complete-message order thinking → text → tool_call, each item completed at its own end", () => {
    const { messages } = translateEvents([
      ...thinking(["I should", " run ls"]),
      ...text(["Running it."]),
      ...call("exec_command", "c1", ['{"cmd":"ls"}']),
      stop("tool_call"),
    ]);
    expect(
      messages.map(typeOf).filter((t) => t === "thinking" || t === "text" || t === "tool_call"),
    ).toEqual(["thinking", "text", "tool_call"]);
    // Items that ended before the stream did are `completed`: the finish reason belongs to the
    // item that ends the stream (here the tool call).
    const think = messages.find((m) => typeOf(m) === "thinking")!.payload as ThinkingPayload;
    expect(think.thinking).toBe("I should run ls");
    expect(think.stop_reason).toBe("completed");
    const txt = messages.find((m) => typeOf(m) === "text")!.payload as TextPayload;
    expect(txt.text).toBe("Running it.");
    expect(txt.stop_reason).toBe("completed");
    const tc = messages.find((m) => typeOf(m) === "tool_call")!.payload as ToolCallPayload;
    expect(tc.stop_reason).toBe("completed");
  });

  it("keeps every item in generation order: text after a tool call, thinking between texts", () => {
    const { messages } = translateEvents([
      ...text(["before ", "call"]),
      ...call("exec_command", "c1", ['{"cmd":"ls"}']),
      ...text(["after call"]),
      ...thinking(["hmm"]),
      ...text(["c"]),
      stop(),
    ]);
    expect(
      messages.map(typeOf).filter((t) => t === "thinking" || t === "text" || t === "tool_call"),
    ).toEqual(["text", "tool_call", "text", "thinking", "text"]);
    expect(
      messages.filter((m) => typeOf(m) === "text").map((m) => (m.payload as TextPayload).text),
    ).toEqual(["before call", "after call", "c"]);
    // Each item opens its own partial stream: three partial_text starts.
    expect(
      messages.filter(
        (m) =>
          typeOf(m) === "partial_text" &&
          (m.payload as { event_type?: string }).event_type === "start",
      ),
    ).toHaveLength(3);
  });

  it("the item that ends the stream takes the request's finish reason: `length` ends it fatal", () => {
    // A reply cut at the output cap: the request itself committed (nothing retries), but the
    // last item ended in a way only a human can fix, which is what the abnormal terminal label
    // tells the render layers. Earlier items are unaffected.
    const { messages } = translateEvents([
      ...thinking(["plan"]),
      ...text(["cut off mid-sen"]),
      stop("length"),
    ]);
    const think = messages.find((m) => typeOf(m) === "thinking")!.payload as ThinkingPayload;
    expect(think.stop_reason).toBe("completed");
    const txt = messages.find((m) => typeOf(m) === "text")!.payload as TextPayload;
    expect(txt.stop_reason).toBe("fatal");
    const textStop = messages.find(
      (m) =>
        typeOf(m) === "partial_text" &&
        (m.payload as { event_type?: string }).event_type === "stop",
    )!.payload as { stop_reason: string };
    expect(textStop.stop_reason).toBe("fatal");
    // The messages of the last item wait for the stop event: nothing about it went out before.
    expect(messages.map(typeOf)).toEqual([
      "partial_thinking",
      "partial_thinking",
      "partial_thinking",
      "thinking",
      "partial_text",
      "partial_text",
      "partial_text",
      "text",
      "token_usage",
    ]);
  });

  it("a fragment carrying only fidelity opens nothing on screen; its done item still becomes a complete message", () => {
    // GPT-5 encrypted reasoning: a thinking item with no text, only the payload replay needs.
    const { messages } = translateEvents([
      delta({
        type: "thinking.delta",
        thinking: "",
        fidelity: { id: "rs_1", encrypted_content: "aaa" },
      }),
      delta({
        type: "thinking.done",
        thinking: "",
        fidelity: { id: "rs_1", encrypted_content: "aaa" },
      }),
      ...text(["answer"]),
      stop(),
    ]);
    expect(messages.map(typeOf)).toEqual([
      "thinking",
      "partial_text",
      "partial_text",
      "partial_text",
      "text",
      "token_usage",
    ]);
    const think = messages[0]!.payload as ThinkingPayload;
    expect(think.thinking).toBe("");
    expect(think.fidelity).toEqual({ id: "rs_1", encrypted_content: "aaa" });
  });

  it("carries the done items' fidelity to the complete messages", () => {
    const { messages } = translateEvents([
      ...thinking(["deep"], { signature: "sig-1" }),
      ...text(["hi"], { phase: "answer", signature: "sig-2" }),
      ...call("t", "tc1", ["{}"], { signature: "sig-3" }),
      stop("tool_call"),
    ]);
    const fidelityOf = (type: string): unknown =>
      (messages.find((m) => typeOf(m) === type)!.payload as { fidelity?: unknown }).fidelity;
    expect(fidelityOf("thinking")).toEqual({ signature: "sig-1" });
    expect(fidelityOf("text")).toEqual({ phase: "answer", signature: "sig-2" });
    expect(fidelityOf("tool_call")).toEqual({ signature: "sig-3" });
    // Partials never carry it.
    expect(
      messages
        .filter((m) => typeOf(m).startsWith("partial_"))
        .every((m) => (m.payload as { fidelity?: unknown }).fidelity === undefined),
    ).toBe(true);
  });

  it("passes over items that are not model text, thinking or tool calls", () => {
    // An image the model generated mid-reply is not streaming output here; the text before it
    // is still closed in order.
    const { messages } = translateEvents([
      ...text(["see: "]),
      delta({ type: "inline_data.delta", data: Buffer.from("png"), mime_type: "image/png" }),
      delta({ type: "inline_data.done", data: Buffer.from("png"), mime_type: "image/png" }),
      ...text(["done"]),
      stop(),
    ]);
    expect(
      messages.filter((m) => typeOf(m) === "text").map((m) => (m.payload as TextPayload).text),
    ).toEqual(["see: ", "done"]);
    expect(messages.map(typeOf)).not.toContain("inline_data");
  });

  it("accumulates session tokens across two requests", () => {
    const mkUsage = (p: number, r: number): UsageMetadata => ({
      cached_tokens: 0,
      prompt_tokens: p,
      thoughts_tokens: 0,
      response_tokens: r,
    });
    const first = translateEvents([...text(["a"]), stop("stop", mkUsage(10, 5))]);
    expect(first.sessionTokens.total).toBe(15);

    const second = translateEvents(
      [...text(["b"]), stop("stop", mkUsage(20, 3))],
      first.sessionTokens,
    );
    expect(second.requestTokens.total).toBe(23);
    expect(second.sessionTokens.total).toBe(38);
  });
});

describe("EventTranslator.finishInterrupted (PRN-012 structural closure)", () => {
  function pushAll(tr: EventTranslator, events: UniEvent[]): OmniMessage[] {
    const out: OmniMessage[] = [];
    for (const e of events) for (const m of tr.pushEvent(e)) out.push(m);
    return out;
  }

  it("closes an open text item with a stop + complete text marked with the interruption reason, and emits no token_usage", () => {
    const tr = new EventTranslator();
    // Two fragments went out, then the stream broke (no done item, no stop event).
    const out = pushAll(tr, [
      delta({ type: "text.delta", text: "Par" }),
      delta({ type: "text.delta", text: "tial" }),
    ]);
    for (const m of tr.finishInterrupted("retryable")) out.push(m);

    expect(out.map(typeOf)).toEqual([
      "partial_text", // start
      "partial_text", // delta Par
      "partial_text", // delta tial
      "partial_text", // stop (backfilled by finishInterrupted)
      "text", // complete message
    ]);

    const stop_ = out[3]!.payload as { event_type: string; stop_reason: string };
    expect(stop_.event_type).toBe("stop");
    expect(stop_.stop_reason).toBe("retryable");
    const complete = out[4]!.payload as TextPayload;
    expect(complete.text).toBe("Partial");
    expect(complete.stop_reason).toBe("retryable");
  });

  it("closes an open thinking item with the interruption reason on both partial stop and complete message", () => {
    const tr = new EventTranslator();
    const out = pushAll(tr, [delta({ type: "thinking.delta", thinking: "half a thought" })]);
    for (const m of tr.finishInterrupted("aborted")) out.push(m);

    const stop_ = out.find(
      (m) =>
        typeOf(m) === "partial_thinking" &&
        (m.payload as { event_type?: string }).event_type === "stop",
    )!.payload as { stop_reason: string };
    expect(stop_.stop_reason).toBe("aborted");
    const complete = out.find((m) => typeOf(m) === "thinking")!.payload as ThinkingPayload;
    expect(complete.thinking).toBe("half a thought");
    // Streamed concatenation == complete message: the complete thinking's stop_reason matches
    // partial(stop).
    expect(complete.stop_reason).toBe("aborted");
  });

  it("completes an incomplete (fragments-only) tool_call with the interruption reason, not 'completed'", () => {
    const tr = new EventTranslator();
    const out = pushAll(tr, [
      delta({ type: "tool_call.delta", name: "exec_command", arguments: "", tool_call_id: "c1" }),
      delta({ type: "tool_call.delta", name: "", arguments: '{"cmd":"ls', tool_call_id: "" }),
    ]);
    for (const m of tr.finishInterrupted("aborted")) out.push(m);

    const complete = out.find((m) => typeOf(m) === "tool_call")!.payload as ToolCallPayload;
    expect(complete.tool_call_id).toBe("c1");
    expect(complete.name).toBe("exec_command");
    // Key point: not "completed" -> context_engine will not dispatch it for execution (it only
    // serves structural completeness and observability).
    expect(complete.stop_reason).toBe("aborted");
    expect(complete.arguments).toBe('{"cmd":"ls'); // Keeps the (incomplete) fragments accumulated so far.

    const toolStop = out.find(
      (m) =>
        typeOf(m) === "partial_tool_call" &&
        (m.payload as { event_type: string }).event_type === "stop",
    )!.payload as { stop_reason: string };
    expect(toolStop.stop_reason).toBe("aborted");
    expect(out.map(typeOf)).not.toContain("token_usage");
  });

  it("does not re-emit nor relabel a tool_call already completed by its done item (keeps 'completed')", () => {
    const tr = new EventTranslator();
    const out = pushAll(tr, call("exec_command", "c1", ['{"cmd":"ls"}']));
    const before = out.length;
    for (const m of tr.finishInterrupted("retryable")) out.push(m);
    expect(out.length).toBe(before); // Already produced on its done item, not duplicated.
    const complete = out.find((m) => typeOf(m) === "tool_call")!.payload as ToolCallPayload;
    expect(complete.stop_reason).toBe("completed");
  });

  it("a finished text still waiting for the stream's end takes the interruption reason", () => {
    // The text's done item arrived, but the stream broke before its stop event: the request
    // never committed, so the complete text is labelled like the request — and goes out at
    // all, rather than staying held.
    const tr = new EventTranslator();
    const out = pushAll(tr, text(["all of it"]));
    expect(out.map(typeOf)).toEqual(["partial_text", "partial_text"]); // start + delta; the rest waits
    for (const m of tr.finishInterrupted("retryable")) out.push(m);
    expect(out.map(typeOf)).toEqual(["partial_text", "partial_text", "partial_text", "text"]);
    const complete = out[3]!.payload as TextPayload;
    expect(complete.text).toBe("all of it");
    expect(complete.stop_reason).toBe("retryable");
    expect((out[2]!.payload as { stop_reason: string }).stop_reason).toBe("retryable");
  });
});

describe("config helpers", () => {
  it("maps thinking levels", () => {
    expect(mapThinkingLevel("none")).toBe(ThinkingLevel.NONE);
    expect(mapThinkingLevel("low")).toBe(ThinkingLevel.LOW);
    expect(mapThinkingLevel("medium")).toBe(ThinkingLevel.MEDIUM);
    expect(mapThinkingLevel("high")).toBe(ThinkingLevel.HIGH);
    expect(mapThinkingLevel("xhigh")).toBe(ThinkingLevel.XHIGH);
    expect(mapThinkingLevel("max")).toBe(ThinkingLevel.MAX);
    expect(mapThinkingLevel(undefined)).toBeUndefined();
  });

  it("maps tool definitions to schemas (omitting undefined parameters)", () => {
    const schemas = toolDefinitionsToSchemas([
      { name: "a", description: "desc a", parameters: { type: "object" } },
      { name: "b", description: "desc b" },
    ]);
    expect(schemas[0]).toEqual({
      name: "a",
      description: "desc a",
      parameters: { type: "object" },
    });
    expect(schemas[1]).toEqual({ name: "b", description: "desc b" });
    expect("parameters" in schemas[1]!).toBe(false);
  });

  it("builds UniConfig with only provided fields (thinking level stays out — it is per-request)", () => {
    const cfg = buildUniConfig({
      modelId: "claude-sonnet-4-6",
      tools: [{ name: "t", description: "d" }],
      systemPrompt: "You are concise.",
      maxTokens: 256,
      thinkingLevel: "high",
    });
    expect(cfg.system_prompt).toBe("You are concise.");
    expect(cfg.max_tokens).toBe(256);
    // The thinking level is applied per request (override ?? construction default), never
    // baked into the frozen config — see the request-config test below.
    expect("thinking_level" in cfg).toBe(false);
    expect(cfg.tools).toEqual([{ name: "t", description: "d" }]);

    const minimal = buildUniConfig({ modelId: "m", tools: [] });
    expect("tools" in minimal).toBe(false);
    expect("system_prompt" in minimal).toBe(false);
    expect("max_tokens" in minimal).toBe(false);
    expect("thinking_level" in minimal).toBe(false);

    // max_tokens -1 (the config's "no cap" sentinel) stays OFF the wire — sent literally,
    // providers reject a negative max_tokens with a 400.
    const uncapped = buildUniConfig({ modelId: "m", tools: [], maxTokens: -1 });
    expect("max_tokens" in uncapped).toBe(false);
  });

  it("defaults the request idle budget to 300s (a silent reasoning phase fits inside it)", () => {
    // The budget is the wait for the NEXT upstream event, and a model that keeps its
    // reasoning off the wire spends its whole thinking phase inside the first-event gap.
    const model = new GenerativeModel({ modelId: "claude-sonnet-4-6", tools: [] });
    expect((model as unknown as { requestTimeoutMs: number }).requestTimeoutMs).toBe(300000);
    // An explicit value still wins, and <=0 still disables the timer.
    const explicit = new GenerativeModel({
      modelId: "claude-sonnet-4-6",
      tools: [],
      requestTimeoutMs: 5000,
    });
    expect((explicit as unknown as { requestTimeoutMs: number }).requestTimeoutMs).toBe(5000);
  });

  it("omits tools when empty and never sets tool_choice (strict endpoints reject both)", () => {
    // Empty tool list (connectivity probe, bare/meta LLM, vision describer): the `tools` key
    // must be absent, not `[]` — MMSP forwards any defined array verbatim, and strict
    // OpenAI-compatible servers (e.g. vLLM) reject `tools: []` with a 400.
    const empty = buildUniConfig({ modelId: "m", tools: [] });
    expect("tools" in empty).toBe(false);
    // `tool_choice` must never be set: MMSP only emits it on the wire when UniConfig
    // defines it, and leaving it off preserves the protocol default.
    expect("tool_choice" in empty).toBe(false);
    const withTools = buildUniConfig({ modelId: "m", tools: [{ name: "t", description: "d" }] });
    expect("tool_choice" in withTools).toBe(false);
  });

  it("sets fast_mode only when enabled: the key stays off the config otherwise", () => {
    // Enabled: the entry's fast_mode annotation reaches the wire as UniConfig.fast_mode.
    const on = buildUniConfig({ modelId: "m", tools: [], fastMode: true });
    expect(on.fast_mode).toBe(true);
    // Off / absent: the key must be ABSENT, not false — models without a fast tier reject
    // the parameter, so an unset annotation must leave existing configs bit-identical.
    const off = buildUniConfig({ modelId: "m", tools: [], fastMode: false });
    expect("fast_mode" in off).toBe(false);
    const unset = buildUniConfig({ modelId: "m", tools: [] });
    expect("fast_mode" in unset).toBe(false);
  });

  it("always asks for thought summaries (they keep a reasoning phase on the wire)", () => {
    // Unconditional, unlike fast_mode: no client rejects the flag — MMSP maps it where the
    // provider has one and drops it where it doesn't. Beyond showing the user the reasoning,
    // it keeps events arriving while the model thinks, which is what the request timeout (an
    // idle budget between upstream events) actually measures.
    expect(buildUniConfig({ modelId: "m", tools: [] }).thinking_summary).toBe(true);
    expect(
      buildUniConfig({ modelId: "m", tools: [], thinkingLevel: "none" }).thinking_summary,
    ).toBe(true);
  });
});

describe("isFatalProviderRejection (the fatal allowlist; everything it misses stays retryable)", () => {
  it("matches definitive 4xx rejections — including quota-coded and bare 403s", () => {
    expect(isFatalProviderRejection({ status: 400 })).toBe(true);
    expect(isFatalProviderRejection({ status: 403 })).toBe(true);
    expect(isFatalProviderRejection({ status: 404 })).toBe(true);
    expect(isFatalProviderRejection({ statusCode: 422 })).toBe(true);
    expect(isFatalProviderRejection({ status: 403, code: "insufficient_user_quota" })).toBe(true);
    expect(isFatalProviderRejection({ status: 402, code: "insufficient_quota" })).toBe(true);
    expect(isFatalProviderRejection({ status: 403, message: "no active subscription" })).toBe(true);
    // 401 matches here too, but the auth detector runs first and gives it the more
    // specific credentials handling.
    expect(isFatalProviderRejection({ status: 401 })).toBe(true);
  });

  it("leaves the transient statuses out: 408, 429 and 5xx keep their retries", () => {
    expect(isFatalProviderRejection({ status: 408 })).toBe(false);
    expect(isFatalProviderRejection({ status: 429 })).toBe(false);
    expect(isFatalProviderRejection({ status: 500 })).toBe(false);
    expect(isFatalProviderRejection({ statusCode: 503 })).toBe(false);
  });

  it("finds the status down the cause chain (SDKs wrap the response error)", () => {
    expect(
      isFatalProviderRejection(
        new Error("request failed", {
          cause: Object.assign(new Error("bad request"), { status: 400 }),
        }),
      ),
    ).toBe(true);
    expect(
      isFatalProviderRejection(
        new Error("request failed", {
          cause: Object.assign(new Error("throttled"), { status: 429 }),
        }),
      ),
    ).toBe(false);
  });

  it("never matches status-less errors: transport drops and local failures stay retryable", () => {
    expect(isFatalProviderRejection({ code: "ECONNRESET" })).toBe(false);
    expect(isFatalProviderRejection(new Error("socket hang up"))).toBe(false);
    expect(
      isFatalProviderRejection(
        new TypeError("terminated", {
          cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }),
        }),
      ),
    ).toBe(false);
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(isFatalProviderRejection(abort)).toBe(false);
    expect(isFatalProviderRejection(new Error("unexpected token in JSON"))).toBe(false);
    expect(isFatalProviderRejection(null)).toBe(false);
    expect(isFatalProviderRejection(undefined)).toBe(false);
  });

  it("the auth detector keeps its own contract: a definitive credential signal, wherever it rides", () => {
    // A 403 whose BODY carries a definitive auth code but whose MESSAGE mentions a
    // subscription (SDKs routinely put the body's message on err.message): the explicit
    // credential signal decides, and the classifier checks auth before the generic 4xx.
    const err = Object.assign(new Error("subscription key invalid"), {
      status: 403,
      error: { code: "invalid_api_key" },
    });
    expect(isAuthenticationError(err)).toBe(true);
    // A bare 403 carries no credential signal: NOT auth (it is fatal through the generic
    // 4xx rejection instead; see the classification tests).
    expect(isAuthenticationError({ status: 403, message: "forbidden" })).toBe(false);
  });
});

describe("isAuthenticationError", () => {
  it("classifies HTTP 401 as auth, own or wrapped", () => {
    expect(isAuthenticationError({ status: 401 })).toBe(true);
    expect(isAuthenticationError({ statusCode: 401 })).toBe(true);
    expect(isAuthenticationError(new Error("request failed", { cause: { status: 401 } }))).toBe(
      true,
    );
  });

  it("classifies known auth codes/types and the SDK AuthenticationError class", () => {
    expect(isAuthenticationError({ code: "invalid_api_key" })).toBe(true);
    expect(isAuthenticationError({ status: 403, error: { type: "authentication_error" } })).toBe(
      true,
    );
    // Anthropic SDK shape: `error` holds the whole response body.
    expect(isAuthenticationError({ error: { error: { code: "unauthorized" } } })).toBe(true);
    class AuthenticationError extends Error {}
    expect(isAuthenticationError(new AuthenticationError("bad key"))).toBe(true);
    expect(
      isAuthenticationError(new Error("request failed", { cause: { code: "invalid_api_key" } })),
    ).toBe(true);
  });

  it("does not classify a bare 403 or unrelated failures as auth", () => {
    expect(isAuthenticationError({ status: 403 })).toBe(false);
    expect(isAuthenticationError({ status: 400, message: "invalid param" })).toBe(false);
    expect(isAuthenticationError({ status: 403, code: "insufficient_user_quota" })).toBe(false);
    expect(isAuthenticationError(new Error("socket hang up"))).toBe(false);
    expect(isAuthenticationError(null)).toBe(false);
  });
});

describe("isFastModeUnsupportedError (fast_mode rejected by a model without a fast tier)", () => {
  const fastModeError = () =>
    new UnsupportedParameterError({
      client: "MoonshotOfficialClient",
      parameter: "fast_mode",
      message: "Kimi does not support fast mode.",
    });

  it("detects MMSP's UnsupportedParameterError for fast_mode, including the cause chain", () => {
    expect(isFastModeUnsupportedError(fastModeError())).toBe(true);
    // Wrapped one level up (a higher layer annotating the request) is still found.
    expect(
      isFastModeUnsupportedError(new Error("request failed", { cause: fastModeError() })),
    ).toBe(true);
    // Cross-realm / reconstructed errors match by name + parameter without the class identity.
    expect(
      isFastModeUnsupportedError({
        name: "UnsupportedParameterError",
        parameter: "fast_mode",
        message: "Bedrock does not support fast mode.",
      }),
    ).toBe(true);
  });

  it("stays scoped to fast_mode: other unsupported parameters and unrelated errors do not match", () => {
    // Another UnsupportedParameterError source (e.g. temperature) keeps the default
    // retryable classification and the engine's retry ladder — this detector must not
    // widen the fatal special case.
    expect(
      isFastModeUnsupportedError(
        new UnsupportedParameterError({
          client: "GeminiOfficialClient",
          parameter: "temperature",
          message: "temperature is not supported.",
        }),
      ),
    ).toBe(false);
    // Message vocabulary alone is not a signal: only the typed error (or its name) counts.
    expect(isFastModeUnsupportedError(new Error("model does not support fast mode"))).toBe(false);
    expect(isFastModeUnsupportedError({ status: 400 })).toBe(false);
    expect(isFastModeUnsupportedError(null)).toBe(false);
  });
});

describe("isUnusableResponseError", () => {
  it("a JSON.parse SyntaxError is one, by exception type, down the cause chain", () => {
    expect(
      isUnusableResponseError(new SyntaxError("Unexpected token < in JSON at position 0")),
    ).toBe(true);
    expect(
      isUnusableResponseError(
        new Error("request failed", { cause: new SyntaxError("Unexpected end of JSON input") }),
      ),
    ).toBe(true);
    // Message vocabulary alone is not a signal: a plain Error that mentions JSON is left to the
    // network / rejection classification.
    expect(isUnusableResponseError(new Error("Unexpected token < in JSON at position 0"))).toBe(
      false,
    );
    expect(isUnusableResponseError(new Error("socket hang up"))).toBe(false);
    expect(isUnusableResponseError(null)).toBe(false);
  });

  it("MMSP's stream errors are: truncated tool args, a thinking-only response, a broken grammar", () => {
    // A stream truncated mid-arguments surfaces as ToolCallArgumentParseError, thrown in place
    // of the call's done item.
    expect(
      isUnusableResponseError(
        new ToolCallArgumentParseError({
          client: "AnthropicOfficialClient",
          toolName: "exec_command",
          toolCallId: "toolu_broken_1",
          rawArguments: '{"cmd": "ec',
          reason: "Unterminated string in JSON at position 11",
        }),
      ),
    ).toBe(true);
    // A completed thinking-only response cannot be replayed (400 on the next turn): retrying
    // gives the model another chance instead of failing the turn.
    expect(
      isUnusableResponseError(
        new Error("request failed", {
          cause: new EmptyResponseError({ client: "OpenAIOfficialClient", finishReason: null }),
        }),
      ),
    ).toBe(true);
    expect(
      isUnusableResponseError(
        new StreamProtocolError({ client: "OpenaiChatClient", message: "a delta carries usage" }),
      ),
    ).toBe(true);
    // A reconstructed error matches by name.
    expect(isUnusableResponseError({ name: "StreamProtocolError" })).toBe(true);
  });

  it("a cleanly truncated stream is: MMSP has no usage or finish reason to close it with", () => {
    expect(
      isUnusableResponseError(new Error("Streaming response ended without usage_metadata")),
    ).toBe(true);
    expect(
      isUnusableResponseError(
        new Error("request failed", {
          cause: new Error("Streaming response ended without finish_reason"),
        }),
      ),
    ).toBe(true);
  });
});

describe("GenerativeModel per-request thinking level", () => {
  // Captures the UniConfig each request goes out with (the openStream seam now receives the
  // per-request resolved config): the effective level = params.thinkingLevel ?? the
  // construction default, mapped onto the wire enum; neither → the key stays off the wire.
  function capturingModel(defaultLevel?: ThinkingLevelName): {
    model: GenerativeModel;
    configs: (UniConfig | undefined)[];
  } {
    const configs: (UniConfig | undefined)[] = [];
    class CapturingModel extends GenerativeModel {
      protected override openStream(
        _uni: UniMessage,
        _signal: AbortSignal,
        config?: UniConfig,
      ): AsyncIterable<UniEvent> {
        configs.push(config);
        return okStream();
      }
    }
    const model = new CapturingModel({
      modelId: "claude-sonnet-4-6",
      tools: [],
      ...(defaultLevel !== undefined ? { thinkingLevel: defaultLevel } : {}),
    });
    return { model, configs };
  }

  async function drainAll(gen: AsyncGenerator<OmniMessage, LLMOutcome | void>): Promise<void> {
    let res = await gen.next();
    while (!res.done) res = await gen.next();
  }

  it("applies the construction default when no override is given, per request", async () => {
    const { model, configs } = capturingModel("medium");
    await drainAll(model.streamGenerate({ newMessages: [userText("hi")] }));
    expect(configs[0]?.thinking_level).toBe(ThinkingLevel.MEDIUM);
  });

  it("a per-request override wins for that request only; the default returns afterwards", async () => {
    const { model, configs } = capturingModel("medium");
    await drainAll(model.streamGenerate({ newMessages: [userText("a")], thinkingLevel: "high" }));
    await drainAll(model.streamGenerate({ newMessages: [userText("b")] }));
    expect(configs[0]?.thinking_level).toBe(ThinkingLevel.HIGH);
    expect(configs[1]?.thinking_level).toBe(ThinkingLevel.MEDIUM);
  });

  it("no default and no override: thinking_level stays off the wire; an override still applies", async () => {
    const { model, configs } = capturingModel();
    await drainAll(model.streamGenerate({ newMessages: [userText("a")] }));
    await drainAll(model.streamGenerate({ newMessages: [userText("b")], thinkingLevel: "xhigh" }));
    expect(configs[0] !== undefined && "thinking_level" in configs[0]).toBe(false);
    expect(configs[1]?.thinking_level).toBe(ThinkingLevel.XHIGH);
  });
});

describe("GenerativeModel per-request output cap (window clamp, issue #218)", () => {
  // Same capturing pattern as the thinking-level suite: the openStream seam receives the
  // per-request resolved UniConfig, whose max_tokens is the value that would go on the
  // wire. The fake stream's usage_metadata drives lastRequestTotal between requests.
  function windowModel(opts: {
    maxTokens?: number;
    contextWindow?: number;
    promptTokens?: number;
  }): { model: GenerativeModel; configs: (UniConfig | undefined)[] } {
    const configs: (UniConfig | undefined)[] = [];
    class WindowModel extends GenerativeModel {
      protected override openStream(
        _uni: UniMessage,
        _signal: AbortSignal,
        config?: UniConfig,
      ): AsyncIterable<UniEvent> {
        configs.push(config);
        return okStream({ ...NO_USAGE, prompt_tokens: opts.promptTokens ?? 1, response_tokens: 1 });
      }
    }
    const model = new WindowModel({
      modelId: "claude-sonnet-4-6",
      tools: [],
      ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
      ...(opts.contextWindow !== undefined ? { contextWindow: opts.contextWindow } : {}),
    });
    return { model, configs };
  }

  async function drainAll(gen: AsyncGenerator<OmniMessage, LLMOutcome | void>): Promise<void> {
    let res = await gen.next();
    while (!res.done) res = await gen.next();
  }

  it("is a no-op for a big configured window: the configured cap goes out unchanged", async () => {
    const { model, configs } = windowModel({ maxTokens: 32000, contextWindow: 1_000_000 });
    await drainAll(model.streamGenerate({ newMessages: [userText("hi")] }));
    expect(configs[0]?.max_tokens).toBe(32000);
  });

  it("never clamps without a configured window — even when the measured context is huge", async () => {
    // No contextWindow on the entry: a hard cap must not be derived from the 128000
    // assumption. A large-window model that omits context_window (and has compaction
    // disabled) would otherwise get its outputs floored past the assumed mark.
    const { model, configs } = windowModel({ maxTokens: 32000, promptTokens: 200_000 });
    await drainAll(model.streamGenerate({ newMessages: [userText("a")] }));
    await drainAll(model.streamGenerate({ newMessages: [userText("b")] }));
    expect(configs[0]?.max_tokens).toBe(32000);
    expect(configs[1]?.max_tokens).toBe(32000); // measured 200k context, still no clamp
  });

  it("counts a tool output's base64 image at the flat allowance: the next request is not floored", async () => {
    // Regression for the review repro: a read_file image output carrying a 1 MB
    // data-URL image used to be serialized into the estimate (~262k "tokens"), flooring
    // request 2's max_tokens to the minimum even on a 128k window.
    const { model, configs } = windowModel({
      maxTokens: 32000,
      contextWindow: 128_000,
      promptTokens: 1000,
    });
    await drainAll(model.streamGenerate({ newMessages: [userText("read the screenshot")] }));
    const imageOutput = toolCallOutput({
      output: "Read image OK (1024x768).",
      toolCallId: "c1",
      stopReason: "completed",
      images: [`data:image/png;base64,${"A".repeat(1_000_000)}`],
    });
    await drainAll(model.streamGenerate({ newMessages: [imageOutput] }));
    expect(configs[1]?.max_tokens).toBe(32000); // flat image allowance: nowhere near the window
  });

  it("clamps the first request of a small-window model below the window (the vLLM 400)", async () => {
    // The issue #218 report: window 32768 with the seeded cap 32000 — the fixed cap
    // overflowed the window on the very first request. The clamped value must leave the
    // estimated input plus safety margin inside the window while staying positive.
    const { model, configs } = windowModel({ maxTokens: 32000, contextWindow: 32768 });
    await drainAll(model.streamGenerate({ newMessages: [userText("hello vllm")] }));
    const cap = configs[0]?.max_tokens ?? 0;
    expect(cap).toBeLessThan(32000);
    expect(cap).toBeGreaterThan(30000); // tiny prompt: only the estimate + margin is shaved off
  });

  it("shrinks the cap as the measured context grows; floors instead of going non-positive", async () => {
    const { model, configs } = windowModel({
      maxTokens: 32000,
      contextWindow: 32768,
      promptTokens: 30_000,
    });
    await drainAll(model.streamGenerate({ newMessages: [userText("a")] }));
    // Request 2 reasons from request 1's real token_usage (total ≈ 30001): the remaining
    // window is ~1.7k, so the cap lands between the floor and 2k.
    await drainAll(model.streamGenerate({ newMessages: [userText("b")] }));
    const second = configs[1]?.max_tokens ?? 0;
    expect(second).toBeLessThan(2000);
    expect(second).toBeGreaterThanOrEqual(MIN_OUTPUT_TOKENS);
    expect(second).toBeLessThan(configs[0]?.max_tokens ?? 0);
  });

  it("clamps to the deterministic floor once the window is exhausted (degenerate case)", async () => {
    // A measured context beyond the window (compaction disabled/misconfigured): the cap
    // pins at MIN_OUTPUT_TOKENS — never zero or negative, which providers reject outright.
    const { model, configs } = windowModel({
      maxTokens: 32000,
      contextWindow: 32768,
      promptTokens: 40_000,
    });
    await drainAll(model.streamGenerate({ newMessages: [userText("a")] }));
    await drainAll(model.streamGenerate({ newMessages: [userText("b")] }));
    expect(configs[1]?.max_tokens).toBe(MIN_OUTPUT_TOKENS);
  });

  it("keeps the no-explicit-cap contract: without a configured cap nothing goes on the wire", async () => {
    // The provider's own default already bounds output by the remaining window; the clamp
    // must not invent a cap where the config said "none".
    const { model, configs } = windowModel({ contextWindow: 32768, promptTokens: 30_000 });
    await drainAll(model.streamGenerate({ newMessages: [userText("a")] }));
    await drainAll(model.streamGenerate({ newMessages: [userText("b")] }));
    expect(configs[0] !== undefined && "max_tokens" in configs[0]).toBe(false);
    expect(configs[1] !== undefined && "max_tokens" in configs[1]).toBe(false);
  });

  it("setHistory seeds the input estimate, so a resumed session clamps its first request", async () => {
    const { model, configs } = windowModel({ maxTokens: 32000, contextWindow: 32768 });
    // ~30k estimated tokens of replayed history (120k ASCII chars): without the seed the
    // first request after resume would reason from an empty context and send ~31k.
    model.setHistory([userText("x".repeat(120_000))]);
    await drainAll(model.streamGenerate({ newMessages: [userText("continue")] }));
    const cap = configs[0]?.max_tokens ?? 0;
    expect(cap).toBeLessThan(2000);
    expect(cap).toBeGreaterThanOrEqual(MIN_OUTPUT_TOKENS);
  });
});

describe("GenerativeModel rotating credentials", () => {
  it("resolves before every request and rebuilds the client only when the key changes", async () => {
    const resolvedKeys = ["new-key", "new-key", "newer-key"];
    let resolutions = 0;
    const observed: Array<{ apiKey: string | undefined; client: unknown; historyLength: number }> =
      [];

    class RotatingKeyModel extends GenerativeModel {
      protected override openStream(): AsyncIterable<UniEvent> {
        const internals = this as unknown as {
          currentApiKey: string | undefined;
          client: { getHistory(): UniMessage[] };
        };
        observed.push({
          apiKey: internals.currentApiKey,
          client: internals.client,
          historyLength: internals.client.getHistory().length,
        });
        return okStream();
      }
    }

    const model = new RotatingKeyModel({
      modelId: "modelscope-model",
      apiKey: "old-key",
      clientType: "openai-chat",
      tools: [],
      resolveApiKey: async () => resolvedKeys[resolutions++]!,
    });
    model.setHistory([userText("prior turn")]);

    const drain = async (): Promise<void> => {
      const stream = model.streamGenerate({ newMessages: [userText("next")] });
      let result = await stream.next();
      while (!result.done) result = await stream.next();
    };
    await drain();
    await drain();
    await drain();

    expect(resolutions).toBe(3);
    expect(observed.map((item) => item.apiKey)).toEqual(["new-key", "new-key", "newer-key"]);
    expect(observed[1]!.client).toBe(observed[0]!.client);
    expect(observed[2]!.client).not.toBe(observed[1]!.client);
    expect(observed.map((item) => item.historyLength)).toEqual([1, 1, 1]);
  });
});

describe("GenerativeModel.streamGenerate outcome classification (PRN-013)", () => {
  // Injects a controlled UniEvent stream through the protected openStream seam to verify the
  // outcome classification of timeout/network-drop/interrupt/error, without needing a real API.
  // Construction only creates the config object; no network involved.
  class SeamModel extends GenerativeModel {
    constructor(
      private readonly source: (signal: AbortSignal) => AsyncIterable<UniEvent>,
      timeoutMs = 10000,
    ) {
      super({ modelId: "claude-sonnet-4-6", tools: [], requestTimeoutMs: timeoutMs });
    }
    protected override openStream(_uni: UniMessage, signal: AbortSignal): AsyncIterable<UniEvent> {
      return this.source(signal);
    }
  }

  const abortError = (): Error => Object.assign(new Error("aborted"), { name: "AbortError" });

  /**
   * An upstream that IGNORES its AbortSignal: it never yields and never rejects, whatever
   * happens to the signal. This is the shape that wedged real Sessions (observed with Kimi):
   * the SDK's stream promise simply never settles, so `await it.next()` hangs forever and the
   * idle timer cannot rescue it either, because by then `ac` is already aborted and its
   * `ac.abort()` is a no-op.
   */
  async function* deaf(): AsyncGenerator<UniEvent> {
    await new Promise(() => {}); // never settles, never observes the signal
  }

  /** Fails the test loudly instead of letting a regression hang the whole suite. */
  function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      p,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`streamGenerate did not settle within ${ms}ms`)), ms),
      ),
    ]);
  }

  // Never yields any event, and only ends with an AbortError once the signal aborts
  // (simulates idle/hanging).
  async function* hang(signal: AbortSignal): AsyncGenerator<UniEvent> {
    await new Promise<void>((_, reject) => {
      if (signal.aborted) {
        reject(abortError());
        return;
      }
      signal.addEventListener("abort", () => reject(abortError()), { once: true });
    });
  }

  // Yields one fragment of text, then throws a retryable network error (network drop).
  async function* dropAfterText(): AsyncGenerator<UniEvent> {
    yield delta({ type: "text.delta", text: "hi" });
    throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
  }

  // Immediately throws a non-retryable error (auth).
  async function* authError(): AsyncGenerator<UniEvent> {
    throw Object.assign(new Error("invalid api key"), { status: 401 });
  }

  // The response body is not valid JSON (e.g. the gateway returns HTML / a truncated response).
  async function* malformedJsonAfterText(): AsyncGenerator<UniEvent> {
    yield delta({ type: "text.delta", text: "hi" });
    throw new SyntaxError("Unexpected token < in JSON at position 0");
  }

  async function drain(
    gen: AsyncGenerator<OmniMessage, LLMOutcome | void>,
  ): Promise<{ messages: OmniMessage[]; outcome: LLMOutcome }> {
    const messages: OmniMessage[] = [];
    let res = await gen.next();
    while (!res.done) {
      messages.push(res.value);
      res = await gen.next();
    }
    return { messages, outcome: res.value as LLMOutcome };
  }

  it("returns fatal on a build failure such as empty input (never throws)", async () => {
    const model = new SeamModel((sig) => hang(sig));
    const { messages, outcome } = await drain(model.streamGenerate({ newMessages: [] }));
    // A mergeOmniToUniMessage failure converges to fatal (the same input can never
    // assemble on a retry), never throws.
    expect(outcome.status).toBe("fatal");
    expect(messages).toHaveLength(0);
  });

  it("interrupt lands while the consumer is suspended at yield: finish immediately as aborted, never pull the already-aborted upstream again", async () => {
    // This is exactly the cause of "the session hangs forever after interrupting it in the
    // browser": when the user interrupts, this generator is usually suspended at `yield`
    // (the engine is blocked on `await approve(tc)` waiting for manual approval). onUserAbort
    // has already aborted the upstream stream; when the consumer comes to pull again, if we go
    // back and call `it.next()` on that now-dead stream, the promise will never settle again --
    // and the idle timer cannot save it either (once it fires, it just aborts again, which is a
    // no-op on an already-aborted stream). The run then never finishes, and the Session is stuck
    // in running: it can neither send messages nor compact (the frontend's /compact is gated by
    // !running, so clicking it does nothing).
    //
    // The upstream simulates the real cancellation behavior with "pulling again after being
    // aborted never settles." If the fix is missing, this test hangs until it times out and fails.
    async function* deadAfterAbort(): AsyncGenerator<UniEvent> {
      yield delta({ type: "text.delta", text: "hi" });
      await new Promise<never>(() => {}); // Never settles
    }
    const ac = new AbortController();
    // Give the idle timeout plenty of headroom, so it's the "pre-interrupt check" doing the
    // finishing, not the timer as a fallback.
    const model = new SeamModel(() => deadAfterAbort(), 60_000);
    const gen = model.streamGenerate({ newMessages: [userText("go")], signal: ac.signal });

    const first = await gen.next(); // Gets the first message -> this generator is now suspended at yield
    expect(first.done).toBe(false);

    ac.abort(); // User interrupt (we are suspended at yield right now, not inside it.next())

    // The already-resolved buffered messages are drained as usual, and afterward it **must**
    // finish -- the key point is that it ends, rather than going back to pull that dead
    // upstream and hanging the whole run forever (if the fix is missing, this would never
    // get a result, and the test times out and fails).
    let res = await gen.next();
    while (!res.done) res = await gen.next();
    expect(res.value).toMatchObject({ status: "aborted" });
  });

  it("classifies an idle timeout as retryable, with no token_usage", async () => {
    const model = new SeamModel((sig) => hang(sig), 30); // 30ms idle timeout
    const { messages, outcome } = await drain(
      model.streamGenerate({ newMessages: [userText("go")] }),
    );
    expect(outcome.status).toBe("retryable");
    expect(messages.map(typeOf)).not.toContain("token_usage");
  });

  it("classifies an idle timeout as retryable even when the stream ends gracefully on abort", async () => {
    // The underlying implementation does not throw on abort, and ends gracefully with done:
    // this must still be classified as retryable, not mistakenly as completed.
    async function* gracefulHang(signal: AbortSignal): AsyncGenerator<UniEvent> {
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    }
    const model = new SeamModel((sig) => gracefulHang(sig), 30);
    const { messages, outcome } = await drain(
      model.streamGenerate({ newMessages: [userText("go")] }),
    );
    expect(outcome.status).toBe("retryable");
    expect(messages.map(typeOf)).not.toContain("token_usage");
  });

  it("classifies a network drop as retryable, closing the open text segment, no token_usage", async () => {
    const model = new SeamModel(() => dropAfterText());
    const { messages, outcome } = await drain(
      model.streamGenerate({ newMessages: [userText("go")] }),
    );
    expect(outcome.status).toBe("retryable");
    const complete = messages.find((m) => typeOf(m) === "text");
    expect((complete!.payload as TextPayload).text).toBe("hi");
    expect((complete!.payload as TextPayload).stop_reason).toBe("retryable");
    expect(messages.map(typeOf)).not.toContain("token_usage");
  });

  it("classifies a JSON parse exception as retryable and closes partial output", async () => {
    const model = new SeamModel(() => malformedJsonAfterText());
    const { messages, outcome } = await drain(
      model.streamGenerate({ newMessages: [userText("go")] }),
    );
    expect(outcome.status).toBe("retryable");
    expect(outcome.errorMessage).toContain("Unexpected token");
    const complete = messages.find((m) => typeOf(m) === "text");
    expect((complete!.payload as TextPayload).text).toBe("hi");
    expect((complete!.payload as TextPayload).stop_reason).toBe("retryable");
    expect(messages.map(typeOf)).not.toContain("token_usage");
  });

  it("classifies a cleanly-truncated stream (no usage to close it with) as malformed, not failed", async () => {
    // The server/proxy cleanly drops the stream at an event boundary (no network error thrown):
    // MMSP throws a plain Error in place of the stop event; this is an incomplete LLM Request
    // that must go through the malformed reconnect path, and must not abort the task as failed.
    async function* cleanTruncationAfterText(): AsyncGenerator<UniEvent> {
      yield* text(["hi"]);
      throw new Error("Streaming response ended without usage_metadata");
    }
    const model = new SeamModel(() => cleanTruncationAfterText());
    const { messages, outcome } = await drain(
      model.streamGenerate({ newMessages: [userText("go")] }),
    );
    expect(outcome).toMatchObject({ status: "retryable", errorCode: "malformed" });
    expect(messages.map(typeOf)).not.toContain("token_usage");
    // The text's done item had arrived, but its request never committed: labelled retryable.
    const complete = messages.find((m) => typeOf(m) === "text")!.payload as TextPayload;
    expect(complete.text).toBe("hi");
    expect(complete.stop_reason).toBe("retryable");

    async function* noEvents(): AsyncGenerator<UniEvent> {
      throw new Error("Streaming response ended without finish_reason");
    }
    const model2 = new SeamModel(() => noEvents());
    const { outcome: outcome2 } = await drain(
      model2.streamGenerate({ newMessages: [userText("go")] }),
    );
    expect(outcome2.status).toBe("retryable");
  });

  it("a stream that ends without its stop event is retryable, never completed", async () => {
    // Nothing threw, but no stop event means no usage and no committed turn: the engine must
    // reconnect, not report a completed request with empty usage.
    async function* endsWithoutStop(): AsyncGenerator<UniEvent> {
      yield* text(["hi"]);
    }
    const model = new SeamModel(() => endsWithoutStop());
    const { messages, outcome } = await drain(
      model.streamGenerate({ newMessages: [userText("go")] }),
    );
    expect(outcome).toMatchObject({ status: "retryable", errorCode: "malformed" });
    expect(messages.map(typeOf)).not.toContain("token_usage");
    expect((messages.find((m) => typeOf(m) === "text")!.payload as TextPayload).stop_reason).toBe(
      "retryable",
    );
  });

  it("a stop event in hand completes the request even when the abort landed as it arrived", async () => {
    // MMSP records the turn in its history before yielding the stop event, so a request whose
    // stop event was received is committed whatever the abort signal says: treating it as
    // aborted would have the engine flatten a committed tool_use turn, and every later
    // request would be rejected as an unanswered tool_use.
    const controller = new AbortController();
    const events = [...text(["done"]), stop("stop", { ...NO_USAGE, response_tokens: 1 })];
    const source: AsyncIterable<UniEvent> = {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<UniEvent>> {
            const value = events.shift();
            if (value === undefined) return Promise.resolve({ done: true, value: undefined });
            // The abort lands in a microtask behind the stop event, ahead of the consumer.
            if (value.event_type === "stop") void Promise.resolve().then(() => controller.abort());
            return Promise.resolve({ done: false, value });
          },
        };
      },
    };
    const model = new SeamModel(() => source);
    const { messages, outcome } = await drain(
      model.streamGenerate({ newMessages: [userText("go")], signal: controller.signal }),
    );
    expect(controller.signal.aborted).toBe(true);
    expect(outcome.status).toBe("completed");
    expect(messages.map(typeOf)).toContain("token_usage");
  });

  it("a user abort ends the run even when upstream ignores the signal and never settles", async () => {
    const model = new SeamModel(() => deaf());
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20); // the user presses Stop mid-request
    // Without the race this never settles and the Session stays "running" forever.
    const { outcome } = await withTimeout(
      drain(model.streamGenerate({ newMessages: [userText("go")], signal: controller.signal })),
      2000,
    );
    expect(outcome.status).toBe("aborted");
  });

  it("the idle timeout still ends the run when upstream ignores the signal", async () => {
    const model = new SeamModel(() => deaf(), 50); // 50ms idle budget
    const { outcome } = await withTimeout(
      drain(model.streamGenerate({ newMessages: [userText("go")] })),
      2000,
    );
    expect(outcome.status).toBe("retryable");
  });

  it("classifies a credentials failure as fatal; a parameter 400 is fatal too", async () => {
    const model = new SeamModel(() => authError());
    const { messages, outcome } = await drain(
      model.streamGenerate({ newMessages: [userText("go")] }),
    );
    // 401 = credentials failure: fatal — the engine stops the run and the errorMessage
    // tells the user to update the model's API key.
    expect(outcome.status).toBe("fatal");
    expect(outcome.errorMessage).toContain("invalid api key");
    expect(messages.map(typeOf)).not.toContain("token_usage");

    // A parameter error (400) is a definitive provider rejection: fatal — the identical
    // request fails identically on every retry, so the engine surfaces it immediately.
    async function* paramError(): AsyncGenerator<UniEvent> {
      throw Object.assign(new Error("unknown parameter: max_output_tokens"), { status: 400 });
    }
    const model2 = new SeamModel(() => paramError());
    const { outcome: outcome2 } = await drain(
      model2.streamGenerate({ newMessages: [userText("go")] }),
    );
    expect(outcome2.status).toBe("fatal");
  });

  it("marks a fast-mode rejection as fatal with actionable guidance (guarded on its own config)", async () => {
    // MMSP throws UnsupportedParameterError before any network I/O when fast_mode is
    // enabled on a model without a fast tier: deterministic for this object's frozen config,
    // so it is fatal — the engine aborts on it instead of retrying (the engine side is
    // covered in engine.test.ts).
    async function* fastModeRejected(): AsyncGenerator<UniEvent> {
      throw new UnsupportedParameterError({
        client: "MoonshotOfficialClient",
        parameter: "fast_mode",
        message: "Kimi does not support fast mode.",
      });
    }
    class FastSeamModel extends GenerativeModel {
      constructor(fastMode: boolean) {
        // A real AutoLLMClient is constructed even though openStream is overridden, and the
        // Kimi client's OpenAI SDK demands a credential at construction time. The key is
        // passed explicitly so the config is frozen here rather than read from the ambient
        // environment (see test/provider-keys.ts); nothing is ever sent.
        super({
          modelId: "kimi-k3",
          tools: [],
          fastMode,
          requestTimeoutMs: 10000,
          apiKey: "test-key-not-used",
        });
      }
      protected override openStream(): AsyncIterable<UniEvent> {
        return fastModeRejected();
      }
    }
    const model = new FastSeamModel(true);
    const { messages, outcome } = await drain(
      model.streamGenerate({ newMessages: [userText("go")] }),
    );
    expect(outcome.status).toBe("fatal");
    // The surfaced text keeps MMSP's own words and appends where the switch lives.
    expect(outcome.errorMessage).toContain("Kimi does not support fast mode.");
    expect(outcome.errorMessage).toContain(FAST_MODE_UNSUPPORTED_GUIDANCE);
    expect(messages.map(typeOf)).not.toContain("token_usage");

    // Guard: the same error on a config that never sent fast_mode cannot be ours to
    // explain — it carries no HTTP status, so it stays retryable and rides the engine's
    // ladder.
    const model2 = new FastSeamModel(false);
    const { outcome: outcome2 } = await drain(
      model2.streamGenerate({ newMessages: [userText("go")] }),
    );
    expect(outcome2.status).toBe("retryable");
  });

  it("an explicit auth signal wins whatever the message says: fatal, never retried", async () => {
    // 403 + body code invalid_api_key + a message mentioning the subscription: the
    // explicit credential signal decides — fatal, and no message vocabulary may pull a
    // dead credential back onto the retry ladder.
    async function* dressedAuthError(): AsyncGenerator<UniEvent> {
      throw Object.assign(new Error("subscription key invalid"), {
        status: 403,
        error: { code: "invalid_api_key" },
      });
    }
    const model = new SeamModel(() => dressedAuthError());
    const { messages, outcome } = await drain(
      model.streamGenerate({ newMessages: [userText("go")] }),
    );
    expect(outcome.status).toBe("fatal");
    expect(outcome.errorMessage).toContain("subscription key invalid");
    expect(messages.map(typeOf)).not.toContain("token_usage");
  });

  it("labels a bare 403 as fatal — a definitive provider rejection, no message heuristics involved", async () => {
    // A 4xx (minus 408/429) is a definitive rejection: fatal, whatever the message says.
    // A quota-coded provider rejection classifies exactly the same way, and its real
    // message still rides on the outcome for observability.
    async function* bare403(): AsyncGenerator<UniEvent> {
      throw Object.assign(new Error("forbidden"), { status: 403 });
    }
    const model = new SeamModel(() => bare403());
    const { messages, outcome } = await drain(
      model.streamGenerate({ newMessages: [userText("go")] }),
    );
    expect(outcome.status).toBe("fatal");
    expect(outcome.errorMessage).toContain("forbidden");
    expect(messages.map(typeOf)).not.toContain("token_usage");

    async function* quotaCoded403(): AsyncGenerator<UniEvent> {
      throw Object.assign(new Error("no active subscription"), {
        status: 403,
        code: "insufficient_user_quota",
      });
    }
    const model2 = new SeamModel(() => quotaCoded403());
    const { outcome: outcome2 } = await drain(
      model2.streamGenerate({ newMessages: [userText("go")] }),
    );
    expect(outcome2.status).toBe("fatal");
    expect(outcome2.errorMessage).toContain("insufficient_user_quota");
  });

  // The provider's wording singles out two definitive rejections — wherever it rides: the
  // error's message, the parsed body's code, the Anthropic body's nested message. Only a 4xx
  // is read this way: a 5xx stays retryable whatever it says.
  it.each([
    {
      name: "llama.cpp past its context size",
      status: 400,
      message:
        "request (100091 tokens) exceeds the available context size (98304 tokens), try increasing it",
      body: undefined,
      stopReason: "fatal",
      code: "context_overflow",
    },
    {
      name: "OpenAI context_length_exceeded",
      status: 400,
      message: "400 Bad Request",
      body: { code: "context_length_exceeded", type: "invalid_request_error" },
      stopReason: "fatal",
      code: "context_overflow",
    },
    {
      name: "Anthropic prompt is too long",
      status: 400,
      message: "400 invalid_request_error",
      body: {
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "prompt is too long: 210000 tokens > 200000 maximum",
        },
      },
      stopReason: "fatal",
      code: "context_overflow",
    },
    {
      name: "DeepSeek unsupported image",
      status: 400,
      message:
        "input[366].image[0]: You have uploaded an unsupported image. Please make sure your " +
        "image is valid and has one of the following formats: webp, png, jpeg, and gif.",
      body: undefined,
      stopReason: "fatal",
      code: "image_rejected",
    },
    {
      name: "Anthropic Could not process image",
      status: 400,
      message: "Could not process image",
      body: undefined,
      stopReason: "fatal",
      code: "image_rejected",
    },
    {
      name: "a plain parameter 400",
      status: 400,
      message: "unknown parameter: max_output_tokens",
      body: undefined,
      stopReason: "fatal",
      code: "rejected",
    },
    {
      name: "a 500 worded like an image rejection",
      status: 500,
      message: "Could not process image",
      body: undefined,
      stopReason: "retryable",
      code: "network",
    },
  ])("classifies $name as $code", async ({ status, message, body, stopReason, code }) => {
    async function* rejection(): AsyncGenerator<UniEvent> {
      throw Object.assign(new Error(message), { status, ...(body ? { error: body } : {}) });
    }
    const model = new SeamModel(() => rejection());
    const { outcome } = await drain(model.streamGenerate({ newMessages: [userText("go")] }));
    expect(outcome).toMatchObject({ status: stopReason, errorCode: code });
  });

  it("classifies an undici transport drop (TypeError terminated, cause UND_ERR_SOCKET) as retryable", async () => {
    async function* socketDrop(): AsyncGenerator<UniEvent> {
      yield delta({ type: "text.delta", text: "hi" });
      throw new TypeError("terminated", {
        cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }),
      });
    }
    const model = new SeamModel(() => socketDrop());
    const { messages, outcome } = await drain(
      model.streamGenerate({ newMessages: [userText("go")] }),
    );
    expect(outcome.status).toBe("retryable");
    const complete = messages.find((m) => typeOf(m) === "text");
    expect((complete!.payload as TextPayload).stop_reason).toBe("retryable");
    expect(messages.map(typeOf)).not.toContain("token_usage");
  });

  it("classifies a user abort (mid idle) as aborted, not retryable", async () => {
    const controller = new AbortController();
    const model = new SeamModel((sig) => hang(sig)); // Default 10s timeout, won't fire first
    const p = drain(
      model.streamGenerate({
        newMessages: [userText("go")],
        signal: controller.signal,
      }),
    );
    setTimeout(() => controller.abort(), 20);
    const { outcome } = await p;
    expect(outcome.status).toBe("aborted");
  });
});

describe("provider fidelity payloads (opaque)", () => {
  it("round-trips fidelity payloads back to UniMessage content items (setHistory path)", () => {
    const uni = mergeOmniToUniMessage([
      thinkingMessage("deep", "completed", { signature: "sig-1" }),
      assistantText("hi", "completed", { phase: "answer", signature: "sig-2" }),
      toolCall({ name: "t", arguments: "{}", toolCallId: "tc1", fidelity: { signature: "sig-3" } }),
    ]);
    expect(uni.content_items).toEqual([
      { type: "thinking.done", thinking: "deep", fidelity: { signature: "sig-1" } },
      { type: "text.done", text: "hi", fidelity: { phase: "answer", signature: "sig-2" } },
      {
        type: "tool_call.done",
        name: "t",
        arguments: {},
        tool_call_id: "tc1",
        fidelity: { signature: "sig-3" },
      },
    ]);
  });

  it("an empty-text message keeps its fidelity on the way out (a signed empty part is still signed)", () => {
    const uni = mergeOmniToUniMessage([assistantText("", "completed", { signature: "sig-t" })]);
    expect(uni.content_items).toEqual([
      { type: "text.done", text: "", fidelity: { signature: "sig-t" } },
    ]);
  });
});

describe("tool_call_id uniquification (name-as-id providers, e.g. Gemini uses the function name as the id)", () => {
  const callIdsOf = (messages: OmniMessage[]): string[] =>
    messages
      .filter((m) => typeOf(m) === "tool_call")
      .map((m) => (m.payload as ToolCallPayload).tool_call_id);

  it("the second call with a duplicate id within one Request is not dropped and gets the #2 suffix", () => {
    const { messages } = translateEvents([
      ...call("get_time", "get_time", ['{"city":"Tokyo"}']),
      ...call("get_time", "get_time", ['{"city":"Paris"}']),
      stop("tool_call"),
    ]);
    expect(callIdsOf(messages)).toEqual(["get_time", "get_time#2"]);
    const calls = messages
      .filter((m) => typeOf(m) === "tool_call")
      .map((m) => m.payload as ToolCallPayload);
    expect(calls[0]!.arguments).toBe('{"city":"Tokyo"}');
    expect(calls[1]!.arguments).toBe('{"city":"Paris"}');
    expect(calls.every((c) => c.stop_reason === "completed")).toBe(true);
    // The fragments of each call go out under its own id, the suffixed one included.
    const partialIds = messages
      .filter((m) => typeOf(m) === "partial_tool_call")
      .map((m) => (m.payload as { tool_call_id: string }).tool_call_id);
    expect(partialIds).toEqual([
      "get_time",
      "get_time",
      "get_time",
      "get_time#2",
      "get_time#2",
      "get_time#2",
    ]);
  });

  it("parallel calls with distinct ids are unaffected (passed through as-is, no suffix)", () => {
    const { messages } = translateEvents([
      ...call("get_time", "get_time", ["{}"]),
      ...call("get_weather", "get_weather", ["{}"]),
      ...call("get_time", "get_time", ["{}"]),
      stop("tool_call"),
    ]);
    expect(callIdsOf(messages)).toEqual(["get_time", "get_weather", "get_time#2"]);
  });

  it("the registry is shared across Requests: a same-name call in the next round gets a new suffix (frontend tool cards no longer overwrite each other)", () => {
    const ids = new ToolCallIdAllocator();
    const round = (city: string): string[] => {
      const translator = new EventTranslator(ids);
      const out: OmniMessage[] = [];
      for (const e of [
        ...call("get_time", "get_time", [`{"city":"${city}"}`]),
        stop("tool_call"),
      ]) {
        for (const m of translator.pushEvent(e)) out.push(m);
      }
      return callIdsOf(out);
    };
    expect(round("Tokyo")).toEqual(["get_time"]);
    expect(round("Paris")).toEqual(["get_time#2"]);
    expect(round("NYC")).toEqual(["get_time#3"]);
  });

  it("on a cross-Request collision, partial fragments and the complete message use the same suffixed id", () => {
    const ids = new ToolCallIdAllocator();
    ids.markUsed("exec"); // this provider id was already taken in the previous turn
    const { messages } = (() => {
      const translator = new EventTranslator(ids);
      const out: OmniMessage[] = [];
      for (const e of [...call("exec", "exec", ['{"cmd":', '"ls"}']), stop("tool_call")]) {
        for (const m of translator.pushEvent(e)) out.push(m);
      }
      return { messages: out };
    })();
    const partialIds = messages
      .filter((m) => typeOf(m) === "partial_tool_call")
      .map((m) => (m.payload as { tool_call_id: string }).tool_call_id);
    expect(partialIds).toHaveLength(4); // start + delta×2 + stop
    expect(partialIds.every((id) => id === "exec#2")).toBe(true);
    expect(callIdsOf(messages)).toEqual(["exec#2"]);
  });

  it("outbound restoration: the #n suffix on tool_call / tool_call_output is stripped before sending to the provider; unsuffixed ids pass as-is", () => {
    const result = mergeOmniToUniMessage([
      toolCallOutput({ output: "10:00", toolCallId: "get_time#2" }),
    ]);
    expect((result.content_items[0] as { tool_call_id: string }).tool_call_id).toBe("get_time");

    const call = mergeOmniToUniMessage([
      toolCall({ name: "get_time", arguments: "{}", toolCallId: "get_time#3" }),
    ]);
    expect((call.content_items[0] as { tool_call_id: string }).tool_call_id).toBe("get_time");

    const passthrough = mergeOmniToUniMessage([
      toolCallOutput({ output: "ok", toolCallId: "call_Ab12" }),
    ]);
    expect((passthrough.content_items[0] as { tool_call_id: string }).tool_call_id).toBe(
      "call_Ab12",
    );
  });

  it("stripToolCallIdSuffix only strips a trailing #digits (idempotent, never touches an infix)", () => {
    expect(stripToolCallIdSuffix("get_time#2")).toBe("get_time");
    expect(stripToolCallIdSuffix("get_time#12")).toBe("get_time");
    expect(stripToolCallIdSuffix("get_time")).toBe("get_time");
    expect(stripToolCallIdSuffix("a#2b")).toBe("a#2b");
    expect(stripToolCallIdSuffix("a#x")).toBe("a#x");
  });

  it("ToolCallIdAllocator: probing skips occupied suffixes; markUsed seeding takes effect", () => {
    const ids = new ToolCallIdAllocator();
    ids.markUsed("t");
    ids.markUsed("t#2");
    expect(ids.allocate("t")).toBe("t#3");
    expect(ids.allocate("u")).toBe("u");
    expect(ids.allocate("u")).toBe("u#2");
  });

  it("resume seeding: after setHistory, new same-name calls do not collide with historical ids", async () => {
    class SeedModel extends GenerativeModel {
      constructor() {
        super({ modelId: "claude-sonnet-4-6", tools: [] });
      }
      protected override openStream(
        _uni: UniMessage,
        _signal: AbortSignal,
      ): AsyncIterable<UniEvent> {
        return (async function* () {
          yield* call("get_time", "get_time", ['{"city":"Paris"}']);
          yield stop("tool_call");
        })();
      }
    }
    const model = new SeedModel();
    model.setHistory([
      userText("What time is it in Tokyo?"),
      toolCall({ name: "get_time", arguments: '{"city":"Tokyo"}', toolCallId: "get_time" }),
      toolCallOutput({ output: "10:00", toolCallId: "get_time" }),
    ]);

    const out: OmniMessage[] = [];
    const gen = model.streamGenerate({ newMessages: [userText("And Paris?")] });
    let res = await gen.next();
    while (!res.done) {
      out.push(res.value);
      res = await gen.next();
    }
    expect(callIdsOf(out)).toEqual(["get_time#2"]);
  });
});
