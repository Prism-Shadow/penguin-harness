/**
 * The Trace line index (services/trace-line-index.ts): the events endpoint's pages, served by
 * ranged reads instead of a parse of the whole file per page.
 *
 * - Given a file with blank lines, a CRLF line, a malformed middle line and a crash-torn
 *   tail, every page holds exactly the records `readTraceTolerant` returns at those
 *   ordinals, and `total` is its record count.
 * - Given a last record whose newline has not landed yet, it is counted as the tolerant
 *   reader counts it, and keeps its ordinal once the writer appends after it.
 * - Given a torn tail the writer later heals with a leading newline, the torn line stays out
 *   and the healed record takes the next ordinal, both before and after.
 * - Paging through a file reads the whole file once, then only the bytes of each page.
 * - Concurrent first reads of one file share that one scan.
 * - An appended file is followed by reading only the appended bytes, never its prefix again.
 * - A truncated file, a file replaced by another, and a same-size rewrite are indexed anew.
 * - Only the most recently used files keep their index: an evicted file is scanned again.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readTraceTolerant, userText } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import { TraceLineIndex } from "../src/services/trace-line-index.js";
import { makeTempRoot } from "./helpers.js";

const line = (msg: OmniMessage): string => `${JSON.stringify(msg)}\n`;
const texts = (events: OmniMessage[]): string[] =>
  events.map((e) => (e.payload as { text: string }).text);

describe("trace line index", () => {
  let dir: string;
  let file: string;
  let reads: Array<{ path: string; start: number; end: number }>;
  let index: TraceLineIndex;

  const bytesRead = () => reads.reduce((sum, r) => sum + (r.end - r.start), 0);
  /** Every page of `size` the index serves, concatenated, and the totals it reported. */
  const allPages = async (size: number) => {
    const events: OmniMessage[] = [];
    const totals = new Set<number>();
    for (let offset = 0; ; offset += size) {
      const page = await index.readRange(file, offset, size);
      totals.add(page.total);
      events.push(...page.events);
      if (page.events.length < size) break;
    }
    return { events, totals: [...totals] };
  };

  beforeEach(async () => {
    dir = await makeTempRoot();
    file = path.join(dir, "s_001.jsonl");
    reads = [];
    index = new TraceLineIndex({
      observeRead: (p, start, end) => reads.push({ path: p, start, end }),
    });
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it.each([1, 2, 3, 1000])(
    "pages of %i hold exactly the tolerant reader's records, skipping damage the way it does",
    async (size) => {
      await fs.writeFile(
        file,
        [
          line(userText("m0")),
          "\n",
          "   \n",
          line(userText("m1")).replace("\n", "\r\n"),
          '{"timestamp":"2026-07-05T10:00:00.000Z","type":"model_msg","payl\n',
          line(userText("m2")),
          "not json at all\n",
          line(userText("m3")),
          '{"timestamp":"2026-07-05T10:00:0',
        ].join(""),
      );
      const expected = await readTraceTolerant(file);
      expect(texts(expected)).toEqual(["m0", "m1", "m2", "m3"]);

      const { events, totals } = await allPages(size);
      expect(events).toEqual(expected);
      expect(totals).toEqual([expected.length]);
    },
  );

  it("a last record whose newline has not landed is counted, and keeps its ordinal after the next append", async () => {
    await fs.writeFile(file, line(userText("a")) + JSON.stringify(userText("b")));
    expect(texts((await index.readRange(file, 0, 10)).events)).toEqual(
      texts(await readTraceTolerant(file)),
    );
    expect((await index.readRange(file, 0, 10)).total).toBe(2);

    await fs.appendFile(file, `\n${line(userText("c"))}`);
    const after = await index.readRange(file, 0, 10);
    expect(texts(after.events)).toEqual(["a", "b", "c"]);
    expect(after.events).toEqual(await readTraceTolerant(file));
  });

  it("a torn tail stays out before and after the writer heals it, and the healed record follows", async () => {
    await fs.writeFile(file, line(userText("a")) + '{"timestamp":"2026-07-05T1');
    const before = await index.readRange(file, 0, 10);
    expect(before.events).toEqual(await readTraceTolerant(file));
    expect(before.total).toBe(1);

    // The writer's heal: a leading newline turns the torn line into a malformed middle line.
    await fs.appendFile(file, `\n${line(userText("b"))}`);
    const after = await index.readRange(file, 0, 10);
    expect(after.events).toEqual(await readTraceTolerant(file));
    expect(texts(after.events)).toEqual(["a", "b"]);
  });

  it("paging through a file reads it whole once, then only each page's bytes", async () => {
    const records = Array.from({ length: 30 }, (_, i) => line(userText(`m${i}`)));
    await fs.writeFile(file, records.join(""));
    const size = (await fs.stat(file)).size;

    await allPages(7);
    // One full scan, then every record exactly once across the pages.
    expect(bytesRead()).toBe(size + size);
    expect(reads.filter((r) => r.start === 0 && r.end === size)).toHaveLength(1);

    reads = [];
    const again = await index.readRange(file, 10, 5);
    expect(texts(again.events)).toEqual(["m10", "m11", "m12", "m13", "m14"]);
    expect(bytesRead()).toBe(records.slice(10, 15).join("").length);
  });

  it("concurrent first reads of one file share one scan", async () => {
    await fs.writeFile(
      file,
      Array.from({ length: 20 }, (_, i) => line(userText(`m${i}`))).join(""),
    );
    const size = (await fs.stat(file)).size;
    const pages = await Promise.all(
      [0, 5, 10, 15].map((offset) => index.readRange(file, offset, 5)),
    );
    expect(pages.map((p) => texts(p.events)[0])).toEqual(["m0", "m5", "m10", "m15"]);
    // One scan, plus four pages of a quarter of the file each.
    expect(bytesRead()).toBe(size + size);
  });

  it("an appended file is followed by reading only the appended bytes", async () => {
    const head = Array.from({ length: 10 }, (_, i) => line(userText(`m${i}`))).join("");
    await fs.writeFile(file, head);
    await index.readRange(file, 0, 1);

    reads = [];
    const tail = line(userText("m10")) + line(userText("m11"));
    await fs.appendFile(file, tail);
    const page = await index.readRange(file, 10, 5);
    expect(texts(page.events)).toEqual(["m10", "m11"]);
    expect(page.total).toBe(12);
    // The scan starts one byte before the old end (re-checking the newline it ended on).
    const scan = reads[0]!;
    expect(scan.start).toBe(head.length - 1);
    expect(reads.every((r) => r.start >= head.length - 1)).toBe(true);
  });

  it("a truncated, a replaced and a same-size rewritten file are indexed anew", async () => {
    await fs.writeFile(file, [line(userText("aa")), line(userText("bb"))].join(""));
    expect((await index.readRange(file, 0, 10)).total).toBe(2);

    // Truncated to its first record.
    await fs.writeFile(file, line(userText("aa")));
    expect(texts((await index.readRange(file, 0, 10)).events)).toEqual(["aa"]);

    // Replaced by another file (a rename onto the path: a new inode), longer than before.
    const other = path.join(dir, "other.jsonl");
    await fs.writeFile(
      other,
      [line(userText("x")), line(userText("y")), line(userText("z"))].join(""),
    );
    await fs.rename(other, file);
    expect(texts((await index.readRange(file, 0, 10)).events)).toEqual(["x", "y", "z"]);

    // Rewritten in place with the same size and a later mtime.
    await fs.writeFile(
      file,
      [line(userText("p")), line(userText("q")), line(userText("r"))].join(""),
    );
    const later = new Date(Date.now() + 60_000);
    await fs.utimes(file, later, later);
    expect(texts((await index.readRange(file, 0, 10)).events)).toEqual(["p", "q", "r"]);
  });

  it("only the most recently used files keep their index", async () => {
    index = new TraceLineIndex({
      maxFiles: 2,
      observeRead: (p, start, end) => reads.push({ path: p, start, end }),
    });
    const files = ["a", "b", "c"].map((name) => path.join(dir, `${name}.jsonl`));
    for (const f of files) await fs.writeFile(f, line(userText("one")) + line(userText("two")));
    const size = (await fs.stat(files[0]!)).size;
    /** Whole-file reads: scans (a page here is a single record, never the whole file). */
    const scans = (f: string) =>
      reads.filter((r) => r.path === f && r.start === 0 && r.end === size);

    await index.readRange(files[0]!, 0, 1);
    await index.readRange(files[1]!, 0, 1);
    await index.readRange(files[0]!, 0, 1); // a is now the most recent
    await index.readRange(files[2]!, 0, 1); // evicts b
    reads = [];
    await index.readRange(files[0]!, 0, 1);
    await index.readRange(files[1]!, 0, 1);
    expect(scans(files[0]!)).toHaveLength(0);
    expect(scans(files[1]!)).toHaveLength(1);
  });
});
