/**
 * The bytes a Trace holds, pinned: one record of every kind the Trace stores, built by core's
 * builders and written by its Trace writer, against a checked-in file. The protocol types live
 * in `@prismshadow/amsp` and core re-exports them; this file is what proves that where they are
 * defined changes nothing on disk.
 *
 * - Given one record of each stored kind at a fixed time, when they are written to a Trace, the
 *   file is byte for byte the pinned one.
 * - Given that file, when it is read back and written to a new Trace, the bytes are unchanged.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  abortEvent,
  approvalDecision,
  compactionBegin,
  compactionEnd,
  hookEvent,
  imageUrlMessage,
  inlineData,
  inlineThinking,
  mcpConnectBegin,
  mcpConnectEnd,
  requestBegin,
  requestEnd,
  sessionMeta,
  subagentEvent,
  taskBegin,
  taskEnd,
  textMessage,
  thinkingMessage,
  tokenUsage,
  toolCall,
  toolCallOutput,
  toolListReady,
  userText,
} from "@prismshadow/amsp/records";
import type { AmspRecord } from "@prismshadow/amsp/records";
import { Writer, readTrace } from "../src/trace/index.js";

const PINNED = "./fixtures/trace-bytes.jsonl";
const SESSION = "session-2026-10-23-10-00-00-0a1b2c3d";

/** One record of every kind the Trace stores, in a plausible order. */
function everyStoredKind(): AmspRecord[] {
  const counts = { cache_read: 10, cache_write: 2, output: 7, total: 40 };
  return [
    sessionMeta({
      session_id: SESSION,
      provider: "loopback",
      model_id: "pinned-model",
      model_context_window: 128000,
      system_prompt: "You are a pinned fixture.",
      agent_state: "/data/agents/demo/coder/agent_state",
      workspace: "/work",
      source: "api",
    }),
    taskBegin(),
    userText("List the files, then sum 2 and 3."),
    userText("[background note]", "harness"),
    imageUrlMessage("data:image/png;base64,iVBORw0KGgo="),
    mcpConnectBegin(["files"]),
    mcpConnectEnd({
      status: "completed",
      results: [
        { server: "files", transport: "stdio", status: "completed", duration_ms: 12, tools: 2 },
      ],
    }),
    toolListReady([
      { name: "exec_command", description: "Run a command.", parameters: { type: "object" } },
    ]),
    requestBegin("medium"),
    thinkingMessage("The user wants a listing.", { provider: "loopback", signature: "s1" }),
    inlineThinking("ZW5jcnlwdGVk", "application/octet-stream"),
    textMessage("assistant", "Listing now."),
    toolCall({ name: "exec_command", arguments: '{"cmd":"ls"}', toolCallId: "call_1" }),
    approvalDecision("allow", "call_1"),
    tokenUsage(counts, counts),
    requestEnd("completed"),
    toolCallOutput({ output: "a.txt\nb.txt", toolCallId: "call_1", status: "completed" }),
    requestBegin(),
    inlineData("assistant", "aGVsbG8=", "text/plain"),
    requestEnd("retryable", {
      errorCode: "rate_limited",
      errorMessage: "busy",
      attempt: 1,
      retryInMs: 2000,
    }),
    subagentEvent("session-2026-10-23-10-00-05-11223344"),
    hookEvent({
      hook: "stop",
      name: "goal",
      decision: "continue",
      reason: "not yet",
      output: { round: 2 },
    }),
    compactionBegin({ reason: "context", mode: "summarize", context: 90000, turns: 3 }),
    compactionEnd({ reason: "context", mode: "summarize", status: "completed", attempt: 1 }),
    abortEvent("user_abort"),
    taskEnd(),
  ];
}

describe("the bytes a Trace holds", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "trace-bytes-"));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T10:00:00.000Z"));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(dir, { recursive: true, force: true });
  });

  async function written(records: AmspRecord[], name: string): Promise<string> {
    const writer = new Writer({
      tracesDir: join(dir, name),
      sessionId: SESSION,
      dateDir: "2026-10-23",
    });
    for (const record of records) await writer.write(record);
    return await readFile(writer.currentPath(), "utf8");
  }

  it("one record of every stored kind is written as the pinned file, byte for byte", async () => {
    await expect(await written(everyStoredKind(), "first")).toMatchFileSnapshot(PINNED);
  });

  it("the pinned file read back and written again keeps every byte", async () => {
    const first = await written(everyStoredKind(), "first");
    const writer = new Writer({
      tracesDir: join(dir, "first"),
      sessionId: SESSION,
      dateDir: "2026-10-23",
    });
    const again = await written(await readTrace(writer.currentPath()), "again");
    expect(again).toBe(first);
  });
});
