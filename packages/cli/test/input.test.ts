import { describe, expect, it } from "vitest";
import {
  LineComposer,
  PasteFilter,
  endsWithContinuation,
  splitTrailingPartial,
} from "../src/input.js";

/** Feeds a series of input chunks into PasteFilter, collecting the forwarded output and paste events. */
async function runFilter(chunks: string[]): Promise<{ forwarded: string; pastes: string[] }> {
  const filter = new PasteFilter();
  const pastes: string[] = [];
  let forwarded = "";
  filter.on("data", (d: Buffer) => {
    forwarded += d.toString("utf8");
  });
  filter.on("paste", (t: string) => pastes.push(t));
  for (const c of chunks) filter.write(c);
  await new Promise<void>((resolve) => {
    filter.end(() => resolve());
  });
  return { forwarded, pastes };
}

/**
 * Feeds raw byte slices, so a multi-byte character can be torn across chunks the way a
 * terminal's buffer tears one during a large paste. Output Buffers are concatenated before
 * decoding: decoding each one on its own would introduce the very corruption under test.
 */
async function runFilterBytes(parts: Buffer[]): Promise<{ forwarded: string; pastes: string[] }> {
  const filter = new PasteFilter();
  const out: Buffer[] = [];
  const pastes: string[] = [];
  filter.on("data", (d: Buffer) => out.push(d));
  filter.on("paste", (t: string) => pastes.push(t));
  for (const p of parts) filter.write(p);
  await new Promise<void>((resolve) => {
    filter.end(() => resolve());
  });
  return { forwarded: Buffer.concat(out).toString("utf8"), pastes };
}

describe("splitTrailingPartial", () => {
  it("holds a trailing partial-marker prefix", () => {
    expect(splitTrailingPartial("abc\x1b[200", "\x1b[200~")).toEqual({
      emit: "abc",
      hold: "\x1b[200",
    });
  });
  it("holds nothing when no trailing prefix", () => {
    expect(splitTrailingPartial("hello", "\x1b[200~")).toEqual({
      emit: "hello",
      hold: "",
    });
  });
});

describe("PasteFilter", () => {
  it("forwards normal bytes unchanged", async () => {
    const { forwarded, pastes } = await runFilter(["hello\r"]);
    expect(forwarded).toBe("hello\r");
    expect(pastes).toEqual([]);
  });

  it("strips markers and emits the pasted block (incl. newlines) as one event", async () => {
    const { forwarded, pastes } = await runFilter(["\x1b[200~line1\nline2\nline3\x1b[201~"]);
    expect(pastes).toEqual(["line1\nline2\nline3"]);
    expect(forwarded).toBe(""); // pasted content is not forwarded to readline
  });

  it("keeps surrounding typed bytes and paste together in order", async () => {
    const { forwarded, pastes } = await runFilter(["ab\x1b[200~PASTED\x1b[201~cd\r"]);
    expect(forwarded).toBe("abcd\r");
    expect(pastes).toEqual(["PASTED"]);
  });

  it("handles a marker split across chunks", async () => {
    const { forwarded, pastes } = await runFilter(["x\x1b[20", "0~mid\x1b[201", "~y\r"]);
    expect(forwarded).toBe("xy\r");
    expect(pastes).toEqual(["mid"]);
  });

  it("keeps a typed CJK character split across chunks intact", async () => {
    const b = Buffer.from("你好世界\r", "utf8");
    // Cut inside 「好」, between its first and second byte.
    const { forwarded } = await runFilterBytes([b.subarray(0, 4), b.subarray(4)]);
    expect(forwarded).toBe("你好世界\r");
  });

  it("keeps a pasted emoji split across chunks intact", async () => {
    const b = Buffer.from("\x1b[200~ok🐧done\x1b[201~", "utf8");
    // Cut two bytes into the 4-byte emoji.
    const cut = b.indexOf(Buffer.from("🐧", "utf8")) + 2;
    const { forwarded, pastes } = await runFilterBytes([b.subarray(0, cut), b.subarray(cut)]);
    expect(pastes).toEqual(["ok🐧done"]);
    expect(forwarded).toBe("");
  });

  it("keeps CJK intact when fed one byte at a time", async () => {
    const b = Buffer.from("中\r", "utf8");
    const { forwarded } = await runFilterBytes([...b].map((x) => Buffer.from([x])));
    expect(forwarded).toBe("中\r");
  });

  it("handles markers and multi-byte characters both split across the same chunks", async () => {
    // 前(0-2) START(3-8) 文(9-11) 字(12-14) END(15-20) 後(21-23) \r(24); every cut below
    // falls inside either a marker or a character.
    const b = Buffer.from("前\x1b[200~文字\x1b[201~後\r", "utf8");
    const cuts = [2, 5, 10, 17, 22];
    const parts = [0, ...cuts].map((from, i) => b.subarray(from, cuts[i] ?? b.length));
    const { forwarded, pastes } = await runFilterBytes(parts);
    expect(pastes).toEqual(["文字"]);
    expect(forwarded).toBe("前後\r");
  });
});

describe("endsWithContinuation", () => {
  it("odd trailing backslashes → continuation", () => {
    expect(endsWithContinuation("foo\\")).toBe(true);
    expect(endsWithContinuation("foo\\\\\\")).toBe(true);
  });
  it("even/none → not continuation", () => {
    expect(endsWithContinuation("foo")).toBe(false);
    expect(endsWithContinuation("foo\\\\")).toBe(false);
  });
});

describe("LineComposer", () => {
  it("single line → immediate message", () => {
    const c = new LineComposer();
    expect(c.pushTypedLine("hello")).toEqual({ message: "hello" });
  });

  it("backslash continuation joins lines with \\n", () => {
    const c = new LineComposer();
    expect(c.pushTypedLine("a\\")).toEqual({});
    expect(c.pushTypedLine("b\\")).toEqual({});
    expect(c.pushTypedLine("c")).toEqual({ message: "a\nb\nc" });
  });

  it("paste buffers a block, Enter on empty line sends it", () => {
    const c = new LineComposer();
    expect(c.pushPaste("l1\nl2\n")).toEqual({ lineCount: 2, normalized: "l1\nl2" });
    expect(c.hasPending()).toBe(true);
    expect(c.pushTypedLine("")).toEqual({ message: "l1\nl2" });
    expect(c.hasPending()).toBe(false);
  });

  it("paste then typed text appends the text before sending", () => {
    const c = new LineComposer();
    c.pushPaste("l1\nl2");
    expect(c.pushTypedLine("more")).toEqual({ message: "l1\nl2\nmore" });
  });

  it("reset clears pending", () => {
    const c = new LineComposer();
    c.pushPaste("a\nb");
    c.reset();
    expect(c.hasPending()).toBe(false);
  });
});
