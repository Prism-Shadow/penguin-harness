/**
 * memory-replay.ts unit tests: backwards replay of a conversation's file-tool calls —
 * clean reversal (single / chained / replace_all), the write_file cutoff with its drift
 * check, and every degradation path (missing anchor, ambiguous anchor, missing material,
 * empty new string). Plus the frontmatter-stripping alignment the detail view relies on.
 */
import { describe, expect, it } from "vitest";
import { replayBackwards } from "../src/lib/memory-replay";
import type { MemoryChangeEvent } from "../src/lib/omni/memory-changes";
import { bodyWithoutFrontmatter } from "../src/lib/frontmatter";
import { diffLines } from "../src/lib/line-diff";

const edit = (oldString: string, newString: string, replaceAll?: boolean): MemoryChangeEvent => ({
  op: "edit",
  oldString,
  newString,
  ...(replaceAll === true ? { replaceAll: true } : {}),
});
const write = (content?: string): MemoryChangeEvent => ({
  op: "write",
  ...(content !== undefined ? { content } : {}),
});

describe("replayBackwards", () => {
  it("reverses a single edit", () => {
    expect(replayBackwards("a NEW c", [edit("OLD", "NEW")])).toEqual({
      kind: "diff",
      before: "a OLD c",
    });
  });

  it("reverses chained edits newest-first", () => {
    // before "x" → e1 → "y" → e2 → "z"
    expect(replayBackwards("z", [edit("x", "y"), edit("y", "z")])).toEqual({
      kind: "diff",
      before: "x",
    });
  });

  it("no events = no change", () => {
    expect(replayBackwards("t", [])).toEqual({ kind: "diff", before: "t" });
  });

  it("reverts every occurrence of a replace_all edit", () => {
    expect(replayBackwards("B and B and B", [edit("A", "B", true)])).toEqual({
      kind: "diff",
      before: "A and A and A",
    });
  });

  it("a write_file whose content matches the reconstruction = the conversation wrote the whole text", () => {
    // write "W1" → edit W1→W2; current "W2" reverses to "W1", matching the write's record.
    expect(replayBackwards("W2", [write("W1"), edit("W1", "W2")])).toEqual({ kind: "rewritten" });
    // A write without recorded content can't be checked; the record is trusted.
    expect(replayBackwards("whatever", [write()])).toEqual({ kind: "rewritten" });
  });

  it("a write_file whose content no longer matches = external drift, no alignment", () => {
    expect(replayBackwards("externally changed", [write("W1")])).toEqual({ kind: "unaligned" });
  });

  it("degrades when an edit's anchor is missing or ambiguous", () => {
    expect(replayBackwards("nothing to find", [edit("a", "gone")])).toEqual({
      kind: "unaligned",
    });
    expect(replayBackwards("dup dup", [edit("a", "dup")])).toEqual({ kind: "unaligned" });
    expect(replayBackwards("text", [edit("a", "")])).toEqual({ kind: "unaligned" });
    expect(replayBackwards("text", [{ op: "edit" }])).toEqual({ kind: "unaligned" });
  });

  it("replay runs on raw content, and stripping frontmatter afterwards aligns meta-only edits", () => {
    const current = "---\nname: t\nupdated: 2026-08-21\n---\nbody line\n";
    const result = replayBackwards(current, [edit("updated: 2026-08-20", "updated: 2026-08-21")]);
    expect(result.kind).toBe("diff");
    const before = (result as { kind: "diff"; before: string }).before;
    const lines = diffLines(bodyWithoutFrontmatter(before), bodyWithoutFrontmatter(current));
    expect(lines.every((l) => l.type === "same")).toBe(true);
  });
});
