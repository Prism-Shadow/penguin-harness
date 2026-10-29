/**
 * Trace bytes as socket frames, and the receiver that commits them (socket/line-frames.ts).
 *
 * - Given lines that fit, every frame carries whole lines only, none over the budget, and the
 *   frames laid end to end are the source bytes.
 * - Given a line longer than the budget, it arrives as parts no larger than the budget, never
 *   cutting a multi-byte character, and the committer joins them byte-exact.
 * - Given bytes after the last newline, they are not framed: only whole lines leave.
 * - Given frames that end inside a line, the committer commits only up to the last newline and
 *   holds the rest as its partial.
 * - Given a transfer cut after a partial, a sender resuming from the partial's end completes
 *   the line, and the committed bytes equal the source.
 * - Given whole lines for another place in the file while a line is held, they commit and the
 *   held line stays held; a part that starts a line afresh gives the held one up.
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

  it("the committer commits only up to the last newline and holds the rest", () => {
    const committer = new LineCommitter();
    const first = committer.push({ off: 10, text: '{"a":1}\n{"b":' });
    expect(first).toEqual({ off: 10, bytes: Buffer.from('{"a":1}\n') });
    expect(committer.partial()).toEqual({ off: 18, bytes: Buffer.from('{"b":') });
    expect(committer.push({ off: 23, text: "2" })).toBeNull();
    const second = committer.push({ off: 24, text: "}\n" });
    expect(second).toEqual({ off: 18, bytes: Buffer.from('{"b":2}\n') });
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
      ...partFrames(source.subarray(resume, lineEnd), resume, BUDGET),
      ...lineFrames(source.subarray(lineEnd), lineEnd, BUDGET),
    ];
    const resumed = commitAll(rest, committer);
    expect(copyOf([...runs, ...resumed.runs], source.length)).toEqual(source);
    const sent = [...frames.slice(0, cut), ...rest].reduce((n, f) => n + frameBytes(f).length, 0);
    expect(sent).toBe(source.length);
  });

  it("whole lines elsewhere leave a held line alone; a part starting a line afresh gives it up", () => {
    const committer = new LineCommitter();
    expect(committer.push({ off: 500, text: '{"long":"aaaa', last: false })).toBeNull();
    // The window's light lines, at another offset, pass through.
    expect(committer.push({ off: 0, text: '{"a":1}\n' })).toEqual({
      off: 0,
      bytes: Buffer.from('{"a":1}\n'),
    });
    expect(committer.partial()).toEqual({ off: 500, bytes: Buffer.from('{"long":"aaaa') });
    // The rest of the held line, from where it stopped.
    expect(committer.push({ off: 513, text: 'bb"}\n', last: true })).toEqual({
      off: 500,
      bytes: Buffer.from('{"long":"aaaabb"}\n'),
    });
    // A part elsewhere begins a new line; the one held before it is given up.
    committer.push({ off: 900, text: '{"x":"', last: false });
    committer.push({ off: 2000, text: '{"y":"', last: false });
    expect(committer.partial()).toEqual({ off: 2000, bytes: Buffer.from('{"y":"') });
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
