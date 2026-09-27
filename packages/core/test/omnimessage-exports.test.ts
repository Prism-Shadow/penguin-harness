/**
 * The OmniMessage export audit — one fixture per payload type declared in `types.ts`, carried
 * through `builders.ts`, `aggregate.ts` and the marker reader, plus the exports no other test
 * reaches.
 *
 * Why this file exists: the protocol is the wire format between Human, LLM and Environment, and
 * until now its contract was a guess — `omnimessage.test.ts` and `markers.test.ts` cover a few
 * builders and every marker family, and the SDK surface lock next door (`sdk-surface.test.ts`)
 * records the *names* of the two subpaths' exports, but nothing tied the two halves together: a
 * payload type could lose a field on its way from a builder through the aggregator into a marker
 * parser without a single test failing.
 *
 * The lock has two halves, both driven by measurement rather than a hand-kept list:
 *
 * - **The payload round trip.** `PAYLOAD_CASES` holds one fixture per `export interface
 *   *Payload` in `types.ts`, and the first test reads `types.ts` and fails when the two sets
 *   drift apart — a new payload type cannot be added without a fixture here. Each fixture pins
 *   the payload its builder must produce field for field, then passes it through the aggregator
 *   (a partial_* stream folds into its complete twin) and through a JSON round trip, which is
 *   what Trace persistence and replay do to it.
 * - **The exports nobody reaches.** The audit that produced this file measured, per runtime
 *   value export of `./omnimessage`, whether any test names it or a tested call path asserts its
 *   behaviour. The names below were reached by nothing at all — the marker primitives with no
 *   caller, the transcript line writers whose spelling the engine only ever emits, the payload
 *   guards, and the harness-input predicates — so they are pinned here by the behaviour a
 *   regression would break, with the reason each one was uncovered.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MARKER_TAGS,
  PartialAggregator,
  TRANSCRIPT_TAGS,
  abortEvent,
  aggregateAll,
  approvalDecision,
  assistantText,
  attachedFileLine,
  attachedImageLine,
  buildContextSummaryText,
  buildHandoffMessage,
  buildSkillsMessage,
  buildTurnAbortedBlock,
  buildTurnRetriedBlock,
  compactionBegin,
  compactionEnd,
  hookEvent,
  imageUrlMessage,
  inlineData,
  inlineThinking,
  isCompleteModelMessage,
  isEventMessage,
  isHarnessInput,
  isHookInput,
  isModelMessage,
  isPartialPayload,
  isSessionMeta,
  isWholeOriginBlock,
  markerBlock,
  markerClose,
  markerOpen,
  matchAttachedFileLine,
  matchAttachedImageLine,
  mcpConnectBegin,
  mcpConnectEnd,
  parseSkillsMessage,
  parseUserSteeringText,
  partialText,
  partialThinking,
  partialToolCall,
  partialToolCallOutput,
  requestBegin,
  requestEnd,
  sessionMeta,
  startsWithMarker,
  subagentEvent,
  textMessage,
  thinkingMessage,
  tokenUsage,
  toolCall,
  toolCallOutput,
  toolListReady,
  transcribeText,
  transcribeThinking,
  transcribeToolCall,
  transcribeToolCallOutput,
  transcribeUserInput,
  unwrapSyntheticBlock,
  userSteeringText,
  userText,
} from "../src/omnimessage/index.js";
import type { OmniMessage } from "../src/omnimessage/index.js";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The envelope category a payload rides in — the outer `type` of an OmniMessage. */
type Category = "session_meta" | "model_msg" | "event_msg";

/**
 * One fixture: the `types.ts` interface it stands for, the category and inner `type` its message
 * must carry, the builder that produces it, and the exact payload that builder owes. `fold` is
 * present exactly for the four streaming payloads: the `partial_*` stream the builder emits that
 * the aggregator must fold into `twinPayload` (what the complete builder of that kind produces).
 */
interface PayloadCase {
  /** The `export interface <iface>` in types.ts this fixture measures. */
  iface: string;
  category: Category;
  /** The payload's inner `type`; `null` for `session_meta`, which carries no discriminator. */
  kind: string | null;
  build: () => OmniMessage;
  /** The exact payload the builder must write — the fixture that fails when a field moves. */
  expected: Record<string, unknown>;
  fold?: {
    /** The one stream a producer emits for this payload kind. */
    stream: () => OmniMessage[];
    /** The complete builder of the same kind, for the aggregate ↔ builders agreement check. */
    twin: () => OmniMessage;
    /** The exact payload the fold must produce. */
    twinPayload: Record<string, unknown>;
  };
}

const IMAGE_DATA_URL = "data:image/png;base64,AAAA";

const PAYLOAD_CASES: PayloadCase[] = [
  {
    iface: "SessionMetaPayload",
    category: "session_meta",
    kind: null,
    build: () =>
      sessionMeta({
        session_id: "session-2026-07-12-10-00-00-abcdef01",
        provider: "deepseek",
        model_id: "deepseek-v4-flash",
        model_context_window: 128_000,
        system_prompt: "you are a test",
        agent_state: "/data/p1/agents/a1",
        workspace: "/data/p1/agents/a1/workspace",
        source: "schedule",
      }),
    expected: {
      session_id: "session-2026-07-12-10-00-00-abcdef01",
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      model_context_window: 128_000,
      system_prompt: "you are a test",
      agent_state: "/data/p1/agents/a1",
      workspace: "/data/p1/agents/a1/workspace",
      source: "schedule",
    },
  },
  {
    iface: "TextPayload",
    category: "model_msg",
    kind: "text",
    build: () => textMessage("user", "hello", "completed", { phase: "final_answer" }),
    expected: {
      type: "text",
      role: "user",
      text: "hello",
      stop_reason: "completed",
      fidelity: { phase: "final_answer" },
    },
  },
  {
    iface: "ImageUrlPayload",
    category: "model_msg",
    kind: "image_url",
    build: () => imageUrlMessage("https://example.com/a.png"),
    expected: {
      type: "image_url",
      role: "user",
      image_url: "https://example.com/a.png",
      stop_reason: "completed",
    },
  },
  {
    iface: "InlineDataPayload",
    category: "model_msg",
    kind: "inline_data",
    build: () => inlineData("user", "AAAA", "image/png", { signature: "sig" }),
    expected: {
      type: "inline_data",
      role: "user",
      data: "AAAA",
      mime_type: "image/png",
      stop_reason: "completed",
      fidelity: { signature: "sig" },
    },
  },
  {
    iface: "ThinkingPayload",
    category: "model_msg",
    kind: "thinking",
    build: () => thinkingMessage("weighing it", "completed", { signature: "sig" }),
    expected: {
      type: "thinking",
      role: "assistant",
      thinking: "weighing it",
      stop_reason: "completed",
      fidelity: { signature: "sig" },
    },
  },
  {
    iface: "InlineThinkingPayload",
    category: "model_msg",
    kind: "inline_thinking",
    build: () => inlineThinking("AAAA", "text/plain", { signature: "sig" }),
    expected: {
      type: "inline_thinking",
      role: "assistant",
      data: "AAAA",
      mime_type: "text/plain",
      stop_reason: "completed",
      fidelity: { signature: "sig" },
    },
  },
  {
    iface: "ToolCallPayload",
    category: "model_msg",
    kind: "tool_call",
    build: () =>
      toolCall({
        name: "exec_command",
        arguments: '{"cmd":"ls -la"}',
        toolCallId: "call_1",
        fidelity: { signature: "sig" },
      }),
    expected: {
      type: "tool_call",
      role: "assistant",
      name: "exec_command",
      arguments: '{"cmd":"ls -la"}',
      tool_call_id: "call_1",
      stop_reason: "completed",
      fidelity: { signature: "sig" },
    },
  },
  {
    iface: "ToolCallOutputPayload",
    category: "model_msg",
    kind: "tool_call_output",
    build: () =>
      toolCallOutput({
        output: "image/png, 4 B",
        toolCallId: "call_1",
        images: [IMAGE_DATA_URL],
        stopReason: "completed",
      }),
    expected: {
      type: "tool_call_output",
      role: "user",
      output: "image/png, 4 B",
      images: [IMAGE_DATA_URL],
      tool_call_id: "call_1",
      stop_reason: "completed",
    },
  },
  {
    iface: "PartialTextPayload",
    category: "model_msg",
    kind: "partial_text",
    build: () => partialText("delta", "Hel", "completed"),
    expected: {
      type: "partial_text",
      role: "assistant",
      event_type: "delta",
      text: "Hel",
      stop_reason: "completed",
    },
    fold: {
      stream: () => [
        partialText("start", "Hel"),
        partialText("delta", "lo "),
        partialText("stop", "world"),
      ],
      twin: () => assistantText("Hello world"),
      twinPayload: {
        type: "text",
        role: "assistant",
        text: "Hello world",
        stop_reason: "completed",
      },
    },
  },
  {
    iface: "PartialThinkingPayload",
    category: "model_msg",
    kind: "partial_thinking",
    build: () => partialThinking("delta", "think"),
    expected: {
      type: "partial_thinking",
      role: "assistant",
      event_type: "delta",
      thinking: "think",
      stop_reason: "completed",
    },
    fold: {
      stream: () => [
        partialThinking("start", "th"),
        partialThinking("delta", "ink"),
        partialThinking("stop"),
      ],
      twin: () => thinkingMessage("think"),
      twinPayload: {
        type: "thinking",
        role: "assistant",
        thinking: "think",
        stop_reason: "completed",
      },
    },
  },
  {
    iface: "PartialToolCallPayload",
    category: "model_msg",
    kind: "partial_tool_call",
    build: () => partialToolCall({ eventType: "delta", name: "x", toolCallId: "call_1" }),
    expected: {
      type: "partial_tool_call",
      role: "assistant",
      event_type: "delta",
      name: "x",
      arguments: "",
      tool_call_id: "call_1",
      stop_reason: "completed",
    },
    fold: {
      stream: () => [
        partialToolCall({ eventType: "start", name: "exec_command", toolCallId: "call_1" }),
        partialToolCall({
          eventType: "delta",
          name: "exec_command",
          arguments: '{"cmd":"ls',
          toolCallId: "call_1",
        }),
        partialToolCall({
          eventType: "delta",
          name: "exec_command",
          arguments: ' -la"}',
          toolCallId: "call_1",
        }),
        partialToolCall({ eventType: "stop", name: "exec_command", toolCallId: "call_1" }),
      ],
      twin: () =>
        toolCall({ name: "exec_command", arguments: '{"cmd":"ls -la"}', toolCallId: "call_1" }),
      twinPayload: {
        type: "tool_call",
        role: "assistant",
        name: "exec_command",
        arguments: '{"cmd":"ls -la"}',
        tool_call_id: "call_1",
        stop_reason: "completed",
      },
    },
  },
  {
    iface: "PartialToolCallOutputPayload",
    category: "model_msg",
    kind: "partial_tool_call_output",
    build: () => partialToolCallOutput({ eventType: "delta", toolCallId: "call_1" }),
    expected: {
      type: "partial_tool_call_output",
      role: "user",
      event_type: "delta",
      output: "",
      tool_call_id: "call_1",
      stop_reason: "completed",
    },
    fold: {
      stream: () => [
        partialToolCallOutput({ eventType: "start", toolCallId: "call_1" }),
        partialToolCallOutput({ eventType: "delta", output: "ok", toolCallId: "call_1" }),
        partialToolCallOutput({
          eventType: "delta",
          toolCallId: "call_1",
          images: [IMAGE_DATA_URL],
        }),
        partialToolCallOutput({ eventType: "stop", toolCallId: "call_1" }),
      ],
      twin: () => toolCallOutput({ output: "ok", toolCallId: "call_1", images: [IMAGE_DATA_URL] }),
      twinPayload: {
        type: "tool_call_output",
        role: "user",
        output: "ok",
        images: [IMAGE_DATA_URL],
        tool_call_id: "call_1",
        stop_reason: "completed",
      },
    },
  },
  {
    iface: "ApprovalDecisionPayload",
    category: "event_msg",
    kind: "approval_decision",
    build: () => approvalDecision("forbidden", "call_1"),
    expected: { type: "approval_decision", decision: "forbidden", tool_call_id: "call_1" },
  },
  {
    iface: "AbortPayload",
    category: "event_msg",
    kind: "abort",
    build: () => abortEvent("compaction_interrupted"),
    expected: { type: "abort", error_code: "compaction_interrupted" },
  },
  {
    iface: "RequestBeginPayload",
    category: "event_msg",
    kind: "request_begin",
    build: () => requestBegin(),
    expected: { type: "request_begin" },
  },
  {
    iface: "RequestEndPayload",
    category: "event_msg",
    kind: "request_end",
    build: () =>
      requestEnd("retryable", {
        errorCode: "network",
        errorMessage: "socket closed",
        attempt: 2,
        retryInMs: 1500,
      }),
    expected: {
      type: "request_end",
      status: "retryable",
      error_code: "network",
      error_message: "socket closed",
      attempt: 2,
      retry_in_ms: 1500,
    },
  },
  {
    iface: "TokenUsagePayload",
    category: "event_msg",
    kind: "token_usage",
    build: () =>
      tokenUsage(
        { cache_read: 1, cache_write: 2, output: 3, total: 6 },
        { cache_read: 10, cache_write: 20, output: 30, total: 60 },
      ),
    expected: {
      type: "token_usage",
      session: { cache_read: 1, cache_write: 2, output: 3, total: 6 },
      request: { cache_read: 10, cache_write: 20, output: 30, total: 60 },
    },
  },
  {
    iface: "CompactionBeginPayload",
    category: "event_msg",
    kind: "compaction_begin",
    build: () => compactionBegin({ reason: "context", mode: "summarize", context: 90, turns: 7 }),
    expected: {
      type: "compaction_begin",
      reason: "context",
      mode: "summarize",
      context: 90,
      turns: 7,
    },
  },
  {
    iface: "CompactionEndPayload",
    category: "event_msg",
    kind: "compaction_end",
    build: () =>
      compactionEnd({
        reason: "turns",
        mode: "discard",
        status: "fatal",
        attempt: 3,
        errorCode: "auth",
        errorMessage: "bad key",
      }),
    expected: {
      type: "compaction_end",
      reason: "turns",
      mode: "discard",
      status: "fatal",
      attempt: 3,
      error_code: "auth",
      error_message: "bad key",
    },
  },
  {
    iface: "HookPayload",
    category: "event_msg",
    kind: "hook",
    build: () =>
      hookEvent({
        hook: "stop",
        name: "goal",
        decision: "continue",
        reason: "round 2",
        output: { status: "running", round: 2 },
      }),
    expected: {
      type: "hook",
      hook: "stop",
      name: "goal",
      decision: "continue",
      reason: "round 2",
      output: { status: "running", round: 2 },
    },
  },
  {
    iface: "SubagentPayload",
    category: "event_msg",
    kind: "subagent",
    build: () => subagentEvent("child-session-1"),
    expected: { type: "subagent", session_id: "child-session-1" },
  },
  {
    iface: "ToolListReadyPayload",
    category: "event_msg",
    kind: "tool_list_ready",
    build: () => toolListReady([{ name: "read_file", description: "read", parameters: {} }]),
    expected: {
      type: "tool_list_ready",
      tools: [{ name: "read_file", description: "read", parameters: {} }],
    },
  },
  {
    iface: "McpConnectBeginPayload",
    category: "event_msg",
    kind: "mcp_connect_begin",
    build: () => mcpConnectBegin(["files", "search"]),
    expected: { type: "mcp_connect_begin", servers: ["files", "search"] },
  },
  {
    iface: "McpConnectEndPayload",
    category: "event_msg",
    kind: "mcp_connect_end",
    build: () =>
      mcpConnectEnd({
        status: "fatal",
        results: [
          { server: "files", transport: "stdio", status: "completed", duration_ms: 12, tools: 3 },
          {
            server: "search",
            transport: "http",
            status: "fatal",
            duration_ms: 50,
            error_code: "connect_failed",
            error_message: "refused",
          },
        ],
        errorMessage: "1 of 2 servers failed",
      }),
    expected: {
      type: "mcp_connect_end",
      status: "fatal",
      results: [
        { server: "files", transport: "stdio", status: "completed", duration_ms: 12, tools: 3 },
        {
          server: "search",
          transport: "http",
          status: "fatal",
          duration_ms: 50,
          error_code: "connect_failed",
          error_message: "refused",
        },
      ],
      error_message: "1 of 2 servers failed",
    },
  },
];

describe("the payload round trip (types.ts → builders.ts → aggregate.ts)", () => {
  it("has one fixture for every payload interface types.ts declares, and no other", async () => {
    const source = await readFile(path.join(packageDir, "src/omnimessage/types.ts"), "utf8");
    const declared = [...source.matchAll(/^export interface (\w+Payload)\b/gm)].map(
      (match) => match[1]!,
    );
    expect(declared.length, "export interface *Payload in types.ts").toBe(PAYLOAD_CASES.length);
    expect(
      PAYLOAD_CASES.map((entry) => entry.iface).sort(),
      "a payload type without a fixture (or a stale fixture)",
    ).toEqual(declared.slice().sort());
  });

  it("builds each payload type through its builder, in the right envelope and with every field", () => {
    for (const entry of PAYLOAD_CASES) {
      const msg = entry.build();
      // The envelope: ISO 8601 UTC timestamp, one of the three categories, payload + timestamp only.
      expect(new Date(msg.timestamp).toISOString(), entry.iface).toBe(msg.timestamp);
      expect(msg.type, entry.iface).toBe(entry.category);
      expect(Object.keys(msg).sort(), entry.iface).toEqual(["payload", "timestamp", "type"]);
      // The inner discriminator: every payload but session_meta carries one, and it is the
      // declared one (this is what the render layers and the aggregator switch on).
      expect((msg.payload as { type?: string }).type, entry.iface).toBe(entry.kind ?? undefined);
      // The payload field for field — the assertion that fails when a builder drops, renames or
      // mis-spells a field (a JSON round trip against itself would not see that).
      expect(msg.payload, entry.iface).toEqual(entry.expected);
    }
  });

  it("loses nothing through a JSON round trip — Trace persistence and replay", () => {
    for (const entry of PAYLOAD_CASES) {
      const msg = entry.build();
      const revived = JSON.parse(JSON.stringify(msg)) as OmniMessage;
      expect(revived, entry.iface).toEqual(msg);
      expect(revived.payload, entry.iface).toEqual(entry.expected);
      // Optional fields survive as absent, never as `null` or an empty stand-in.
      expect(Object.hasOwn(revived.payload, "fidelity"), entry.iface).toBe(
        Object.hasOwn(entry.expected, "fidelity"),
      );
    }
  });

  it("passes every complete, event and session_meta message through the aggregator untouched", () => {
    const passthrough = PAYLOAD_CASES.filter(
      (entry) => entry.category !== "model_msg" || !entry.fold,
    );
    const built = passthrough.map((entry) => entry.build());
    const out = aggregateAll(built);
    expect(out).toHaveLength(built.length);
    // Untouched means the very same object: the aggregator is not allowed to clone or rewrite a
    // complete message on its way to Trace.
    for (let i = 0; i < built.length; i += 1) {
      expect(out[i], passthrough[i]!.iface).toBe(built[i]);
    }
  });

  it("folds each partial_* stream into exactly the complete payload of the same kind", () => {
    const partials = PAYLOAD_CASES.filter((entry) => entry.fold);
    expect(partials, "the four streaming payload types").toHaveLength(4);
    for (const entry of partials) {
      const out = aggregateAll(entry.fold!.stream());
      expect(out, entry.iface).toHaveLength(1);
      expect(isCompleteModelMessage(out[0]!), entry.iface).toBe(true);
      // The fold produces the documented complete payload, and the module's own complete builder
      // of that kind produces the same one — the aggregate ↔ builders agreement.
      expect(out[0]!.payload, entry.iface).toEqual(entry.fold!.twinPayload);
      expect(entry.fold!.twin().payload, entry.iface).toEqual(entry.fold!.twinPayload);
    }
  });

  it("keeps the frame the aggregator saw when a fragment is unterminated (flush)", () => {
    const agg = new PartialAggregator();
    const emitted: OmniMessage[] = [];
    emitted.push(...agg.push(partialText("start", "half")));
    emitted.push(...agg.push(partialText("delta", " done")));
    const flushed = agg.flush();
    expect(emitted).toHaveLength(0);
    expect(flushed).toHaveLength(1);
    expect(flushed[0]!.payload).toEqual(assistantText("half done").payload);
    // The fold re-stamps the message (the builders stamp at fold time); only content is carried,
    // so the assertion is that the stamp is still a well-formed envelope timestamp.
    expect(new Date(flushed[0]!.timestamp).toISOString()).toBe(flushed[0]!.timestamp);
  });
});

describe("the marker reader on the payload boundary (builders.ts ↔ aggregate.ts ↔ markers/)", () => {
  it("reads back a steering message wrapped in a user text payload, after aggregation", () => {
    const msg = userText(userSteeringText("switch branch"));
    const out = aggregateAll([msg]);
    expect(out[0]!.payload).toEqual(msg.payload);
    expect(parseUserSteeringText((out[0]!.payload as { text: string }).text)).toBe("switch branch");
  });

  it("reads back the skill block and the body that follows it", () => {
    const msg = userText(buildSkillsMessage(["a", "b"], "do it"));
    const out = aggregateAll([msg]);
    expect(parseSkillsMessage((out[0]!.payload as { text: string }).text)).toEqual({
      skills: ["a", "b"],
      rest: "do it",
    });
  });

  it("keeps an appended attachment line readable after the envelope round trip", () => {
    const image = attachedImageLine("https://example.com/a.png");
    const file = attachedFileLine("/data/scratchpad/s1/report.csv");
    const msg = userText(`look\n\n${image}\n${file}`);
    const out = aggregateAll([msg]);
    const lines = (out[0]!.payload as { text: string }).text.split("\n");
    expect(matchAttachedImageLine(lines[lines.length - 2]!)).toBe("https://example.com/a.png");
    expect(matchAttachedFileLine(lines[lines.length - 1]!)).toBe("/data/scratchpad/s1/report.csv");
  });

  it("keeps an engine transcript block unwrappable after the envelope round trip", () => {
    const lines = [
      transcribeUserInput("go"),
      transcribeThinking("hmm"),
      transcribeText("done"),
      transcribeToolCall("read_file", "t1", "{}"),
      transcribeToolCallOutput("t1", "completed", "ok"),
    ];
    const aborted = userText(buildTurnAbortedBlock(lines));
    const out = aggregateAll([aborted]);
    expect(unwrapSyntheticBlock((out[0]!.payload as { text: string }).text)).toBe(lines.join("\n"));
    const retried = userText(buildTurnRetriedBlock(lines));
    const retriedOut = aggregateAll([retried]);
    expect(unwrapSyntheticBlock((retriedOut[0]!.payload as { text: string }).text)).toBe(
      lines.join("\n"),
    );
  });

  it("keeps a context-summary injection and a handoff block readable after aggregation", () => {
    const summary = userText(buildContextSummaryText("the gist"));
    const aggregated = aggregateAll([summary])[0]!;
    const text = (aggregated.payload as { text: string }).text;
    expect(text).toBe("[context_summary]\nthe gist\n[/context_summary]");
    // The engine recognises the injection by its leading tag on the text it aggregated.
    expect(startsWithMarker(text, MARKER_TAGS.contextSummary)).toBe(true);

    const handoff = userText(buildHandoffMessage({ agentId: "researcher", sessionId: "s1" }));
    expect(isWholeOriginBlock((handoff.payload as { text: string }).text)).toBe(true);
  });
});

/*
 * The exports no test reaches — the residue of the audit.
 *
 * Every runtime value export of `./omnimessage` was searched against every test file in the
 * repository. Each name below is one that no test named and no tested call path asserted the
 * behaviour of, with the reason it stayed uncovered; each is pinned here by the behaviour a
 * regression would break. A name that is merely reached by a tested caller (the guards inside
 * `aggregateAll`, the builders inside `userText`) is deliberately not repeated here — its
 * caller's test is its coverage.
 */
describe("the exports no other test reaches", () => {
  it("markerOpen / markerClose spell the canonical delimiters markerBlock wraps", () => {
    // Nothing in the package calls these two: they are published for producers that need an
    // inline (single-line) tag rather than a whole block, so only a consumer would catch a change.
    expect(markerOpen("demo")).toBe("[demo]");
    expect(markerClose("demo")).toBe("[/demo]");
    expect(markerBlock("demo", "body")).toBe(`${markerOpen("demo")}\nbody\n${markerClose("demo")}`);
  });

  it("TRANSCRIPT_TAGS is the inner vocabulary the transcribers write", () => {
    // The tags are written by the engine's carry-over and read back by unwrapSyntheticBlock; no
    // test asserted the list itself, so a renamed entry would only surface as an unparsable block.
    expect(TRANSCRIPT_TAGS).toEqual({
      userInput: "user_input",
      thinking: "thinking",
      text: "text",
      toolCall: "tool_call",
      toolCallOutput: "tool_call_output",
    });
  });

  it("every transcript line writer emits the two-space inner line the engine resends", () => {
    // transcribeText / transcribeThinking / transcribeToolCallOutput were only ever *run* by the
    // engine (engine.test.ts asserts the outer [turn_aborted] block exists, never its lines), so
    // their spelling was guarded by nothing.
    expect(transcribeUserInput("go")).toBe("  [user_input]go[/user_input]");
    expect(transcribeThinking("hmm")).toBe("  [thinking]hmm[/thinking]");
    expect(transcribeText("done")).toBe("  [text]done[/text]");
    expect(transcribeToolCall("read_file", "t1", "{}")).toBe(
      '  [tool_call name="read_file" id="t1"]{}[/tool_call]',
    );
    expect(transcribeToolCallOutput("t1", "completed", "ok")).toBe(
      '  [tool_call_output id="t1" status="completed"]ok[/tool_call_output]',
    );
  });

  it("the envelope guards discriminate exactly one category each", () => {
    // isModelMessage / isSessionMeta / isEventMessage are reached through resume, replay and the
    // engine, but no test asserted the guard's own truth table — only that a caller worked.
    const meta = sessionMeta({
      session_id: "s1",
      provider: "p",
      model_id: "m",
      model_context_window: 1,
      system_prompt: "",
      agent_state: "/a",
      workspace: "/w",
    });
    const model = assistantText("x");
    const event = approvalDecision("allow", "c1");

    for (const msg of [meta, model, event]) {
      expect([isSessionMeta(msg), isModelMessage(msg), isEventMessage(msg)], msg.type).toEqual([
        msg === meta,
        msg === model,
        msg === event,
      ]);
    }
  });

  it("isPartialPayload / isCompleteModelMessage agree on every payload kind", () => {
    for (const entry of PAYLOAD_CASES) {
      const msg = entry.build();
      const partial = entry.kind?.startsWith("partial_") ?? false;
      expect(isPartialPayload(msg.payload), entry.iface).toBe(partial);
      expect(isCompleteModelMessage(msg), entry.iface).toBe(
        entry.category === "model_msg" && !partial,
      );
    }
  });

  it("isHarnessInput accepts only a main-session harness-stamped user text", () => {
    // No test named this predicate: it is reached inside isHookInput, whose own callers are
    // outside this package.
    expect(isHarnessInput(userText("hi", "harness"))).toBe(true);
    expect(isHarnessInput(userText("hi"))).toBe(false); // absent sender = the human user
    expect(isHarnessInput(userText("hi", "user"))).toBe(false);
    expect(isHarnessInput(userText("hi", "parent_agent"))).toBe(false);
    // A nested child session's message is never the main session's injection.
    const nested = userText("hi", "harness");
    nested.origin = ["child-1"];
    expect(isHarnessInput(nested)).toBe(false);
    // Not a model_msg, and not a user-role text.
    expect(isHarnessInput(approvalDecision("allow", "c1"))).toBe(false);
    expect(isHarnessInput(assistantText("hi"))).toBe(false);
  });

  it("isHookInput separates a round-opening injection from a background-completion notice", () => {
    // A stop hook's `continue` input opens a round of its own; a background-task completion
    // notice shares the harness stamp but rides inside a round, excluded by its own block.
    const injected = userText("continue with the goal");
    injected.payload.sender = "harness";
    expect(isHookInput(injected)).toBe(true);

    const notice = userText(
      "[background_task_done]\nkind: command\nid: proc-1\nstatus: completed\n[/background_task_done]\n\ndone",
      "harness",
    );
    expect(isHookInput(notice)).toBe(false);
    expect(isHarnessInput(notice)).toBe(true);
  });

  it("isWholeOriginBlock accepts a whole block and rejects a block with anything appended", () => {
    // The predicate the producers that append to a message consult (core's appendAttachmentLines)
    // — implemented by running the parsers, so this pins the boundary it draws.
    const handoff = buildHandoffMessage({ agentId: "researcher" });
    expect(isWholeOriginBlock(handoff)).toBe(true);
    expect(isWholeOriginBlock(`${handoff}\nand also this`)).toBe(false);
    expect(isWholeOriginBlock(userText("just a message").payload.text)).toBe(false);
  });
});
