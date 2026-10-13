import { mkdir, mkdtemp, open, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assistantText,
  imageUrlMessage,
  partialText,
  sessionMeta,
  subagentEvent,
  tokenUsage,
  emptyTokenCounts,
  withOrigin,
} from "../src/omnimessage/index.js";
import type { OmniMessage } from "../src/omnimessage/index.js";
import { Writer, parseTraceLines, readTrace } from "../src/trace/index.js";

const SESSION_ID = "sess_abc";

/** FileHandle's prototype, grabbed from a throwaway handle (the class is not exported). */
async function fileHandleProto(dir: string): Promise<{ write: (...args: unknown[]) => unknown }> {
  const probe = await open(join(dir, "probe.tmp"), "w");
  const proto = Object.getPrototypeOf(probe) as { write: (...args: unknown[]) => unknown };
  await probe.close();
  return proto;
}

/** The assistant text of a message, for content comparison (its timestamp differs per call). */
function textOf(msg: OmniMessage | undefined): string | undefined {
  if (msg === undefined || msg.type !== "model_msg") return undefined;
  const p = msg.payload as { type?: string; text?: string };
  return p.type === "text" ? p.text : undefined;
}

function meta() {
  return sessionMeta({
    session_id: SESSION_ID,
    provider: "custom",
    model_id: "test-model",
    model_context_window: 200000,
    system_prompt: "test system prompt",
    agent_state: "/tmp/agent_state",
    workspace: "/tmp/workspace",
    source: "user",
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
      agent_state: "/tmp/child_agent/agent_state",
      workspace: "/tmp/workspace",
      source: "user",
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

  // Size-based rotation: a session that never compacts would otherwise grow ONE unbounded shard
  // (42MB observed in the wild), and every whole-shard reader pays for that on each open.
  describe("size-based rotation", () => {
    it("opens a new shard before the record that would cross the ceiling", async () => {
      // A ceiling a few records wide, so the rotation point is reachable with small records.
      const writer = new Writer({
        tracesDir,
        sessionId: SESSION_ID,
        date: new Date(2026, 0, 9),
        maxShardBytes: 4096,
      });
      await writer.write(meta());
      const firstPath = writer.currentPath();

      // Enough assistant records to blow past 4 KiB several times over.
      for (let i = 0; i < 60; i++) await writer.write(assistantText(`turn ${i} ${"x".repeat(200)}`));

      // The writer moved past the first shard...
      expect(writer.currentPath()).not.toBe(firstPath);
      // ...and every shard on disk respects the ceiling except one carrying a single record
      // larger than it (the ceiling is soft). Read every shard back, oldest index first.
      const dateDir = join(tracesDir, "2026-01-09");
      const shards = (await readdir(dateDir)).filter((n) => n.endsWith(".jsonl")).sort();
      expect(shards.length).toBeGreaterThan(1);
      for (const name of shards) {
        const records = await readTrace(join(dateDir, name));
        const size = (await stat(join(dateDir, name))).size;
        // A shard is either within the ceiling, or holds exactly the one record that did not fit.
        expect(size <= 4096 || records.length === 1).toBe(true);
      }

      // Nothing is lost or reordered across the new boundaries: concatenated in index order,
      // the shards hold exactly the messages written, in order (compared by content, since
      // assistantText stamps each message with its own creation time).
      const all: OmniMessage[] = [];
      for (const name of shards) all.push(...(await readTrace(join(dateDir, name))));
      expect(all).toHaveLength(61); // meta + 60 turns
      // The session_meta opened the first shard (compared field-wise: meta() re-stamps).
      expect(all[0]?.type).toBe("session_meta");
      expect((all[0]?.payload as { session_id?: string }).session_id).toBe(SESSION_ID);
      expect(all.slice(1).map((m) => textOf(m))).toEqual(
        [...Array(60).keys()].map((i) => `turn ${i} ${"x".repeat(200)}`),
      );
    });

    it("never splits a record across shards", async () => {
      const writer = new Writer({
        tracesDir,
        sessionId: SESSION_ID,
        date: new Date(2026, 0, 9),
        maxShardBytes: 2048,
      });
      await writer.write(meta());
      // One record far bigger than the ceiling: it must land WHOLE in its own shard rather
      // than being cut at the boundary.
      const huge = imageUrlMessage(`data:image/png;base64,${"B".repeat(64 * 1024)}`);
      await writer.write(huge);
      await writer.write(assistantText("after the giant"));

      const dateDir = join(tracesDir, "2026-01-09");
      const shards = (await readdir(dateDir)).filter((n) => n.endsWith(".jsonl")).sort();
      const all: OmniMessage[] = [];
      for (const name of shards) all.push(...(await readTrace(join(dateDir, name))));
      // The giant record parses as ONE message (a split would throw or duplicate it).
      expect(all.filter((m) => JSON.stringify(m) === JSON.stringify(huge)).length).toBe(1);
      expect(textOf(all[all.length - 1]!)).toBe("after the giant");
    });

    it("does not rotate when no ceiling is configured (compaction-only, unchanged)", async () => {
      const writer = new Writer({
        tracesDir,
        sessionId: SESSION_ID,
        date: new Date(2026, 0, 9),
        maxShardBytes: 0,
      });
      await writer.write(meta());
      const firstPath = writer.currentPath();
      for (let i = 0; i < 200; i++) await writer.write(assistantText(`turn ${i} ${"y".repeat(500)}`));
      // Same file throughout: an explicit 0 turns the ceiling off.
      expect(writer.currentPath()).toBe(firstPath);
    });

    it("resumes the ceiling from a pre-existing shard's real size", async () => {
      const dateDir = join(tracesDir, "2026-01-09");
      await mkdir(dateDir, { recursive: true });
      const path = join(dateDir, `${SESSION_ID}_004.jsonl`);
      // A resumed shard already well past a small ceiling: the very next record must rotate
      // rather than append onto it (the ceiling is seeded from disk, not from zero).
      await writeFile(
        path,
        `${JSON.stringify(assistantText(`pre-existing ${"z".repeat(2000)}`))}\n`,
        "utf8",
      );
      expect((await stat(path)).size).toBeGreaterThan(1024);

      const writer = new Writer({
        tracesDir,
        sessionId: SESSION_ID,
        dateDir: "2026-01-09",
        startIndex: 4,
        maxShardBytes: 1024,
      });
      await writer.write(assistantText("one more"));
      expect(writer.currentPath()).not.toBe(path);
      expect(writer.currentPath().endsWith(`${SESSION_ID}_005.jsonl`)).toBe(true);
      // The pre-existing shard is append-only: it kept exactly its one record.
      expect((await readTrace(path)).length).toBe(1);
    });
  });

  // #215 regression: appends come from multiple async producers in one process (the LLM stream
  // driver plus each parallel tool), and fs.appendFile splits multi-MB payloads into multiple
  // underlying writes — without serialization a concurrent append can land mid-record.
  describe("concurrency (#215)", () => {
    it("keeps a multi-MB record intact under concurrent small appends", async () => {
      const writer = new Writer({
        tracesDir,
        sessionId: SESSION_ID,
        date: new Date(2026, 0, 9),
      });
      // Several MB, like a base64 image Data URL — large enough that fs.appendFile splits it
      // into multiple underlying writes (Node chunks the data at 512 KiB), small enough to
      // keep the test fast.
      const big = imageUrlMessage(`data:image/png;base64,${"A".repeat(3 * 1024 * 1024)}`);
      const submitted: OmniMessage[] = [
        meta(),
        big,
        ...[1, 2, 3, 4, 5].map((i) => assistantText(`small ${i}`)),
      ];
      // Submit every write before awaiting any: concurrent producers, submission order known.
      await Promise.all(submitted.map((msg) => writer.write(msg)));

      // Every non-empty line parses independently, and count and order match submission.
      const raw = await readFile(writer.currentPath(), "utf8");
      const lines = raw.split("\n").filter((line) => line.trim().length > 0);
      expect(lines).toEqual(submitted.map((msg) => JSON.stringify(msg)));
      for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
    });

    it("serializes rotate() against in-flight writes: shard boundaries follow submission order", async () => {
      const writer = new Writer({
        tracesDir,
        sessionId: SESSION_ID,
        date: new Date(2026, 0, 9),
      });
      const firstPath = writer.currentPath();
      // A large record right before the rotation: the rotation must wait for the whole
      // append, and writes submitted after it must land in the next shard.
      const big = imageUrlMessage(`data:image/png;base64,${"B".repeat(2 * 1024 * 1024)}`);
      const shardOne: OmniMessage[] = [meta(), big];
      const shardTwo: OmniMessage[] = [meta(), assistantText("new context")];
      await Promise.all([
        writer.write(shardOne[0]!),
        writer.write(shardOne[1]!),
        writer.rotate(),
        writer.write(shardTwo[0]!),
        writer.write(shardTwo[1]!),
      ]);

      const secondPath = writer.currentPath();
      expect(secondPath.endsWith(`${SESSION_ID}_002.jsonl`)).toBe(true);
      const firstLines = (await readFile(firstPath, "utf8"))
        .split("\n")
        .filter((line) => line.trim().length > 0);
      const secondLines = (await readFile(secondPath, "utf8"))
        .split("\n")
        .filter((line) => line.trim().length > 0);
      expect(firstLines).toEqual(shardOne.map((msg) => JSON.stringify(msg)));
      expect(secondLines).toEqual(shardTwo.map((msg) => JSON.stringify(msg)));
    });

    it("appends a multi-MB record with a single underlying write (no 512 KiB chunk tear window)", async () => {
      // fs.appendFile would split this into three writes (Node chunks at 512 KiB = 524288
      // bytes); a crash between chunks used to leave exactly the first 524288 bytes of the
      // record, and the next session's appends then glued onto that torn line. The Writer
      // issues one write(2) per record instead, so no crash can split a record mid-file.
      const writer = new Writer({
        tracesDir,
        sessionId: SESSION_ID,
        date: new Date(2026, 0, 9),
      });
      const head = meta();
      const big = imageUrlMessage(`data:image/png;base64,${"C".repeat(1200 * 1024)}`);
      const bigRecordBytes = Buffer.byteLength(`${JSON.stringify(big)}\n`);

      const writeSpy = vi.spyOn(await fileHandleProto(tracesDir), "write");
      try {
        await writer.writeAll([head, big]);
        // One write() per record — the big one lands whole, never in 524288-byte chunks
        // (>= so a chunk of exactly 524288 bytes would be caught too).
        const lengths = writeSpy.mock.calls.map((call) => call[2]);
        expect(lengths).toContain(bigRecordBytes);
        expect(lengths.filter((len) => (len as number) >= 512 * 1024)).toEqual([bigRecordBytes]);
      } finally {
        writeSpy.mockRestore();
      }
      expect(await readTrace(writer.currentPath())).toEqual([head, big]);
    });

    it("a failed write rejects its own caller without wedging subsequent writes", async () => {
      const writer = new Writer({
        tracesDir,
        sessionId: SESSION_ID,
        date: new Date(2026, 0, 9),
      });
      // Occupy the date-dir path with a regular file so mkdir (and the append) must fail.
      const dateDirPath = join(tracesDir, "2026-01-09");
      await writeFile(dateDirPath, "blocker", "utf8");
      const results = await Promise.allSettled([
        writer.write(meta()),
        writer.write(assistantText("also blocked")),
      ]);
      // Each failure surfaces to its own caller (callers log it as best-effort)...
      expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);

      // ...and the chain is not wedged: once the cause clears, later writes land normally.
      await rm(dateDirPath);
      const recovered = assistantText("after recovery");
      await writer.write(recovered);
      const rows = await readTrace(writer.currentPath());
      expect(rows).toEqual([recovered]);
    });
  });

  // The failure branches of the single-write append: a partial write leaves a torn tail that
  // the next append must heal; a zero-progress write must bail out instead of looping.
  describe("append failure semantics", () => {
    it("marks the tail torn after a partial append failure and heals on the next write", async () => {
      const writer = new Writer({
        tracesDir,
        sessionId: SESSION_ID,
        date: new Date(2026, 0, 9),
      });
      const first = assistantText("intact record");
      await writer.write(first); // the shard exists with a clean tail before the failure

      const torn = assistantText("torn mid-write");
      const tornData = Buffer.from(`${JSON.stringify(torn)}\n`, "utf8");
      const half = Math.floor(tornData.length / 2);
      const proto = await fileHandleProto(tracesDir);
      const originalWrite = proto.write;
      const writeSpy = vi.spyOn(proto, "write");
      try {
        // First syscall lands only half the record, the second fails: ENOSPC mid-record.
        writeSpy
          .mockImplementationOnce(function (this: unknown, ...args: unknown[]) {
            const [buf, offset] = args as [Buffer, number, number];
            return originalWrite.call(this, buf, offset, half);
          })
          .mockImplementationOnce(() => {
            return Promise.reject(
              Object.assign(new Error("ENOSPC: no space left on device, write"), {
                code: "ENOSPC",
              }),
            );
          });
        await expect(writer.write(torn)).rejects.toThrow(/ENOSPC/);
      } finally {
        writeSpy.mockRestore();
      }

      const healed = assistantText("after the failure");
      await writer.write(healed);

      const raw = await readFile(writer.currentPath(), "utf8");
      expect(raw).toBe(
        `${JSON.stringify(first)}\n` +
          `${tornData.subarray(0, half).toString("utf8")}\n` +
          `${JSON.stringify(healed)}\n`,
      );
      // The torn half-record is skipped as malformed; both intact records survive.
      expect(parseTraceLines(raw)).toEqual([first, healed]);
    });

    it("bails out of a zero-progress write and appends cleanly afterwards (nothing reached the file)", async () => {
      const writer = new Writer({
        tracesDir,
        sessionId: SESSION_ID,
        date: new Date(2026, 0, 9),
      });
      const writeSpy = vi.spyOn(await fileHandleProto(tracesDir), "write");
      try {
        writeSpy.mockImplementationOnce((...args: unknown[]) =>
          Promise.resolve({ bytesWritten: 0, buffer: args[0] }),
        );
        await expect(writer.write(assistantText("stuck"))).rejects.toThrow(/made no progress/);
      } finally {
        writeSpy.mockRestore();
      }

      // Zero bytes landed, so the tail is intact: the next append gets no heal prefix.
      const next = assistantText("clean append");
      await writer.write(next);
      expect(await readFile(writer.currentPath(), "utf8")).toBe(`${JSON.stringify(next)}\n`);
    });
  });

  // A process death mid-append can only truncate the LAST record (single-write appends), but
  // resumption keeps writing to the same file — without healing, the first post-resume record
  // would glue onto the torn line and be swallowed with it.
  describe("crash-torn tail healing on resume", () => {
    const DATE_DIR = "2026-01-09";

    /** A Writer resuming the session's existing 001 shard (dateDir pins the original file). */
    function resumingWriter(): Writer {
      return new Writer({ tracesDir, sessionId: SESSION_ID, dateDir: DATE_DIR, startIndex: 1 });
    }

    async function seedShard(content: string): Promise<string> {
      await mkdir(join(tracesDir, DATE_DIR), { recursive: true });
      const path = join(tracesDir, DATE_DIR, `${SESSION_ID}_001.jsonl`);
      await writeFile(path, content, "utf8");
      return path;
    }

    it("starts the next record on a fresh line after a torn tail", async () => {
      const head = meta();
      const intact = `${JSON.stringify(head)}\n`;
      const torn = JSON.stringify(assistantText("giant record")).slice(0, 40); // no trailing \n
      const path = await seedShard(intact + torn);

      const afterCrash = assistantText("after crash");
      await resumingWriter().write(afterCrash);

      const raw = await readFile(path, "utf8");
      expect(raw).toBe(`${intact + torn}\n${JSON.stringify(afterCrash)}\n`);
      // The torn line is skipped as malformed; both intact records survive.
      expect(parseTraceLines(raw)).toEqual([head, afterCrash]);
    });

    it("appends without a heal prefix when the resumed file ends cleanly", async () => {
      const intact = `${JSON.stringify(meta())}\n`;
      const path = await seedShard(intact);

      const next = assistantText("resumed");
      await resumingWriter().write(next);

      expect(await readFile(path, "utf8")).toBe(`${intact}${JSON.stringify(next)}\n`);
    });

    it("treats an empty pre-existing file as clean", async () => {
      const path = await seedShard("");

      const next = assistantText("first record");
      await resumingWriter().write(next);

      expect(await readFile(path, "utf8")).toBe(`${JSON.stringify(next)}\n`);
    });

    it("probes once per shard: a healed file gets no second prefix, and rotation resets the state", async () => {
      const torn = `{"timestamp":"x","type":"model_msg","payload":{"type":"text","role":"assist`;
      const path = await seedShard(torn);

      const writer = resumingWriter();
      const first = assistantText("heals");
      const second = assistantText("plain append");
      await writer.writeAll([first, second]);
      expect(await readFile(path, "utf8")).toBe(
        `${torn}\n${JSON.stringify(first)}\n${JSON.stringify(second)}\n`,
      );

      // The next shard is a brand-new file: no heal prefix may leak into it.
      await writer.rotate();
      const fresh = assistantText("next shard");
      await writer.write(fresh);
      expect(await readFile(writer.currentPath(), "utf8")).toBe(`${JSON.stringify(fresh)}\n`);
    });
  });
});
