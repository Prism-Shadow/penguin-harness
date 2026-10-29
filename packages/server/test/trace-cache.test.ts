/**
 * The hub's copy of a machine's Trace lines (machines/trace-cache.ts), read back through its own
 * surface over a real temp directory.
 *
 * - Given the newest lines of a file committed first and the ones before them after, when the
 *   copy is read, then they make one run that reads back byte for byte, and records by ordinal;
 *   a rotated file held whole answers its record count, a live one does not.
 * - Given a frame that overlaps lines already held, when it is committed, then only the part in
 *   the hole is written and nothing held changes.
 * - Given bytes written to the data file without their sidecar (a crash between the two), when
 *   the copy is opened again, then those bytes are never answered.
 * - Given a copy whose data file went away under it, when a later line is committed, then the
 *   runs that file held are forgotten: nothing reads back as zeros.
 * - Given a read the copy cannot match — more records than it holds, a run whose bytes no longer
 *   parse into its record count, a run whose line starts read as NUL — then it answers null,
 *   never a wrong record.
 * - Given a run read once, when one more line is committed, then the next record read reads only
 *   that record's bytes, not the whole run again.
 * - Given a held run, when `have` is asked, then it names that run with the anchors of its edge
 *   bytes; when the machine resets the file or its identity changes, the copy starts over; a file
 *   the machine no longer lists is dropped.
 * - Given a group of 200 held files, then `have` stays within what the machine takes, the
 *   Session's own file first; asked for one file, it names that file alone.
 * - Given a line that arrives in parts, when the stream stops before its last part, then `have`
 *   offers the partial, and the parts that continue it complete the line byte for byte.
 * - Given the cache over its cap, when it evicts, then the least recently read Session goes
 *   first, and never one held; a copy of a file's tail counts up to its highest offset.
 * - Given a commit and an eviction of the same Session at once, then the copy is gone and
 *   nothing comes back after it.
 * - Given ids that differ only by case, or a Windows device name, then each is its own directory.
 * - Given a directory that cannot open, then each use fails until it can, and then it works.
 * - Given a machine dropped, then nothing of it remains; given the sweep at start, then every
 *   machine but the known ones goes.
 * - Given a directory written in another format, when the cache opens it, then it is wiped.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HistoryFileFact } from "../src/api/types.js";
import { TraceCache, dirNameOf } from "../src/machines/trace-cache.js";
import {
  HAVE_MAX_CHARS,
  anchorOf,
  decodeHistoryHave,
  encodeHistoryHave,
  hiAnchorRange,
  loAnchorRange,
} from "../src/services/history-wire.js";
import { makeTempRoot, removeTempRoot } from "./helpers.js";

const M = "machine-a";
const S = "session-1";
const K = `default_agent/${S}/1`;

/** One Trace record line. */
const line = (i: number, text = `reply ${i}`): string =>
  `${JSON.stringify({ type: "model_msg", timestamp: "2026-10-29T00:00:00.000Z", payload: { type: "text", role: "assistant", text } })}\n`;

/** A file of `n` records, and where each line starts. */
function traceFile(n: number, text?: (i: number) => string): { bytes: Buffer; starts: number[] } {
  const lines = Array.from({ length: n }, (_, i) => Buffer.from(line(i, text?.(i))));
  const starts: number[] = [];
  let at = 0;
  for (const l of lines) {
    starts.push(at);
    at += l.length;
  }
  return { bytes: Buffer.concat(lines), starts };
}

const fact = (
  bytes: Buffer,
  records: number,
  over: Partial<HistoryFileFact> = {},
): HistoryFileFact => ({
  k: K,
  ino: 7,
  birthtimeMs: 1000,
  size: bytes.length,
  records,
  final: false,
  ...over,
});

/** Lines [from, to) of a file as one `lines` frame. */
const linesFrame = (
  file: { bytes: Buffer; starts: number[] },
  from: number,
  to: number,
  k = K,
) => ({
  k,
  off: file.starts[from]!,
  ord: from,
  text: file.bytes
    .subarray(file.starts[from]!, to < file.starts.length ? file.starts[to]! : file.bytes.length)
    .toString("utf8"),
});

/** Where a file's copy lies on disk. */
const dataPath = (machineId: string, sessionId: string, index = 1) =>
  path.join(
    root,
    dirNameOf(machineId),
    dirNameOf(sessionId),
    `${String(index).padStart(3, "0")}.jsonl`,
  );

let root: string;

beforeEach(async () => {
  root = path.join(await makeTempRoot(), "traces");
});

afterEach(async () => {
  await removeTempRoot(path.dirname(root));
});

describe("the hub's copy of a machine's Trace lines", () => {
  it("merges the newest lines and the ones before them into one run that reads back byte for byte", async () => {
    const file = traceFile(6);
    const cache = new TraceCache(root);
    await cache.reconcile(M, S, [fact(file.bytes, 6)]);
    await cache.commit(M, linesFrame(file, 3, 6));
    await cache.commit(M, linesFrame(file, 0, 3));

    expect(await cache.bytes(M, K, 0, file.bytes.length)).toEqual(file.bytes);
    const records = await cache.records(M, K, 2, 4);
    expect(records?.map((r) => (r.record.payload as { text: string }).text)).toEqual([
      "reply 2",
      "reply 3",
    ]);
    expect(records?.[0]?.offset).toBe(file.starts[2]);
    // Whole, but the machine still writes to it: its count is the machine's to give.
    expect(await cache.finalRecords(M, K)).toBeNull();
    await cache.reconcile(M, S, [fact(file.bytes, 6, { final: true })]);
    expect(await cache.finalRecords(M, K)).toBe(6);
  });

  it("writes only the hole of a frame that overlaps what is held", async () => {
    const file = traceFile(4);
    const cache = new TraceCache(root);
    await cache.reconcile(M, S, [fact(file.bytes, 4)]);
    expect(await cache.commit(M, linesFrame(file, 1, 3))).toBe(file.starts[3]! - file.starts[1]!);
    // The machine sends lines 0..4 again; only lines 0 and 3 are new.
    const committed = await cache.commit(M, linesFrame(file, 0, 4));
    expect(committed).toBe(file.bytes.length - (file.starts[3]! - file.starts[1]!));
    expect(await cache.bytes(M, K, 0, file.bytes.length)).toEqual(file.bytes);
  });

  it("never answers bytes no sidecar vouches for", async () => {
    const file = traceFile(4);
    const first = new TraceCache(root);
    await first.reconcile(M, S, [fact(file.bytes, 4, { final: true })]);
    await first.commit(M, linesFrame(file, 0, 2));
    // A crash between the data write and the sidecar write: the bytes are there, unvouched.
    const handle = await fs.open(dataPath(M, S), "r+");
    await handle.write(
      file.bytes,
      file.starts[2]!,
      file.bytes.length - file.starts[2]!,
      file.starts[2]!,
    );
    await handle.close();

    const reopened = new TraceCache(root);
    expect(await reopened.bytes(M, K, 0, file.starts[2]!)).toEqual(
      file.bytes.subarray(0, file.starts[2]!),
    );
    expect(await reopened.bytes(M, K, 0, file.bytes.length)).toBeNull();
    expect(await reopened.records(M, K, 0, 3)).toBeNull();
    expect(await reopened.finalRecords(M, K)).toBeNull();
  });

  it("forgets what a data file that went away held, so nothing reads back as zeros", async () => {
    const file = traceFile(7);
    const cache = new TraceCache(root);
    await cache.reconcile(M, S, [fact(file.bytes, 7)]);
    await cache.commit(M, linesFrame(file, 0, 6));
    // The Session's copy goes under the loaded state (someone deletes the cache by hand).
    await fs.rm(path.dirname(dataPath(M, S)), { recursive: true, force: true });
    await cache.commit(M, linesFrame(file, 6, 7));

    const reopened = new TraceCache(root);
    expect(await reopened.bytes(M, K, 0, file.bytes.length)).toBeNull();
    expect(await reopened.bytes(M, K, file.starts[6]!, file.bytes.length)).toEqual(
      file.bytes.subarray(file.starts[6]!),
    );
  });

  it("refuses a read it cannot match rather than answering a wrong record", async () => {
    const file = traceFile(4);
    const first = new TraceCache(root);
    await first.reconcile(M, S, [fact(file.bytes, 4)]);
    await first.commit(M, linesFrame(file, 0, 4));
    expect(await first.records(M, K, 0, 5)).toBeNull();

    // A record's bytes damaged in place: the run no longer holds the records it says it does.
    const handle = await fs.open(dataPath(M, S), "r+");
    await handle.write(Buffer.from("#".repeat(10)), 0, 10, file.starts[1]!);
    await handle.close();
    expect(await new TraceCache(root).records(M, K, 0, 2)).toBeNull();

    // A line start gone to zeros (a hole the sidecar wrongly vouches for) is not a line.
    const zeroed = await fs.open(dataPath(M, S), "r+");
    await zeroed.write(
      Buffer.alloc(file.starts[3]! - file.starts[2]!),
      0,
      file.starts[3]! - file.starts[2]!,
      file.starts[2]!,
    );
    await zeroed.close();
    const reopened = new TraceCache(root);
    expect(await reopened.bytes(M, K, file.starts[2]!, file.bytes.length)).toBeNull();
    expect(await reopened.bytes(M, K, 0, file.starts[1]!)).toEqual(
      file.bytes.subarray(0, file.starts[1]!),
    );
  });

  it("reads one record after a commit without reading the whole run again", async () => {
    const file = traceFile(301, () => "z".repeat(2_000));
    const reads: Array<[number, number]> = [];
    const cache = new TraceCache(root, { observeRead: (start, end) => reads.push([start, end]) });
    await cache.reconcile(M, S, [fact(file.bytes, 301)]);
    await cache.commit(M, linesFrame(file, 0, 300));
    await cache.records(M, K, 5, 6);
    await cache.commit(M, linesFrame(file, 300, 301));

    reads.length = 0;
    const [record] = (await cache.records(M, K, 9, 10)) ?? [];
    expect(record?.offset).toBe(file.starts[9]);
    expect(reads).toEqual([[file.starts[9], file.starts[10]]]);
    expect((await cache.records(M, K, 300, 301))?.[0]?.offset).toBe(file.starts[300]);
  });

  it("names its newest run in `have` with the anchors of its edges, and starts over when the machine says so", async () => {
    const file = traceFile(5);
    const cache = new TraceCache(root);
    await cache.reconcile(M, S, [fact(file.bytes, 5)]);
    await cache.commit(M, linesFrame(file, 2, 5));
    const lo = file.starts[2]!;
    const hi = file.bytes.length;
    expect(await cache.have(M, S)).toEqual([
      {
        k: K,
        ino: 7,
        birthtimeMs: 1000,
        lo,
        loOrd: 2,
        hi,
        loAnchor: anchorOf(file.bytes.subarray(...loAnchorRange(lo, hi))),
        hiAnchor: anchorOf(file.bytes.subarray(...hiAnchorRange(lo, hi))),
      },
    ]);

    await cache.reconcile(M, S, [fact(file.bytes, 5, { reset: true })]);
    expect(await cache.have(M, S)).toEqual([]);

    await cache.commit(M, linesFrame(file, 0, 5));
    await cache.reconcile(M, S, [fact(file.bytes, 5, { ino: 8 })]);
    expect(await cache.bytes(M, K, 0, 10)).toBeNull();

    await cache.commit(M, linesFrame(file, 0, 5));
    await cache.reconcile(M, S, []);
    expect(await cache.have(M, S)).toEqual([]);
    expect(await cache.bytes(M, K, 0, 10)).toBeNull();
  });

  it("keeps a group's `have` within what the machine takes, its own file first, or names one file alone", async () => {
    const one = line(0);
    const facts: HistoryFileFact[] = [];
    for (let i = 0; i < 200; i++) {
      const sid = i === 0 ? S : `session-child-${String(i).padStart(4, "0")}`;
      facts.push({ ...fact(Buffer.from(one), 1, { final: true }), k: `default_agent/${sid}/1` });
    }
    const cache = new TraceCache(root);
    await cache.reconcile(M, S, facts);
    for (const f of facts) await cache.commit(M, { k: f.k, off: 0, ord: 0, text: one });

    const have = await cache.have(M, S);
    const encoded = encodeHistoryHave(have);
    expect(encoded.length).toBeLessThanOrEqual(HAVE_MAX_CHARS);
    expect(decodeHistoryHave(encoded)).not.toBeNull();
    expect(have[0]?.k).toBe(K);
    expect(have.length).toBeGreaterThan(10);
    const child = facts[150]!.k;
    expect((await cache.have(M, S, { only: child })).map((h) => h.k)).toEqual([child]);
  });

  it("offers a line held in part as a partial, and completes it from the parts that continue it", async () => {
    const big = line(1, "y".repeat(5000));
    const bytes = Buffer.concat([Buffer.from(line(0)), Buffer.from(big)]);
    const off = Buffer.byteLength(line(0));
    const cache = new TraceCache(root);
    await cache.reconcile(M, S, [fact(bytes, 2)]);
    await cache.commit(M, { k: K, off: 0, ord: 0, text: line(0) });
    await cache.commit(M, { k: K, off, ord: 1, text: big.slice(0, 2000), last: false });

    const [have] = await cache.have(M, S);
    expect(have?.partial).toEqual({
      off,
      len: 2000,
      anchor: anchorOf(Buffer.from(big.slice(0, 2000))),
    });
    expect(await cache.bytes(M, K, off, off + 10)).toBeNull();

    await cache.commit(M, { k: K, off: off + 2000, ord: 1, text: big.slice(2000), last: true });
    expect(await cache.bytes(M, K, 0, bytes.length)).toEqual(bytes);
    expect((await cache.have(M, S))[0]?.partial).toBeUndefined();
  });

  it("evicts the least recently read Session first, and never one held", async () => {
    let now = 0;
    const file = traceFile(4);
    const cache = new TraceCache(root, {
      capBytes: Math.floor(file.bytes.length * 2.5),
      now: () => now,
    });
    for (const session of ["s-old", "s-mid", "s-new"]) {
      now += 1000;
      const k = `default_agent/${session}/1`;
      await cache.reconcile(M, session, [{ ...fact(file.bytes, 4), k }]);
      await cache.commit(M, linesFrame(file, 0, 4, k));
      cache.touch(M, [session]);
    }
    const held = (session: string) => cache.bytes(M, `default_agent/${session}/1`, 0, 1);

    await cache.evict(new Set([`${M}\0s-old`]));
    expect(await held("s-old")).not.toBeNull();
    expect(await held("s-mid")).toBeNull();
    expect(await held("s-new")).not.toBeNull();

    now += 1000;
    const k = "default_agent/s-more/1";
    await cache.reconcile(M, "s-more", [{ ...fact(file.bytes, 4), k }]);
    await cache.commit(M, linesFrame(file, 0, 4, k));
    await cache.evict(new Set());
    expect(await held("s-old")).toBeNull();
    expect(await held("s-new")).not.toBeNull();
  });

  it("counts a copy of a file's tail up to its highest offset", async () => {
    const file = traceFile(50, () => "t".repeat(500));
    const cache = new TraceCache(root);
    await cache.reconcile(M, S, [fact(file.bytes, 50)]);
    await cache.commit(M, linesFrame(file, 49, 50));
    expect(cache.usedBytes).toBe(file.bytes.length);
  });

  it("lets an eviction racing a commit leave the Session gone, with nothing written back after it", async () => {
    const file = traceFile(201, () => "r".repeat(400));
    const cache = new TraceCache(root, { capBytes: 1 });
    await cache.reconcile(M, S, [fact(file.bytes, 201)]);
    await cache.commit(M, linesFrame(file, 0, 200));
    await Promise.all([cache.commit(M, linesFrame(file, 200, 201)), cache.evict(new Set())]);

    await expect(fs.access(path.dirname(dataPath(M, S)))).rejects.toThrow();
    expect(await new TraceCache(root).bytes(M, K, 0, 10)).toBeNull();
    expect(cache.usedBytes).toBe(0);
  });

  it("gives ids that differ only by case, and device names, their own directories", async () => {
    const file = traceFile(1);
    const other = traceFile(2);
    const cache = new TraceCache(root);
    for (const [machine, sid, f] of [
      ["Machine", "CON", file],
      ["machine", "con", other],
    ] as const) {
      const k = `default_agent/${sid}/1`;
      await cache.reconcile(machine, sid, [{ ...fact(f.bytes, f.starts.length), k }]);
      await cache.commit(machine, linesFrame(f, 0, f.starts.length, k));
    }
    expect(await cache.bytes("Machine", "default_agent/CON/1", 0, file.bytes.length)).toEqual(
      file.bytes,
    );
    expect(await cache.bytes("machine", "default_agent/con/1", 0, other.bytes.length)).toEqual(
      other.bytes,
    );
    const names = (await fs.readdir(root)).filter((name) => name !== "VERSION");
    expect(names).toHaveLength(2);
    expect(names.every((name) => /^[0-9a-f]{32}$/.test(name))).toBe(true);
  });

  it("fails each use while its directory cannot open, and works once it can", async () => {
    const blocked = path.join(path.dirname(root), "blocked");
    await fs.writeFile(blocked, "a file where the cache's parent should be");
    const cache = new TraceCache(path.join(blocked, "traces"));
    await expect(cache.have(M, S)).rejects.toThrow();
    await expect(cache.have(M, S)).rejects.toThrow();
    await fs.rm(blocked);
    expect(await cache.have(M, S)).toEqual([]);
  });

  it("leaves nothing of a dropped machine, and the start sweep keeps only the known ones", async () => {
    const file = traceFile(2);
    const cache = new TraceCache(root);
    for (const machine of ["machine-a", "machine-b", "machine-c"]) {
      await cache.reconcile(machine, S, [fact(file.bytes, 2)]);
      await cache.commit(machine, linesFrame(file, 0, 2));
    }
    await cache.dropMachine("machine-a");
    await expect(fs.access(path.join(root, dirNameOf("machine-a")))).rejects.toThrow();
    expect(await cache.bytes("machine-a", K, 0, 1)).toBeNull();

    await new TraceCache(root).dropUnknown(new Set(["machine-b"]));
    expect((await fs.readdir(root)).sort()).toEqual(["VERSION", dirNameOf("machine-b")].sort());
  });

  it("wipes a directory written in another format", async () => {
    await fs.mkdir(path.join(root, M, S), { recursive: true });
    await fs.writeFile(path.join(root, "VERSION"), "1\n");
    await fs.writeFile(path.join(root, M, S, "001.jsonl"), line(0));
    const cache = new TraceCache(root);
    expect(await cache.have(M, S)).toEqual([]);
    expect(await fs.readdir(root)).toEqual(["VERSION"]);
  });
});
