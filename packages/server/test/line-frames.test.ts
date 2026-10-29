/**
 * Trace bytes as socket frames, and the receiver that commits them (socket/line-frames.ts).
 *
 * - Given lines that fit, every frame carries whole lines only, none over the budget, and the
 *   frames laid end to end are the source bytes.
 * - Given a line longer than the budget, it arrives as parts no larger than the budget, never
 *   cutting a multi-byte character, and the committer joins them byte-exact.
 * - Given bytes after the last newline, they are not framed: only whole lines leave.
 * - Given a line's parts, the committer holds them by the line's first byte and commits the
 *   line, from that byte, only with its last part.
 * - Given a transfer cut after a partial, a sender resuming from the partial's end completes
 *   the line, and the committed bytes equal the source.
 * - Given a held line, and then — before its rest — whole lines elsewhere and the parts of
 *   another line longer than a frame, both lines commit whole from their first byte: nothing is
 *   committed from the middle of a line.
 * - Given a part whose line's head is not held (the rest of a partial the receiver lost), it is
 *   dropped, never committed.
 * - Given blank lines, malformed lines and bytes that are not UTF-8, they survive byte-exact.
 */
import { describe, expect, it } from "vitest";
import { LineCommitter, frameBytes, lineFrames, partFrames } from "../src/socket/line-frames.js";
import type { LineFrame, PartFrame } from "../src/socket/line-frames.js";

const BUDGET = 64;

/** Every committed run written into a copy at its offset, as a cache would. */
function commitAll(frames: Iterable<LineFrame | PartFrame>, committer = new LineCommitter()) {
  const runs: { off: number; bytes: Buffer }[] = [];
  for (const frame of frames) {
    const run = committer.push(frame);
    if (run !== null) runs.push(run);
  }
  return { runs, committer };
}

function copyOf(runs: { off: number; bytes: Buffer }[], size: number): Buffer {
  const copy = Buffer.alloc(size);
  for (const run of runs) run.bytes.copy(copy, run.off);
  return copy;
}

describe("line frames", () => {
  it("whole lines only, within the budget, and end to end they are the source", () => {
    const source = Buffer.from(
      Array.from({ length: 20 }, (_, i) => `{"n":${i},"t":"${"x".repeat(i)}"}\n`).join(""),
    );
    const frames = [...lineFrames(source, 1000, BUDGET)];
    let at = 1000;
    for (const frame of frames) {
      expect("last" in frame).toBe(false);
      const bytes = frameBytes(frame);
      expect(frame.off).toBe(at);
      expect(bytes.length).toBeLessThanOrEqual(BUDGET);
      expect(bytes[bytes.length - 1]).toBe(0x0a);
      at += bytes.length;
    }
    expect(Buffer.concat(frames.map(frameBytes))).toEqual(source);
  });

  it("a line longer than the budget goes as parts that never cut a character and join byte-exact", () => {
    const long = `{"t":"${"中文".repeat(80)}"}\n`;
    const source = Buffer.from(`{"a":1}\n${long}{"b":2}\n`);
    const frames = [...lineFrames(source, 0, BUDGET)];
    const parts = frames.filter((f): f is PartFrame => "last" in f);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.filter((p) => p.last)).toHaveLength(1);
    for (const part of parts) {
      expect(Buffer.byteLength(part.text)).toBeLessThanOrEqual(BUDGET);
      expect(part.b64).toBeUndefined();
      // Each part's text round-trips: no character was split across two parts.
      expect(Buffer.from(part.text).toString()).toBe(part.text);
      expect(part.text).not.toContain("�");
    }
    const { runs, committer } = commitAll(frames);
    expect(copyOf(runs, source.length)).toEqual(source);
    expect(committer.partial()).toBeNull();
  });

  it("bytes after the last newline are not framed", () => {
    const source = Buffer.from('{"a":1}\n{"b":2}\n{"torn');
    const sent = Buffer.concat([...lineFrames(source, 0, BUDGET)].map(frameBytes));
    expect(sent.toString()).toBe('{"a":1}\n{"b":2}\n');
  });

  it("a line's parts are held by its first byte and the line commits from there with its last", () => {
    const committer = new LineCommitter();
    expect(committer.push({ line: 18, off: 18, text: '{"b":', last: false })).toBeNull();
    expect(committer.partial()).toEqual({ off: 18, bytes: Buffer.from('{"b":') });
    expect(committer.push({ line: 18, off: 23, text: "2", last: false })).toBeNull();
    expect(committer.push({ line: 18, off: 24, text: "}\n", last: true })).toEqual({
      off: 18,
      bytes: Buffer.from('{"b":2}\n'),
    });
    expect(committer.partial()).toBeNull();
  });

  it("a transfer cut after a partial resumes from its end and the copy equals the source", () => {
    const source = Buffer.from(`{"a":1}\n{"long":"${"y".repeat(300)}"}\n{"c":3}\n`);
    const frames = [...lineFrames(source, 0, BUDGET)];
    const cut = frames.findIndex((f) => "last" in f) + 2; // inside the long line
    const { runs, committer } = commitAll(frames.slice(0, cut));
    const held = committer.partial()!;
    expect(held).not.toBeNull();
    // The sender, told of the partial, sends the rest of that line from where it stopped,
    // then the lines after it — and nothing before.
    const resume = held.off + held.bytes.length;
    const lineEnd = source.indexOf(0x0a, resume) + 1;
    const rest = [
      ...partFrames(source.subarray(resume, lineEnd), resume, BUDGET, held.off),
      ...lineFrames(source.subarray(lineEnd), lineEnd, BUDGET),
    ];
    const resumed = commitAll(rest, committer);
    expect(copyOf([...runs, ...resumed.runs], source.length)).toEqual(source);
    const sent = [...frames.slice(0, cut), ...rest].reduce((n, f) => n + frameBytes(f).length, 0);
    expect(sent).toBe(source.length);
  });

  it("a held line survives whole lines and another long line arriving first; both commit whole", () => {
    // A heavy line held in part from an earlier stream; then a stream whose light lines — one
    // of them longer than a frame — come before the rest of the held line.
    const heavy = Buffer.from(`{"heavy":"${"h".repeat(200)}"}\n`);
    const light = Buffer.from(`{"a":1}\n{"long":"${"L".repeat(150)}"}\n`);
    const source = Buffer.concat([heavy, light]);
    const committer = new LineCommitter();
    const heavyParts = [...partFrames(heavy, 0, BUDGET)];
    const runs = commitAll(heavyParts.slice(0, 2), committer).runs;
    const held = committer.partial()!;
    expect(held.off).toBe(0);
    const resume = held.bytes.length;
    const second = [
      ...lineFrames(light, heavy.length, BUDGET),
      ...partFrames(heavy.subarray(resume), resume, BUDGET, 0),
    ];
    const after = commitAll(second, committer).runs;
    const starts = new Set([0, heavy.length, heavy.length + 8]);
    expect([...runs, ...after].every((r) => starts.has(r.off))).toBe(true);
    expect(copyOf([...runs, ...after], source.length)).toEqual(source);
    expect(committer.partials()).toEqual([]);
  });

  it("a part whose line's head is not held is dropped, never committed", () => {
    const committer = new LineCommitter();
    // The rest of a line that started at 100, from a receiver that holds nothing of it.
    expect(committer.push({ line: 100, off: 164, text: 'end"}\n', last: true })).toBeNull();
    expect(committer.push({ line: 100, off: 140, text: "middle", last: false })).toBeNull();
    expect(committer.partials()).toEqual([]);
  });

  it("blank lines, malformed lines and bytes that are not UTF-8 survive byte-exact", () => {
    const source = Buffer.concat([
      Buffer.from('{"a":1}\n\n   \n{not json\n'),
      Buffer.from([0x7b, 0xe4, 0xb8, 0x0a]), // a healed torn line cut inside a character
      Buffer.from('{"z":26}\n'),
      Buffer.from([0xff, 0xfe, ...Buffer.from("x".repeat(100)), 0x0a]),
    ]);
    const frames = [...lineFrames(source, 0, BUDGET)];
    expect(frames.some((f) => f.b64 === true)).toBe(true);
    const { runs } = commitAll(frames);
    expect(copyOf(runs, source.length)).toEqual(source);
  });
});
