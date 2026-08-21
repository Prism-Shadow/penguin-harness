/**
 * line-diff.ts unit tests: LCS alignment, pure additions/removals, trailing-newline line
 * counting, and the oversized-input fallback.
 */
import { describe, expect, it } from "vitest";
import { diffLines } from "../src/lib/line-diff";

describe("diffLines", () => {
  it("keeps common lines and emits del/add for a substitution", () => {
    expect(diffLines("a\nb\nc", "a\nx\nc")).toEqual([
      { type: "same", text: "a" },
      { type: "del", text: "b" },
      { type: "add", text: "x" },
      { type: "same", text: "c" },
    ]);
  });

  it("renders a pure insertion and a pure removal", () => {
    expect(diffLines("a\nc", "a\nb\nc")).toEqual([
      { type: "same", text: "a" },
      { type: "add", text: "b" },
      { type: "same", text: "c" },
    ]);
    expect(diffLines("a\nb\nc", "a\nc")).toEqual([
      { type: "same", text: "a" },
      { type: "del", text: "b" },
      { type: "same", text: "c" },
    ]);
  });

  it("empty old = every line added (the write_file rendering); empty both = no rows", () => {
    expect(diffLines("", "x\ny")).toEqual([
      { type: "add", text: "x" },
      { type: "add", text: "y" },
    ]);
    expect(diffLines("", "")).toEqual([]);
  });

  it("a trailing newline ends the last line instead of adding an empty one", () => {
    expect(diffLines("a\n", "a\nb\n")).toEqual([
      { type: "same", text: "a" },
      { type: "add", text: "b" },
    ]);
  });

  it("groups a fully-replaced block as removals then additions", () => {
    expect(diffLines("a\nb", "x\ny")).toEqual([
      { type: "del", text: "a" },
      { type: "del", text: "b" },
      { type: "add", text: "x" },
      { type: "add", text: "y" },
    ]);
  });

  it("falls back to full removal + full addition past the LCS size cap", () => {
    const oldText = Array.from({ length: 500 }, (_, i) => `old ${i}`).join("\n");
    const newText = Array.from({ length: 500 }, (_, i) => `new ${i}`).join("\n");
    const lines = diffLines(oldText, newText);
    expect(lines).toHaveLength(1000);
    expect(lines[0]).toEqual({ type: "del", text: "old 0" });
    expect(lines[500]).toEqual({ type: "add", text: "new 0" });
  });
});
