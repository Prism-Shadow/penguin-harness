/**
 * Trace replay:
 *
 * - Per-round judgment: completed rounds enter history; uncommitted rounds (not completed / have
 *   a start but no stop) are dropped entirely, keeping only outputs paired with already-committed
 *   tool_calls; trailing input is kept as-is as carry-over.
 * - Pairing fallback: committed tool_calls with no paired output get an interrupted-state placeholder.
 * - Compaction wrap-up (file level): summarize rebuilds [context_summary], discard leaves no
 *   pending input; failed compaction rounds are dropped by the generic rule; a "completed"
 *   summarize closure whose output extracts to an empty summary (a pre-#83 trace shape) is
 *   voided and the original context replays.
 * - A compaction that took tool rounds: the summary is the closing span's last committed
 *   request (a round's text is not), followed by the one line naming the replayed file; a round
 *   the process died in leaves its outputs as carry-over, pairing its calls, and its reminder
 *   is not resent.
 * - A compaction completed with the unified error pair (no full summary could be had): the next
 *   context opens with the hand-off note filled from the file with the template in force at
 *   resume — the same note the live engine opened it with — and no text a reply in the span wrote.
 * - A span with no request (an ordinary request the provider refused, answered by a hand-off)
 *   resumes with that note, the refusal quoted in it; a process that died inside such a span
 *   resumes on the old context with the refused turn's input pending.
 * - Tolerates a truncated trailing line left by an abnormal process exit.
 * - Round-trip: a Trace written out by the engine, once replayed, matches the history the model actually received.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REJECTED_IMAGE_NOTE, replaceInputImages } from "../src/engine/rejected-images.js";
import {
  assistantText,
  compactionBegin,
  compactionEnd,
  emptyTokenCounts,
  imageUrlMessage,
  requestBegin,
  requestEnd,
  sessionMeta,
  thinkingMessage,
  tokenUsage,
  toolCall,
  toolCallOutput,
  userText,
} from "@prismshadow/amsp/records";
import type { AmspRecord, ErrorCode, TokenCounts } from "@prismshadow/amsp/records";
import { transcribeToolCallOutput } from "@prismshadow/amsp/markers";
import { parseTraceLines, readTraceTolerant, resumeTrace } from "../src/trace/resume.js";
import { buildCompactionHandoff } from "../src/engine/compaction-carry.js";
import { ContextEngine } from "../src/engine/context-engine.js";
import { Environment } from "../src/environment/index.js";
import { Writer, readTrace } from "../src/trace/index.js";
import type { ApproveFn, EnvironmentInterface, LLMInterface } from "../src/interfaces/index.js";

const usage = (total: number): TokenCounts => ({
  cache_read: 0,
  cache_write: 0,
  output: 1,
  total,
});

function meta(): AmspRecord {
  return sessionMeta({
    session_id: "session-2026-07-06-10-00-00-abcdef01",
    provider: "anthropic",
    model_id: "claude-sonnet-4-6",
    model_context_window: 1000000,
    system_prompt: "SP",
    agent_state: "/agent/state",
    workspace: "/ws",
    source: "user",
  });
}

function textsOf(msgs: AmspRecord[]): string[] {
  return msgs.map((m) => {
    const p = m.payload as {
      type?: string;
      text?: string;
      output?: string;
      name?: string;
      thinking?: string;
    };
    return p.text ?? p.output ?? p.thinking ?? p.name ?? p.type ?? "";
  });
}

describe("resumeTrace", () => {
  it("committed rounds enter history; trailing inputs become carry-over", () => {
    const result = resumeTrace([
      meta(),
      userText("hello"),
      requestBegin(),
      assistantText("hi"),
      requestEnd("completed"),
      tokenUsage(usage(10), usage(10)),
      userText("tail input"), // the request never got a chance to start
    ]);
    expect(textsOf(result.history)).toEqual(["hello", "hi"]);
    expect(textsOf(result.carryOver)).toEqual(["tail input"]);
    expect(result.sessionTurns).toBe(1);
    expect(result.sessionTokens.total).toBe(10);
    expect(result.lastRequestTotal).toBe(10);
    expect(result.contextClosed).toBe(false);
  });

  it("re-carries the uncommitted round's raw input into the retried round", () => {
    // The synthesized carry-over (flatten) is never written to Trace: replay does its best,
    // merging the unanswered raw input as-is into the retried round (the history content differs
    // in wording from the flatten MMSP actually received, but matches in structure and information).
    const result = resumeTrace([
      meta(),
      userText("A"),
      requestBegin(),
      requestEnd("retryable"), // failed with zero output
      requestBegin(),
      assistantText("ok"),
      requestEnd("completed"),
      tokenUsage(usage(20), usage(20)),
    ]);
    expect(textsOf(result.history)).toEqual(["A", "ok"]);
    expect(result.carryOver).toEqual([]);
  });

  it("keeps structured outputs pairing committed tool_calls when a later round fails", () => {
    const result = resumeTrace([
      meta(),
      userText("run it"),
      requestBegin(),
      toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc1" }),
      requestEnd("completed"),
      tokenUsage(usage(10), usage(10)),
      toolCallOutput({ output: "result-1", toolCallId: "tc1", status: "completed" }),
      requestBegin(),
      thinkingMessage("half"), // the replay request was interrupted
      requestEnd("aborted"),
    ]);
    expect(textsOf(result.history)).toEqual(["run it", "exec_command"]);
    // tc1 was committed but unanswered: its output is kept pending (structured re-delivery); the half-finished thinking is discarded.
    expect(textsOf(result.carryOver)).toEqual(["result-1"]);
  });

  it("an image-rejected round gives its input back with the images replaced, as the engine resent it", () => {
    const image = "data:image/png;base64,iVBORw0KGgo=";
    const readImage = toolCallOutput({
      output: "image/png, 8 B",
      toolCallId: "tc1",
      images: [image],
      status: "completed",
    });
    const errorMessage = "400 Could not process image";
    const upToRequest: AmspRecord[] = [
      meta(),
      userText("look at the screenshot"),
      requestBegin(),
      toolCall({ name: "read_file", arguments: "{}", toolCallId: "tc1" }),
      requestEnd("completed"),
      tokenUsage(usage(10), usage(10)),
      readImage,
      requestBegin(),
    ];
    const retried = resumeTrace([
      ...upToRequest,
      requestEnd("retryable", {
        errorCode: "image_rejected",
        errorMessage,
        attempt: 1,
        retryInMs: 0,
      }),
      requestBegin(),
      assistantText("I could not see it."),
      requestEnd("completed", { attempt: 2 }),
      tokenUsage(usage(20), usage(20)),
    ]);
    // The fixed note stands in for the image, as the engine sent it; the provider's text rode
    // in the retry's [turn_retried] block, which replay does not rebuild.
    const [resent] = textsOf(replaceInputImages([readImage]));
    expect(resent).toBe(`image/png, 8 B\n${REJECTED_IMAGE_NOTE}`);
    expect(textsOf(retried.history)).toEqual([
      "look at the screenshot",
      "read_file",
      resent,
      "I could not see it.",
    ]);
    expect((retried.history[2]!.payload as { images?: string[] }).images).toBeUndefined();
    expect(retried.carryOver).toEqual([]);

    // Any other failure gives the input back as it was: the image is resent.
    const rejected = resumeTrace([
      ...upToRequest,
      requestEnd("fatal", { errorCode: "rejected", errorMessage: "400 unknown parameter" }),
    ]);
    expect(rejected.carryOver).toHaveLength(1);
    expect((rejected.carryOver[0]!.payload as { images?: string[] }).images).toEqual([image]);
  });

  it("treats begin-without-end as uncommitted: raw input re-carried, half-products lost", () => {
    const result = resumeTrace([
      meta(),
      userText("A"),
      requestBegin(),
      thinkingMessage("half"),
      // The process exited during the request: no end.
    ]);
    expect(result.history).toEqual([]);
    // The last unanswered input is resent as-is; the model's half-finished output is allowed to be lost.
    expect(textsOf(result.carryOver)).toEqual(["A"]);
    // The render view still shows every complete message.
    expect(textsOf(result.renderMessages)).toEqual(["A", "half"]);
  });

  it("backfills placeholder outputs for committed tool_calls with no paired output", () => {
    const result = resumeTrace([
      meta(),
      userText("go"),
      requestBegin(),
      toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc1" }),
      toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc2" }),
      requestEnd("completed"),
      tokenUsage(usage(10), usage(10)),
      toolCallOutput({ output: "done-1", toolCallId: "tc1", status: "completed" }),
      // tc2's output was lost along with the process.
    ]);
    // carry-over = real trailing output + in-memory synthesized placeholder (never written to Trace), pairing complete.
    expect(result.carryOver).toHaveLength(2);
    const backfill = result.carryOver[1]!.payload as { tool_call_id: string; output: string };
    expect(backfill.tool_call_id).toBe("tc2");
    expect(backfill.output).toContain("interrupted");
    expect(textsOf(result.carryOver)).toEqual(["done-1", backfill.output]);
  });

  it("routes user-side messages inside a request span to the next round's input", () => {
    const result = resumeTrace([
      meta(),
      userText("go"),
      requestBegin(),
      toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc1" }),
      // A parallel tool finished during the request: its output lands between start and stop.
      toolCallOutput({ output: "early", toolCallId: "tc1", status: "completed" }),
      requestEnd("completed"),
      tokenUsage(usage(10), usage(10)),
    ]);
    expect(textsOf(result.history)).toEqual(["go", "exec_command"]);
    expect(textsOf(result.carryOver)).toEqual(["early"]);
  });

  it("closed context (summarize): empty history, summary rebuilt from compaction output", () => {
    const result = resumeTrace([
      meta(),
      userText("hello"),
      requestBegin(),
      assistantText("hi"),
      requestEnd("completed"),
      tokenUsage(usage(10), usage(10)),
      compactionBegin({ reason: "context", mode: "summarize", context: 10, turns: 1 }),
      userText("please summarize"),
      requestBegin(),
      assistantText("[summary]the gist[/summary]"),
      requestEnd("completed"),
      tokenUsage(usage(20), usage(20)),
      compactionEnd({ reason: "context", mode: "summarize", status: "completed" }),
    ]);
    expect(result.contextClosed).toBe(true);
    expect(result.history).toEqual([]);
    expect(result.renderMessages).toEqual([]);
    const summary = result.pendingSummary!.payload as { text: string };
    expect(summary.text).toBe("[context_summary]\nthe gist\n[/context_summary]");
    expect(result.sessionTurns).toBe(0);
    expect(result.sessionTokens.total).toBe(20); // Token carry-over includes compaction consumption
  });

  it("closed context (summarize): the legacy <summary> form in an old Trace still rebuilds the summary", () => {
    // Dual-form regression: compaction.prompt is persisted in old agents' system_config.yaml,
    // so old Traces contain angle-bracket compaction output; extractSummary must keep
    // accepting it (the rebuilt pending input always uses the current square form).
    const result = resumeTrace([
      meta(),
      userText("hello"),
      requestBegin(),
      assistantText("hi"),
      requestEnd("completed"),
      tokenUsage(usage(10), usage(10)),
      compactionBegin({ reason: "context", mode: "summarize", context: 10, turns: 1 }),
      userText("please summarize"),
      requestBegin(),
      assistantText("<summary>the old-form gist</summary>"),
      requestEnd("completed"),
      tokenUsage(usage(20), usage(20)),
      compactionEnd({ reason: "context", mode: "summarize", status: "completed" }),
    ]);
    expect(result.contextClosed).toBe(true);
    const summary = result.pendingSummary!.payload as { text: string };
    expect(summary.text).toBe("[context_summary]\nthe old-form gist\n[/context_summary]");
  });

  it("replays a trace containing [user_steering] user messages as ordinary turn input", () => {
    // Mid-run steering is delivered as standalone [user_steering] user messages written to
    // Trace alongside that turn's tool outputs: replay attributes them positionally like any
    // user input — committed spans keep them in history verbatim (marker and all).
    const steered = "[user_steering]\nswitch to the staging config\n[/user_steering]";
    const result = resumeTrace([
      meta(),
      userText("run it"),
      requestBegin(),
      toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc1" }),
      requestEnd("completed"),
      tokenUsage(usage(10), usage(10)),
      toolCallOutput({ output: "result-1", toolCallId: "tc1", status: "completed" }),
      // Steering delivered with the tool output as the second turn's input.
      userText(steered),
      requestBegin(),
      assistantText("done"),
      requestEnd("completed"),
      tokenUsage(usage(20), usage(20)),
      // Loop-end steering continuation: a [user_steering] user turn of its own.
      userText("[user_steering]\none more thing\n[/user_steering]"),
      requestBegin(),
      assistantText("handled"),
      requestEnd("completed"),
      tokenUsage(usage(30), usage(30)),
    ]);
    expect(textsOf(result.history)).toEqual([
      "run it",
      "exec_command",
      "result-1",
      steered,
      "done",
      "[user_steering]\none more thing\n[/user_steering]",
      "handled",
    ]);
    expect(result.sessionTurns).toBe(3);
    expect(result.carryOver).toEqual([]);
  });

  it("keeps trailing steering user messages as carry-over verbatim (unanswered input is resent)", () => {
    // The steering message was persisted but its answering request never committed: it is
    // resent as-is on resume, marker and all, next to the tool output it rode along with.
    const steered = "[user_steering]\nalso check CI\n[/user_steering]";
    const result = resumeTrace([
      meta(),
      userText("run it"),
      requestBegin(),
      toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc1" }),
      requestEnd("completed"),
      tokenUsage(usage(10), usage(10)),
      toolCallOutput({ output: "late", toolCallId: "tc1", status: "completed" }),
      userText(steered),
    ]);
    expect(textsOf(result.history)).toEqual(["run it", "exec_command"]);
    expect(textsOf(result.carryOver)).toEqual(["late", steered]);
  });

  it("closed context (discard): empty history and no pending summary", () => {
    const result = resumeTrace([
      meta(),
      userText("hello"),
      requestBegin(),
      assistantText("hi"),
      requestEnd("completed"),
      tokenUsage(usage(10), usage(10)),
      compactionBegin({ reason: "manual", mode: "discard", context: 10, turns: 1 }),
      compactionEnd({ reason: "manual", mode: "discard", status: "completed" }),
    ]);
    expect(result.contextClosed).toBe(true);
    expect(result.history).toEqual([]);
    expect(result.pendingSummary).toBeUndefined();
  });

  it("an open context names the summary it opened with until a turn completes on it", () => {
    const summary = "[context_summary]\nthe gist\n[/context_summary]";
    const unanswered = resumeTrace([
      meta(),
      userText(summary),
      userText("and now?"),
      requestBegin(),
      requestEnd("aborted"),
    ]);
    expect(textsOf(unanswered.carryOver)).toEqual([summary, "and now?"]);
    expect(unanswered.openingSummary).toBe(unanswered.carryOver[0]);

    const answered = resumeTrace([
      meta(),
      userText(summary),
      userText("and now?"),
      requestBegin(),
      assistantText("this"),
      requestEnd("completed"),
      tokenUsage(usage(10), usage(10)),
    ]);
    expect(answered.openingSummary).toBeUndefined();
    // A first input that is no summary is not one the context opened with.
    expect(resumeTrace([meta(), userText("hello")]).openingSummary).toBeUndefined();
  });

  it("closed context with tool rounds: the summary is the span's last committed request, then one line naming the replayed file", () => {
    const file = "/data/agents/a/traces/2026-11-04/session-x_001.jsonl";
    const result = resumeTrace(
      [
        meta(),
        userText("hello"),
        requestBegin(),
        assistantText("hi"),
        requestEnd("completed"),
        tokenUsage(usage(10), usage(10)),
        compactionBegin({ reason: "context", mode: "summarize", context: 10, turns: 1 }),
        userText("please summarize"),
        requestBegin(),
        assistantText("Writing the plan first."),
        toolCall({ name: "write_file", arguments: '{"file_path":"/s/plan.md"}', toolCallId: "h1" }),
        requestEnd("completed"),
        toolCallOutput({ output: "written", toolCallId: "h1", status: "completed" }),
        userText("R 1/8"),
        requestBegin(),
        assistantText("[summary]see /s/plan.md[/summary]"),
        toolCall({ name: "write_file", arguments: '{"file_path":"/s/more.md"}', toolCallId: "h2" }),
        requestEnd("completed"),
        toolCallOutput({ output: "denied by the user", toolCallId: "h2", status: "aborted" }),
        compactionEnd({ reason: "context", mode: "summarize", status: "completed" }),
      ],
      { tracePath: file },
    );
    expect(result.contextClosed).toBe(true);
    expect(result.history).toEqual([]);
    // No round's text and no call: the summary and the pointer only.
    expect((result.pendingSummary!.payload as { text: string }).text).toBe(
      `[context_summary]\nsee /s/plan.md\n\nTrace file of the compacted context (JSONL, one record per line): ${file}\n[/context_summary]`,
    );
  });

  it("a round the process died in leaves its outputs as carry-over, pairing the committed calls", () => {
    const result = resumeTrace([
      meta(),
      userText("hello"),
      requestBegin(),
      assistantText("hi"),
      requestEnd("completed"),
      tokenUsage(usage(10), usage(10)),
      compactionBegin({ reason: "context", mode: "summarize", context: 10, turns: 1 }),
      userText("please summarize"),
      requestBegin(),
      toolCall({ name: "write_file", arguments: '{"file_path":"/s/a.md"}', toolCallId: "h1" }),
      toolCall({ name: "read_file", arguments: '{"file_path":"/s/b.md"}', toolCallId: "h2" }),
      requestEnd("completed"),
      toolCallOutput({ output: "written", toolCallId: "h1", status: "completed" }),
      // The next request was under way when the process died; h2 never got its output.
      requestBegin(),
    ]);
    expect(result.contextClosed).toBe(false);
    expect(result.danglingCompaction).toMatchObject({ mode: "summarize" });
    // The round's committed request is history; its output, and a placeholder for the call
    // that got none, are what the next request sends first.
    expect(textsOf(result.history)).toEqual([
      "hello",
      "hi",
      "please summarize",
      "write_file",
      "read_file",
    ]);
    expect(
      result.carryOver.map((m) => (m.payload as { tool_call_id?: string }).tool_call_id),
    ).toEqual(["h1", "h2"]);
    expect(textsOf(result.carryOver)).toEqual([
      "written",
      "[interrupted: process exited before the tool finished]",
    ]);
  });

  it("drops failed compaction rounds via the generic rule (prompt not in history)", () => {
    const result = resumeTrace([
      meta(),
      userText("hello"),
      requestBegin(),
      assistantText("hi"),
      requestEnd("completed"),
      tokenUsage(usage(10), usage(10)),
      compactionBegin({ reason: "context", mode: "summarize", context: 10, turns: 1 }),
      userText("please summarize"),
      requestBegin(),
      requestEnd("retryable"),
      compactionEnd({ reason: "context", mode: "summarize", status: "retryable" }),
      userText("continue"),
      requestBegin(),
      assistantText("sure"),
      requestEnd("completed"),
      tokenUsage(usage(30), usage(30)),
    ]);
    expect(result.contextClosed).toBe(false);
    expect(textsOf(result.history)).toEqual(["hello", "hi", "continue", "sure"]);
    expect(result.carryOver).toEqual([]);
    expect(result.sessionTurns).toBe(2);
  });
});

describe("resumeTrace over a compaction's span (summary, hand-off)", () => {
  const file = "/data/agents/a/traces/2026-11-11/session-x_001.jsonl";
  const begin = (): AmspRecord =>
    compactionBegin({ reason: "context", mode: "summarize", context: 10, turns: 1 });
  /** The end of a compaction that completed without a full summary, the error pair saying why. */
  const degradedEnd = (attempt: number, errorCode: ErrorCode, errorMessage: string): AmspRecord =>
    compactionEnd({
      reason: "context",
      mode: "summarize",
      status: "completed",
      attempt,
      errorCode,
      errorMessage,
    });
  const opened = (): AmspRecord[] => [
    meta(),
    userText("hello"),
    requestBegin(),
    assistantText("hi"),
    requestEnd("completed"),
    tokenUsage(usage(10), usage(10)),
  ];
  const textOf = (msg: AmspRecord | undefined): string =>
    (msg?.payload as { text?: string } | undefined)?.text ?? "";
  const truncated = { errorCode: "output_truncated" as const, errorMessage: "output limit" };
  const refused = { errorCode: "rejected" as const, errorMessage: "prompt is too long" };

  it("a file closed with the error pair resumes with the template in force filled from it, a cut summary in its span unused", () => {
    const result = resumeTrace(
      [
        ...opened(),
        begin(),
        userText("please summarize"),
        requestBegin(),
        assistantText("[summary]\n## Request\nShip the release.\n## Progress\nStep done."),
        tokenUsage(usage(40), usage(50)),
        requestEnd("retryable", truncated),
        degradedEnd(1, "output_truncated", "output limit"),
      ],
      {
        tracePath: file,
        handoffNote: "Closed:\n{{ERROR}}\nAsked:\n{{USER_MESSAGES}}\nIn {{TRACE_PATH}}",
      },
    );
    expect(result.contextClosed).toBe(true);
    expect(result.history).toEqual([]);
    expect(textOf(result.pendingSummary)).toBe(
      [
        "[context_summary]",
        "Closed:",
        '  [request_error code="output_truncated"]output limit[/request_error]',
        "Asked:",
        "  [user_input]hello[/user_input]",
        `In ${file}`,
        "[/context_summary]",
      ].join("\n"),
    );
  });

  it("a process that died inside a hand-off resumes on the old context with the refused turn's input pending", () => {
    const result = resumeTrace([
      meta(),
      userText("migrate the database"),
      requestBegin(),
      toolCall({ name: "read_file", arguments: '{"file_path":"/ws/s.sql"}', toolCallId: "rs" }),
      requestEnd("completed"),
      tokenUsage(usage(10), usage(10)),
      toolCallOutput({ output: "CREATE TABLE t", toolCallId: "rs", status: "completed" }),
      userText("use the new column names"),
      requestBegin(),
      requestEnd("retryable", { ...refused, attempt: 1, retryInMs: 0 }),
      begin(),
      // The process died before the span's end was written.
    ]);
    expect(result.contextClosed).toBe(false);
    expect(result.pendingSummary).toBeUndefined();
    expect(result.danglingCompaction).toEqual({ reason: "context", mode: "summarize" });
    expect(result.sessionTurns).toBe(1);
    expect(textsOf(result.history)).toEqual(["migrate the database", "read_file"]);
    // The next run sends the refused turn again, as it was.
    expect(textsOf(result.carryOver)).toEqual(["CREATE TABLE t", "use the new column names"]);
  });

  it("a span the process died in after a committed summary-with-calls response replays the old context with those calls paired", () => {
    const result = resumeTrace([
      ...opened(),
      begin(),
      userText("please summarize"),
      requestBegin(),
      assistantText("[summary]the gist[/summary]"),
      toolCall({ name: "write_file", arguments: '{"file_path":"/s/a.md"}', toolCallId: "h1" }),
      toolCall({ name: "write_file", arguments: '{"file_path":"/s/b.md"}', toolCallId: "h2" }),
      requestEnd("completed"),
      tokenUsage(usage(20), usage(30)),
      toolCallOutput({ output: "written", toolCallId: "h1", status: "completed" }),
      // The process died while h2 ran (or while the next context was being opened).
    ]);
    expect(result.contextClosed).toBe(false);
    expect(result.pendingSummary).toBeUndefined();
    expect(result.danglingCompaction).toMatchObject({ mode: "summarize" });
    // The summary reply is an ordinary committed turn of the old context.
    expect(textsOf(result.history)).toEqual([
      "hello",
      "hi",
      "please summarize",
      "[summary]the gist[/summary]",
      "write_file",
      "write_file",
    ]);
    expect(
      result.carryOver.map((m) => (m.payload as { tool_call_id?: string }).tool_call_id),
    ).toEqual(["h1", "h2"]);
    expect(textsOf(result.carryOver)).toEqual([
      "written",
      "[interrupted: process exited before the tool finished]",
    ]);
  });

  it("does not resend the reminder of an uncommitted compaction request", () => {
    const result = resumeTrace([
      ...opened(),
      begin(),
      userText("please summarize"),
      requestBegin(),
      toolCall({ name: "write_file", arguments: '{"file_path":"/s/a.md"}', toolCallId: "h1" }),
      requestEnd("completed"),
      toolCallOutput({ output: "written", toolCallId: "h1", status: "completed" }),
      userText("R 1/8"),
      // The process died during the request that followed.
      requestBegin(),
    ]);
    expect(result.danglingCompaction).toMatchObject({ mode: "summarize" });
    expect(textsOf(result.history)).toEqual(["hello", "hi", "please summarize", "write_file"]);
    // Only the output the committed round is owed rides on; the harness's line does not.
    expect(textsOf(result.carryOver)).toEqual(["written"]);
  });
});

describe("parseTraceLines", () => {
  /**
   * Content shaped like the #215 corruption: a large record torn in half by a concurrent
   * append, with a complete small record and a newline landing in the middle. Line 2
   * (big prefix + small record) and line 3 (big suffix) are both unparseable.
   */
  function tornContent(): { content: string; survivors: AmspRecord[] } {
    const before = userText("before");
    const after = userText("after");
    const big = JSON.stringify(imageUrlMessage(`data:image/png;base64,${"A".repeat(2048)}`));
    const interleaved = JSON.stringify(tokenUsage(usage(1), usage(1)));
    const torn = `${big.slice(0, 100)}${interleaved}\n${big.slice(100)}`;
    const content = `${JSON.stringify(before)}\n${torn}\n${JSON.stringify(after)}\n`;
    return { content, survivors: [before, after] };
  }

  it("tolerates a torn trailing line (process crash mid-write)", () => {
    const content = `${JSON.stringify(userText("a"))}\n{"timestamp":"2026-07-06T`;
    const skipped: number[] = [];
    const msgs = parseTraceLines(content, { onSkip: (line) => skipped.push(line) });
    expect(msgs).toHaveLength(1);
    // The trailing truncated line is the expected crash artifact — ignored, not diagnosed.
    expect(skipped).toEqual([]);
  });

  it("skips a malformed middle line by default, keeping every parseable record (#215)", () => {
    const { content, survivors } = tornContent();
    const skipped: number[] = [];
    const msgs = parseTraceLines(content, { onSkip: (line) => skipped.push(line) });
    expect(msgs).toEqual(survivors);
    expect(skipped).toEqual([2, 3]);
  });

  it('throws on mid-file corruption when onMalformed is "throw" (import validation)', () => {
    const content = `not-json\n${JSON.stringify(userText("a"))}\n`;
    expect(() => parseTraceLines(content, { onMalformed: "throw" })).toThrow();
    // The trailing truncated line stays tolerated even in strict mode.
    const truncatedTail = `${JSON.stringify(userText("a"))}\n{"timestamp":"2026-07-06T`;
    expect(parseTraceLines(truncatedTail, { onMalformed: "throw" })).toHaveLength(1);
  });

  it("handles thousands of malformed lines without quadratic rescans (wide corruption)", () => {
    // A large mostly-unparseable file (e.g. a non-JSONL file dropped into the traces dir).
    // The tail check must not rescan the remainder per skipped line — with the old
    // slice-per-hit check, this content took seconds of synchronous CPU; now it's O(n).
    const early = userText("early survivor");
    const late = userText("late survivor");
    const lines: string[] = [];
    for (let i = 0; i < 5000; i++) lines.push(`{torn ${i}`);
    lines.push(JSON.stringify(early));
    for (let i = 0; i < 5000; i++) lines.push(`{torn ${5000 + i}`);
    lines.push(JSON.stringify(late));
    const content = `${lines.join("\n")}\n`;

    const skipped: number[] = [];
    const msgs = parseTraceLines(content, { onSkip: (line) => skipped.push(line) });
    expect(msgs).toEqual([early, late]);
    // Every malformed line is reported exactly once, in order, none treated as the tail
    // (the last non-empty line is the valid "late survivor").
    expect(skipped).toHaveLength(10000);
    expect(skipped[0]).toBe(1);
    expect(skipped[4999]).toBe(5000);
    expect(skipped[5000]).toBe(5002);
    expect(skipped[9999]).toBe(10001);
  });
});

describe("readTraceTolerant", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "penguin-tolerant-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("returns the surviving records of a corrupted file without throwing (#215 recovery)", async () => {
    // A file damaged by the pre-fix interleaving: a large record torn in half around a
    // complete small record. No migration exists — the tolerant read IS the recovery.
    const before = userText("before");
    const after = userText("after");
    const big = JSON.stringify(imageUrlMessage(`data:image/png;base64,${"B".repeat(4096)}`));
    const interleaved = JSON.stringify(assistantText("landed mid-record"));
    const file = join(dir, "sess_abc_001.jsonl");
    await mkdir(dir, { recursive: true });
    await writeFile(
      file,
      `${JSON.stringify(before)}\n${big.slice(0, 64)}${interleaved}\n${big.slice(64)}\n${JSON.stringify(after)}\n`,
      "utf8",
    );

    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const msgs = await readTraceTolerant(file);
    expect(msgs).toEqual([before, after]);
    // The skipped lines are diagnosed once, with the file path.
    const diagnostics = stderr.mock.calls
      .map((c) => String(c[0]))
      .filter((s) => s.includes("[trace]"));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain("skipped 2 malformed line(s)");
    expect(diagnostics[0]).toContain(file);
  });

  it("caps the spelled-out line numbers in the diagnostic on heavily damaged files", async () => {
    const survivor = userText("survivor");
    const badLines = Array.from({ length: 30 }, (_, i) => `{torn ${i}`);
    const file = join(dir, "sess_abc_001.jsonl");
    await mkdir(dir, { recursive: true });
    await writeFile(file, `${badLines.join("\n")}\n${JSON.stringify(survivor)}\n`, "utf8");

    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const msgs = await readTraceTolerant(file);
    expect(msgs).toEqual([survivor]);
    const diagnostic = stderr.mock.calls
      .map((c) => String(c[0]))
      .find((s) => s.includes("[trace]"))!;
    // The total is exact, but only the first 20 line numbers are spelled out.
    expect(diagnostic).toContain("skipped 30 malformed line(s)");
    const list = /malformed line\(s\) \[([^\]]*)\]/.exec(diagnostic);
    expect(list).not.toBeNull();
    const firstTwenty = Array.from({ length: 20 }, (_, i) => i + 1).join(", ");
    expect(list![1]).toBe(`${firstTwenty}, …`);
  });
});

describe("engine trace round-trip", () => {
  let workspace: string;
  let traces: string;
  /** The hand-off note's template in force, live and at resume alike. */
  const HANDOFF_NOTE =
    "Handed off.\n{{ERROR}}\n{{USER_MESSAGES}}\n{{LAST_TURN}}\nIn {{TRACE_PATH}}";

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "penguin-replay-ws-"));
    traces = await mkdtemp(join(tmpdir(), "penguin-replay-tr-"));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(traces, { recursive: true, force: true });
  });

  it("replaying an engine-written trace reconstructs the committed history", async () => {
    // Two rounds of dialogue: the first round issues and executes a tool call, the second round
    // wraps up -- the engine writes Trace (including request events); replay should reconstruct
    // history matching what was actually committed to MMSP, with no leftover carry-over.
    let call = 0;
    const llm: LLMInterface = {
      async *streamGenerate() {
        call += 1;
        if (call === 1) {
          yield toolCall({
            name: "exec_command",
            arguments: JSON.stringify({ cmd: "printf ok" }),
            toolCallId: "rt1",
          });
          yield tokenUsage(usage(10), usage(10));
          return { status: "completed" };
        }
        yield assistantText("done");
        yield tokenUsage(usage(20), usage(20));
        return { status: "completed" };
      },
    };
    const environment = new Environment({
      workspaceDir: workspace,
      toolConfig: {
        customTools: [
          {
            name: "exec_command",
            description: "Run a shell command.",
            parameters: { type: "object", properties: { cmd: { type: "string" } } },
            permission: "rw" as const,
          },
        ],
        mcpServers: [],
      },
    });
    const trace = new Writer({ tracesDir: traces, sessionId: "sess-roundtrip" });
    const engine = new ContextEngine({ llm, environment, trace });
    const allow: ApproveFn = async () => "allow";
    for await (const _ of engine.run([userText("go")], { approve: allow })) {
      // consume
    }

    const recorded = await readTrace(trace.currentPath());
    // request boundary events are written in pairs: one pair per round, two rounds total.
    const requestEvents = recorded.filter((m) =>
      ((m.payload as { type?: string }).type ?? "").startsWith("request_"),
    );
    expect(requestEvents.map((m) => (m.payload as { type?: string }).type)).toEqual([
      "request_begin",
      "request_end",
      "request_begin",
      "request_end",
    ]);

    const result = resumeTrace(recorded);
    expect(result.carryOver).toEqual([]);
    expect(result.sessionTurns).toBe(2);
    // History = input -> tool_call -> tool output -> final reply, in the same order as committed.
    const kinds = result.history.map((m) => (m.payload as { type?: string }).type);
    expect(kinds).toEqual(["text", "tool_call", "tool_call_output", "text"]);
  });

  it("aborted run leaves a replayable trace: the raw input is re-carried (flatten not persisted)", async () => {
    let call = 0;
    const llm: LLMInterface = {
      async *streamGenerate() {
        call += 1;
        if (call === 1) {
          yield thinkingMessage("half");
          return { status: "aborted" };
        }
        yield assistantText("ok");
        yield tokenUsage(usage(5), usage(5));
        return { status: "completed" };
      },
    };
    const environment = new Environment({
      workspaceDir: workspace,
      toolConfig: { customTools: [], mcpServers: [] },
    });
    const trace = new Writer({ tracesDir: traces, sessionId: "sess-abort" });
    const engine = new ContextEngine({ llm, environment, trace });
    for await (const _ of engine.run([userText("go")], { approve: async () => "deny" })) {
      // consume
    }

    // If the process exits here: Trace has no synthesized flatten; replay treats the raw input as
    // pending input as-is, and the original round never enters history.
    const recorded = await readTrace(trace.currentPath());
    expect(
      recorded.some((m) =>
        ((m.payload as { text?: string }).text ?? "").includes("[turn_aborted]"),
      ),
    ).toBe(false);
    const result = resumeTrace(recorded);
    expect(result.history).toEqual([]);
    expect(textsOf(result.carryOver)).toEqual(["go"]);
  });

  it("a compaction its provider refused resumes with the hand-off note the live engine opened the next context with", async () => {
    // One test drives both sides: the live engine completes a mid-Task compaction whose request
    // was refused with the note built from the file being closed and the template in force (what
    // the Session supplies as `buildHandoff`), and a restart over that file rebuilds the same text.
    let call = 0;
    const llm1: LLMInterface = {
      async *streamGenerate() {
        call += 1;
        if (call === 1) {
          yield toolCall({
            name: "read_file",
            arguments: '{"file_path":"/ws/notes.md"}',
            toolCallId: "rn",
          });
          yield tokenUsage(usage(150), usage(150));
          return { status: "completed" };
        }
        return { status: "fatal", errorCode: "rejected", errorMessage: "prompt is too long" };
      },
    };
    const llm2: LLMInterface = {
      async *streamGenerate() {
        yield assistantText("carrying on");
        yield tokenUsage(usage(20), usage(170));
        return { status: "completed" };
      },
    };
    const environment: EnvironmentInterface = {
      async listTools() {
        return [];
      },
      async *executeTool({ toolCall: tc }) {
        yield toolCallOutput({
          output: "the notes",
          toolCallId: tc.payload.tool_call_id,
          status: "completed",
        });
      },
      toolPermission() {
        return "rw";
      },
    };
    const trace = new Writer({ tracesDir: traces, sessionId: "sess-handoff" });
    const oldPath = trace.currentPath();
    const engine = new ContextEngine({
      llm: llm1,
      environment,
      trace,
      sessionMeta: meta(),
      compaction: {
        maxContextLength: 100,
        maxSessionTurns: -1,
        mode: "summarize",
        prompt: "COMPACT NOW",
        handoffNote: HANDOFF_NOTE,
      },
      openNextContext: () => ({ llm: llm2 }),
      buildHandoff: async (template) => {
        const path = trace.currentPath();
        return userText(
          buildCompactionHandoff(await readTrace(path), { tracePath: path, template }),
        );
      },
    });
    const approve: ApproveFn = async () => "allow";
    for await (const _ of engine.run([userText("summarize my notes")], { approve })) {
      // consume
    }

    expect(trace.currentPath()).not.toBe(oldPath);
    const opening = (await readTrace(trace.currentPath())).find((m) => {
      const p = m.payload as { type?: string; role?: string };
      return p.type === "text" && p.role === "user";
    });
    const live = (opening?.payload as { text?: string } | undefined)?.text ?? "";
    expect(live.startsWith("[context_summary]\nHanded off.\n")).toBe(true);
    expect(live).toContain("  [user_input]summarize my notes[/user_input]");
    expect(live).toContain(transcribeToolCallOutput("rn", "completed", "the notes"));
    expect(live).toContain(`\nIn ${oldPath}\n`);

    const resumed = resumeTrace(await readTrace(oldPath), {
      tracePath: oldPath,
      handoffNote: HANDOFF_NOTE,
    });
    expect(resumed.contextClosed).toBe(true);
    expect((resumed.pendingSummary?.payload as { text?: string } | undefined)?.text).toBe(live);
  });

  it("a request its provider refused resumes, from a span with no request, with the note the live engine opened the next context with", async () => {
    // One test drives both sides: the live engine answers an ordinary request the provider
    // refused, on a context that has completed a turn, by handing off — no compaction request —
    // and a restart over the closed file rebuilds the same note, the refusal quoted in it.
    const refusal = "prompt is too long: 250000 tokens > 200000 maximum";
    let oldModelCalls = 0;
    const llm1: LLMInterface = {
      async *streamGenerate() {
        oldModelCalls += 1;
        if (oldModelCalls === 1) {
          yield toolCall({
            name: "read_file",
            arguments: '{"file_path":"/ws/big.log"}',
            toolCallId: "rb",
          });
          yield tokenUsage(usage(150), usage(150));
          return { status: "completed" };
        }
        return { status: "fatal", errorCode: "rejected", errorMessage: refusal };
      },
    };
    const llm2: LLMInterface = {
      async *streamGenerate() {
        yield assistantText("carrying on");
        yield tokenUsage(usage(20), usage(170));
        return { status: "completed" };
      },
    };
    const environment: EnvironmentInterface = {
      async listTools() {
        return [];
      },
      async *executeTool({ toolCall: tc }) {
        yield toolCallOutput({
          output: "a very long log",
          toolCallId: tc.payload.tool_call_id,
          status: "completed",
        });
      },
      toolPermission() {
        return "rw";
      },
    };
    const trace = new Writer({ tracesDir: traces, sessionId: "sess-refused" });
    const oldPath = trace.currentPath();
    const engine = new ContextEngine({
      llm: llm1,
      environment,
      trace,
      sessionMeta: meta(),
      // The threshold is far away: only the refusal closes the context.
      compaction: {
        maxContextLength: 100000,
        maxSessionTurns: -1,
        mode: "summarize",
        prompt: "COMPACT NOW",
        handoffNote: HANDOFF_NOTE,
      },
      openNextContext: () => ({ llm: llm2 }),
      buildHandoff: async (template) => {
        const path = trace.currentPath();
        return userText(
          buildCompactionHandoff(await readTrace(path), { tracePath: path, template }),
        );
      },
    });
    const approve: ApproveFn = async () => "allow";
    for await (const _ of engine.run([userText("read the log")], { approve })) {
      // consume
    }

    expect(oldModelCalls).toBe(2);
    expect(trace.currentPath()).not.toBe(oldPath);
    const closed = await readTrace(oldPath);
    const typeAt = (m: AmspRecord): string => (m.payload as { type?: string }).type ?? "";
    const spanStart = closed.findIndex((m) => typeAt(m) === "compaction_begin");
    expect(spanStart).toBeGreaterThan(-1);
    expect(closed.slice(spanStart).map(typeAt)).not.toContain("request_begin");

    const opening = (await readTrace(trace.currentPath())).find((m) => {
      const p = m.payload as { type?: string; role?: string };
      return p.type === "text" && p.role === "user";
    });
    const live = (opening?.payload as { text?: string } | undefined)?.text ?? "";
    expect(live.startsWith("[context_summary]\nHanded off.\n")).toBe(true);
    expect(live).toContain(transcribeToolCallOutput("rb", "completed", "a very long log"));
    expect(live).toContain(`  [request_error code="rejected"]${refusal}[/request_error]`);

    const resumed = resumeTrace(closed, { tracePath: oldPath, handoffNote: HANDOFF_NOTE });
    expect(resumed.contextClosed).toBe(true);
    expect((resumed.pendingSummary?.payload as { text?: string } | undefined)?.text).toBe(live);
  });
});

describe("resumeTrace regressions (PR #39 review)", () => {
  it("drops the aborted round's own tool outputs regardless of landing before or after the end", () => {
    // Tools and the LLM stream run concurrently: an orphaned output may land on disk before or
    // after that round's end, and neither may be re-delivered as a structured result (its
    // tool_call isn't in history, so re-delivering it would produce an orphan tool_result with
    // no preceding tool_use); the raw input is resent as-is.
    const result = resumeTrace([
      meta(),
      userText("go"),
      requestBegin(),
      toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc1" }),
      toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc2" }),
      toolCallOutput({ output: "early", toolCallId: "tc1", status: "completed" }),
      requestEnd("aborted"),
      toolCallOutput({ output: "late", toolCallId: "tc2", status: "aborted" }),
    ]);
    expect(result.history).toEqual([]);
    expect(textsOf(result.carryOver)).toEqual(["go"]);
  });

  it("filters the dropped round's tool outputs out of the next committed round's input snapshot", () => {
    // Main reconnect flow: a tool executes during a timed-out attempt (its output lands on disk),
    // and the retry round completes. The dropped round's tool_call is not in history -- when its
    // output is snapshotted into the retry round's input it must be filtered out, otherwise the
    // history injected via setHistory contains an orphan tool_result with no preceding tool_use,
    // and every request after resume gets rejected by the provider (400).
    const result = resumeTrace([
      meta(),
      userText("go"),
      requestBegin(),
      toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc1" }),
      toolCallOutput({ output: "ran-during-timeout", toolCallId: "tc1", status: "completed" }),
      requestEnd("retryable"), // this round is dropped: tc1 never entered MMSP history
      requestBegin(),
      assistantText("recovered"),
      requestEnd("completed"),
      tokenUsage(usage(20), usage(20)),
    ]);
    // History = original input + retry round output; the orphaned tool_call_output neither enters history nor is re-delivered.
    expect(textsOf(result.history)).toEqual(["go", "recovered"]);
    expect(
      result.history.some((m) => (m.payload as { type?: string }).type === "tool_call_output"),
    ).toBe(false);
    expect(result.carryOver).toEqual([]);
  });

  it("repairs history structure with in-memory placeholders for previously unpaired committed calls", () => {
    // Scenario: the placeholder synthesized on a previous resume was sent out with the request but
    // never written to Trace; a subsequent committed round in Trace is therefore missing that
    // pairing. Replay must re-synthesize the placeholder and inject it into history before that
    // round's input, guaranteeing every assistant tool_use is followed by a tool_result.
    const result = resumeTrace([
      meta(),
      userText("go"),
      requestBegin(),
      toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc1" }),
      requestEnd("completed"),
      tokenUsage(usage(10), usage(10)),
      // (process exits -> resume -> placeholder sent out with the next round but never persisted)
      userText("next"),
      requestBegin(),
      assistantText("ok"),
      requestEnd("completed"),
      tokenUsage(usage(20), usage(20)),
    ]);
    const kinds = result.history.map((m) => (m.payload as { type?: string }).type);
    expect(kinds).toEqual(["text", "tool_call", "tool_call_output", "text", "text"]);
    const repaired = result.history[2]!.payload as { tool_call_id: string; output: string };
    expect(repaired.tool_call_id).toBe("tc1");
    expect(repaired.output).toContain("interrupted");
    expect(result.carryOver).toEqual([]);
  });

  it("closed context (summarize) with a textless compaction output voids the closure and replays the original context", () => {
    // The compaction request completed but produced no text (e.g. thinking-only): only a
    // pre-#83 engine wrote such a "completed" closure — the engine now fails the compaction
    // instead of committing an empty summary that would erase the task state. Resume mirrors
    // that contract: no empty [context_summary] is fabricated, nothing falls back to an
    // earlier round's ordinary answer, and the original context held by this file is
    // reconstructed (the committed compaction turn stays in history like any committed turn).
    const result = resumeTrace([
      meta(),
      userText("hello"),
      requestBegin(),
      assistantText("The answer is 42."),
      requestEnd("completed"),
      tokenUsage(usage(10), usage(10)),
      compactionBegin({ reason: "context", mode: "summarize", context: 10, turns: 1 }),
      userText("please summarize"),
      requestBegin(),
      thinkingMessage("thinking only, no text"),
      requestEnd("completed"),
      tokenUsage(usage(20), usage(20)),
      compactionEnd({ reason: "context", mode: "summarize", status: "completed" }),
    ]);
    expect(result.contextClosed).toBe(false);
    expect(result.pendingSummary).toBeUndefined();
    // Full original history, including the committed compaction exchange (MMSP committed
    // it, so the next request builds on top of it).
    expect(result.history.map((m) => (m.payload as { type?: string }).type)).toEqual([
      "text",
      "text",
      "text",
      "thinking",
    ]);
    expect(textsOf(result.history.slice(0, 3))).toEqual([
      "hello",
      "The answer is 42.",
      "please summarize",
    ]);
    // The committed compaction request does not count as a Session turn (in-process, only real
    // turns increment the counter).
    expect(result.sessionTurns).toBe(1);
    expect(result.carryOver).toEqual([]);
  });

  it("absorbed mid-task compaction (committed rejections) replays with nothing left to resend", () => {
    // Resume symmetry for issue #85: a mid-task compaction whose first attempt committed has
    // absorbed the turn's tool output into history; the repair answering the rejected
    // attempt's tool call rode the second committed attempt. After a process exit at the
    // abandonment, replay must reconstruct exactly the live engine's state: everything in
    // history, nothing in carry-over — the next request continues from the committed state
    // without resending any tool_result.
    const result = resumeTrace([
      meta(),
      userText("go"),
      requestBegin(),
      toolCall({ name: "exec_command", arguments: "{}", toolCallId: "ct" }),
      requestEnd("completed"),
      tokenUsage(usage(150), usage(150)),
      toolCallOutput({ output: "tool ran", toolCallId: "ct", status: "completed" }),
      compactionBegin({ reason: "context", mode: "summarize", context: 150, turns: 1 }),
      userText("COMPACT NOW"),
      requestBegin(),
      assistantText("[summary]nope[/summary]"),
      toolCall({ name: "t", arguments: "{}", toolCallId: "c1" }),
      requestEnd("completed"),
      tokenUsage(usage(160), usage(310)),
      toolCallOutput({
        output: "[tool error] the compaction request expects a summary, not tool calls",
        toolCallId: "c1",
        status: "fatal",
      }),
      requestBegin(),
      thinkingMessage("still nothing"),
      requestEnd("completed"),
      tokenUsage(usage(170), usage(480)),
      compactionEnd({ reason: "context", mode: "summarize", status: "retryable" }),
    ]);
    expect(result.contextClosed).toBe(false);
    expect(result.pendingSummary).toBeUndefined();
    // Both committed compaction rounds enter history: the turn output was absorbed by the
    // first, the repair by the second.
    expect(result.history.map((m) => (m.payload as { type?: string }).type)).toEqual([
      "text",
      "tool_call",
      "tool_call_output",
      "text",
      "text",
      "tool_call",
      "tool_call_output",
      "thinking",
    ]);
    // Nothing left to resend — matching the live engine, which also holds no carry-over here.
    expect(result.carryOver).toEqual([]);
    expect(result.sessionTurns).toBe(1);
  });

  it("absorbed mid-task compaction abandoned with an unanswered repair replays it as carry-over", () => {
    // The abort-in-window shape: the rejected attempt committed (absorbing the turn output),
    // its repair was written, and the process exited before any request carried the repair.
    // Replay's eligibility filter keeps exactly the repair (paired with the committed,
    // unanswered c1) as carry-over — the same stash the live engine holds — and does not
    // reclaim the absorbed turn output.
    const result = resumeTrace([
      meta(),
      userText("go"),
      requestBegin(),
      toolCall({ name: "exec_command", arguments: "{}", toolCallId: "ct" }),
      requestEnd("completed"),
      tokenUsage(usage(150), usage(150)),
      toolCallOutput({ output: "tool ran", toolCallId: "ct", status: "completed" }),
      compactionBegin({ reason: "context", mode: "summarize", context: 150, turns: 1 }),
      userText("COMPACT NOW"),
      requestBegin(),
      toolCall({ name: "t", arguments: "{}", toolCallId: "c1" }),
      requestEnd("completed"),
      tokenUsage(usage(160), usage(310)),
      toolCallOutput({
        output: "[tool error] the compaction request expects a summary, not tool calls",
        toolCallId: "c1",
        status: "fatal",
      }),
      compactionEnd({ reason: "context", mode: "summarize", status: "aborted" }),
    ]);
    expect(result.contextClosed).toBe(false);
    // The absorbed turn output sits in history (attempt 1's committed input), not carry-over.
    expect(result.history.map((m) => (m.payload as { type?: string }).type)).toEqual([
      "text",
      "tool_call",
      "tool_call_output",
      "text",
      "tool_call",
    ]);
    expect(
      result.carryOver.map((m) => (m.payload as { tool_call_id?: string }).tool_call_id),
    ).toEqual(["c1"]);
    expect((result.carryOver[0]!.payload as { output?: string }).output).toContain("[tool error]");
  });
});
