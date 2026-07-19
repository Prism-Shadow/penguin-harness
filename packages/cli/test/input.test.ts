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
