import { describe, expect, it } from "vitest";
import {
  TOOL_OUTPUT_HEAD_LINES,
  TOOL_OUTPUT_TAIL_LINES,
  ToolOutputCollapser,
  collapseLines,
} from "../src/output-collapse.js";

/** Numbered test lines l1..ln. */
function lines(n: number, from = 1): string[] {
  return Array.from({ length: n }, (_, i) => `l${from + i}`);
}

describe("ToolOutputCollapser (streaming head/tail collapse)", () => {
  it("streams a short output through live, byte for byte (untouched)", () => {
    const c = new ToolOutputCollapser();
    expect(c.push("l1\nl2\n")).toBe("l1\nl2\n");
    expect(c.push("l3")).toBe("l3");
    expect(c.hasBuffered()).toBe(false);
    expect(c.flush()).toEqual({ hidden: 0, lines: [] });
  });

  it("a head line split across chunks stays live until its newline spends the allowance", () => {
    const c = new ToolOutputCollapser(2, 2);
    expect(c.push("l1\nl2 sta")).toBe("l1\nl2 sta");
    expect(c.push("rts here\n")).toBe("rts here\n"); // completes head line 2
    expect(c.push("l3\n")).toBe(""); // allowance spent: held back
    expect(c.hasBuffered()).toBe(true);
  });

  it("holds everything after the head allowance and prints it all when nothing was dropped", () => {
    const c = new ToolOutputCollapser(2, 2);
    expect(c.push("l1\nl2\nl3\nl4\n")).toBe("l1\nl2\n");
    // 2 held lines <= tail+1: everything still fits, nothing hidden.
    expect(c.flush()).toEqual({ hidden: 0, lines: ["l3", "l4"] });
  });

  it("head + tail + 1 lines print whole (the marker must hide at least 2 lines)", () => {
    const c = new ToolOutputCollapser(2, 2);
    expect(c.push("l1\nl2\nl3\nl4\nl5\n")).toBe("l1\nl2\n");
    expect(c.flush()).toEqual({ hidden: 0, lines: ["l3", "l4", "l5"] });
  });

  it("elides the middle beyond head+tail+1 and reports the hidden count", () => {
    const c = new ToolOutputCollapser(2, 2);
    expect(c.push(`${lines(8).join("\n")}\n`)).toBe("l1\nl2\n");
    // 8 lines: head l1-l2 live, l3-l6 hidden (4), tail l7-l8.
    expect(c.flush()).toEqual({ hidden: 4, lines: ["l7", "l8"] });
  });

  it("an unterminated final line counts as a line", () => {
    const c = new ToolOutputCollapser(2, 2);
    expect(c.push("l1\nl2\nl3\nl4\nl5\nl6")).toBe("l1\nl2\n");
    // Held: l3..l6 (l6 unterminated) -> l3 and l4 hidden, tail l5 l6.
    expect(c.flush()).toEqual({ hidden: 2, lines: ["l5", "l6"] });
  });

  it("buffers with bounded memory across many chunks (drop counting stays exact)", () => {
    const c = new ToolOutputCollapser(1, 3);
    let live = "";
    for (let i = 1; i <= 100; i++) live += c.push(`l${i}\n`);
    expect(live).toBe("l1\n");
    // 99 held lines, tail keeps the last 3, the other 96 are hidden.
    expect(c.flush()).toEqual({ hidden: 96, lines: ["l98", "l99", "l100"] });
  });

  it("flush resets the held state (a settled collapser prints nothing more)", () => {
    const c = new ToolOutputCollapser(1, 1);
    c.push("l1\nl2\nl3\nl4\n");
    c.flush();
    expect(c.hasBuffered()).toBe(false);
    expect(c.flush()).toEqual({ hidden: 0, lines: [] });
  });
});

describe("collapseLines (complete outputs, resumed-history rendering)", () => {
  it("keeps short outputs whole up to head+tail+1 lines", () => {
    const nine = lines(TOOL_OUTPUT_HEAD_LINES + TOOL_OUTPUT_TAIL_LINES + 1);
    expect(collapseLines(nine)).toEqual({ head: nine, hidden: 0, tail: [] });
  });

  it("splits longer outputs into head, hidden count, tail (hidden always >= 2)", () => {
    const ten = lines(TOOL_OUTPUT_HEAD_LINES + TOOL_OUTPUT_TAIL_LINES + 2);
    expect(collapseLines(ten)).toEqual({
      head: lines(TOOL_OUTPUT_HEAD_LINES),
      hidden: 2,
      tail: lines(TOOL_OUTPUT_TAIL_LINES, 7),
    });
  });

  it("honors custom head/tail sizes", () => {
    expect(collapseLines(lines(6), 1, 1)).toEqual({ head: ["l1"], hidden: 4, tail: ["l6"] });
  });
});
