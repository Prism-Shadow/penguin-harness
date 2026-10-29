/**
 * The hub's copy of a machine's Trace lines (machines/trace-cache.ts), read back through its own
 * surface over a real temp directory.
 *
 * - Given the newest lines of a file committed first and the ones before them after, when the
 *   copy is read, then they make one run that reads back byte for byte, and records by ordinal.
 * - Given a frame that overlaps lines already held, when it is committed, then only the part in
 *   the hole is written and nothing held changes.
 * - Given bytes written to the data file without their sidecar (a crash between the two), when
 *   the copy is opened again, then those bytes are never answered.
 * - Given a read the copy cannot match — more records than it holds, or a run whose bytes no
 *   longer parse into its record count — then it answers null, never a wrong record.
 * - Given a held run, when `have` is asked, then it names that run with the anchors of its edge
 *   bytes; when the machine resets the file or its identity changes, the copy starts over; a file
 *   the machine no longer lists is dropped.
 * - Given a line that arrives in parts, when the stream stops before its last part, then `have`
 *   offers the partial, and the parts that continue it complete the line byte for byte.
 * - Given the cache over its cap, when it evicts, then the least recently read Session goes
 *   first, and never one an open job holds.
 * - Given a machine dropped, then nothing of it remains; given the sweep at start, then every
 *   machine but the known ones goes.
 * - Given a directory written in another format, when the cache opens it, then it is wiped.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HistoryFileFact } from "../src/api/types.js";
import { TraceCache } from "../src/machines/trace-cache.js";
import { anchorOf, hiAnchorRange, loAnchorRange } from "../src/services/history-wire.js";
import { makeTempRoot, removeTempRoot } from "./helpers.js";

const M = "machine-a";
const S = "session-1";
const K = `default_agent/${S}/1`;

/** One Trace record line. */
const line = (i: number, text = `reply ${i}`): string =>
  `${JSON.stringify({ type: "model_msg", timestamp: "2026-10-29T00:00:00.000Z", payload: { type: "text", role: "assistant", text } })}\n`;

/** A file of `n` records, and where each line starts. */
function traceFile(n: number): { bytes: Buffer; starts: number[] } {
  const lines = Array.from({ length: n }, (_, i) => Buffer.from(line(i)));
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
    expect(await cache.wholeRecords(M, K)).toBe(6);
    const records = await cache.records(M, K, 2, 4);
    expect(records?.map((r) => (r.record.payload as { text: string }).text)).toEqual([
      "reply 2",
      "reply 3",
    ]);
    expect(records?.[0]?.offset).toBe(file.starts[2]);
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
    expect(await cache.wholeRecords(M, K)).toBe(4);
  });

  it("never answers bytes no sidecar vouches for", async () => {
    const file = traceFile(4);
    const first = new TraceCache(root);
    await first.reconcile(M, S, [fact(file.bytes, 4)]);
    await first.commit(M, linesFrame(file, 0, 2));
    // A crash between the data write and the sidecar write: the bytes are there, unvouched.
    const data = path.join(root, M, S, "001.jsonl");
    const handle = await fs.open(data, "r+");
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
    expect(await reopened.wholeRecords(M, K)).toBeNull();
  });

  it("refuses a read it cannot match rather than answering a wrong record", async () => {
    const file = traceFile(4);
    const first = new TraceCache(root);
    await first.reconcile(M, S, [fact(file.bytes, 4)]);
    await first.commit(M, linesFrame(file, 0, 4));
    expect(await first.records(M, K, 0, 5)).toBeNull();

    // A record's bytes damaged in place: the run no longer holds the records it says it does.
    const data = path.join(root, M, S, "001.jsonl");
    const handle = await fs.open(data, "r+");
    await handle.write(Buffer.from("#".repeat(10)), 0, 10, file.starts[1]!);
    await handle.close();
    const reopened = new TraceCache(root);
    expect(await reopened.records(M, K, 0, 2)).toBeNull();
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

  it("evicts the least recently read Session first, and never one an open job holds", async () => {
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

    await cache.evict(new Set([`${M}/s-old`]));
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

  it("leaves nothing of a dropped machine, and the start sweep keeps only the known ones", async () => {
    const file = traceFile(2);
    const cache = new TraceCache(root);
    for (const machine of ["machine-a", "machine-b", "machine-c"]) {
      await cache.reconcile(machine, S, [fact(file.bytes, 2)]);
      await cache.commit(machine, linesFrame(file, 0, 2));
    }
    await cache.dropMachine("machine-a");
    await expect(fs.access(path.join(root, "machine-a"))).rejects.toThrow();
    expect(await cache.bytes("machine-a", K, 0, 1)).toBeNull();

    await new TraceCache(root).dropUnknown(new Set(["machine-b"]));
    expect((await fs.readdir(root)).sort()).toEqual(["VERSION", "machine-b"]);
  });

  it("wipes a directory written in another format", async () => {
    await fs.mkdir(path.join(root, M, S), { recursive: true });
    await fs.writeFile(path.join(root, "VERSION"), "0\n");
    await fs.writeFile(path.join(root, M, S, "001.jsonl"), line(0));
    const cache = new TraceCache(root);
    expect(await cache.have(M, S)).toEqual([]);
    expect(await fs.readdir(root)).toEqual(["VERSION"]);
  });
});
