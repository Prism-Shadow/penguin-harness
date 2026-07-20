import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import {
  approvalDecision,
  abortEvent,
  assistantText,
  compactionBegin,
  compactionEnd,
  requestBegin,
  requestEnd,
  thinkingMessage,
  toolCall,
  toolCallOutput,
  tokenUsage,
  sessionMeta,
  partialText,
  partialThinking,
  partialToolCall,
  partialToolCallOutput,
  withOrigin,
} from "@prismshadow/penguin-core";
import type { MessageOrigin } from "@prismshadow/penguin-core";
import { StreamRenderer, formatAbort, humanizeTokens, renderHistory } from "../src/render.js";
import { getMessages } from "../src/i18n.js";

const t = getMessages("en");

function collector(): { stream: Writable; text: () => string } {
  let buf = "";
  const stream = new Writable({
    write(chunk, _enc, cb) {
      buf += chunk.toString();
      cb();
    },
  });
  return { stream, text: () => buf };
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

/** Overrides a message's timestamp (the constructor defaults to the current time). */
function at<M extends { timestamp: string }>(ts: string, msg: M): M {
  return { ...msg, timestamp: ts };
}

/** token_usage shorthand: request.total = req, session.total = sess (all buckets zero, sufficient for this test group). */
function usage(req: number, sess: number) {
  return tokenUsage(
    { cache_read: 0, cache_write: 0, output: 0, total: sess },
    { cache_read: 0, cache_write: 0, output: 0, total: req },
  );
}

describe("humanizeTokens", () => {
  it("abbreviates with k / M and trims .0", () => {
    expect(humanizeTokens(0)).toBe("0");
    expect(humanizeTokens(999)).toBe("999");
    expect(humanizeTokens(1000)).toBe("1k");
    expect(humanizeTokens(1234)).toBe("1.2k");
    expect(humanizeTokens(32000)).toBe("32k");
    expect(humanizeTokens(1_500_000)).toBe("1.5M");
  });
});

describe("pure formatters", () => {
  it("formatAbort includes the reason", () => {
    expect(stripAnsi(formatAbort({ type: "abort", reason: "ctrl-c" }, t))).toContain("ctrl-c");
  });

  it("renderHistory includes abort events from resumed sessions", () => {
    const { stream, text } = collector();
    renderHistory([assistantText("partial", "aborted"), abortEvent("aborted by user")], stream, t);
    expect(stripAnsi(text())).toBe("partial [aborted]\n[abort]: aborted by user\n");
  });
});

describe("StreamRenderer", () => {
  it("streams partial_text deltas and does NOT re-render the complete text", () => {
    const { stream, text } = collector();
    const r = new StreamRenderer(stream, t);
    r.handle(partialText("start", "Hel"));
    r.handle(partialText("delta", "lo "));
    r.handle(partialText("delta", "world"));
    r.handle(partialText("stop", "", "completed"));
    r.handle(assistantText("Hello world")); // complete message: must not be re-rendered
    expect(stripAnsi(text())).toBe("Hello world\n");
  });

  it("streams partial_thinking (dim) and skips the complete thinking", () => {
    const { stream, text } = collector();
    const r = new StreamRenderer(stream, t);
    r.handle(partialThinking("start", "think"));
    r.handle(partialThinking("delta", "ing"));
    r.handle(partialThinking("stop"));
    r.handle(thinkingMessage("thinking")); // must not be re-rendered
    expect(stripAnsi(text())).toBe("thinking\n");
  });

  it("does not render a complete tool_call without partials", () => {
    const { stream, text } = collector();
    const r = new StreamRenderer(stream, t);
    r.handle(toolCall({ name: "exec_command", arguments: '{"cmd":"ls"}', toolCallId: "c2" }));
    expect(text()).toBe("");
  });

  it("streams partial_tool_call with a pairing tag and skips the complete tool_call", () => {
    const { stream, text } = collector();
    const r = new StreamRenderer(stream, t);
    r.handle(partialToolCall({ eventType: "start", name: "exec_command", toolCallId: "c4" }));
    r.handle(
      partialToolCall({ eventType: "delta", name: "", arguments: '{"cmd":"l', toolCallId: "c4" }),
    );
    r.handle(partialToolCall({ eventType: "delta", name: "", arguments: 's"}', toolCallId: "c4" }));
    r.handle(partialToolCall({ eventType: "stop", name: "", toolCallId: "c4" }));
    r.handle(toolCall({ name: "exec_command", arguments: '{"cmd":"ls"}', toolCallId: "c4" }));
    // The call line carries a [tool-<last-3-chars-of-id>] pairing tag matching the output line.
    expect(stripAnsi(text())).toBe("[tool-c4] $ ls\n");
  });

  it("streams partial_tool_call_output with a tagged gutter and skips the complete tool_call_output", () => {
    const { stream, text } = collector();
    const r = new StreamRenderer(stream, t);
    r.handle(partialToolCallOutput({ eventType: "start", toolCallId: "c3" }));
    r.handle(partialToolCallOutput({ eventType: "delta", output: "line1\n", toolCallId: "c3" }));
    r.handle(partialToolCallOutput({ eventType: "delta", output: "line2", toolCallId: "c3" }));
    r.handle(partialToolCallOutput({ eventType: "stop", toolCallId: "c3" }));
    r.handle(toolCallOutput({ output: "line1\nline2", toolCallId: "c3" })); // must not be re-rendered
    // Each line starts with a tagged gutter (no indent) matching the call line.
    expect(stripAnsi(text())).toBe("[tool-c3] >> line1\n[tool-c3] >> line2\n");
  });

  it("prints the retry line only when the retry request actually begins", () => {
    const { stream, text } = collector();
    const r = new StreamRenderer(stream, t);
    r.handle(requestBegin());
    r.handle(requestEnd("malformed"));
    expect(stripAnsi(text())).toBe(""); // the failure itself prints nothing; only the retry's start does
    r.handle(requestBegin()); // retry #1 begins
    expect(stripAnsi(text())).toContain("retry #1");
    r.handle(requestEnd("timeout"));
    r.handle(requestBegin()); // retry #2 begins
    expect(stripAnsi(text())).toContain("retry #2");
    // Retry #2 fails again and retries are exhausted: no next request_begin, only abort — no retry #3 appears.
    r.handle(requestEnd("malformed"));
    r.handle(abortEvent("malformed response failed after 2 retries"));
    expect(stripAnsi(text())).not.toContain("retry #3");
    // The first request of the next run is not a retry, so it prints nothing; a new failure after it counts from 1 again.
    r.handle(requestBegin());
    r.handle(requestEnd("timeout"));
    r.handle(requestBegin());
    const lines = stripAnsi(text());
    expect(lines.match(/retry #1/g)).toHaveLength(2);
    expect(lines).not.toContain("retry #3");
  });

  it("locks the screen to one streaming tool output; other messages queue until its stop", () => {
    const { stream, text } = collector();
    const r = new StreamRenderer(stream, t);
    r.handle(partialToolCallOutput({ eventType: "start", toolCallId: "tA" }));
    r.handle(partialToolCallOutput({ eventType: "delta", output: "a1\n", toolCallId: "tA" }));
    // The screen is locked by tA: other streaming messages queue up.
    r.handle(partialText("start", ""));
    r.handle(partialText("delta", "hello"));
    r.handle(partialToolCallOutput({ eventType: "delta", output: "a2\n", toolCallId: "tA" }));
    expect(stripAnsi(text())).toBe("[tool-tA] >> a1\n[tool-tA] >> a2\n"); // hello is still queued
    r.handle(partialToolCallOutput({ eventType: "stop", toolCallId: "tA" }));
    r.handle(partialText("stop", "", "completed"));
    expect(stripAnsi(text())).toBe("[tool-tA] >> a1\n[tool-tA] >> a2\nhello\n");
  });

  it("queues everything while a user prompt is active and flushes after it ends", () => {
    const { stream, text } = collector();
    const r = new StreamRenderer(stream, t);
    r.beginUserPrompt();
    r.handle(partialText("start", ""));
    r.handle(partialText("delta", "after prompt"));
    r.handle(partialText("stop", "", "completed"));
    expect(text()).toBe(""); // the screen is locked while waiting for user input
    r.endUserPrompt();
    expect(stripAnsi(text())).toBe("after prompt\n");
  });

  it("does not print token_usage per turn; endTask prints [stats] line with per-task deltas", () => {
    const { stream, text } = collector();
    const r = new StreamRenderer(stream, t);
    r.handle(
      sessionMeta({
        session_id: "s",
        provider: "custom",
        model_id: "m",
        model_context_window: 1,
        system_prompt: "sp",
        tools: [{ name: "exec_command", description: "test tool" }],
        thinking_level: "medium",
        agent_state: "/a",
        workspace: "/w",
      }),
    );
    // Two turns: request total 1500, 4000. Per-task token delta = 5500; session cumulative = 12000;
    // context = the latest request's input+output (= total) = 4000.
    r.handle(
      tokenUsage(
        { cache_read: 0, cache_write: 0, output: 0, total: 8000 },
        { cache_read: 0, cache_write: 0, output: 200, total: 1500 },
      ),
    );
    r.handle(
      tokenUsage(
        { cache_read: 0, cache_write: 0, output: 0, total: 12000 },
        { cache_read: 0, cache_write: 0, output: 300, total: 4000 },
      ),
    );
    expect(stripAnsi(text())).toBe(""); // no stats line is printed mid-turn
    r.endTask(2345);
    // Exact full-line assertion: context 4k (the latest request's total) and its delta, cumulative tokens 12k,
    // per-task delta 5.5k (1500 + 4000), elapsed 2.3s (first task: session equals the delta);
    // this also implies session_meta is not rendered (no /w or similar field appears in the output).
    expect(stripAnsi(text())).toBe(
      "[stats] context 4k (+4k) · tokens 12k (+5.5k) · 2.3s (+2.3s)\n",
    );
  });

  it("accumulates session elapsed across tasks; context delta is vs previous task", () => {
    const { stream, text } = collector();
    const r = new StreamRenderer(stream, t);
    // task 1: context 4000, elapsed 2000ms.
    r.handle(
      tokenUsage(
        { cache_read: 0, cache_write: 0, output: 0, total: 4000 },
        { cache_read: 0, cache_write: 0, output: 0, total: 4000 },
      ),
    );
    r.endTask(2000);
    // task 2: context 7000 (+3000 vs. the previous task), session elapsed cumulative 5000ms (this task +3000ms).
    r.handle(
      tokenUsage(
        { cache_read: 0, cache_write: 0, output: 0, total: 11000 },
        { cache_read: 0, cache_write: 0, output: 0, total: 7000 },
      ),
    );
    r.endTask(3000);
    const lines = stripAnsi(text()).trim().split("\n");
    const last = lines[lines.length - 1]!;
    // Exact full-line assertion: context 7k (delta = 7000 - 4000), cumulative session tokens 11k,
    // per-task token delta 7k, total session elapsed 5s (this task +3s).
    expect(last).toBe("[stats] context 7k (+3k) · tokens 11k (+7k) · 5s (+3s)");
  });

  it("context delta goes negative after compaction shrinks the context (no clamping)", () => {
    const { stream, text } = collector();
    const r = new StreamRenderer(stream, t);
    // task 1: context 7000.
    r.handle(
      tokenUsage(
        { cache_read: 0, cache_write: 0, output: 0, total: 7000 },
        { cache_read: 0, cache_write: 0, output: 0, total: 7000 },
      ),
    );
    r.endTask(1000);
    // task 2: context drops to 2000 after compaction -> delta is negative (2000 - 7000 = -5k), not clamped to non-negative.
    r.handle(
      tokenUsage(
        { cache_read: 0, cache_write: 0, output: 0, total: 9000 },
        { cache_read: 0, cache_write: 0, output: 0, total: 2000 },
      ),
    );
    r.endTask(1000);
    const lines = stripAnsi(text()).trim().split("\n");
    expect(lines[lines.length - 1]).toBe("[stats] context 2k (-5k) · tokens 9k (+2k) · 2s (+1s)");
  });

  it("renders mode-specific compaction messages (summarize vs discard)", () => {
    const { stream, text } = collector();
    const r = new StreamRenderer(stream, t);
    r.handle(compactionBegin({ reason: "context", mode: "summarize", context: 150, turns: 3 }));
    r.handle(compactionEnd({ reason: "context", mode: "summarize", status: "completed" }));
    r.handle(compactionBegin({ reason: "manual", mode: "discard", context: 10, turns: 1 }));
    r.handle(compactionEnd({ reason: "manual", mode: "discard", status: "completed" }));
    r.handle(compactionEnd({ reason: "context", mode: "summarize", status: "failed" }));
    expect(stripAnsi(text())).toBe(
      [
        "[compaction] summarizing context (context)…",
        "[compaction] done; continuing with the summarized context",
        "[compaction] discarding context (manual)…",
        "[compaction] done; old context discarded",
        "[compaction] failed; keeping the current context",
        "",
      ].join("\n"),
    );
  });

  it("compaction after the turn ends: the completion line shows its own cost, excluded from the turn stats delta; context not updated", () => {
    const { stream, text } = collector();
    const r = new StreamRenderer(stream, t);
    // Ordinary request: context 5000.
    r.handle(
      tokenUsage(
        { cache_read: 0, cache_write: 0, output: 0, total: 8000 },
        { cache_read: 0, cache_write: 0, output: 0, total: 5000 },
      ),
    );
    // The compaction request's usage sits between the paired compaction events: no ordinary request_end
    // follows it in this turn -> compaction after the turn has ended.
    r.handle(compactionBegin({ reason: "context", mode: "summarize", context: 5000, turns: 1 }));
    r.handle(
      tokenUsage(
        { cache_read: 0, cache_write: 0, output: 0, total: 14000 },
        { cache_read: 0, cache_write: 0, output: 0, total: 6000 },
      ),
    );
    r.handle(compactionEnd({ reason: "context", mode: "summarize", status: "completed" }));
    r.endTask(1000);
    const s = stripAnsi(text());
    // The compaction-done line still shows this call's usage: session cumulative 14k + this compaction's 6k.
    expect(s).toContain(
      "[compaction] done; continuing with the summarized context · tokens 14k (+6k)",
    );
    // Stats line: context stays at the ordinary-request figure of 5k; cumulative tokens 14k (includes
    // compaction, following the provider), but this turn's **delta** is only the ordinary request's 5k —
    // compaction after the turn ends is not attributed to this turn.
    expect(s).toContain("context 5k");
    expect(s).toContain("tokens 14k (+5k)");
  });

  it("mid-turn compaction (a normal request_end follows): elapsed time includes the compaction span, Token delta includes compaction", () => {
    const { stream, text } = collector();
    const r = new StreamRenderer(stream, t);
    // own1: ordinary request, request 5000, 00:00 -> 00:02.
    r.handle(at("2026-07-05T00:00:00.000Z", requestBegin()));
    r.handle(at("2026-07-05T00:00:01.000Z", usage(5000, 5000)));
    r.handle(at("2026-07-05T00:00:02.000Z", requestEnd("completed")));
    // Mid-turn compaction: 00:03 -> 00:13, request 6000 (the compaction's own summarization request).
    r.handle(
      at(
        "2026-07-05T00:00:03.000Z",
        compactionBegin({ reason: "context", mode: "summarize", context: 5000, turns: 1 }),
      ),
    );
    r.handle(at("2026-07-05T00:00:04.000Z", requestBegin()));
    r.handle(at("2026-07-05T00:00:10.000Z", usage(6000, 14000)));
    r.handle(at("2026-07-05T00:00:12.000Z", requestEnd("completed")));
    r.handle(
      at(
        "2026-07-05T00:00:13.000Z",
        compactionEnd({ reason: "context", mode: "summarize", status: "completed" }),
      ),
    );
    // The turn continues after compaction (carry-over): own2 request 2000, final request_end at 00:16 -> settles the compaction usage.
    r.handle(at("2026-07-05T00:00:14.000Z", requestBegin()));
    r.handle(at("2026-07-05T00:00:15.000Z", usage(2000, 16000)));
    r.handle(at("2026-07-05T00:00:16.000Z", requestEnd("completed")));
    r.endTask(999); // the passed-in wall clock is ignored: with a request_end present, elapsed comes from the timestamp span
    const s = stripAnsi(text());
    // Elapsed = first event 00:00 -> the last non-compaction request_end 00:16 = 16s (includes the 10s of
    // compaction in the middle, which occupied this turn's wall clock).
    // Token delta = own1 5000 + own2 2000 + compaction 6000 = 13k; context uses the ordinary-request figure after compaction, 2k.
    expect(s).toContain("context 2k");
    expect(s).toContain("tokens 16k (+13k)");
    expect(s).toContain("16s (+16s)");
  });

  it("compaction after the turn ends (with request events): elapsed time stops at the last request_end before compaction", () => {
    const { stream, text } = collector();
    const r = new StreamRenderer(stream, t);
    // own1: 00:00 -> 00:03.
    r.handle(at("2026-07-05T00:00:00.000Z", requestBegin()));
    r.handle(at("2026-07-05T00:00:01.000Z", usage(5000, 5000)));
    r.handle(at("2026-07-05T00:00:03.000Z", requestEnd("completed")));
    // Trailing compaction: 00:04 -> 00:24, a full 20s, with no ordinary request_end for this turn after it.
    r.handle(
      at(
        "2026-07-05T00:00:04.000Z",
        compactionBegin({ reason: "context", mode: "summarize", context: 5000, turns: 1 }),
      ),
    );
    r.handle(at("2026-07-05T00:00:05.000Z", requestBegin()));
    r.handle(at("2026-07-05T00:00:20.000Z", usage(6000, 14000)));
    r.handle(at("2026-07-05T00:00:23.000Z", requestEnd("completed")));
    r.handle(
      at(
        "2026-07-05T00:00:24.000Z",
        compactionEnd({ reason: "context", mode: "summarize", status: "completed" }),
      ),
    );
    r.endTask(999);
    const s = stripAnsi(text());
    // Elapsed = 00:00 -> the last non-compaction request_end before compaction, 00:03 = 3s (the whole 20s
    // compaction span comes after it and does not count).
    // Token delta is only own1's 5k; compaction's 6k is not attributed to this turn.
    expect(s).toContain("tokens 14k (+5k)");
    expect(s).toContain("3s (+3s)");
  });

  it("renders approval_decision events (approved / denied)", () => {
    const { stream, text } = collector();
    const r = new StreamRenderer(stream, t);
    r.handle(approvalDecision("allow", "c1"));
    r.handle(approvalDecision("deny", "c2"));
    const s = stripAnsi(text());
    expect(s).toContain("[approved]");
    expect(s).toContain("[denied]");
  });

  it("keeps call → decision contiguous at prompt time and dedupes the late approval_decision event", () => {
    const { stream, text } = collector();
    const r = new StreamRenderer(stream, t);
    const tc = toolCall({ name: "exec_command", arguments: '{"cmd":"pwd"}', toolCallId: "p8" });
    // Interactive approval: while locked, renders "call line -> (prompt, written directly by readline) -> result" as three contiguous lines.
    r.beginUserPrompt(tc);
    r.noteApprovalDecision(tc, "allow");
    r.endUserPrompt();
    expect(stripAnsi(text())).toBe("[tool-p8] $ pwd\n✓ [approved]\n");
    // A late approval_decision event is deduped by key and not re-rendered.
    r.handle(approvalDecision("allow", "p8"));
    expect(stripAnsi(text())).toBe("[tool-p8] $ pwd\n✓ [approved]\n");
  });

  it("re-renders a half-streamed call line at approval and suppresses its late tail deltas", () => {
    const { stream, text } = collector();
    const r = new StreamRenderer(stream, t);
    const tc = toolCall({
      name: "exec_command",
      arguments: '{"cmd":"git status"}',
      toolCallId: "h7",
    });
    // The call line is still mid-stream (only half its arguments rendered) when approval begins.
    r.handle(partialToolCall({ eventType: "start", name: "exec_command", toolCallId: "h7" }));
    r.handle(
      partialToolCall({
        eventType: "delta",
        name: "",
        arguments: '{"cmd":"git st',
        toolCallId: "h7",
      }),
    );
    r.beginUserPrompt(tc);
    // The trailing delta / stop arrive queued while the screen is locked.
    r.handle(
      partialToolCall({ eventType: "delta", name: "", arguments: 'atus"}', toolCallId: "h7" }),
    );
    r.handle(partialToolCall({ eventType: "stop", name: "", toolCallId: "h7" }));
    r.noteApprovalDecision(tc, "allow");
    r.endUserPrompt();
    const s = stripAnsi(text());
    // At approval time, the full call line is re-rendered in place from the complete message, right next to
    // the result; after unlocking, the late tail is deduped and must not start a duplicate call line after
    // the result line.
    expect(s).toContain("[tool-h7] $ git status\n✓ [approved]\n");
    expect(s.slice(s.indexOf("[approved]"))).not.toContain("[tool-h7]");
  });

  it("defers another call's auto-approval rendering while an interactive prompt is active", () => {
    const { stream, text } = collector();
    const r = new StreamRenderer(stream, t);
    const parent = toolCall({
      name: "exec_command",
      arguments: '{"cmd":"pwd"}',
      toolCallId: "pa1",
    });
    const child = withOrigin(
      toolCall({ name: "exec_command", arguments: '{"cmd":"ls"}', toolCallId: "ch2" }),
      "sess_kid",
    );
    r.beginUserPrompt(parent); // parent call's interactive prompt: locks the screen
    r.noteApprovalDecision(child, "allow"); // concurrent subagent auto-approval: deferred, not inserted mid-prompt
    expect(stripAnsi(text())).not.toContain("ch2");
    r.noteApprovalDecision(parent, "allow"); // the prompt owner's result renders in place as usual
    r.endUserPrompt();
    const s = stripAnsi(text());
    // Order: parent call line -> parent result -> child call line -> child result.
    const iParentOk = s.indexOf("[approved]");
    const iChildCall = s.indexOf("[agent-kid-tool-ch2]");
    expect(s.indexOf("[tool-pa1]")).toBeGreaterThanOrEqual(0);
    expect(iChildCall).toBeGreaterThan(iParentOk);
    expect(s.indexOf("[approved]", iChildCall)).toBeGreaterThan(iChildCall);
  });

  it("endCompact settles manual /compact usage so the next task's delta excludes it", () => {
    const { stream, text } = collector();
    const r = new StreamRenderer(stream, t);
    r.handle(
      tokenUsage(
        { cache_read: 0, cache_write: 0, output: 0, total: 8000 },
        { cache_read: 0, cache_write: 0, output: 0, total: 5000 },
      ),
    );
    r.endTask(1000);
    // Manual /compact: the compaction request consumes 6000 (already shown on the compaction-done line), endCompact settles it.
    r.handle(compactionBegin({ reason: "manual", mode: "summarize", context: 5000, turns: 1 }));
    r.handle(
      tokenUsage(
        { cache_read: 0, cache_write: 0, output: 0, total: 14000 },
        { cache_read: 0, cache_write: 0, output: 0, total: 6000 },
      ),
    );
    r.handle(compactionEnd({ reason: "manual", mode: "summarize", status: "completed" }));
    r.endCompact(500);
    // The next task consumes only 1000: its delta must not include compaction's 6000.
    r.handle(
      tokenUsage(
        { cache_read: 0, cache_write: 0, output: 0, total: 15000 },
        { cache_read: 0, cache_write: 0, output: 0, total: 1000 },
      ),
    );
    r.endTask(1000);
    const lines = stripAnsi(text()).trim().split("\n");
    expect(lines[lines.length - 1]).toContain("tokens 15k (+1k)");
  });

  it("re-renders the call line next to the decision when other output separated them (auto-approve)", () => {
    const { stream, text } = collector();
    const r = new StreamRenderer(stream, t);
    // The call line is first rendered while streaming, then separated from the decision by other output.
    r.handle(partialToolCall({ eventType: "start", name: "exec_command", toolCallId: "c5" }));
    r.handle(
      partialToolCall({
        eventType: "delta",
        name: "",
        arguments: '{"cmd":"ls"}',
        toolCallId: "c5",
      }),
    );
    r.handle(partialToolCall({ eventType: "stop", name: "", toolCallId: "c5" }));
    r.handle(partialText("start", ""));
    r.handle(partialText("delta", "hi"));
    r.handle(partialText("stop", "", "completed"));
    // Auto-approval: the call line is no longer adjacent -> it is re-rendered in place, with the result immediately following it as a pair.
    r.noteApprovalDecision(
      toolCall({ name: "exec_command", arguments: '{"cmd":"ls"}', toolCallId: "c5" }),
      "allow",
    );
    expect(stripAnsi(text())).toBe("[tool-c5] $ ls\nhi\n[tool-c5] $ ls\n✓ [approved]\n");
  });

  it("does not re-render the call line when it is already adjacent to the decision", () => {
    const { stream, text } = collector();
    const r = new StreamRenderer(stream, t);
    r.handle(partialToolCall({ eventType: "start", name: "exec_command", toolCallId: "c6" }));
    r.handle(
      partialToolCall({
        eventType: "delta",
        name: "",
        arguments: '{"cmd":"ls"}',
        toolCallId: "c6",
      }),
    );
    r.handle(partialToolCall({ eventType: "stop", name: "", toolCallId: "c6" }));
    r.noteApprovalDecision(
      toolCall({ name: "exec_command", arguments: '{"cmd":"ls"}', toolCallId: "c6" }),
      "deny",
    );
    expect(stripAnsi(text())).toBe("[tool-c6] $ ls\n× [denied]\n");
  });
});

describe("StreamRenderer — nested (origin-tagged) subagent messages", () => {
  const hop: MessageOrigin = "sess_child";

  it("renders nested tool calls with an agent-tool tag; skips nested text/thinking partials", () => {
    const { stream, text } = collector();
    const r = new StreamRenderer(stream, t);
    // Nested text/thinking is not rendered (the child's reply is shown via the parent tool's output gutter).
    r.handle(withOrigin(partialText("delta", "child text"), hop));
    r.handle(withOrigin(partialThinking("delta", "child think"), hop));
    // A nested complete tool_call renders one line (so the user can see what tool the subagent is calling
    // before approval); the tag is agent-<last-3-chars-of-child-session>-tool-<last-3-chars-of-id>; the
    // approval line carries no tag.
    r.handle(
      withOrigin(
        toolCall({ name: "exec_command", arguments: '{"cmd":"ls"}', toolCallId: "cc1" }),
        hop,
      ),
    );
    r.handle(withOrigin(approvalDecision("allow", "cc1"), hop));
    expect(stripAnsi(text())).toBe("[agent-ild-tool-cc1] $ ls\n✓ [approved]\n");
  });

  it("renders the pending nested tool call at approval time when its stream copy has not arrived; dedupes the late copy", () => {
    const { stream, text } = collector();
    const r = new StreamRenderer(stream, t);
    const tc = withOrigin(
      toolCall({ name: "exec_command", arguments: '{"cmd":"ls"}', toolCallId: "cc9" }),
      hop,
    );
    // The approval callback arrives before the forwarded message: beginUserPrompt renders the call line directly from the complete message.
    r.beginUserPrompt(tc);
    expect(stripAnsi(text())).toBe("[agent-ild-tool-cc9] $ ls\n");
    r.endUserPrompt();
    // The late forwarded copy is deduped by key and not re-rendered.
    r.handle(tc);
    expect(stripAnsi(text())).toBe("[agent-ild-tool-cc9] $ ls\n");
  });

  it("renders the pending parent tool call at approval time and suppresses its late partial stream", () => {
    const { stream, text } = collector();
    const r = new StreamRenderer(stream, t);
    r.beginUserPrompt(
      toolCall({ name: "exec_command", arguments: '{"cmd":"pwd"}', toolCallId: "p7" }),
    );
    r.endUserPrompt();
    // The whole late streaming copy is deduped and skipped.
    r.handle(partialToolCall({ eventType: "start", name: "exec_command", toolCallId: "p7" }));
    r.handle(
      partialToolCall({
        eventType: "delta",
        name: "",
        arguments: '{"cmd":"pwd"}',
        toolCallId: "p7",
      }),
    );
    r.handle(partialToolCall({ eventType: "stop", name: "", toolCallId: "p7" }));
    expect(stripAnsi(text())).toBe("[tool-p7] $ pwd\n");
  });

  it("adds nested token_usage request totals to the task delta and the session total", () => {
    const { stream, text } = collector();
    const r = new StreamRenderer(stream, t);
    // One parent-session request: 1500; one child-session request: 2000 -> per-task delta 3.5k;
    // session cumulative = parent 8000 + child 2000 = 10k (delta and cumulative use the same basis: parent + child).
    r.handle(
      tokenUsage(
        { cache_read: 0, cache_write: 0, output: 0, total: 8000 },
        { cache_read: 0, cache_write: 0, output: 200, total: 1500 },
      ),
    );
    r.handle(
      withOrigin(
        tokenUsage(
          { cache_read: 0, cache_write: 0, output: 0, total: 2000 },
          { cache_read: 0, cache_write: 0, output: 100, total: 2000 },
        ),
        hop,
      ),
    );
    r.endTask(1000);
    const s1 = stripAnsi(text());
    expect(s1).toContain("3.5k"); // the per-task delta includes child-session usage
    expect(s1).toContain("10k"); // the session cumulative includes child-session usage
    // The child session's cumulative persists across tasks: the next task consumes only from the parent session, cumulative = 9000 + 2000 = 11k (+1k).
    r.handle(
      tokenUsage(
        { cache_read: 0, cache_write: 0, output: 0, total: 9000 },
        { cache_read: 0, cache_write: 0, output: 100, total: 1000 },
      ),
    );
    r.endTask(1000);
    const lines = stripAnsi(text()).trim().split("\n");
    const last = lines[lines.length - 1]!;
    expect(last).toContain("11k");
    expect(last).toContain("+1k");
  });

  it("prints stats when a task only has nested (subagent) token usage", () => {
    const { stream, text } = collector();
    const r = new StreamRenderer(stream, t);
    r.handle(
      withOrigin(
        tokenUsage(
          { cache_read: 0, cache_write: 0, output: 0, total: 2000 },
          { cache_read: 0, cache_write: 0, output: 100, total: 2000 },
        ),
        hop,
      ),
    );
    r.endTask(1000);
    const s = stripAnsi(text());
    expect(s).toContain("[stats]");
    expect(s).toContain("2k (+2k)");
  });
});

describe("renderHistory (resume)", () => {
  it("renders complete messages statically with interruption markers", async () => {
    const { renderHistory } = await import("../src/render.js");
    const { userText } = await import("@prismshadow/penguin-core");
    const { stream, text } = collector();
    renderHistory(
      [
        userText("hello"),
        thinkingMessage("pondering"),
        assistantText("hi there"),
        toolCall({ name: "exec_command", arguments: '{"cmd":"ls"}', toolCallId: "call_653" }),
        toolCallOutput({ output: "a.txt\nb.txt", toolCallId: "call_653" }),
        assistantText("half answer", "aborted"),
      ],
      stream,
    );
    const s = stripAnsi(text());
    expect(s).toContain("> hello");
    expect(s).toContain("pondering");
    expect(s).toContain("hi there");
    expect(s).toContain("[tool-653] $ ls");
    expect(s).toContain("[tool-653] >> a.txt");
    expect(s).toContain("[tool-653] >> b.txt");
    // An interrupted message carries a marker (rendering includes the interrupted turn).
    expect(s).toContain("half answer [aborted]");
  });

  it("skips events and renders nothing for empty history", async () => {
    const { renderHistory } = await import("../src/render.js");
    const { stream, text } = collector();
    renderHistory(
      [
        tokenUsage(
          { cache_read: 0, cache_write: 0, output: 0, total: 1 },
          { cache_read: 0, cache_write: 0, output: 0, total: 1 },
        ),
      ],
      stream,
    );
    expect(text()).toBe("");
  });
});
