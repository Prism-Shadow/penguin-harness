/**
 * What a summarize compaction carries into the next context, read off its Trace span
 * (engine/compaction-carry.ts) — the functions the live engine and Trace replay both call on the
 * same records:
 *
 * - the hand-off note written in place of a summary none could be had of: the user's messages
 *   (the first and the last eight, within a token budget), the last completed turn, the
 *   compaction's own calls, and the Trace pointer;
 * - the compaction's calls as the next context reads them, from committed responses only.
 */
import { describe, expect, it } from "vitest";
import {
  assistantText,
  compactionBegin,
  compactionEnd,
  hookEvent,
  requestBegin,
  requestEnd,
  sessionMeta,
  taskBegin,
  taskEnd,
  thinkingMessage,
  tokenUsage,
  toolCall,
  toolCallOutput,
  userText,
} from "@prismshadow/amsp/records";
import type { AmspRecord, TokenCounts } from "@prismshadow/amsp/records";
import {
  buildContextSummaryText,
  transcribeText,
  transcribeToolCall,
  transcribeToolCallOutput,
} from "@prismshadow/amsp/markers";
import {
  buildCompactionHandoff,
  closingSpan,
  compactionCallLines,
  readSpan,
} from "../src/engine/compaction-carry.js";
import { approximateTokens } from "../src/llm/context-limits.js";

const TRACE = "/data/p/agents/a/traces/2026-11-11/session-x_002.jsonl";
const OPTS = { tracePath: TRACE, shell: "bash" };

const usage = (total: number): TokenCounts => ({
  cache_read: 0,
  cache_write: 0,
  output: 1,
  total,
});

function meta(): AmspRecord {
  return sessionMeta({
    session_id: "session-x",
    provider: "anthropic",
    model_id: "claude-sonnet-4-6",
    model_context_window: 200000,
    system_prompt: "SP",
    agent_state: "/agent/state",
    workspace: "/ws",
    source: "user",
  });
}

/** One completed exchange of the compacted context: the user's message and the answer. */
function exchange(user: string, answer = "ok"): AmspRecord[] {
  return [
    userText(user),
    requestBegin(),
    assistantText(answer),
    requestEnd("completed"),
    tokenUsage(usage(100), usage(100)),
  ];
}

/** The span of a compaction whose one request the provider refused, as far as it is written before its end. */
function refusedCompaction(): AmspRecord[] {
  return [
    compactionBegin({ reason: "context", mode: "summarize", context: 900, turns: 3 }),
    userText("COMPACT NOW"),
    requestBegin(),
    requestEnd("fatal", { errorCode: "rejected", errorMessage: "prompt is too long" }),
  ];
}

/** The end of a span that completed by handing off because the provider refused a request. */
function refusedEnd(errorMessage: string): AmspRecord {
  return compactionEnd({
    reason: "context",
    mode: "summarize",
    status: "completed",
    errorCode: "rejected",
    errorMessage,
  });
}

/** The bodies of the `[user_input]` lines a note quotes, in order. */
function quotedUserInputs(note: string): string[] {
  return [...note.matchAll(/^ {2}\[user_input\]([\s\S]*?)\[\/user_input\]$/gm)].map((m) => m[1]!);
}

/** The lines of the note section under `heading`, up to the blank line that ends it. */
function sectionLines(note: string, heading: string): string[] {
  const part = note.split("\n\n").find((p) => p.startsWith(heading));
  return part === undefined ? [] : part.split("\n").slice(1);
}

describe("the hand-off note", () => {
  it("quotes the first and the last eight user messages, counting the ones between, and nothing of a compaction's own texts", () => {
    const file = [
      meta(),
      ...Array.from({ length: 6 }, (_, i) => exchange(`ask ${i + 1}`)).flat(),
      // An earlier compaction the user stopped: its prompt is no message of the user's.
      compactionBegin({ reason: "manual", mode: "summarize", context: 400, turns: 6 }),
      userText("EARLIER PROMPT"),
      requestBegin(),
      requestEnd("aborted"),
      compactionEnd({ reason: "manual", mode: "summarize", status: "aborted" }),
      ...Array.from({ length: 6 }, (_, i) => exchange(`ask ${i + 7}`)).flat(),
      ...refusedCompaction(),
    ];
    const note = buildCompactionHandoff(file, OPTS);

    expect(note.startsWith("[context_summary]\nNo summary of the earlier conversation")).toBe(true);
    expect(quotedUserInputs(note)).toEqual([
      "ask 1",
      ...Array.from({ length: 8 }, (_, i) => `ask ${i + 5}`),
    ]);
    expect(note).toContain("  …[3 messages left out]…\n");
    expect(note).not.toContain("EARLIER PROMPT");
    expect(note).not.toContain("COMPACT NOW");
    // It names the file it was built from, once, worded for the Session's shell.
    expect(note.split(TRACE)).toHaveLength(2);
    expect(note).toContain("rg -n -o");
  });

  it("stays within its budget on a file of long CJK messages, keeping the first message's head and tail", () => {
    const first = `开头${"甲".repeat(5000)}结尾`;
    const file = [
      meta(),
      ...exchange(first),
      ...Array.from({ length: 11 }, (_, i) => exchange(`${"乙".repeat(2000)}第${i + 2}条`)).flat(),
      ...refusedCompaction(),
    ];
    const note = buildCompactionHandoff(file, OPTS);

    expect(approximateTokens(note)).toBeLessThanOrEqual(4000);
    const quoted = quotedUserInputs(note);
    expect(quoted).toHaveLength(1);
    expect(quoted[0]!.startsWith("开头甲")).toBe(true);
    expect(quoted[0]!.endsWith("甲结尾")).toBe(true);
    expect(quoted[0]).toMatch(/…\[\d+ characters left out\]…/);
    // The last messages went first, every one of them counted.
    expect(note).toContain("  …[11 messages left out]…\n");
    expect(note).toContain(TRACE);
  });

  it("quotes a context's opening summary without nesting the block, keeping its own transcript pointer", () => {
    const earlier = "/data/p/agents/a/traces/2026-11-11/session-x_001.jsonl";
    const file = [
      meta(),
      userText(buildContextSummaryText("## Request\nthe earlier gist", { tracePath: earlier })),
      ...exchange("and then this"),
      ...refusedCompaction(),
    ];
    const note = buildCompactionHandoff(file, OPTS);
    const lines = note.split("\n");

    expect(lines.filter((line) => line === "[context_summary]")).toHaveLength(1);
    expect(lines.filter((line) => line === "[/context_summary]")).toHaveLength(1);
    expect(lines[0]).toBe("[context_summary]");
    expect(lines.at(-1)).toBe("[/context_summary]");
    const quoted = quotedUserInputs(note);
    expect(quoted[0]!.startsWith("## Request\nthe earlier gist")).toBe(true);
    expect(quoted[0]).toContain(earlier);
    expect(quoted[1]).toBe("and then this");
  });

  it("pairs each call of the last completed turn with its output, quoting no thinking and no image", () => {
    const readA = toolCall({
      name: "read_file",
      arguments: '{"file_path":"/ws/a.png"}',
      toolCallId: "ra",
    });
    const readB = toolCall({
      name: "read_file",
      arguments: '{"file_path":"/ws/b.md"}',
      toolCallId: "rb",
    });
    const file = [
      meta(),
      ...exchange("an earlier ask", "an earlier answer"),
      userText("look at both files"),
      requestBegin(),
      thinkingMessage("private reasoning"),
      assistantText("Reading both files."),
      readA,
      readB,
      requestEnd("completed"),
      tokenUsage(usage(900), usage(900)),
      toolCallOutput({
        output: "an image of a chart",
        toolCallId: "ra",
        status: "completed",
        images: ["data:image/png;base64,AAAA"],
      }),
      toolCallOutput({ output: "no such file", toolCallId: "rb", status: "fatal" }),
      ...refusedCompaction(),
    ];
    const note = buildCompactionHandoff(file, OPTS);

    expect(sectionLines(note, "The last completed turn before the compaction:")).toEqual([
      transcribeText("Reading both files."),
      transcribeToolCall("read_file", "ra", '{"file_path":"/ws/a.png"}'),
      transcribeToolCallOutput("ra", "completed", "an image of a chart"),
      transcribeToolCall("read_file", "rb", '{"file_path":"/ws/b.md"}'),
      transcribeToolCallOutput("rb", "fatal", "no such file"),
    ]);
    expect(note).not.toContain("private reasoning");
    expect(note).not.toContain("data:image");
    expect(note).not.toContain("an earlier answer");
  });

  it("is not changed by the records written after the closing compaction_end", () => {
    const closed = [
      meta(),
      ...exchange("ask one"),
      ...exchange("ask two"),
      ...refusedCompaction(),
      refusedEnd("prompt is too long"),
    ];
    const later = [
      ...closed,
      taskEnd(),
      hookEvent({ hook: "stop", name: "goal", decision: "continue", reason: "keep going" }),
      taskBegin(),
      userText("a late question"),
    ];
    // Live, the note is built once the end is written; on replay, from the file as it grew on.
    expect(buildCompactionHandoff(later, OPTS)).toBe(buildCompactionHandoff(closed, OPTS));
    expect(buildCompactionHandoff(later, OPTS)).not.toContain("a late question");
  });

  it("says the provider refused the request after the last turn, quoting its error from the span's own end", () => {
    const refusal = `prompt is too long: ${"x".repeat(600)}`;
    // An ordinary request the provider refused, answered by a hand-off: its span holds no request.
    const file = [
      meta(),
      ...exchange("read the build log", "Reading it."),
      userText("and the test log too"),
      requestBegin(),
      requestEnd("retryable", { errorCode: "rejected", errorMessage: refusal, retryInMs: 0 }),
      compactionBegin({ reason: "context", mode: "summarize", context: 900, turns: 1 }),
      refusedEnd(refusal),
    ];
    const note = buildCompactionHandoff(file, OPTS);
    const parts = note.split("\n\n");
    const turnAt = parts.findIndex((p) => p.startsWith("The last completed turn"));
    const [heading, ...quoted] = parts[turnAt + 1]!.split("\n");

    expect(heading).toMatch(/^The request after that turn was refused by the provider/);
    expect(quoted).toHaveLength(1);
    // The provider's words as they came, cut to 500 characters where marked.
    expect(quoted[0]).toMatch(
      /^ {2}\[request_error code="rejected"\]prompt is too long: x+ …\[120 characters left out\]\[\/request_error\]$/,
    );
    expect(quoted[0]!.split("x").length - 1).toBe(500 - "prompt is too long: ".length);
    // The refused turn's own text input is quoted with the user's messages.
    expect(quotedUserInputs(note)).toEqual(["read the build log", "and the test log too"]);
  });

  it("quotes no cause for an end that is not a refusal, nor before the span has an end", () => {
    const file = [meta(), ...exchange("ask one"), ...refusedCompaction()];
    const truncated = [
      ...file,
      compactionEnd({
        reason: "context",
        mode: "summarize",
        status: "completed",
        attempt: 3,
        errorCode: "output_truncated",
        errorMessage: "the response stopped at the output limit",
      }),
    ];
    for (const records of [file, truncated]) {
      const note = buildCompactionHandoff(records, OPTS);
      expect(note).not.toContain("refused by the provider");
      expect(note).not.toContain("[request_error");
    }
  });

  it("lists the compaction's own calls under their heading", () => {
    const created = 'Created "/s/handoff/plan.md" (5 lines, 71 bytes).';
    const file = [
      meta(),
      ...exchange("plan the release"),
      compactionBegin({ reason: "context", mode: "summarize", context: 900, turns: 1 }),
      userText("COMPACT NOW"),
      requestBegin(),
      toolCall({
        name: "write_file",
        arguments: '{"file_path":"/s/handoff/plan.md"}',
        toolCallId: "w1",
      }),
      requestEnd("completed"),
      toolCallOutput({ output: created, toolCallId: "w1", status: "completed" }),
      userText("Tool round 1 of 3 used; 2 left."),
      requestBegin(),
      requestEnd("fatal", { errorCode: "rejected", errorMessage: "prompt is too long" }),
    ];
    const note = buildCompactionHandoff(file, OPTS);

    expect(sectionLines(note, "Tool calls made during this compaction")).toEqual([
      transcribeToolCall("write_file", "w1", '{"file_path":"/s/handoff/plan.md"}'),
      transcribeToolCallOutput("w1", "completed", created),
    ]);
    // The round line is the harness's, not the user's.
    expect(note).not.toContain("Tool round 1 of 3");
  });

  it("without a Trace path is its explanation alone, whatever the file holds", () => {
    const file = [meta(), ...exchange("ask one"), ...refusedCompaction()];
    const note = buildCompactionHandoff(file, {});
    const lines = note.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("no transcript of it is recorded");
    expect(note).not.toContain("ask one");

    // An empty file with a path: the explanation and the pointer, no sections.
    const bare = buildCompactionHandoff([], OPTS);
    expect(bare).toContain(TRACE);
    expect(bare).not.toContain("User messages of the compacted context");
    expect(bare).not.toContain("The last completed turn");
  });
});

describe("the compaction's calls", () => {
  it("come from committed responses only, each with its output, in call order", () => {
    const file = [
      meta(),
      ...exchange("go"),
      compactionBegin({ reason: "context", mode: "summarize", context: 900, turns: 1 }),
      userText("COMPACT NOW"),
      requestBegin(),
      toolCall({ name: "write_file", arguments: '{"file_path":"/s/a.md"}', toolCallId: "w1" }),
      toolCall({ name: "write_file", arguments: '{"file_path":"/s/b.md"}', toolCallId: "w2" }),
      requestEnd("completed"),
      toolCallOutput({ output: "denied by the user", toolCallId: "w2", status: "aborted" }),
      toolCallOutput({ output: "Created /s/a.md", toolCallId: "w1", status: "completed" }),
      // A reply that never committed: its call was never answered or run.
      requestBegin(),
      toolCall({ name: "write_file", arguments: '{"file_path":"/s/c.md"}', toolCallId: "w3" }),
      requestEnd("retryable", { errorCode: "network", errorMessage: "socket hang up" }),
      compactionEnd({ reason: "context", mode: "summarize", status: "aborted" }),
    ];
    const { calls } = readSpan(closingSpan(file));
    expect(calls.map((c) => [c.call.payload.tool_call_id, c.output?.payload.status])).toEqual([
      ["w1", "completed"],
      ["w2", "aborted"],
    ]);
    expect(compactionCallLines(calls)).toEqual([
      transcribeToolCall("write_file", "w1", '{"file_path":"/s/a.md"}'),
      transcribeToolCallOutput("w1", "completed", "Created /s/a.md"),
      transcribeToolCall("write_file", "w2", '{"file_path":"/s/b.md"}'),
      transcribeToolCallOutput("w2", "aborted", "denied by the user"),
    ]);
  });

  it("are the latest twelve, the earlier ones counted, with long arguments and outputs cut where marked", () => {
    const span = [
      compactionBegin({ reason: "context", mode: "summarize", context: 900, turns: 1 }),
      requestBegin(),
      ...Array.from({ length: 14 }, (_, i) =>
        toolCall({ name: "read_file", arguments: `{"n":${i + 1}}`, toolCallId: `c${i + 1}` }),
      ),
      requestEnd("completed"),
      ...Array.from({ length: 14 }, (_, i) =>
        toolCallOutput({
          output: i === 13 ? "o".repeat(1000) : `out ${i + 1}`,
          toolCallId: `c${i + 1}`,
          status: "completed",
        }),
      ),
      requestBegin(),
      toolCall({ name: "write_file", arguments: "x".repeat(260), toolCallId: "w" }),
      requestEnd("completed"),
    ];
    const lines = compactionCallLines(readSpan(span).calls);

    expect(lines[0]).toBe("  …[3 earlier tool calls left out]…");
    // Twelve calls listed, each with its output line except the unanswered last one.
    expect(lines.filter((l) => l.startsWith("  [tool_call "))).toHaveLength(12);
    expect(lines[1]).toBe(transcribeToolCall("read_file", "c4", '{"n":4}'));
    expect(lines.at(-2)).toBe(
      transcribeToolCallOutput("c14", "completed", `${"o".repeat(300)} …[700 characters left out]`),
    );
    expect(lines.at(-1)).toBe(
      transcribeToolCall("write_file", "w", `${"x".repeat(200)} …[60 characters left out]`),
    );
  });
});
