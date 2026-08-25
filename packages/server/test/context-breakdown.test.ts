/**
 * Unit tests for the context composition: how a Trace shard's messages are split across the six
 * parts, how tool traffic is attributed to tool names, and which shard the service reads.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import {
  approximateTokens,
  assistantText,
  compactionBegin,
  compactionEnd,
  imageUrlMessage,
  requestBegin,
  requestEnd,
  sessionMeta,
  thinkingMessage,
  tokenUsage,
  toolCall,
  toolCallOutput,
  toolListReady,
  userText,
} from "@prismshadow/penguin-core";
import type { OmniMessage, SessionMetaPayload, ToolDefinition } from "@prismshadow/penguin-core";
import {
  buildContextBreakdown,
  compactionThresholdFor,
} from "../src/services/context-breakdown.js";
import { makeTempRoot, makeTraceHarness, writeTraceFile } from "./helpers.js";

const P = "project-c";
const A = "agent-c";
const S = "session-2026-08-24-09-00-00-aabbccdd";

function metaPayload(systemPrompt: string): SessionMetaPayload {
  return {
    session_id: S,
    model_id: "m1",
    provider: "custom",
    model_context_window: 128000,
    system_prompt: systemPrompt,
    agent_state: `/data/${P}/agents/${A}`,
    workspace: "/data/ws",
  };
}

const TOOLS: ToolDefinition[] = [
  { name: "read_file", description: "Read a file", parameters: { type: "object" } },
  { name: "exec_command", description: "Run a command", parameters: { type: "object" } },
];

describe("buildContextBreakdown", () => {
  it("splits a shard across the six parts and sums them into total", () => {
    const b = buildContextBreakdown([
      sessionMeta(metaPayload("You are a helpful agent.")),
      toolListReady(TOOLS),
      userText("please read the config"),
      thinkingMessage("the config lives in the workspace root"),
      assistantText("reading it now"),
      toolCall({ name: "read_file", arguments: '{"path":"config.toml"}', toolCallId: "c1" }),
      toolCallOutput({ output: "port = 8080", toolCallId: "c1" }),
    ]);

    expect(b.systemPrompt).toBe(approximateTokens("You are a helpful agent."));
    expect(b.toolDefs).toBe(TOOLS.reduce((n, t) => n + approximateTokens(JSON.stringify(t)), 0));
    for (const part of [
      b.userMessages,
      b.assistantMessages,
      b.toolRequests,
      b.toolResults,
    ] as const) {
      expect(part).toBeGreaterThan(0);
    }
    expect(b.total).toBe(
      b.systemPrompt +
        b.toolDefs +
        b.userMessages +
        b.assistantMessages +
        b.toolRequests +
        b.toolResults,
    );
    expect(b.contextClosed).toBe(false);
  });

  it("counts thinking as a model message and a user image as a user message", () => {
    const thinkingOnly = buildContextBreakdown([thinkingMessage("a long deliberation")]);
    expect(thinkingOnly.assistantMessages).toBeGreaterThan(0);
    expect(thinkingOnly.userMessages).toBe(0);

    // A data URL's base64 body must not be counted character by character: an image carries a
    // flat allowance, so a 1x1 pixel and a photograph cost the same estimate here.
    const tiny = buildContextBreakdown([imageUrlMessage("data:image/png;base64,iVBORw0KGgo=")]);
    const big = buildContextBreakdown([
      imageUrlMessage(`data:image/png;base64,${"A".repeat(200_000)}`),
    ]);
    expect(tiny.userMessages).toBe(big.userMessages);
    expect(tiny.assistantMessages).toBe(0);
  });

  it("ranks tools by their calls plus their results, capped at five", () => {
    const messages: OmniMessage[] = [];
    // Sizes are engineered so the ranking is unambiguous: exec_command's single result dwarfs
    // everything else, and read_file's three small calls still beat the one-off tools.
    messages.push(
      toolCall({ name: "exec_command", arguments: "{}", toolCallId: "e1" }),
      toolCallOutput({ output: "x".repeat(4000), toolCallId: "e1" }),
    );
    for (let i = 0; i < 3; i++) {
      messages.push(
        toolCall({ name: "read_file", arguments: "{}", toolCallId: `r${i}` }),
        toolCallOutput({ output: "y".repeat(400), toolCallId: `r${i}` }),
      );
    }
    for (const name of ["grep", "write_file", "list_dir", "web_fetch"]) {
      messages.push(
        toolCall({ name, arguments: "{}", toolCallId: `${name}-1` }),
        toolCallOutput({ output: "z".repeat(40), toolCallId: `${name}-1` }),
      );
    }

    const b = buildContextBreakdown(messages);
    expect(b.topTools).toHaveLength(5);
    expect(b.topTools.map((t) => t.name).slice(0, 2)).toEqual(["exec_command", "read_file"]);
    expect(b.topTools[0]!.tokens).toBeGreaterThan(b.topTools[1]!.tokens);
    // The ranking lives inside the two tool parts and never exceeds them.
    expect(b.topTools.reduce((n, t) => n + t.tokens, 0)).toBeLessThanOrEqual(
      b.toolRequests + b.toolResults,
    );
  });

  it("keeps the newest session_meta and tool_list_ready instead of adding a second copy", () => {
    // A resumed process writes its own bootstrap pair into the shard it continues.
    const once = buildContextBreakdown([sessionMeta(metaPayload("prompt")), toolListReady(TOOLS)]);
    const twice = buildContextBreakdown([
      sessionMeta(metaPayload("prompt")),
      toolListReady(TOOLS),
      userText("hello"),
      sessionMeta(metaPayload("prompt")),
      toolListReady(TOOLS),
    ]);
    expect(twice.systemPrompt).toBe(once.systemPrompt);
    expect(twice.toolDefs).toBe(once.toolDefs);
  });

  it("excludes the compaction request's own messages from the composition", () => {
    const base: OmniMessage[] = [userText("hi"), assistantText("hello")];
    const withCompaction: OmniMessage[] = [
      ...base,
      compactionBegin({ reason: "context", mode: "summarize", context: 1000, turns: 4 }),
      requestBegin(),
      assistantText("[context_summary] a long summary of everything so far"),
      tokenUsage(
        { cache_read: 0, cache_write: 0, output: 0, total: 0 },
        { cache_read: 0, cache_write: 0, output: 0, total: 0 },
      ),
      requestEnd("completed"),
      compactionEnd({ reason: "context", mode: "summarize", status: "retryable" }),
    ];
    const plain = buildContextBreakdown(base);
    const compacted = buildContextBreakdown(withCompaction);
    expect(compacted.assistantMessages).toBe(plain.assistantMessages);
    // A failed compaction leaves the context open — only a completed one closes it.
    expect(compacted.contextClosed).toBe(false);
  });

  it("reports contextClosed when the shard ends on a completed compaction", () => {
    const b = buildContextBreakdown([
      userText("hi"),
      compactionBegin({ reason: "manual", mode: "summarize", context: 1000, turns: 4 }),
      compactionEnd({ reason: "manual", mode: "summarize", status: "completed" }),
    ]);
    expect(b.contextClosed).toBe(true);
  });
});

describe("TraceService.contextBreakdown", () => {
  let root = "";
  let harness: ReturnType<typeof makeTraceHarness> | null = null;

  beforeEach(async () => {
    root = await makeTempRoot();
    harness = makeTraceHarness(root);
  });

  afterEach(async () => {
    harness?.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("reads the newest shard only — an earlier context is not part of the current one", async () => {
    await writeTraceFile(root, P, A, "2026-08-24", S, 1, [
      sessionMeta(metaPayload("old prompt")),
      userText("x".repeat(4000)),
    ]);
    await writeTraceFile(root, P, A, "2026-08-24", S, 2, [
      sessionMeta(metaPayload("new prompt")),
      toolListReady(TOOLS),
      userText("short"),
    ]);

    const b = await harness!.service.contextBreakdown(P, A, S);
    expect(b.systemPrompt).toBe(approximateTokens("new prompt"));
    expect(b.userMessages).toBe(buildContextBreakdown([userText("short")]).userMessages);
    expect(harness!.shardReads).toHaveLength(1);
    expect(harness!.shardReads[0]).toContain("_002.jsonl");
  });

  it("answers with zeros for a Session that has no Trace", async () => {
    const b = await harness!.service.contextBreakdown(P, A, "session-nonexistent");
    expect(b).toEqual({
      systemPrompt: 0,
      toolDefs: 0,
      userMessages: 0,
      assistantMessages: 0,
      toolRequests: 0,
      toolResults: 0,
      total: 0,
      topTools: [],
      contextClosed: false,
    });
  });
});

describe("compactionThresholdFor", () => {
  it("caps the configured threshold at what the window leaves room for", () => {
    // 2048 tokens of headroom: the compaction request's own prompt and summary have to fit.
    expect(compactionThresholdFor(256_000, 200_000)).toBe(197_952);
    // Configured below the cap: taken as configured.
    expect(compactionThresholdFor(100_000, 1_000_000)).toBe(100_000);
  });

  it("falls back to the seeded threshold when the Agent configures none", () => {
    expect(compactionThresholdFor(undefined, 1_000_000)).toBe(256_000);
  });

  it("derives from the assumed window when the model configures none", () => {
    expect(compactionThresholdFor(256_000, undefined)).toBe(125_952);
  });

  it("has nothing to mark when compaction is off or the threshold is not inside the window", () => {
    expect(compactionThresholdFor(-1, 200_000)).toBeNull();
    expect(compactionThresholdFor(0, 200_000)).toBeNull();
    // An implausibly small window is treated as unconfigured, so the derivation reasons from the
    // assumed default instead — a threshold far outside the gauge it would be drawn on.
    expect(compactionThresholdFor(256_000, 2000)).toBeNull();
  });
});
