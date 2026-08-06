import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";

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
import {
  Writer,
  parseTraceLines,
  parseTraceLinesSalvage,
  readTrace,
  readTraceSalvage,
} from "../src/trace/index.js";

const SESSION_ID = "sess_abc";

function meta() {
  return sessionMeta({
    session_id: SESSION_ID,
    provider: "custom",
    model_id: "test-model",
    model_context_window: 200000,
    system_prompt: "test system prompt",
    tools: [{ name: "exec_command", description: "test tool" }],
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

  it("serializes concurrent writes: a multi-MB record never interleaves with small ones", async () => {
    const writer = new Writer({
      tracesDir,
      sessionId: SESSION_ID,
      date: new Date(2026, 0, 9),
    });

    // Node's appendFile splits payloads > 512 KiB into multiple underlying writes; 4 MiB
    // gives ~8 chunks, so unserialized concurrent appends would interleave (issue #215).
    const big = assistantText(`big:${"x".repeat(4 * 1024 * 1024)}`);
    const smalls = Array.from({ length: 8 }, (_, i) => assistantText(`small-${i}`));

    // Fire all writes concurrently, without awaiting each in turn.
    await Promise.all([writer.write(meta()), writer.write(big), ...smalls.map((m) => writer.write(m))]);

    // Every non-empty line parses independently (readTrace JSON.parses each line and would throw).
    const rows = await readTrace(writer.currentPath());

    // Count and order match the submitted messages.
    expect(rows).toHaveLength(10);
    expect(rows[0]!.type).toBe("session_meta");
    expect((rows[1]!.payload as { text: string }).text.startsWith("big:")).toBe(true);
    smalls.forEach((_, i) => {
      expect((rows[2 + i]!.payload as { text: string }).text).toBe(`small-${i}`);
    });
  });

  it("concurrent write() and rotate() preserve shard boundaries", async () => {
    const writer = new Writer({
      tracesDir,
      sessionId: SESSION_ID,
      date: new Date(2026, 0, 9),
    });
    const firstPath = writer.currentPath();

    // Queue writes and a rotation without awaiting in between.
    await Promise.all([
      writer.write(meta()),
      writer.write(assistantText("before rotate")),
      writer.rotate(),
      writer.write(assistantText("after rotate")),
    ]);

    const secondPath = writer.currentPath();
    expect(secondPath).not.toBe(firstPath);

    const firstRows = await readTrace(firstPath);
    expect(firstRows).toHaveLength(2);
    expect((firstRows[1]!.payload as { text: string }).text).toBe("before rotate");

    const secondRows = await readTrace(secondPath);
    expect(secondRows).toHaveLength(1);
    expect((secondRows[0]!.payload as { text: string }).text).toBe("after rotate");
  });

  it("a failed write rejects its caller but does not block subsequent writes", async () => {
    const writer = new Writer({
      tracesDir,
      sessionId: SESSION_ID,
      date: new Date(2026, 0, 9),
    });

    // Occupy the date-directory path with a regular file so mkdir -p fails.
    const dateDir = dirname(writer.currentPath());
    await writeFile(dateDir, "occupied", "utf8");
    await expect(writer.write(meta())).rejects.toThrow();

    // Once the obstruction is gone, the next write on the same chain succeeds.
    await rm(dateDir);
    await writer.write(assistantText("recovered"));

    const rows = await readTrace(writer.currentPath());
    expect(rows).toHaveLength(1);
    expect((rows[0]!.payload as { text: string }).text).toBe("recovered");
  });

  it("keeps large concurrent writes as intact single lines on disk", async () => {
    const writer = new Writer({
      tracesDir,
      sessionId: SESSION_ID,
      date: new Date(2026, 0, 9),
    });

    const big = assistantText(`payload:${"y".repeat(2 * 1024 * 1024)}`);
    await Promise.all([writer.write(big), writer.write(assistantText("tiny"))]);

    // Raw check, independent of readTrace: exactly 2 newline-terminated lines, each valid JSON.
    const content = await readFile(writer.currentPath(), "utf8");
    const lines = content.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});

describe("parseTraceLines (strict, resume path)", () => {
  const good = (text: string) => JSON.stringify(assistantText(text));

  it("tolerates a truncated last line but throws on middle corruption with the line number", () => {
    const truncated = `${good("a")}\n${good("b")}\n{"type":"model_msg","payl`;
    expect(parseTraceLines(truncated)).toHaveLength(2);

    const middleCorrupt = `${good("a")}\n<part1><part2>\n${good("b")}\n`;
    expect(() => parseTraceLines(middleCorrupt)).toThrow(/line 2/);
  });
});

describe("parseTraceLinesSalvage (display path)", () => {
  const good = (text: string) => JSON.stringify(assistantText(text));

  it("skips corrupt middle lines, reports their 1-based numbers, keeps the rest in order", () => {
    // The #215 interleaving shape: a large record's tail stranded on its own line.
    const content = `${good("a")}\n<large JSON part 1>${good("x")}\n<large JSON part 2>\n${good("b")}\n`;
    const { messages, corruptLines } = parseTraceLinesSalvage(content);
    expect(messages.map((m) => (m.payload as { text: string }).text)).toEqual(["a", "b"]);
    expect(corruptLines).toEqual([2, 3]);
  });

  it("does not count a truncated last line as corruption", () => {
    const content = `${good("a")}\n{"type":"model_msg","payl`;
    const { messages, corruptLines } = parseTraceLinesSalvage(content);
    expect(messages).toHaveLength(1);
    expect(corruptLines).toEqual([]);
  });

  it("readTraceSalvage reads a corrupted file from disk without throwing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "penguin-salvage-"));
    try {
      const path = join(dir, "sess_corrupt_001.jsonl");
      await writeFile(path, `${good("a")}\nnot json at all\n${good("b")}\n`, "utf8");
      const { messages, corruptLines } = await readTraceSalvage(path);
      expect(messages).toHaveLength(2);
      expect(corruptLines).toEqual([2]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
