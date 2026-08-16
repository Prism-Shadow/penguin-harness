/**
 * GenerativeModel pure unit tests (no network).
 *
 * Covers two core pieces of logic:
 *   1. Merging OmniMessage[] into one UniMessage (including throwing on mixed roles, and
 *      mapping each content type);
 *   2. Translating/aggregating UniEvent[] into OmniMessage[] (partial_* ordering, complete
 *      messages, token_usage accumulation, tool_call_id passthrough).
 * As well as helper functions for token conversion, UniConfig construction, and retry
 * determination.
 */
import { describe, expect, it } from "vitest";
import {
  EmptyResponseError,
  ThinkingLevel,
  ToolCallArgumentParseError,
  UnsupportedParameterError,
} from "@prismshadow/agenthub";
import type { UniConfig, UniEvent, UniMessage, UsageMetadata } from "@prismshadow/agenthub";
import type { LLMOutcome, ThinkingLevelName } from "../src/interfaces.js";

import {
  EventTranslator,
  GenerativeModel,
  MIN_OUTPUT_TOKENS,
  ToolCallIdAllocator,
  buildUniConfig,
  isAuthenticationError,
  isIncompleteStreamError,
  isFastModeUnsupportedError,
  isMalformedJsonParseError,
  isRetryableError,
  FAST_MODE_UNSUPPORTED_GUIDANCE,
  isThinkingReplayRejection,
  mapThinkingLevel,
  mergeOmniToUniMessage,
  stripToolCallIdSuffix,
  toolDefinitionsToSchemas,
  translateEvents,
  usageToTokenCounts,
} from "../src/llm/index.js";
import {
  assistantText,
  imageUrlMessage,
  inlineData,
  inlineThinking,
  thinkingMessage,
  toolCall,
  toolCallOutput,
  userText,
} from "../src/omnimessage/index.js";
import type {
  OmniMessage,
  TextPayload,
  ThinkingPayload,
  ToolCallPayload,
  TokenUsagePayload,
} from "../src/omnimessage/index.js";

// Small helper to construct a UniEvent.
function ev(partial: Partial<UniEvent> & Pick<UniEvent, "content_items">): UniEvent {
  return {
    role: "assistant",
    event_type: "delta",
    usage_metadata: null,
    finish_reason: null,
    ...partial,
  };
}

describe("mergeOmniToUniMessage", () => {
  it("merges same-role messages into one UniMessage and maps content types", () => {
    const uni = mergeOmniToUniMessage([
      userText("hello"),
      imageUrlMessage("https://example.com/a.png"),
      inlineData("user", Buffer.from("xyz").toString("base64"), "image/png"),
    ]);
    expect(uni.role).toBe("user");
    expect(uni.content_items).toHaveLength(3);
    expect(uni.content_items[0]).toEqual({ type: "text", text: "hello" });
    expect(uni.content_items[1]).toEqual({
      type: "image_url",
      image_url: "https://example.com/a.png",
    });
    const inline = uni.content_items[2]!;
    expect(inline.type).toBe("inline_data");
    if (inline.type === "inline_data") {
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
      type: "thinking",
      thinking: "step by step",
    });
    const inline = uni.content_items[1]!;
    expect(inline.type).toBe("inline_thinking");
    if (inline.type === "inline_thinking") {
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
      type: "tool_call",
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
      type: "tool_result",
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
      type: "tool_result",
      text: "image/png, 4 B",
      images: [dataUrl],
      tool_call_id: "call_img",
    });
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
    const events: UniEvent[] = [
      ev({ event_type: "start", content_items: [] }),
      ev({ content_items: [{ type: "text", text: "Hel" }] }),
      ev({ content_items: [{ type: "text", text: "lo" }] }),
      ev({
        event_type: "stop",
        content_items: [],
        finish_reason: "stop",
        usage_metadata: {
          cached_tokens: 0,
          prompt_tokens: 12,
          thoughts_tokens: 0,
          response_tokens: 4,
        },
      }),
    ];
    const { messages, requestTokens, sessionTokens } = translateEvents(events);

    const types = messages.map((m) => (m.payload as { type: string }).type);
    // partial start, two deltas, partial stop, complete text, token_usage.
    expect(types).toEqual([
      "partial_text",
      "partial_text",
      "partial_text",
      "partial_text",
      "text",
      "token_usage",
    ]);

    // partial events: start (empty) → delta "Hel" → delta "lo" → stop.
    const ptexts = messages
      .filter((m) => (m.payload as { type: string }).type === "partial_text")
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

    // complete text message: concatenated, stop_reason completed (finish_reason "stop").
    const complete = messages.find((m) => (m.payload as { type: string }).type === "text")!
      .payload as TextPayload;
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

  it("accumulates partial_tool_call args, uses complete tool_call as authoritative, preserves id", () => {
    const events: UniEvent[] = [
      ev({
        event_type: "start",
        content_items: [
          { type: "partial_tool_call", name: "exec_command", arguments: "", tool_call_id: "c1" },
        ],
      }),
      ev({
        content_items: [
          {
            type: "partial_tool_call",
            name: "exec_command",
            arguments: '{"cmd":"ls',
            tool_call_id: "c1",
          },
        ],
      }),
      ev({
        content_items: [
          {
            type: "partial_tool_call",
            name: "exec_command",
            arguments: ' -la"}',
            tool_call_id: "c1",
          },
        ],
      }),
      ev({
        event_type: "stop",
        finish_reason: "tool_call",
        content_items: [
          {
            type: "tool_call",
            name: "exec_command",
            arguments: { cmd: "ls -la" },
            tool_call_id: "c1",
          },
        ],
      }),
    ];
    const { messages } = translateEvents(events);
    const types = messages.map((m) => (m.payload as { type: string }).type);
    expect(types).toEqual([
      "partial_tool_call", // start
      "partial_tool_call", // delta
      "partial_tool_call", // delta
      "partial_tool_call", // stop
      "tool_call", // complete
      "token_usage",
    ]);

    // partial start carries name, no args; deltas carry arg fragments.
    const partials = messages
      .filter((m) => (m.payload as { type: string }).type === "partial_tool_call")
      .map((m) => m.payload as { event_type: string; arguments: string; tool_call_id: string });
    expect(partials[0]!.event_type).toBe("start");
    expect(partials[0]!.arguments).toBe("");
    expect(partials[1]!.arguments).toBe('{"cmd":"ls');
    expect(partials[2]!.arguments).toBe(' -la"}');
    expect(partials[3]!.event_type).toBe("stop");
    expect(partials.every((p) => p.tool_call_id === "c1")).toBe(true);

    // complete tool_call uses the authoritative complete content item.
    const tc = messages.find((m) => (m.payload as { type: string }).type === "tool_call")!
      .payload as ToolCallPayload;
    expect(tc.name).toBe("exec_command");
    expect(tc.tool_call_id).toBe("c1");
    expect(tc.arguments).toBe('{"cmd":"ls -la"}');
    expect(tc.stop_reason).toBe("completed");
  });

  it("falls back to accumulated arg buffer when no complete tool_call item arrives", () => {
    const events: UniEvent[] = [
      ev({
        event_type: "start",
        content_items: [
          { type: "partial_tool_call", name: "do_it", arguments: '{"x":', tool_call_id: "z9" },
        ],
      }),
      ev({
        content_items: [
          { type: "partial_tool_call", name: "do_it", arguments: "1}", tool_call_id: "z9" },
        ],
      }),
      ev({ event_type: "stop", finish_reason: "tool_call", content_items: [] }),
    ];
    const { messages } = translateEvents(events);
    const tc = messages.find((m) => (m.payload as { type: string }).type === "tool_call")!
      .payload as ToolCallPayload;
    expect(tc.arguments).toBe('{"x":1}');
    expect(tc.tool_call_id).toBe("z9");
  });

  it("ignores tool-call fragments with empty tool_call_id (no spurious empty tool_call)", () => {
    // Regression: some early streamed fragments may carry an empty tool_call_id; this must not
    // be used to generate an empty tool_call (otherwise it would trigger "Unknown tool" and
    // AgentHub's "tool_call_id is required" error).
    const events: UniEvent[] = [
      ev({
        event_type: "start",
        content_items: [
          { type: "partial_tool_call", name: "exec_command", arguments: "", tool_call_id: "real1" },
        ],
      }),
      // A streamed fragment with an empty id mixed in.
      ev({
        content_items: [{ type: "partial_tool_call", name: "", arguments: "", tool_call_id: "" }],
      }),
      ev({
        content_items: [
          {
            type: "partial_tool_call",
            name: "exec_command",
            arguments: '{"cmd":"ls"}',
            tool_call_id: "real1",
          },
        ],
      }),
      ev({
        event_type: "stop",
        finish_reason: "tool_call",
        content_items: [
          {
            type: "tool_call",
            name: "exec_command",
            arguments: { cmd: "ls" },
            tool_call_id: "real1",
          },
          // A complete tool_call with an empty id should also be ignored.
          { type: "tool_call", name: "", arguments: {}, tool_call_id: "" },
        ],
      }),
    ];
    const { messages } = translateEvents(events);
    const toolCalls = messages.filter((m) => (m.payload as { type: string }).type === "tool_call");
    expect(toolCalls).toHaveLength(1);
    expect((toolCalls[0]!.payload as ToolCallPayload).tool_call_id).toBe("real1");
    // No message should carry an empty tool_call_id.
    const emptyIds = messages.filter(
      (m) => (m.payload as { tool_call_id?: string }).tool_call_id === "",
    );
    expect(emptyIds).toHaveLength(0);
  });

  it("attributes empty-id tool-call argument deltas to the active tool call", () => {
    const events: UniEvent[] = [
      ev({
        event_type: "start",
        content_items: [
          { type: "partial_tool_call", name: "exec_command", arguments: "", tool_call_id: "real1" },
        ],
      }),
      ev({
        content_items: [
          { type: "partial_tool_call", name: "", arguments: '{"cmd":"l', tool_call_id: "" },
        ],
      }),
      ev({
        content_items: [
          { type: "partial_tool_call", name: "", arguments: 's"}', tool_call_id: "" },
        ],
      }),
      ev({
        event_type: "stop",
        finish_reason: "tool_call",
        content_items: [
          {
            type: "tool_call",
            name: "exec_command",
            arguments: { cmd: "ls" },
            tool_call_id: "real1",
          },
        ],
      }),
    ];
    const { messages } = translateEvents(events);
    const deltas = messages
      .filter(
        (m) =>
          (m.payload as { type: string }).type === "partial_tool_call" &&
          (m.payload as { event_type: string }).event_type === "delta",
      )
      .map((m) => m.payload as { arguments: string; tool_call_id: string });

    expect(deltas.map((p) => p.arguments)).toEqual(['{"cmd":"l', 's"}']);
    expect(deltas.every((p) => p.tool_call_id === "real1")).toBe(true);
  });

  it("emits a complete tool_call immediately when its complete content item arrives mid-stream (async/incremental)", () => {
    // Two tools: the first's complete content item arrives mid-stream (not at finish) -> should
    // be produced immediately.
    const events: UniEvent[] = [
      ev({
        event_type: "start",
        content_items: [
          {
            type: "partial_tool_call",
            name: "exec_command",
            arguments: '{"cmd":"a"}',
            tool_call_id: "t1",
          },
        ],
      }),
      // t1's complete content item arrives early (before t2), and should finish t1 immediately.
      ev({
        content_items: [
          { type: "tool_call", name: "exec_command", arguments: { cmd: "a" }, tool_call_id: "t1" },
        ],
      }),
      ev({
        content_items: [
          {
            type: "partial_tool_call",
            name: "exec_command",
            arguments: '{"cmd":"b"}',
            tool_call_id: "t2",
          },
          { type: "tool_call", name: "exec_command", arguments: { cmd: "b" }, tool_call_id: "t2" },
        ],
      }),
      ev({ event_type: "stop", finish_reason: "tool_call", content_items: [] }),
    ];
    const { messages } = translateEvents(events);
    const completeToolCalls = messages.filter(
      (m) => (m.payload as { type: string }).type === "tool_call",
    );
    // Both complete tool_calls are produced, with t1 before t2 (in arrival order, not as a
    // batch at finish).
    expect(completeToolCalls.map((m) => (m.payload as ToolCallPayload).tool_call_id)).toEqual([
      "t1",
      "t2",
    ]);
    // t1's complete tool_call appears before t2's start fragment (proving it was produced
    // before finish).
    const idxT1Complete = messages.findIndex(
      (m) =>
        (m.payload as { type: string }).type === "tool_call" &&
        (m.payload as ToolCallPayload).tool_call_id === "t1",
    );
    const idxT2Start = messages.findIndex(
      (m) =>
        (m.payload as { type: string }).type === "partial_tool_call" &&
        (m.payload as { tool_call_id?: string }).tool_call_id === "t2",
    );
    expect(idxT1Complete).toBeLessThan(idxT2Start);
    // Each tool is produced exactly once (no duplication at finish).
    expect(completeToolCalls).toHaveLength(2);
  });

  it("does not write name on delta or stop tool-call partials", () => {
    const events: UniEvent[] = [
      ev({
        event_type: "start",
        content_items: [
          { type: "partial_tool_call", name: "exec_command", arguments: "", tool_call_id: "c1" },
        ],
      }),
      ev({
        content_items: [
          {
            type: "partial_tool_call",
            name: "exec_command",
            arguments: '{"cmd":"ls"}',
            tool_call_id: "c1",
          },
        ],
      }),
      ev({ event_type: "stop", finish_reason: "tool_call", content_items: [] }),
    ];
    const { messages } = translateEvents(events);
    const partials = messages.filter(
      (m) => (m.payload as { type: string }).type === "partial_tool_call",
    ) as { payload: { event_type: string; name: string } }[];
    const start = partials.find((p) => p.payload.event_type === "start")!;
    const delta = partials.find((p) => p.payload.event_type === "delta")!;
    const stop = partials.find((p) => p.payload.event_type === "stop")!;
    expect(start.payload.name).toBe("exec_command"); // start still carries name.
    expect(delta.payload.name).toBe(""); // delta does not carry name.
    expect(stop.payload.name).toBe(""); // stop does not carry name.
  });

  it("emits thinking partials and a complete thinking message before text", () => {
    const events: UniEvent[] = [
      ev({ event_type: "start", content_items: [{ type: "thinking", thinking: "Let me" }] }),
      ev({ content_items: [{ type: "thinking", thinking: " think" }] }),
      ev({ content_items: [{ type: "text", text: "Answer" }] }),
      ev({ event_type: "stop", finish_reason: "stop", content_items: [] }),
    ];
    const { messages } = translateEvents(events);
    const completeTypes = messages
      .map((m) => (m.payload as { type: string }).type)
      .filter((t) => t === "thinking" || t === "text");
    // thinking complete message emitted before text complete message.
    expect(completeTypes).toEqual(["thinking", "text"]);

    const think = messages.find((m) => (m.payload as { type: string }).type === "thinking")!
      .payload as ThinkingPayload;
    expect(think.thinking).toBe("Let me think");
  });

  it("emits complete thinking and text before a mid-stream complete tool_call", () => {
    // Reproduces the "thinking ends up after tool_call in Trace" regression: the model thinks
    // first, then outputs text, then the tool call's complete content item arrives before
    // finish. The complete-message order must be thinking -> text -> tool_call (not
    // tool_call -> thinking -> text).
    const events: UniEvent[] = [
      ev({ event_type: "start", content_items: [{ type: "thinking", thinking: "I should" }] }),
      ev({ content_items: [{ type: "thinking", thinking: " run ls" }] }),
      ev({ content_items: [{ type: "text", text: "Running it." }] }),
      ev({
        content_items: [
          {
            type: "partial_tool_call",
            name: "exec_command",
            arguments: '{"cmd":"ls"}',
            tool_call_id: "c1",
          },
          { type: "tool_call", name: "exec_command", arguments: { cmd: "ls" }, tool_call_id: "c1" },
        ],
      }),
      ev({ event_type: "stop", finish_reason: "tool_call", content_items: [] }),
    ];
    const { messages } = translateEvents(events);

    const completeTypes = messages
      .map((m) => (m.payload as { type: string }).type)
      .filter((t) => t === "thinking" || t === "text" || t === "tool_call");
    // Complete-message order: thinking -> text -> tool_call, each exactly once (flush does not repeat).
    expect(completeTypes).toEqual(["thinking", "text", "tool_call"]);

    // Complete thinking/text are marked completed when finished at the boundary (the finish
    // reason belongs to the tool_call itself).
    const think = messages.find((m) => (m.payload as { type: string }).type === "thinking")!
      .payload as ThinkingPayload;
    expect(think.thinking).toBe("I should run ls");
    expect(think.stop_reason).toBe("completed");
    const text = messages.find((m) => (m.payload as { type: string }).type === "text")!
      .payload as TextPayload;
    expect(text.text).toBe("Running it.");
    expect(text.stop_reason).toBe("completed");
    const tc = messages.find((m) => (m.payload as { type: string }).type === "tool_call")!
      .payload as ToolCallPayload;
    expect(tc.stop_reason).toBe("completed");
  });

  it("flushes thinking/text emitted after a tool_call (does not drop later segments)", () => {
    // Interleaved output: text appears both before and after tool_call. The reset-after-flush
    // design should let a new text segment following tool_call still be produced correctly at
    // finish (a one-shot guard would lose it).
    const events: UniEvent[] = [
      ev({ event_type: "start", content_items: [{ type: "text", text: "before " }] }),
      ev({ content_items: [{ type: "text", text: "call" }] }),
      ev({
        content_items: [
          {
            type: "partial_tool_call",
            name: "exec_command",
            arguments: '{"cmd":"ls"}',
            tool_call_id: "c1",
          },
          { type: "tool_call", name: "exec_command", arguments: { cmd: "ls" }, tool_call_id: "c1" },
        ],
      }),
      ev({ content_items: [{ type: "text", text: "after call" }] }),
      ev({ event_type: "stop", finish_reason: "stop", content_items: [] }),
    ];
    const { messages } = translateEvents(events);

    const completeTypes = messages
      .map((m) => (m.payload as { type: string }).type)
      .filter((t) => t === "text" || t === "tool_call");
    // Produces the text before tool_call first, then tool_call, then the new text segment after it.
    expect(completeTypes).toEqual(["text", "tool_call", "text"]);

    const texts = messages
      .filter((m) => (m.payload as { type: string }).type === "text")
      .map((m) => (m.payload as TextPayload).text);
    expect(texts).toEqual(["before call", "after call"]);
  });

  it("keeps thinking and text as separate segments across a thinking→text boundary", () => {
    const events: UniEvent[] = [
      ev({ event_type: "start", content_items: [{ type: "thinking", thinking: "ponder" }] }),
      ev({ content_items: [{ type: "text", text: "answer" }] }),
      ev({ event_type: "stop", finish_reason: "stop", content_items: [] }),
    ];
    const { messages } = translateEvents(events);
    const completeTypes = messages
      .map((m) => (m.payload as { type: string }).type)
      .filter((t) => t === "thinking" || t === "text");
    expect(completeTypes).toEqual(["thinking", "text"]);
    // The thinking segment finishes before the text segment starts: partial_thinking stop
    // precedes partial_text start.
    const idxThinkStop = messages.findIndex(
      (m) =>
        (m.payload as { type: string; event_type?: string }).type === "partial_thinking" &&
        (m.payload as { event_type?: string }).event_type === "stop",
    );
    const idxTextStart = messages.findIndex(
      (m) =>
        (m.payload as { type: string; event_type?: string }).type === "partial_text" &&
        (m.payload as { event_type?: string }).event_type === "start",
    );
    expect(idxThinkStop).toBeGreaterThanOrEqual(0);
    expect(idxThinkStop).toBeLessThan(idxTextStart);
  });

  it("emits text before thinking for a text→thinking boundary (not reordered)", () => {
    const events: UniEvent[] = [
      ev({ event_type: "start", content_items: [{ type: "text", text: "hello" }] }),
      ev({ content_items: [{ type: "thinking", thinking: "hmm" }] }),
      ev({ event_type: "stop", finish_reason: "stop", content_items: [] }),
    ];
    const { messages } = translateEvents(events);
    const completeTypes = messages
      .map((m) => (m.payload as { type: string }).type)
      .filter((t) => t === "thinking" || t === "text");
    // The generation order is text -> thinking, and the complete-message order must match it
    // (the old implementation would reverse it to put thinking first).
    expect(completeTypes).toEqual(["text", "thinking"]);
  });

  it("does not merge two thinking segments separated by text (think→text→think)", () => {
    const events: UniEvent[] = [
      ev({ event_type: "start", content_items: [{ type: "thinking", thinking: "first" }] }),
      ev({ content_items: [{ type: "text", text: "mid" }] }),
      ev({ content_items: [{ type: "thinking", thinking: "second" }] }),
      ev({ event_type: "stop", finish_reason: "stop", content_items: [] }),
    ];
    const { messages } = translateEvents(events);
    const completeTypes = messages
      .map((m) => (m.payload as { type: string }).type)
      .filter((t) => t === "thinking" || t === "text");
    // Three separate segments, produced in generation order (the old implementation merged
    // the two thinking segments and had no second start).
    expect(completeTypes).toEqual(["thinking", "text", "thinking"]);
    const thinkings = messages
      .filter((m) => (m.payload as { type: string }).type === "thinking")
      .map((m) => (m.payload as ThinkingPayload).thinking);
    expect(thinkings).toEqual(["first", "second"]);
    // The second thinking segment reopens a segment: two partial_thinking starts appear.
    const thinkStarts = messages.filter(
      (m) =>
        (m.payload as { type: string; event_type?: string }).type === "partial_thinking" &&
        (m.payload as { event_type?: string }).event_type === "start",
    );
    expect(thinkStarts).toHaveLength(2);
  });

  it("does not merge two text segments separated by thinking (text→think→text)", () => {
    const events: UniEvent[] = [
      ev({ event_type: "start", content_items: [{ type: "text", text: "a" }] }),
      ev({ content_items: [{ type: "thinking", thinking: "b" }] }),
      ev({ content_items: [{ type: "text", text: "c" }] }),
      ev({ event_type: "stop", finish_reason: "stop", content_items: [] }),
    ];
    const { messages } = translateEvents(events);
    const completeTypes = messages
      .map((m) => (m.payload as { type: string }).type)
      .filter((t) => t === "thinking" || t === "text");
    expect(completeTypes).toEqual(["text", "thinking", "text"]);
    const texts = messages
      .filter((m) => (m.payload as { type: string }).type === "text")
      .map((m) => (m.payload as TextPayload).text);
    expect(texts).toEqual(["a", "c"]);
  });

  it("flushes thinking/text before a partial-only tool_call (no full item until finish)", () => {
    // The tool only goes through partial_tool_call deltas (no complete tool_call content item),
    // and is produced by falling back at finish. The new tool's first delta is a type boundary,
    // so thinking/text must be flushed first.
    const events: UniEvent[] = [
      ev({ event_type: "start", content_items: [{ type: "thinking", thinking: "plan" }] }),
      ev({ content_items: [{ type: "text", text: "doing" }] }),
      ev({
        content_items: [
          {
            type: "partial_tool_call",
            name: "exec_command",
            arguments: '{"cmd":',
            tool_call_id: "p1",
          },
        ],
      }),
      ev({
        content_items: [
          { type: "partial_tool_call", name: "", arguments: '"ls"}', tool_call_id: "p1" },
        ],
      }),
      ev({ event_type: "stop", finish_reason: "tool_call", content_items: [] }),
    ];
    const { messages } = translateEvents(events);
    const completeTypes = messages
      .map((m) => (m.payload as { type: string }).type)
      .filter((t) => t === "thinking" || t === "text" || t === "tool_call");
    expect(completeTypes).toEqual(["thinking", "text", "tool_call"]);
    // Only one thinking, one text, each flushed exactly once before the tool's first delta.
    const tc = messages.find((m) => (m.payload as { type: string }).type === "tool_call")!
      .payload as ToolCallPayload;
    expect(tc.arguments).toBe('{"cmd":"ls"}');
  });

  it("does not re-flush on continuation tool deltas lacking a tool_call_id", () => {
    // Some providers' subsequent argument deltas do not carry an id, and are attributed to
    // activeToolCallId; this must not trigger a duplicate flush, nor produce a spurious
    // empty thinking/text complete message.
    const events: UniEvent[] = [
      ev({ event_type: "start", content_items: [{ type: "thinking", thinking: "go" }] }),
      ev({
        content_items: [
          {
            type: "partial_tool_call",
            name: "exec_command",
            arguments: '{"a":',
            tool_call_id: "k1",
          },
        ],
      }),
      // A continuation delta with no id.
      ev({
        content_items: [{ type: "partial_tool_call", name: "", arguments: "1}", tool_call_id: "" }],
      }),
      ev({ event_type: "stop", finish_reason: "tool_call", content_items: [] }),
    ];
    const { messages } = translateEvents(events);
    const thinkings = messages.filter((m) => (m.payload as { type: string }).type === "thinking");
    const texts = messages.filter((m) => (m.payload as { type: string }).type === "text");
    expect(thinkings).toHaveLength(1); // Exactly one, not duplicated by the continuation delta
    expect(texts).toHaveLength(0); // Does not conjure an empty text out of nowhere
    const toolStarts = messages.filter(
      (m) =>
        (m.payload as { type: string; event_type?: string }).type === "partial_tool_call" &&
        (m.payload as { event_type?: string }).event_type === "start",
    );
    expect(toolStarts).toHaveLength(1); // The same tool has only one start
  });

  it("accumulates session tokens across two requests", () => {
    const mkUsage = (p: number, r: number): UsageMetadata => ({
      cached_tokens: 0,
      prompt_tokens: p,
      thoughts_tokens: 0,
      response_tokens: r,
    });
    const first = translateEvents([
      ev({ content_items: [{ type: "text", text: "a" }] }),
      ev({
        event_type: "stop",
        finish_reason: "stop",
        content_items: [],
        usage_metadata: mkUsage(10, 5),
      }),
    ]);
    expect(first.sessionTokens.total).toBe(15);

    const second = translateEvents(
      [
        ev({ content_items: [{ type: "text", text: "b" }] }),
        ev({
          event_type: "stop",
          finish_reason: "stop",
          content_items: [],
          usage_metadata: mkUsage(20, 3),
        }),
      ],
      first.sessionTokens,
    );
    expect(second.requestTokens.total).toBe(23);
    expect(second.sessionTokens.total).toBe(38);
  });

  it("keeps only the last usage snapshot within a request (per-chunk cumulative reports are not summed)", () => {
    // Regression: Gemini (and some OpenAI-compatible endpoints) report usage as a **cumulative
    // snapshot** per chunk; summing them would inflate usage by roughly the chunk count
    // (especially for output), so the last snapshot must be authoritative.
    const mkUsage = (p: number, t: number, r: number): UsageMetadata => ({
      cached_tokens: null,
      prompt_tokens: p,
      thoughts_tokens: t,
      response_tokens: r,
    });
    const { messages, requestTokens, sessionTokens } = translateEvents([
      ev({ content_items: [{ type: "text", text: "Hel" }], usage_metadata: mkUsage(16, 488, 18) }),
      ev({ content_items: [{ type: "text", text: "lo" }], usage_metadata: mkUsage(16, 488, 20) }),
      ev({
        event_type: "stop",
        finish_reason: "stop",
        content_items: [],
        usage_metadata: mkUsage(16, 488, 20),
      }),
    ]);
    // The last snapshot is authoritative: cache_write = 16, output = 488 + 20 = 508, total = 524.
    expect(requestTokens).toEqual({ cache_read: 0, cache_write: 16, output: 508, total: 524 });
    expect(sessionTokens).toEqual(requestTokens);
    const tu = messages.at(-1)!.payload as TokenUsagePayload;
    expect(tu.request.total).toBe(524);
  });

  it("drops an unused event without splitting the segment it interrupts", () => {
    // AgentHub marks any stream event a client does not recognize `unused` and attaches no
    // content items to it, so a frame a gateway injects mid-generation (heartbeat, cost
    // ticker) must pass through the translator without opening, closing or splitting the
    // text segment around it, and without disturbing the usage snapshot.
    const { messages, requestTokens } = translateEvents([
      ev({ event_type: "start", content_items: [] }),
      ev({ content_items: [{ type: "text", text: "Hel" }] }),
      ev({ event_type: "unused", content_items: [] }),
      ev({ content_items: [{ type: "text", text: "lo" }] }),
      ev({
        event_type: "stop",
        content_items: [],
        finish_reason: "stop",
        usage_metadata: {
          cached_tokens: 0,
          prompt_tokens: 12,
          thoughts_tokens: 0,
          response_tokens: 4,
        },
      }),
    ]);

    const types = messages.map((m) => (m.payload as { type: string }).type);
    // One start, one delta per text item, one stop — the unused event adds nothing.
    expect(types).toEqual([
      "partial_text",
      "partial_text",
      "partial_text",
      "partial_text",
      "text",
      "token_usage",
    ]);
    const complete = messages.find((m) => (m.payload as { type: string }).type === "text")!
      .payload as TextPayload;
    expect(complete.text).toBe("Hello");
    expect(complete.stop_reason).toBe("completed");
    expect(requestTokens.total).toBe(16);
  });
});

describe("EventTranslator.finishInterrupted (PRN-012 structural closure)", () => {
  it("closes an open text segment with a stop + complete text marked with the interruption reason, and emits no token_usage", () => {
    const tr = new EventTranslator();
    const out: OmniMessage[] = [];
    // Opens a text segment (start + two deltas), then gets interrupted (no stop / finish received).
    for (const e of [
      ev({ event_type: "start", content_items: [] }),
      ev({ content_items: [{ type: "text", text: "Par" }] }),
      ev({ content_items: [{ type: "text", text: "tial" }] }),
    ]) {
      for (const m of tr.pushEvent(e)) out.push(m);
    }
    for (const m of tr.finishInterrupted("timeout")) out.push(m);

    const types = out.map((m) => (m.payload as { type: string }).type);
    expect(types).toEqual([
      "partial_text", // start
      "partial_text", // delta Par
      "partial_text", // delta tial
      "partial_text", // stop (backfilled by finishInterrupted)
      "text", // complete message
    ]);
    expect(types).not.toContain("token_usage"); // An interrupted Request has no usage.

    const stop = out[3]!.payload as { event_type: string; stop_reason: string };
    expect(stop.event_type).toBe("stop");
    expect(stop.stop_reason).toBe("timeout");
    const complete = out[4]!.payload as TextPayload;
    expect(complete.text).toBe("Partial");
    expect(complete.stop_reason).toBe("timeout");
  });

  it("closes an open thinking segment with the interruption reason on both partial stop and complete message", () => {
    const tr = new EventTranslator();
    const out: OmniMessage[] = [];
    // Opens a thinking segment (start + delta), then gets interrupted (no stop / finish received).
    for (const e of [
      ev({ event_type: "start", content_items: [] }),
      ev({ content_items: [{ type: "thinking", thinking: "half a thought" }] }),
    ]) {
      for (const m of tr.pushEvent(e)) out.push(m);
    }
    for (const m of tr.finishInterrupted("aborted")) out.push(m);

    const stop = out.find(
      (m) =>
        (m.payload as { type: string; event_type?: string }).type === "partial_thinking" &&
        (m.payload as { event_type?: string }).event_type === "stop",
    )!.payload as { stop_reason: string };
    expect(stop.stop_reason).toBe("aborted");
    const complete = out.find((m) => (m.payload as { type: string }).type === "thinking")!
      .payload as ThinkingPayload;
    expect(complete.thinking).toBe("half a thought");
    // Streamed concatenation == complete message: the complete thinking's stop_reason matches
    // partial(stop), no longer hardcoded to completed (regression: flushThinking used to
    // hardcode completed).
    expect(complete.stop_reason).toBe("aborted");
  });

  it("completes an incomplete (partials-only) tool_call with the interruption reason, not 'completed'", () => {
    const tr = new EventTranslator();
    const out: OmniMessage[] = [];
    for (const e of [
      ev({
        event_type: "start",
        content_items: [
          { type: "partial_tool_call", name: "exec_command", arguments: "", tool_call_id: "c1" },
        ],
      }),
      ev({
        content_items: [
          {
            type: "partial_tool_call",
            name: "exec_command",
            arguments: '{"cmd":"ls',
            tool_call_id: "c1",
          },
        ],
      }),
    ]) {
      for (const m of tr.pushEvent(e)) out.push(m);
    }
    for (const m of tr.finishInterrupted("aborted")) out.push(m);

    const complete = out.find((m) => (m.payload as { type: string }).type === "tool_call")!
      .payload as ToolCallPayload;
    expect(complete.tool_call_id).toBe("c1");
    // Key point: not "completed" -> context_engine will not dispatch it for execution (it only
    // serves structural completeness and observability).
    expect(complete.stop_reason).toBe("aborted");
    expect(complete.arguments).toBe('{"cmd":"ls'); // Keeps the (incomplete) delta accumulated so far.

    const toolStop = out.find(
      (m) =>
        (m.payload as { type: string }).type === "partial_tool_call" &&
        (m.payload as { event_type: string }).event_type === "stop",
    )!.payload as { stop_reason: string };
    expect(toolStop.stop_reason).toBe("aborted");
    expect(out.map((m) => (m.payload as { type: string }).type)).not.toContain("token_usage");
  });

  it("does not re-emit nor relabel a tool_call already completed mid-stream (keeps 'completed')", () => {
    const tr = new EventTranslator();
    const out: OmniMessage[] = [];
    for (const e of [
      ev({
        event_type: "start",
        content_items: [
          {
            type: "partial_tool_call",
            name: "exec_command",
            arguments: '{"cmd":"ls"}',
            tool_call_id: "c1",
          },
        ],
      }),
      ev({
        content_items: [
          { type: "tool_call", name: "exec_command", arguments: { cmd: "ls" }, tool_call_id: "c1" },
        ],
      }),
    ]) {
      for (const m of tr.pushEvent(e)) out.push(m);
    }
    const before = out.length;
    for (const m of tr.finishInterrupted("timeout")) out.push(m);
    expect(out.length).toBe(before); // Already produced immediately, not duplicated.
    const complete = out.find((m) => (m.payload as { type: string }).type === "tool_call")!
      .payload as ToolCallPayload;
    expect(complete.stop_reason).toBe("completed");
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

  it("omits tools when empty and never sets tool_choice (strict endpoints reject both)", () => {
    // Empty tool list (connectivity probe, bare/meta LLM, vision describer): the `tools` key
    // must be absent, not `[]` — AgentHub forwards any defined array verbatim, and strict
    // OpenAI-compatible servers (e.g. vLLM) reject `tools: []` with a 400.
    const empty = buildUniConfig({ modelId: "m", tools: [] });
    expect("tools" in empty).toBe(false);
    // `tool_choice` must never be set: AgentHub only emits it on the wire when UniConfig
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
});

describe("isRetryableError (the timeout-vs-failed label; the engine retries every non-auth error)", () => {
  it("labels 429, 408 and 5xx transport-shaped (timeout)", () => {
    expect(isRetryableError({ status: 429 })).toBe(true);
    expect(isRetryableError({ status: 408 })).toBe(true); // Request Timeout (transient)
    expect(isRetryableError({ status: 500 })).toBe(true);
    expect(isRetryableError({ statusCode: 503 })).toBe(true);
  });

  it("labels provider 4xx rejections failed — including quota-coded and bare 403s", () => {
    // The label is taxonomy, not policy: `failed` is in the engine's RETRY_STATUSES, so
    // every one of these retries on the ladder and fails after exhaustion. There is no
    // quota detector anymore — a 402/403 with a quota code or subscription message
    // classifies exactly like a bare one.
    expect(isRetryableError({ status: 400 })).toBe(false);
    expect(isRetryableError({ status: 403 })).toBe(false);
    expect(isRetryableError({ status: 404 })).toBe(false);
    expect(isRetryableError({ status: 403, code: "insufficient_user_quota" })).toBe(false);
    expect(isRetryableError({ status: 402, code: "insufficient_quota" })).toBe(false);
    expect(isRetryableError({ status: 403, message: "no active subscription" })).toBe(false);
    // 401 is auth (terminal), not merely failed-shaped.
    expect(isRetryableError({ status: 401 })).toBe(false);
  });

  it("labels network error codes transport-shaped", () => {
    expect(isRetryableError({ code: "ECONNRESET" })).toBe(true);
    expect(isRetryableError({ code: "ETIMEDOUT" })).toBe(true);
    expect(isRetryableError(new Error("socket hang up"))).toBe(true);
    expect(isRetryableError(new Error("request timeout"))).toBe(true);
  });

  it("labels undici transport failures transport-shaped, probing the cause chain", () => {
    // Node fetch wraps a dropped connection as TypeError("terminated") with the real code on
    // `cause` — exactly the field observed: "terminated: other side closed (UND_ERR_SOCKET)".
    expect(
      isRetryableError(
        new TypeError("terminated", {
          cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }),
        }),
      ),
    ).toBe(true);
    expect(isRetryableError({ code: "UND_ERR_SOCKET" })).toBe(true);
    expect(isRetryableError({ code: "UND_ERR_CONNECT_TIMEOUT" })).toBe(true);
    expect(isRetryableError({ code: "UND_ERR_HEADERS_TIMEOUT" })).toBe(true);
    expect(isRetryableError({ code: "UND_ERR_BODY_TIMEOUT" })).toBe(true);
    // A cause-less "fetch failed" still counts via the message keywords; "terminated" only
    // counts alongside transport vocabulary — the real socket case always carries the
    // UND_ERR_* code on its cause, and bare "terminated" appears in unrelated provider
    // copy too (see the content-filter counter-case below).
    expect(isRetryableError(new TypeError("fetch failed"))).toBe(true);
    expect(isRetryableError(new TypeError("terminated: other side closed"))).toBe(true);
    expect(isRetryableError(new TypeError("terminated"))).toBe(false);
    // Provider verdict copy that merely contains the word is failed-shaped, not transport.
    expect(isRetryableError(new Error("Request terminated by content filter"))).toBe(false);
    // Classic Node codes wrapped one level down are found too.
    expect(
      isRetryableError(
        new Error("request failed", {
          cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
        }),
      ),
    ).toBe(true);
  });

  it("auth always wins: a definitive credential signal is terminal, never merely a label", () => {
    // A 403 whose BODY carries a definitive auth code but whose MESSAGE mentions a
    // subscription (SDKs routinely put the body's message on err.message): the explicit
    // credential signal decides, keeping the dead credential off the retry ladder.
    const err = Object.assign(new Error("subscription key invalid"), {
      status: 403,
      error: { code: "invalid_api_key" },
    });
    expect(isAuthenticationError(err)).toBe(true);
    expect(isRetryableError(err)).toBe(false);
    // Same with the auth signal on the cause chain.
    expect(
      isRetryableError(
        new Error("request failed: quota subscription issue", {
          cause: { status: 403, error: { type: "authentication_error" } },
        }),
      ),
    ).toBe(false);
    // A bare 403 carries no credential signal: NOT auth (it rides the retry ladder as
    // failed; see the engine tests).
    expect(isAuthenticationError({ status: 403, message: "forbidden" })).toBe(false);
  });

  it("labels abort and unknown local errors failed-shaped", () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(isRetryableError(abort)).toBe(false);
    expect(isRetryableError(new Error("unexpected token in JSON"))).toBe(false);
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
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
      client: "KimiK3Client",
      parameter: "fast_mode",
      message: "Kimi does not support fast mode.",
    });

  it("detects AgentHub's UnsupportedParameterError for fast_mode, including the cause chain", () => {
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
    // Another UnsupportedParameterError source (e.g. temperature) keeps the default failed
    // classification and the engine's retry ladder — this detector must not widen the
    // permanent special case.
    expect(
      isFastModeUnsupportedError(
        new UnsupportedParameterError({
          client: "Gemini37Client",
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

describe("isMalformedJsonParseError", () => {
  it("detects JSON.parse SyntaxError by exception type, including the cause chain", () => {
    // AgentHub uses JSON.parse internally; a parse failure throws a SyntaxError, so it can be
    // determined directly by exception type.
    expect(
      isMalformedJsonParseError(new SyntaxError("Unexpected token < in JSON at position 0")),
    ).toBe(true);
    // An error wrapped by a higher layer can still be determined via the cause chain.
    expect(
      isMalformedJsonParseError(
        new Error("request failed", {
          cause: new SyntaxError("Unexpected end of JSON input"),
        }),
      ),
    ).toBe(true);
    // A non-SyntaxError does not count as malformed (even if the message mentions JSON),
    // leaving classification to the network/failure path.
    expect(isMalformedJsonParseError(new Error("Unexpected token < in JSON at position 0"))).toBe(
      false,
    );
    expect(isMalformedJsonParseError(new Error("socket hang up"))).toBe(false);
  });

  it("detects AgentHub 0.4 parse/validation error classes (truncated tool args, thinking-only)", () => {
    // A stream truncated mid-arguments surfaces as ToolCallArgumentParseError since agenthub
    // 0.4 (previously a raw SyntaxError) — must stay malformed so the engine reconnects.
    expect(
      isMalformedJsonParseError(
        new ToolCallArgumentParseError({
          client: "Claude5Client",
          toolName: "exec_command",
          toolCallId: "toolu_broken_1",
          rawArguments: '{"cmd": "ec',
          reason: "Unterminated string in JSON at position 11",
        }),
      ),
    ).toBe(true);
    // A completed thinking-only response cannot be replayed (400 on the next turn): retrying
    // via malformed gives the model another chance instead of failing the turn.
    expect(
      isMalformedJsonParseError(
        new EmptyResponseError({ client: "Claude5Client", finishReason: "stop" }),
      ),
    ).toBe(true);
    // Also detectable via the name fallback and the cause chain.
    expect(
      isMalformedJsonParseError(
        new Error("request failed", {
          cause: new EmptyResponseError({ client: "GPT5_5Client", finishReason: null }),
        }),
      ),
    ).toBe(true);
  });
});

describe("isIncompleteStreamError", () => {
  it("detects AgentHub incomplete-stream validation errors by message prefix, incl. cause chain", () => {
    // The server/proxy cleanly terminates the stream early at an event boundary: AgentHub's
    // final-event validation throws a plain Error.
    expect(isIncompleteStreamError(new Error("Streaming response yielded no events"))).toBe(true);
    expect(
      isIncompleteStreamError(new Error('Last event must carry usage_metadata, got: {"a":1}')),
    ).toBe(true);
    expect(isIncompleteStreamError(new Error("Last event must carry finish_reason, got: {}"))).toBe(
      true,
    );
    expect(
      isIncompleteStreamError(
        new Error("request failed", { cause: new Error("Streaming response yielded no events") }),
      ),
    ).toBe(true);
    expect(isIncompleteStreamError(new Error("socket hang up"))).toBe(false);
    expect(isIncompleteStreamError(null)).toBe(false);
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
        return (async function* () {
          yield ev({
            content_items: [{ type: "text", text: "ok" }],
            finish_reason: "stop",
            usage_metadata: {
              cached_tokens: 0,
              prompt_tokens: 1,
              thoughts_tokens: 0,
              response_tokens: 1,
            },
          });
        })();
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

describe("thinking-mode replay rejection (the provider wants reasoning_content back)", () => {
  // The verdict as DeepSeek words it, reaching the harness through an OpenAI-compatible relay.
  const DEEPSEEK_REJECTION =
    "Upstream request failed: [invalid_request_error] The `reasoning_content` in the " +
    "thinking mode must be passed back to the API.";

  it("recognizes the rejection on the error itself, in a parsed body, and down the cause chain", () => {
    expect(isThinkingReplayRejection(new Error(DEEPSEEK_REJECTION))).toBe(true);
    // OpenAI SDK shape: the parsed body hangs off `error`.
    expect(
      isThinkingReplayRejection(
        Object.assign(new Error("400 status code (no body)"), {
          status: 400,
          error: { message: DEEPSEEK_REJECTION, type: "invalid_request_error" },
        }),
      ),
    ).toBe(true);
    // Anthropic SDK shape: `error` holds the whole response body, the verdict one level deeper.
    expect(
      isThinkingReplayRejection(
        Object.assign(new Error("400"), { error: { error: { message: DEEPSEEK_REJECTION } } }),
      ),
    ).toBe(true);
    // Wrapped by a higher layer (Node fetch puts the real failure on `cause`).
    expect(
      isThinkingReplayRejection(
        new Error("request failed", { cause: new Error(DEEPSEEK_REJECTION) }),
      ),
    ).toBe(true);
    // A relay that translates the same verdict still lands.
    expect(isThinkingReplayRejection(new Error("思考模式下必须回传 reasoning_content"))).toBe(true);
  });

  it("does not match neighbouring rejections that disabling thinking cannot fix", () => {
    expect(isThinkingReplayRejection(null)).toBe(false);
    expect(isThinkingReplayRejection(undefined)).toBe(false);
    expect(isThinkingReplayRejection(new Error("max_tokens must be a positive integer"))).toBe(
      false,
    );
    // Thinking is named, but nothing says reasoning has to come back.
    expect(isThinkingReplayRejection(new Error("thinking is not supported by this model"))).toBe(
      false,
    );
    // reasoning_content is named, but as unsupported — thinking off would still send it.
    expect(
      isThinkingReplayRejection(new Error("`reasoning_content` is not supported by this model")),
    ).toBe(false);
  });

  // A model whose first request is rejected by the provider and whose later requests stream
  // normally, capturing the UniConfig each one goes out with (same seam as the thinking-level
  // suite above).
  function rejectingModel(
    error: unknown,
    defaultLevel?: ThinkingLevelName,
  ): { model: GenerativeModel; configs: (UniConfig | undefined)[] } {
    const configs: (UniConfig | undefined)[] = [];
    class RejectingModel extends GenerativeModel {
      protected override openStream(
        _uni: UniMessage,
        _signal: AbortSignal,
        config?: UniConfig,
      ): AsyncIterable<UniEvent> {
        configs.push(config);
        const first = configs.length === 1;
        return (async function* () {
          if (first) throw error;
          yield ev({
            content_items: [{ type: "text", text: "ok" }],
            finish_reason: "stop",
            usage_metadata: {
              cached_tokens: 0,
              prompt_tokens: 1,
              thoughts_tokens: 0,
              response_tokens: 1,
            },
          });
        })();
      }
    }
    const model = new RejectingModel({
      // The provider family this verdict comes from; its SDK wants a key at construction,
      // and the seam below means none of these tests ever open a socket.
      modelId: "deepseek-v4-flash",
      apiKey: "test-key",
      tools: [],
      ...(defaultLevel !== undefined ? { thinkingLevel: defaultLevel } : {}),
    });
    return { model, configs };
  }

  async function outcomeOf(gen: AsyncGenerator<OmniMessage, LLMOutcome>): Promise<LLMOutcome> {
    let res = await gen.next();
    while (!res.done) res = await gen.next();
    return res.value;
  }

  it("reports the rejection as failed and takes thinking off the wire for every later request", async () => {
    const { model, configs } = rejectingModel(
      Object.assign(new Error(DEEPSEEK_REJECTION), { status: 400 }),
      "medium",
    );
    const outcome = await outcomeOf(model.streamGenerate({ newMessages: [userText("a")] }));
    // Reported honestly (a provider rejection), which the engine retries like any `failed`.
    expect(outcome.status).toBe("failed");
    expect(outcome.errorMessage).toContain("reasoning_content");
    // The retry — and everything after it — goes out with thinking explicitly off, which the
    // unchanged history is valid for; a per-turn override no longer outranks that.
    await outcomeOf(model.streamGenerate({ newMessages: [userText("a")] }));
    await outcomeOf(model.streamGenerate({ newMessages: [userText("b")], thinkingLevel: "high" }));
    expect(configs[0]?.thinking_level).toBe(ThinkingLevel.MEDIUM);
    expect(configs[1]?.thinking_level).toBe(ThinkingLevel.NONE);
    expect(configs[2]?.thinking_level).toBe(ThinkingLevel.NONE);
  });

  it("sends an explicit none even where no level was configured (the provider default is thinking-on)", async () => {
    const { model, configs } = rejectingModel(new Error(DEEPSEEK_REJECTION));
    await outcomeOf(model.streamGenerate({ newMessages: [userText("a")] }));
    await outcomeOf(model.streamGenerate({ newMessages: [userText("a")] }));
    expect(configs[0] !== undefined && "thinking_level" in configs[0]).toBe(false);
    expect(configs[1]?.thinking_level).toBe(ThinkingLevel.NONE);
  });

  it("leaves the level alone for an unrelated provider rejection", async () => {
    const { model, configs } = rejectingModel(
      Object.assign(new Error("400 max_tokens must be a positive integer"), { status: 400 }),
      "medium",
    );
    const outcome = await outcomeOf(model.streamGenerate({ newMessages: [userText("a")] }));
    expect(outcome.status).toBe("failed");
    await outcomeOf(model.streamGenerate({ newMessages: [userText("a")] }));
    expect(configs[1]?.thinking_level).toBe(ThinkingLevel.MEDIUM);
  });

  it("leaves the level alone when the rejected attempt had thinking explicitly off", async () => {
    const { model, configs } = rejectingModel(new Error(DEEPSEEK_REJECTION), "none");
    const outcome = await outcomeOf(
      model.streamGenerate({ newMessages: [userText("a")], thinkingLevel: "none" }),
    );
    // Nothing to turn down — the request already ran with thinking off, so this verdict is
    // about something else and must not be silently absorbed as "thinking disabled".
    expect(outcome.status).toBe("failed");
    await outcomeOf(model.streamGenerate({ newMessages: [userText("b")], thinkingLevel: "high" }));
    expect(configs[1]?.thinking_level).toBe(ThinkingLevel.HIGH);
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
        return (async function* () {
          yield ev({
            content_items: [{ type: "text", text: "ok" }],
            finish_reason: "stop",
            usage_metadata: {
              cached_tokens: 0,
              prompt_tokens: opts.promptTokens ?? 1,
              thoughts_tokens: 0,
              response_tokens: 1,
            },
          });
        })();
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
    // Regression for the review repro: a read_image-style tool output carrying a 1 MB
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

  // Yields one piece of text, then throws a retryable network error (network drop).
  async function* dropAfterText(): AsyncGenerator<UniEvent> {
    yield ev({ content_items: [{ type: "text", text: "hi" }] });
    throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
  }

  // Immediately throws a non-retryable error (auth).
  async function* authError(): AsyncGenerator<UniEvent> {
    throw Object.assign(new Error("invalid api key"), { status: 401 });
  }

  // AgentHub's response body is not valid JSON (e.g. the gateway returns HTML / a truncated response).
  async function* malformedJsonAfterText(): AsyncGenerator<UniEvent> {
    yield ev({ content_items: [{ type: "text", text: "hi" }] });
    throw new SyntaxError("Unexpected token < in JSON at position 0");
  }

  const typeOf = (m: OmniMessage): string => (m.payload as { type?: string }).type ?? "";

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

  it("returns failed on a build failure such as empty input (never throws)", async () => {
    const model = new SeamModel((sig) => hang(sig));
    const { messages, outcome } = await drain(model.streamGenerate({ newMessages: [] }));
    expect(outcome.status).toBe("failed"); // A mergeOmniToUniMessage failure converges to failed, never throws
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
      yield ev({ content_items: [{ type: "text", text: "hi" }] });
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

  it("classifies an idle timeout as timeout, with no token_usage", async () => {
    const model = new SeamModel((sig) => hang(sig), 30); // 30ms idle timeout
    const { messages, outcome } = await drain(
      model.streamGenerate({ newMessages: [userText("go")] }),
    );
    expect(outcome.status).toBe("timeout");
    expect(messages.map(typeOf)).not.toContain("token_usage");
  });

  it("classifies an idle timeout as timeout even when the stream ends gracefully on abort", async () => {
    // The underlying implementation does not throw on abort, and ends gracefully with done:
    // this must still be classified as timeout, not mistakenly as completed.
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
    expect(outcome.status).toBe("timeout");
    expect(messages.map(typeOf)).not.toContain("token_usage");
  });

  it("classifies a network drop as timeout, closing the open text segment, no token_usage", async () => {
    const model = new SeamModel(() => dropAfterText());
    const { messages, outcome } = await drain(
      model.streamGenerate({ newMessages: [userText("go")] }),
    );
    expect(outcome.status).toBe("timeout");
    const complete = messages.find((m) => typeOf(m) === "text");
    expect((complete!.payload as TextPayload).text).toBe("hi");
    expect((complete!.payload as TextPayload).stop_reason).toBe("timeout");
    expect(messages.map(typeOf)).not.toContain("token_usage");
  });

  it("classifies an AgentHub JSON parse exception as malformed and closes partial output", async () => {
    const model = new SeamModel(() => malformedJsonAfterText());
    const { messages, outcome } = await drain(
      model.streamGenerate({ newMessages: [userText("go")] }),
    );
    expect(outcome.status).toBe("malformed");
    expect(outcome.errorMessage).toContain("Unexpected token");
    const complete = messages.find((m) => typeOf(m) === "text");
    expect((complete!.payload as TextPayload).text).toBe("hi");
    expect((complete!.payload as TextPayload).stop_reason).toBe("malformed");
    expect(messages.map(typeOf)).not.toContain("token_usage");
  });

  it("classifies a cleanly-truncated stream (AgentHub last-event validation) as malformed, not failed", async () => {
    // The server/proxy cleanly drops the stream at an event boundary (no network error thrown):
    // AgentHub's final-event validation throws a plain Error; this is an incomplete LLM
    // Request that must go through the malformed reconnect path, and must not abort the task as failed.
    async function* cleanTruncationAfterText(): AsyncGenerator<UniEvent> {
      yield ev({ content_items: [{ type: "text", text: "hi" }] });
      throw new Error('Last event must carry usage_metadata, got: {"content_items":[]}');
    }
    const model = new SeamModel(() => cleanTruncationAfterText());
    const { messages, outcome } = await drain(
      model.streamGenerate({ newMessages: [userText("go")] }),
    );
    expect(outcome.status).toBe("malformed");
    expect(messages.map(typeOf)).not.toContain("token_usage");

    async function* noEvents(): AsyncGenerator<UniEvent> {
      throw new Error("Streaming response yielded no events");
    }
    const model2 = new SeamModel(() => noEvents());
    const { outcome: outcome2 } = await drain(
      model2.streamGenerate({ newMessages: [userText("go")] }),
    );
    expect(outcome2.status).toBe("malformed");
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
    expect(outcome.status).toBe("timeout");
  });

  it("classifies a credentials failure as its own terminal status auth; params stay failed", async () => {
    const model = new SeamModel(() => authError());
    const { messages, outcome } = await drain(
      model.streamGenerate({ newMessages: [userText("go")] }),
    );
    // 401 = credentials failure: its own stop reason so hosts can gate input until the
    // model's API key is updated (same engine behavior as failed).
    expect(outcome.status).toBe("auth");
    expect(outcome.errorMessage).toContain("invalid api key");
    expect(messages.map(typeOf)).not.toContain("token_usage");

    // A parameter error (400) labels failed — honestly reported, and still retried by the
    // engine like every non-auth failure (see engine.test.ts: it burns the ladder, then
    // surfaces verbatim).
    async function* paramError(): AsyncGenerator<UniEvent> {
      throw Object.assign(new Error("unknown parameter: max_output_tokens"), { status: 400 });
    }
    const model2 = new SeamModel(() => paramError());
    const { outcome: outcome2 } = await drain(
      model2.streamGenerate({ newMessages: [userText("go")] }),
    );
    expect(outcome2.status).toBe("failed");
  });

  it("marks a fast-mode rejection as permanent failed with actionable guidance (guarded on its own config)", async () => {
    // AgentHub throws UnsupportedParameterError before any network I/O when fast_mode is
    // enabled on a model without a fast tier: deterministic for this object's frozen config,
    // so it is the one failed shape the engine aborts on instead of retrying
    // (LLMOutcome.permanent; the engine side is covered in engine.test.ts).
    async function* fastModeRejected(): AsyncGenerator<UniEvent> {
      throw new UnsupportedParameterError({
        client: "KimiK3Client",
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
    expect(outcome.status).toBe("failed");
    expect(outcome.permanent).toBe(true);
    // The surfaced text keeps AgentHub's own words and appends where the switch lives.
    expect(outcome.errorMessage).toContain("Kimi does not support fast mode.");
    expect(outcome.errorMessage).toContain(FAST_MODE_UNSUPPORTED_GUIDANCE);
    expect(messages.map(typeOf)).not.toContain("token_usage");

    // Guard: the same error on a config that never sent fast_mode cannot be ours to
    // explain — it stays a plain failed (no permanent) and rides the engine's ladder.
    const model2 = new FastSeamModel(false);
    const { outcome: outcome2 } = await drain(
      model2.streamGenerate({ newMessages: [userText("go")] }),
    );
    expect(outcome2.status).toBe("failed");
    expect(outcome2.permanent).toBeUndefined();
  });

  it("an explicit auth signal wins whatever the message says: status auth, never retried", async () => {
    // 403 + body code invalid_api_key + a message mentioning the subscription: the
    // explicit credential signal decides — auth is the one terminal status, and no
    // message vocabulary may pull a dead credential back onto the retry ladder.
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
    expect(outcome.status).toBe("auth");
    expect(outcome.errorMessage).toContain("subscription key invalid");
    expect(messages.map(typeOf)).not.toContain("token_usage");
  });

  it("labels a bare 403 as failed — a retryable status, no quota/message heuristics involved", async () => {
    // Every LLM error retries except auth: a 403 without a credential signal lands in
    // `failed` (which the engine reconnects on) instead of being probed for quota or
    // subscription vocabulary. The former quota detector is gone; a quota-coded provider
    // rejection classifies exactly the same way, and its real message still rides on the
    // outcome for observability.
    async function* bare403(): AsyncGenerator<UniEvent> {
      throw Object.assign(new Error("forbidden"), { status: 403 });
    }
    const model = new SeamModel(() => bare403());
    const { messages, outcome } = await drain(
      model.streamGenerate({ newMessages: [userText("go")] }),
    );
    expect(outcome.status).toBe("failed");
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
    expect(outcome2.status).toBe("failed");
    expect(outcome2.errorMessage).toContain("insufficient_user_quota");
  });

  it("classifies an undici transport drop (TypeError terminated, cause UND_ERR_SOCKET) as timeout", async () => {
    async function* socketDrop(): AsyncGenerator<UniEvent> {
      yield ev({ content_items: [{ type: "text", text: "hi" }] });
      throw new TypeError("terminated", {
        cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }),
      });
    }
    const model = new SeamModel(() => socketDrop());
    const { messages, outcome } = await drain(
      model.streamGenerate({ newMessages: [userText("go")] }),
    );
    expect(outcome.status).toBe("timeout");
    const complete = messages.find((m) => typeOf(m) === "text");
    expect((complete!.payload as TextPayload).stop_reason).toBe("timeout");
    expect(messages.map(typeOf)).not.toContain("token_usage");
  });

  it("classifies a user abort (mid idle) as aborted, not timeout", async () => {
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

describe("provider fidelity payloads (opaque, AgentHub 0.4 semantics)", () => {
  const complete = (messages: ReturnType<typeof translateEvents>["messages"]) =>
    messages.filter((m) => !(m.payload as { type: string }).type.startsWith("partial_"));

  it("captures the thinking fidelity arriving as an empty-text delta (Claude signature_delta)", () => {
    const { messages } = translateEvents([
      ev({ content_items: [{ type: "thinking", thinking: "let me think" }] }),
      ev({
        content_items: [{ type: "thinking", thinking: "", fidelity: { signature: "sig-abc" } }],
      }),
      ev({ content_items: [{ type: "text", text: "answer" }] }),
      ev({ event_type: "stop", content_items: [], finish_reason: "stop" }),
    ]);
    const thinking = complete(messages).find(
      (m) => (m.payload as { type: string }).type === "thinking",
    )!;
    const p = thinking.payload as { thinking: string; fidelity?: Record<string, unknown> };
    expect(p.thinking).toBe("let me think");
    expect(p.fidelity).toEqual({ signature: "sig-abc" });
  });

  it("splits adjacent thinking blocks on differing fidelity (redacted + normal keep their own)", () => {
    const { messages } = translateEvents([
      // A redacted block: sentinel text + fidelity arrive together (Claude content_block_start).
      ev({
        content_items: [
          { type: "thinking", thinking: "_REDACTED_THINKING", fidelity: { signature: "sig-red" } },
        ],
      }),
      // The next, ordinary thinking block.
      ev({ content_items: [{ type: "thinking", thinking: "visible" }] }),
      ev({
        content_items: [{ type: "thinking", thinking: "", fidelity: { signature: "sig-vis" } }],
      }),
      ev({ event_type: "stop", content_items: [], finish_reason: "stop" }),
    ]);
    const thinkings = complete(messages).filter(
      (m) => (m.payload as { type: string }).type === "thinking",
    );
    expect(
      thinkings.map((m) => {
        const p = m.payload as { thinking: string; fidelity?: Record<string, unknown> };
        return [p.thinking, p.fidelity];
      }),
    ).toEqual([
      ["_REDACTED_THINKING", { signature: "sig-red" }],
      ["visible", { signature: "sig-vis" }],
    ]);
  });

  it("keeps a run of equal fidelity as one thinking block (OpenAI-compatible reasoning_field per delta)", () => {
    const rf = { reasoning_field: "reasoning_content" };
    const { messages } = translateEvents([
      ev({ content_items: [{ type: "thinking", thinking: "step 1, ", fidelity: { ...rf } }] }),
      ev({ content_items: [{ type: "thinking", thinking: "step 2, ", fidelity: { ...rf } }] }),
      ev({ content_items: [{ type: "thinking", thinking: "done", fidelity: { ...rf } }] }),
      ev({ content_items: [{ type: "text", text: "answer" }] }),
      ev({ event_type: "stop", content_items: [], finish_reason: "stop" }),
    ]);
    const thinkings = complete(messages).filter(
      (m) => (m.payload as { type: string }).type === "thinking",
    );
    expect(
      thinkings.map((m) => {
        const p = m.payload as { thinking: string; fidelity?: Record<string, unknown> };
        return [p.thinking, p.fidelity];
      }),
    ).toEqual([["step 1, step 2, done", rf]]);
  });

  it("emits an empty-text thinking with fidelity (GPT-5 encrypted reasoning) and splits on the next one", () => {
    const { messages } = translateEvents([
      ev({
        content_items: [
          { type: "thinking", thinking: "", fidelity: { id: "rs_1", encrypted_content: "aaa" } },
        ],
      }),
      ev({
        content_items: [
          { type: "thinking", thinking: "", fidelity: { id: "rs_2", encrypted_content: "bbb" } },
        ],
      }),
      ev({ content_items: [{ type: "text", text: "answer" }] }),
      ev({ event_type: "stop", content_items: [], finish_reason: "stop" }),
    ]);
    const thinkings = complete(messages).filter(
      (m) => (m.payload as { type: string }).type === "thinking",
    );
    expect(
      thinkings.map((m) => {
        const p = m.payload as { thinking: string; fidelity?: Record<string, unknown> };
        return [p.thinking, p.fidelity];
      }),
    ).toEqual([
      ["", { id: "rs_1", encrypted_content: "aaa" }],
      ["", { id: "rs_2", encrypted_content: "bbb" }],
    ]);
  });

  it("splits text segments on fidelity.phase markers arriving as empty-text deltas (GPT-5)", () => {
    const { messages } = translateEvents([
      ev({ content_items: [{ type: "text", text: "", fidelity: { phase: "planning" } }] }),
      ev({ content_items: [{ type: "text", text: "plan..." }] }),
      ev({ content_items: [{ type: "text", text: "", fidelity: { phase: "answer" } }] }),
      ev({ content_items: [{ type: "text", text: "final" }] }),
      ev({ event_type: "stop", content_items: [], finish_reason: "stop" }),
    ]);
    const texts = complete(messages).filter((m) => (m.payload as { type: string }).type === "text");
    expect(
      texts.map((m) => {
        const p = m.payload as { text: string; fidelity?: Record<string, unknown> };
        return [p.text, p.fidelity];
      }),
    ).toEqual([
      ["plan...", { phase: "planning" }],
      ["final", { phase: "answer" }],
    ]);
  });

  it("closes a text segment on fidelity.signature: later text becomes its own segment (the signature must not cover unsigned text)", () => {
    const { messages } = translateEvents([
      // Gemini stamps a thoughtSignature on the text part it signed; whatever follows is
      // unsigned. Merging them would replay a signature covering text the provider never
      // signed, and the provider rejects the resumed turn.
      ev({ content_items: [{ type: "text", text: "part one", fidelity: { signature: "sigA" } }] }),
      ev({ content_items: [{ type: "text", text: "part two" }] }),
      ev({ event_type: "stop", content_items: [], finish_reason: "stop" }),
    ]);
    const texts = complete(messages).filter((m) => (m.payload as { type: string }).type === "text");
    expect(
      texts.map((m) => {
        const p = m.payload as { text: string; fidelity?: Record<string, unknown> };
        return [p.text, p.fidelity];
      }),
    ).toEqual([
      ["part one", { signature: "sigA" }],
      ["part two", undefined],
    ]);
  });

  it("accumulates fidelity keys across deltas of one text segment (phase marker + trailing signature)", () => {
    const { messages } = translateEvents([
      // GPT-5 opens the segment with a bare phase marker and signs it only at the end; a
      // replacing (rather than merging) assignment would drop the phase and lose the
      // segmentation on replay.
      ev({ content_items: [{ type: "text", text: "", fidelity: { phase: "answer" } }] }),
      ev({ content_items: [{ type: "text", text: "final" }] }),
      ev({ content_items: [{ type: "text", text: "", fidelity: { signature: "sigB" } }] }),
      ev({ event_type: "stop", content_items: [], finish_reason: "stop" }),
    ]);
    const texts = complete(messages).filter((m) => (m.payload as { type: string }).type === "text");
    expect(
      texts.map((m) => {
        const p = m.payload as { text: string; fidelity?: Record<string, unknown> };
        return [p.text, p.fidelity];
      }),
    ).toEqual([["final", { phase: "answer", signature: "sigB" }]]);
  });

  it("carries the tool_call fidelity through to the complete message", () => {
    const { messages } = translateEvents([
      ev({
        content_items: [
          {
            type: "tool_call",
            name: "exec_command",
            arguments: { cmd: "ls" },
            tool_call_id: "tc1",
            fidelity: { signature: "sig-tool" },
          },
        ],
      }),
      ev({ event_type: "stop", content_items: [], finish_reason: "tool_call" }),
    ]);
    const tc = complete(messages).find(
      (m) => (m.payload as { type: string }).type === "tool_call",
    )!;
    expect((tc.payload as { fidelity?: Record<string, unknown> }).fidelity).toEqual({
      signature: "sig-tool",
    });
  });

  it("round-trips fidelity payloads back to UniMessage content items (setHistory path)", () => {
    const uni = mergeOmniToUniMessage([
      thinkingMessage("deep", "completed", { signature: "sig-1" }),
      assistantText("hi", "completed", { phase: "answer", signature: "sig-2" }),
      toolCall({ name: "t", arguments: "{}", toolCallId: "tc1", fidelity: { signature: "sig-3" } }),
    ]);
    expect(uni.content_items).toEqual([
      { type: "thinking", thinking: "deep", fidelity: { signature: "sig-1" } },
      { type: "text", text: "hi", fidelity: { phase: "answer", signature: "sig-2" } },
      {
        type: "tool_call",
        name: "t",
        arguments: {},
        tool_call_id: "tc1",
        fidelity: { signature: "sig-3" },
      },
    ]);
  });
});

describe("flushText fidelity parity (PR #39 review)", () => {
  it("emits an empty-text message carrying a text fidelity instead of dropping it", () => {
    const { messages } = translateEvents([
      ev({ content_items: [{ type: "text", text: "", fidelity: { signature: "sig-t" } }] }),
      ev({ event_type: "stop", content_items: [], finish_reason: "stop" }),
    ]);
    const text = messages.find((m) => (m.payload as { type: string }).type === "text")!;
    expect((text.payload as { text: string }).text).toBe("");
    expect((text.payload as { fidelity?: Record<string, unknown> }).fidelity).toEqual({
      signature: "sig-t",
    });
  });
});

describe("tool_call_id uniquification (name-as-id providers, e.g. Gemini uses the function name as the id)", () => {
  const callIdsOf = (messages: OmniMessage[]): string[] =>
    messages
      .filter((m) => (m.payload as { type: string }).type === "tool_call")
      .map((m) => (m.payload as ToolCallPayload).tool_call_id);

  it("the second complete tool_call with a duplicate id within one Request is not dropped and gets the #2 suffix", () => {
    const { messages } = translateEvents([
      ev({
        event_type: "stop",
        finish_reason: "tool_call",
        content_items: [
          {
            type: "tool_call",
            name: "get_time",
            arguments: { city: "Tokyo" },
            tool_call_id: "get_time",
          },
          {
            type: "tool_call",
            name: "get_time",
            arguments: { city: "Paris" },
            tool_call_id: "get_time",
          },
        ],
      }),
    ]);
    expect(callIdsOf(messages)).toEqual(["get_time", "get_time#2"]);
    const calls = messages
      .filter((m) => (m.payload as { type: string }).type === "tool_call")
      .map((m) => m.payload as ToolCallPayload);
    expect(calls[0]!.arguments).toBe('{"city":"Tokyo"}');
    expect(calls[1]!.arguments).toBe('{"city":"Paris"}');
    expect(calls.every((c) => c.stop_reason === "completed")).toBe(true);
  });

  it("parallel calls with distinct ids are unaffected (passed through as-is, no suffix)", () => {
    const { messages } = translateEvents([
      ev({
        event_type: "stop",
        finish_reason: "tool_call",
        content_items: [
          { type: "tool_call", name: "get_time", arguments: {}, tool_call_id: "get_time" },
          { type: "tool_call", name: "get_weather", arguments: {}, tool_call_id: "get_weather" },
          { type: "tool_call", name: "get_time", arguments: {}, tool_call_id: "get_time" },
        ],
      }),
    ]);
    expect(callIdsOf(messages)).toEqual(["get_time", "get_weather", "get_time#2"]);
  });

  it("the registry is shared across Requests: a same-name call in the next round gets a new suffix (frontend tool cards no longer overwrite each other)", () => {
    const ids = new ToolCallIdAllocator();
    const round = (city: string): string[] => {
      const translator = new EventTranslator(ids);
      const out: OmniMessage[] = [];
      const event = ev({
        event_type: "stop",
        finish_reason: "tool_call",
        content_items: [
          { type: "tool_call", name: "get_time", arguments: { city }, tool_call_id: "get_time" },
        ],
      });
      for (const m of translator.pushEvent(event)) out.push(m);
      for (const m of translator.finish()) out.push(m);
      return callIdsOf(out);
    };
    expect(round("Tokyo")).toEqual(["get_time"]);
    expect(round("Paris")).toEqual(["get_time#2"]);
    expect(round("NYC")).toEqual(["get_time#3"]);
  });

  it("on a cross-Request collision, partial fragments and the complete message use the same suffixed id", () => {
    const ids = new ToolCallIdAllocator();
    ids.markUsed("exec"); // this provider id was already taken in the previous turn
    const translator = new EventTranslator(ids);
    const out: OmniMessage[] = [];
    const push = (e: UniEvent): void => {
      for (const m of translator.pushEvent(e)) out.push(m);
    };
    push(
      ev({
        event_type: "start",
        content_items: [
          { type: "partial_tool_call", name: "exec", arguments: '{"cmd":', tool_call_id: "exec" },
        ],
      }),
    );
    push(
      ev({
        content_items: [
          { type: "partial_tool_call", name: "", arguments: '"ls"}', tool_call_id: "exec" },
        ],
      }),
    );
    push(
      ev({
        event_type: "stop",
        finish_reason: "tool_call",
        content_items: [
          { type: "tool_call", name: "exec", arguments: { cmd: "ls" }, tool_call_id: "exec" },
        ],
      }),
    );
    for (const m of translator.finish()) out.push(m);

    const partialIds = out
      .filter((m) => (m.payload as { type: string }).type === "partial_tool_call")
      .map((m) => (m.payload as { tool_call_id: string }).tool_call_id);
    expect(partialIds.length).toBeGreaterThanOrEqual(3); // start + delta×2 + stop
    expect(partialIds.every((id) => id === "exec#2")).toBe(true);
    expect(callIdsOf(out)).toEqual(["exec#2"]);
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
          yield ev({
            event_type: "stop",
            finish_reason: "tool_call",
            content_items: [
              {
                type: "tool_call",
                name: "get_time",
                arguments: { city: "Paris" },
                tool_call_id: "get_time",
              },
            ],
          });
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
