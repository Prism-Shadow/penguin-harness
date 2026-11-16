/**
 * The hand-off note a summarize compaction opens the next context with when it ends without a
 * summary (engine/compaction-carry.ts), built from the closing Trace file by the same function
 * live and on replay:
 *
 * - it is the configured template with `{{ERROR}}`, `{{USER_MESSAGES}}`, `{{LAST_TURN}}` and
 *   `{{TRACE_PATH}}` filled from that file; a blank template gives the data alone, and a
 *   placeholder with nothing recorded reads `(not recorded)`;
 * - quotes stay within their counts and caps: the first user message and the last three, the
 *   last completed turn's text and its last four calls with their outputs, the error;
 * - nothing of a compaction's own (its prompt, its rounds, an earlier stopped one) and nothing
 *   written after the closing `compaction_end` is quoted.
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
import { buildCompactionHandoff } from "../src/engine/compaction-carry.js";

const TRACE = "/data/p/agents/a/traces/2026-11-11/session-x_002.jsonl";
const NOTE =
  "Why:\n{{ERROR}}\nAsked:\n{{USER_MESSAGES}}\nLast:\n{{LAST_TURN}}\nTrace: {{TRACE_PATH}}";

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

const begin = (): AmspRecord =>
  compactionBegin({ reason: "context", mode: "summarize", context: 900, turns: 3 });

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

/** A compaction whose one request the provider refused, closed by the end that says so. */
function refusedCompaction(errorMessage = "prompt is too long"): AmspRecord[] {
  return [
    begin(),
    userText("COMPACT NOW"),
    requestBegin(),
    requestEnd("fatal", { errorCode: "rejected", errorMessage }),
    refusedEnd(errorMessage),
  ];
}

/** The lines one placeholder is filled with, read through a template holding it alone. */
function filled(file: AmspRecord[], placeholder: string): string[] {
  const note = buildCompactionHandoff(file, { tracePath: TRACE, template: `{{${placeholder}}}` });
  return note.split("\n").slice(1, -1);
}

/** The bodies of the `[user_input]` lines a note quotes, in order. */
function quotedUserInputs(note: string): string[] {
  return [...note.matchAll(/^ {2}\[user_input\]([\s\S]*?)\[\/user_input\]$/gm)].map((m) => m[1]!);
}

describe("the hand-off note", () => {
  it("is the template with its placeholders filled from the closing file, a quote that spells one left as written", () => {
    const file = [
      meta(),
      ...exchange("ask one", "answer one"),
      ...exchange("ask two {{TRACE_PATH}}", "answer two"),
      ...refusedCompaction(),
    ];

    expect(buildCompactionHandoff(file, { tracePath: TRACE, template: NOTE })).toBe(
      [
        "[context_summary]",
        "Why:",
        '  [request_error code="rejected"]prompt is too long[/request_error]',
        "Asked:",
        "  [user_input]ask one[/user_input]",
        "  [user_input]ask two {{TRACE_PATH}}[/user_input]",
        "Last:",
        "  [text]answer two[/text]",
        `Trace: ${TRACE}`,
        "[/context_summary]",
      ].join("\n"),
    );
  });

  it("with a blank template is the quoted data alone, one placeholder per line", () => {
    const file = [meta(), ...exchange("ask one", "answer one"), ...refusedCompaction()];
    const dataAlone = [
      "[context_summary]",
      '  [request_error code="rejected"]prompt is too long[/request_error]',
      "  [user_input]ask one[/user_input]",
      "  [text]answer one[/text]",
      TRACE,
      "[/context_summary]",
    ].join("\n");

    for (const template of ["", " \n ", undefined]) {
      const opts = { tracePath: TRACE, ...(template !== undefined ? { template } : {}) };
      expect(buildCompactionHandoff(file, opts)).toBe(dataAlone);
    }
  });

  it("reads (not recorded) wherever the file has nothing to quote", () => {
    expect(buildCompactionHandoff([], { template: NOTE })).toBe(
      [
        "[context_summary]",
        "Why:",
        "(not recorded)",
        "Asked:",
        "(not recorded)",
        "Last:",
        "(not recorded)",
        "Trace: (not recorded)",
        "[/context_summary]",
      ].join("\n"),
    );
    // A span whose end is not written yet has no error pair, and no request has completed.
    const open = [meta(), userText("go"), begin(), userText("COMPACT NOW"), requestBegin()];
    expect(filled(open, "ERROR")).toEqual(["(not recorded)"]);
    expect(filled(open, "LAST_TURN")).toEqual(["(not recorded)"]);
    expect(filled(open, "USER_MESSAGES")).toEqual(["  [user_input]go[/user_input]"]);
  });

  it("keeps its quotes within their counts and caps", () => {
    const long = (head: string, n: number): string => `${head}${"甲".repeat(n)}`;
    const file = [
      meta(),
      ...Array.from({ length: 12 }, (_, i) => exchange(long(`ask ${i + 1} `, 2000))).flat(),
      userText("run them"),
      requestBegin(),
      assistantText("y".repeat(800)),
      ...Array.from({ length: 6 }, (_, i) =>
        toolCall({ name: "exec_command", arguments: "a".repeat(600), toolCallId: `c${i + 1}` }),
      ),
      requestEnd("completed"),
      ...Array.from({ length: 6 }, (_, i) =>
        toolCallOutput({ output: "o".repeat(700), toolCallId: `c${i + 1}`, status: "completed" }),
      ),
      ...refusedCompaction(`prompt is too long: ${"z".repeat(600)}`),
    ];
    const cut = (kept: string, leftOut: number): string =>
      `${kept} …[${leftOut} characters left out]`;

    // The first user message and the last three, 1,500 characters each, the others counted.
    const users = filled(file, "USER_MESSAGES");
    expect(users[1]).toBe("  …[9 messages left out]…");
    expect(quotedUserInputs(users.join("\n"))).toEqual([
      cut(long("ask 1 ", 1494), 506),
      cut(long("ask 11 ", 1493), 507),
      cut(long("ask 12 ", 1493), 507),
      "run them",
    ]);
    // The turn's text, then its last four calls with their outputs, 500 characters each.
    expect(filled(file, "LAST_TURN")).toEqual([
      transcribeText(cut("y".repeat(500), 300)),
      ...["c3", "c4", "c5", "c6"].flatMap((id) => [
        transcribeToolCall("exec_command", id, cut("a".repeat(500), 100)),
        transcribeToolCallOutput(id, "completed", cut("o".repeat(500), 200)),
      ]),
    ]);
    // The provider's words as they came, cut to 500 characters where marked.
    expect(filled(file, "ERROR")).toEqual([
      `  [request_error code="rejected"]${cut(`prompt is too long: ${"z".repeat(480)}`, 120)}[/request_error]`,
    ]);
  });

  it("quotes nothing of a compaction's own: its prompt, its rounds, an earlier one the user stopped", () => {
    const file = [
      meta(),
      ...exchange("ask 1"),
      ...exchange("ask 2"),
      compactionBegin({ reason: "manual", mode: "summarize", context: 400, turns: 2 }),
      userText("EARLIER PROMPT"),
      requestBegin(),
      requestEnd("aborted"),
      compactionEnd({ reason: "manual", mode: "summarize", status: "aborted" }),
      ...exchange("ask 3", "answer 3"),
      begin(),
      userText("COMPACT NOW"),
      requestBegin(),
      assistantText("Writing the plan first."),
      toolCall({ name: "write_file", arguments: '{"file_path":"/s/plan.md"}', toolCallId: "w1" }),
      requestEnd("completed"),
      toolCallOutput({ output: "Created /s/plan.md", toolCallId: "w1", status: "completed" }),
      userText("R 1/7"),
      requestBegin(),
      requestEnd("fatal", { errorCode: "rejected", errorMessage: "prompt is too long" }),
      refusedEnd("prompt is too long"),
    ];
    const note = buildCompactionHandoff(file, { tracePath: TRACE, template: NOTE });

    expect(quotedUserInputs(note)).toEqual(["ask 1", "ask 2", "ask 3"]);
    expect(filled(file, "LAST_TURN")).toEqual([transcribeText("answer 3")]);
    for (const own of ["EARLIER PROMPT", "COMPACT NOW", "R 1/7", "Writing the plan", "w1"]) {
      expect(note).not.toContain(own);
    }
  });

  it("quotes a context's opening summary without nesting the block, keeping its own Trace pointer", () => {
    const earlier = "/data/p/agents/a/traces/2026-11-11/session-x_001.jsonl";
    const file = [
      meta(),
      userText(buildContextSummaryText("## Request\nthe earlier gist", earlier)),
      ...exchange("and then this"),
      ...refusedCompaction(),
    ];
    const note = buildCompactionHandoff(file, { tracePath: TRACE, template: NOTE });
    const lines = note.split("\n");

    expect(lines.filter((line) => line === "[context_summary]")).toEqual([lines[0]]);
    expect(lines.filter((line) => line === "[/context_summary]")).toEqual([lines.at(-1)]);
    const quoted = quotedUserInputs(note);
    expect(quoted[0]!.startsWith("## Request\nthe earlier gist")).toBe(true);
    expect(quoted[0]).toContain(earlier);
    expect(quoted[1]).toBe("and then this");
  });

  it("pairs each call of the last completed turn with its output, quoting no thinking and no image", () => {
    const file = [
      meta(),
      ...exchange("an earlier ask", "an earlier answer"),
      userText("look at both files"),
      requestBegin(),
      thinkingMessage("private reasoning"),
      assistantText("Reading both files."),
      toolCall({ name: "read_file", arguments: '{"file_path":"/ws/a.png"}', toolCallId: "ra" }),
      toolCall({ name: "read_file", arguments: '{"file_path":"/ws/b.md"}', toolCallId: "rb" }),
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

    expect(filled(file, "LAST_TURN")).toEqual([
      transcribeText("Reading both files."),
      transcribeToolCall("read_file", "ra", '{"file_path":"/ws/a.png"}'),
      transcribeToolCallOutput("ra", "completed", "an image of a chart"),
      transcribeToolCall("read_file", "rb", '{"file_path":"/ws/b.md"}'),
      transcribeToolCallOutput("rb", "fatal", "no such file"),
    ]);
  });

  it("is not changed by the records written after the closing compaction_end", () => {
    const closed = [meta(), ...exchange("ask one"), ...exchange("ask two"), ...refusedCompaction()];
    const later = [
      ...closed,
      taskEnd(),
      hookEvent({ hook: "stop", name: "goal", decision: "continue", reason: "keep going" }),
      taskBegin(),
      userText("a late question"),
    ];
    const opts = { tracePath: TRACE, template: NOTE };
    // Live, the note is built once the end is written; on replay, from the file as it grew on.
    expect(buildCompactionHandoff(later, opts)).toBe(buildCompactionHandoff(closed, opts));
  });

  it("after a refused ordinary request, quotes that request's input with the user's messages", () => {
    // An ordinary request the provider refused, answered by a hand-off: its span holds no request.
    const file = [
      meta(),
      ...exchange("read the build log", "Reading it."),
      userText("and the test log too"),
      requestBegin(),
      requestEnd("retryable", { errorCode: "rejected", errorMessage: "too long", retryInMs: 0 }),
      begin(),
      refusedEnd("too long"),
    ];
    const note = buildCompactionHandoff(file, { tracePath: TRACE, template: NOTE });

    expect(quotedUserInputs(note)).toEqual(["read the build log", "and the test log too"]);
    expect(filled(file, "LAST_TURN")).toEqual([transcribeText("Reading it.")]);
    expect(filled(file, "ERROR")).toEqual([
      '  [request_error code="rejected"]too long[/request_error]',
    ]);
  });
});
