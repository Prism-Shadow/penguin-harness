import { describe, expect, it } from "vitest";
import {
  DIFF_CONTEXT,
  DIFF_CELL_LIMIT,
  changedScenes,
  diffLines,
  diffRegions,
  diffStats,
  sceneRowIndex,
  stepRegion,
  visibleRows,
} from "../src/features/activities/spec-diff";

const shape = (rows: ReturnType<typeof diffLines>) =>
  rows.map((row) => `${row.kind === "same" ? " " : row.kind === "added" ? "+" : "-"}${row.text}`);

describe("line diff", () => {
  it("reports nothing changed when nothing changed", () => {
    const rows = diffLines("a\nb\nc", "a\nb\nc");
    expect(rows.every((row) => row.kind === "same")).toBe(true);
    expect(diffStats(rows)).toEqual({ added: 0, removed: 0, regions: 0 });
  });

  it("keeps common lines as context around an edit", () => {
    expect(shape(diffLines("a\nb\nc", "a\nB\nc"))).toEqual([" a", "-b", "+B", " c"]);
  });

  it("reads a moved block as context rather than as a delete and an insert", () => {
    const rows = diffLines("header\nbody\nfooter", "header\nextra\nbody\nfooter");
    expect(shape(rows)).toEqual([" header", "+extra", " body", " footer"]);
    expect(diffStats(rows)).toEqual({ added: 1, removed: 0, regions: 1 });
  });

  it("numbers each side by its own lines", () => {
    const rows = diffLines("a\nb", "a\nx\nb");
    expect(rows.map((row) => [row.kind, row.before, row.after])).toEqual([
      ["same", 1, 1],
      ["added", undefined, 2],
      ["same", 2, 3],
    ]);
  });

  it("handles one side being empty", () => {
    expect(shape(diffLines("", "a\nb"))).toEqual(["+a", "+b"]);
    expect(shape(diffLines("a\nb", ""))).toEqual(["-a", "-b"]);
    expect(diffLines("", "")).toEqual([]);
  });

  it("treats Windows line endings as the same text", () => {
    expect(diffStats(diffLines("a\r\nb", "a\nb"))).toEqual({ added: 0, removed: 0, regions: 0 });
  });

  it("is bounded by the table's cell count, not by either side's length", () => {
    const lines = (count: number) =>
      Array.from({ length: count }, (_, index) => `line ${index}`).join("\n");

    // A long text against a short one is cheap, so it is still compared properly.
    const long = lines(4000);
    expect(diffStats(diffLines("alpha\nbeta", long)).added).toBe(4000);

    // A thousand lines against a thousand is a million cells: inside the bound, and a
    // one-line edit reads as one line, not as the whole text.
    const thousand = lines(1000);
    expect(diffStats(diffLines(thousand, thousand.replace("line 10\n", "line ten\n")))).toEqual({
      added: 1,
      removed: 1,
      regions: 1,
    });

    // Past the bound, every line is reported replaced rather than a table being built.
    const side = Math.ceil(Math.sqrt(DIFF_CELL_LIMIT)) + 1;
    const big = lines(side);
    const rows = diffLines(big, big);
    expect(rows.every((row) => row.kind !== "same")).toBe(true);
    expect(diffStats(rows).added).toBe(side);
  });
});

describe("change regions", () => {
  it("groups adjacent changed lines into one region", () => {
    const rows = diffLines("a\nb\nc\nd", "a\nB\nC\nd");
    expect(diffRegions(rows)).toEqual([{ start: 1, end: 5 }]);
    expect(diffStats(rows)).toEqual({ added: 2, removed: 2, regions: 1 });
  });

  it("separates regions that unchanged lines sit between", () => {
    const rows = diffLines("a\nb\nc\nd\ne", "A\nb\nc\nd\nE");
    expect(diffRegions(rows)).toHaveLength(2);
  });

  it("counts a change running to the end of the text", () => {
    expect(diffRegions(diffLines("a\nb", "a\nB"))).toEqual([{ start: 1, end: 3 }]);
    expect(diffRegions(diffLines("a", "a"))).toEqual([]);
  });

  it("treats an index past the end as no position at all", () => {
    // Live edits rebuild the regions array, so an index taken before an edit can name a
    // region that no longer exists. Stepping from it must land on a real one.
    expect(stepRegion(-1, 1, 1)).toBe(0);
    expect(stepRegion(-1, 1, -1)).toBe(0);
    // The view clamps an out-of-range index to -1 before stepping, so this is what a
    // stale "3 of 1" becomes.
    const stale = 3;
    const clamped = stale < 1 ? stale : -1;
    expect(stepRegion(clamped, 1, 1)).toBe(0);
  });

  it("steps through regions and wraps at both ends", () => {
    expect(stepRegion(-1, 3, 1)).toBe(0);
    expect(stepRegion(-1, 3, -1)).toBe(2);
    expect(stepRegion(0, 3, 1)).toBe(1);
    expect(stepRegion(2, 3, 1)).toBe(0);
    expect(stepRegion(0, 3, -1)).toBe(2);
    expect(stepRegion(0, 0, 1)).toBe(-1);
  });
});

describe("folding unchanged text", () => {
  it("keeps a change with context either side and folds the rest away", () => {
    const saved = Array.from({ length: 40 }, (_, index) => `line ${index}`).join("\n");
    const edited = saved.replace("line 20", "line twenty");
    const rows = diffLines(saved, edited);
    const visible = visibleRows(rows);
    expect(visible.length).toBeLessThan(rows.length);
    const changed = visible.filter(({ row }) => row.kind !== "same");
    expect(changed).toHaveLength(2);
    // Context on both sides of the single region.
    expect(visible).toHaveLength(2 + DIFF_CONTEXT * 2);
  });

  it("shows nothing when nothing changed", () => {
    expect(visibleRows(diffLines("a\nb\nc", "a\nb\nc"))).toEqual([]);
  });

  it("keeps the indexes it was given, so a jump still lands", () => {
    const rows = diffLines("a\nb\nc\nd\ne\nf\ng\nh\ni\nj", "a\nb\nc\nd\ne\nf\ng\nh\ni\nJ");
    for (const { row, index } of visibleRows(rows)) expect(rows[index]).toBe(row);
  });
});

describe("changed scenes", () => {
  const scene = (id: string, description: string) => ({ id, description });
  const spec = (scenes: unknown[]) => JSON.stringify({ title: "t", scenes }, null, 2);

  it("names a scene whose content changed", () => {
    expect(changedScenes(spec([scene("intro", "a")]), spec([scene("intro", "b")]))).toEqual([
      { id: "intro", change: "changed" },
    ]);
  });

  it("names added and removed scenes", () => {
    expect(changedScenes(spec([scene("intro", "a")]), spec([]))).toEqual([
      { id: "intro", change: "removed" },
    ]);
    expect(changedScenes(spec([]), spec([scene("quiz", "q")]))).toEqual([
      { id: "quiz", change: "added" },
    ]);
  });

  it("says nothing when the scenes are untouched", () => {
    const text = spec([scene("intro", "a"), scene("quiz", "q")]);
    expect(changedScenes(text, text)).toEqual([]);
  });

  it("reads the legacy stages alias", () => {
    const before = JSON.stringify({ stages: [scene("intro", "a")] }, null, 2);
    const after = JSON.stringify({ stages: [scene("intro", "b")] }, null, 2);
    expect(changedScenes(before, after)).toEqual([{ id: "intro", change: "changed" }]);
  });

  it("names no scenes rather than guessing when the edit will not parse", () => {
    expect(changedScenes(spec([scene("intro", "a")]), "{ not json")).toEqual([
      { id: "intro", change: "removed" },
    ]);
    expect(changedScenes("{ not json", "{ also not json")).toEqual([]);
  });

  it("resolves a chip to a row the view actually renders", () => {
    // A scene's own id line is usually unchanged, and far enough from the edit to be
    // folded away. A chip that resolved to a folded row would silently do nothing.
    const padded = (description: string) =>
      Array.from({ length: 12 }, (_, index) => ({
        id: `scene-${index}`,
        description: index === 8 ? description : `body ${index}`,
      }));
    const rows = diffLines(spec(padded("before")), spec(padded("after")));
    const rendered = new Set(visibleRows(rows).map((entry) => entry.index));
    const target = sceneRowIndex(rows, "scene-8");
    expect(target).toBeGreaterThanOrEqual(0);
    expect(rendered.has(target)).toBe(true);
  });

  it("jumps to the scene's own line when that line is rendered", () => {
    const before = spec([scene("intro", "a"), scene("quiz", "q")]);
    const after = spec([scene("intro", "a"), scene("quiz", "changed")]);
    const rows = diffLines(before, after);
    const target = sceneRowIndex(rows, "quiz");
    expect(rows[target]!.text).toContain("quiz");
  });

  it("has nowhere to jump when the scene is not in either text", () => {
    const text = spec([scene("intro", "a")]);
    expect(sceneRowIndex(diffLines(text, text), "absent")).toBe(-1);
  });
});
