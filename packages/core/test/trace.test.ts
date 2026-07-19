import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assistantText,
  partialText,
  sessionMeta,
  subagentEvent,
  tokenUsage,
  emptyTokenCounts,
  withOrigin,
} from "../src/omnimessage/index.js";
import { Writer, readTrace } from "../src/trace/index.js";

const SESSION_ID = "sess_abc";

function meta() {
  return sessionMeta({
    session_id: SESSION_ID,
    provider: "custom",
    model_id: "test-model",
    model_context_window: 200000,
    system_prompt: "test system prompt",
    tools: [{ name: "exec_command", description: "test tool" }],
    thinking_level: "medium",
    agent_state: "/tmp/agent_state",
    workspace: "/tmp/workspace",
  });
}

describe("Writer", () => {
  let tracesDir: string;

  beforeEach(async () => {
    tracesDir = await mkdtemp(join(tmpdir(), "penguin-trace-"));
  });

  afterEach(async () => {
    await rm(tracesDir, { recursive: true, force: true });
  });

  it("writes only recordable messages and skips partial_*, in order", async () => {
    // Injects a fixed date, and asserts the directory name.
    const writer = new Writer({
      tracesDir,
      sessionId: SESSION_ID,
      date: new Date(2026, 0, 9), // Local 2026-01-09 (note the zero padding)
    });

    await writer.writeAll([
      meta(),
      assistantText("hi"),
      partialText("delta", "x"), // Should be skipped
      tokenUsage(emptyTokenCounts(), emptyTokenCounts()),
    ]);

    const rows = await readTrace(writer.currentPath());

    // Exactly 3 rows (partial_text is skipped).
    expect(rows).toHaveLength(3);

    // Every row can be JSON.parse'd (readTrace already parses it) and is in the correct order.
    expect(rows[0]!.type).toBe("session_meta");
    expect(rows[1]!.type).toBe("model_msg");
    expect((rows[1]!.payload as { type: string }).type).toBe("text");
    expect(rows[2]!.type).toBe("event_msg");
    expect((rows[2]!.payload as { type: string }).type).toBe("token_usage");

    // Contains no partial_* at all.
    const innerTypes = rows.map((m) => (m.payload as { type?: string }).type);
    expect(innerTypes.some((t) => t?.startsWith("partial_"))).toBe(false);
  });

  it("skips all nested-session messages; the subagent pointer event is recordable", async () => {
    const writer = new Writer({
      tracesDir,
      sessionId: SESSION_ID,
      date: new Date(2026, 0, 9),
    });
    const childMeta = sessionMeta({
      session_id: "sess_child",
      provider: "custom",
      model_id: "test-model",
      model_context_window: 200000,
      system_prompt: "child prompt",
      tools: [],
      thinking_level: "medium",
      agent_state: "/tmp/child_agent/agent_state",
      workspace: "/tmp/workspace",
    });
    await writer.writeAll([
      meta(),
      // The derived pointer is written by context_engine when the child session_meta arrives
      // (recording only the child Session id).
      subagentEvent("sess_child"),
      withOrigin(childMeta, "sess_child"),
      withOrigin(assistantText("from child"), "sess_child"),
      withOrigin(withOrigin(childMeta, "sess_grandchild"), "sess_child"),
      assistantText("from parent"),
    ]);
    const rows = await readTrace(writer.currentPath());
    // meta + the subagent pointer event + the parent's text; origin-tagged child session
    // messages (including session_meta) are never written.
    expect(rows).toHaveLength(3);
    expect(rows.some((m) => (m.payload as { text?: string }).text === "from child")).toBe(false);
    expect(rows.some((m) => m.origin !== undefined)).toBe(false);
    const pointer = rows[1]!;
    expect(pointer.type).toBe("event_msg");
    expect(pointer.payload).toMatchObject({ type: "subagent", session_id: "sess_child" });
  });

  it("uses padded date subdir and <sessionId>_001.jsonl path", async () => {
    const writer = new Writer({
      tracesDir,
      sessionId: SESSION_ID,
      date: new Date(2026, 0, 9),
    });
    await writer.write(meta());

    const path = writer.currentPath();
    // The path matches <sessionId>_001.jsonl and sits under a <yyyy-mm-dd>/ subdirectory.
    const parts = path.split(sep);
    const fileName = parts[parts.length - 1]!;
    const dateSubdir = parts[parts.length - 2]!;
    expect(fileName).toBe(`${SESSION_ID}_001.jsonl`);
    expect(dateSubdir).toBe("2026-01-09");

    // The file actually exists.
    const info = await stat(path);
    expect(info.isFile()).toBe(true);
  });

  it("rotate() switches to _002.jsonl and leaves the old file append-only", async () => {
    const writer = new Writer({
      tracesDir,
      sessionId: SESSION_ID,
      date: new Date(2026, 0, 9),
    });

    await writer.write(meta());
    await writer.write(assistantText("first context"));
    const firstPath = writer.currentPath();
    expect((await readTrace(firstPath)).length).toBe(2);

    await writer.rotate();
    const secondPath = writer.currentPath();
    expect(secondPath).not.toBe(firstPath);
    expect(secondPath.endsWith(`${SESSION_ID}_002.jsonl`)).toBe(true);

    // The write goes into the new file.
    await writer.write(assistantText("second context"));
    expect((await readTrace(secondPath)).length).toBe(1);

    // append-only verification: the old file's row count does not increase.
    expect((await readTrace(firstPath)).length).toBe(2);
  });
});
