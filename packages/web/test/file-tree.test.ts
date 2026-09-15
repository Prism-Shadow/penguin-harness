/**
 * The shared file tree's DOM-free logic (lib/file-tree.ts): where a row's subtree ends in the
 * flat row list, and the keyboard step over those rows — the WAI-ARIA tree pattern's up/down
 * move, right to open a directory or step into it, left to close it or step out to its parent.
 */
import { describe, expect, it } from "vitest";
import { subtreeEnd, treeKeyStep } from "../src/lib/file-tree";
import type { FileTreeRow } from "../src/lib/file-tree";

const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

const dirRow = (
  path: string,
  depth: number,
  posInSet: number,
  setSize: number,
  over: Partial<FileTreeRow> = {},
): FileTreeRow => ({
  path,
  name: baseName(path),
  kind: "dir",
  depth,
  posInSet,
  setSize,
  expanded: true,
  loaded: true,
  empty: false,
  ...over,
});

const fileRow = (path: string, depth: number, posInSet: number, setSize: number): FileTreeRow => ({
  path,
  name: baseName(path),
  kind: "file",
  depth,
  posInSet,
  setSize,
  expanded: false,
  loaded: true,
  empty: false,
});

/** root: a/ (b/ empty, y.md), x.txt — with both directories open. */
const ROWS: FileTreeRow[] = [
  dirRow("a", 0, 1, 2),
  dirRow("a/b", 1, 1, 2, { empty: true }),
  fileRow("a/y.md", 1, 2, 2),
  fileRow("x.txt", 0, 2, 2),
];

/** The same tree with nothing open: an unopened directory has no listing yet. */
const CLOSED: FileTreeRow[] = [
  dirRow("a", 0, 1, 2, { expanded: false, loaded: false }),
  fileRow("x.txt", 0, 2, 2),
];

describe("subtreeEnd", () => {
  it("ends a row's subtree at the next row no deeper than it", () => {
    // "a" owns rows 1..2, the nested "a/b" owns nothing, and "x.txt" after them is where both stop.
    expect(subtreeEnd(ROWS, 0)).toBe(3);
    expect(subtreeEnd(ROWS, 1)).toBe(2);
    expect(subtreeEnd(ROWS, 3)).toBe(4);
  });
});

describe("treeKeyStep", () => {
  it("moves down and up within the rows on screen, clamped at the ends", () => {
    expect(treeKeyStep(ROWS, null, "ArrowDown")).toEqual({ focus: "a" });
    expect(treeKeyStep(ROWS, "a", "ArrowDown")).toEqual({ focus: "a/b" });
    expect(treeKeyStep(ROWS, "x.txt", "ArrowDown")).toEqual({ focus: "x.txt" });
    expect(treeKeyStep(ROWS, "a/b", "ArrowUp")).toEqual({ focus: "a" });
    expect(treeKeyStep(ROWS, "a", "ArrowUp")).toEqual({ focus: "a" });
    expect(treeKeyStep(ROWS, "a/b", "Home")).toEqual({ focus: "a" });
    expect(treeKeyStep(ROWS, "a", "End")).toEqual({ focus: "x.txt" });
  });

  it("ArrowRight opens a closed directory, steps into an open one, and does nothing on a file or an empty directory", () => {
    expect(treeKeyStep(CLOSED, "a", "ArrowRight")).toEqual({ expand: "a" });
    expect(treeKeyStep(ROWS, "a", "ArrowRight")).toEqual({ focus: "a/b" });
    expect(treeKeyStep(ROWS, "a/b", "ArrowRight")).toBeNull();
    expect(treeKeyStep(ROWS, "a/y.md", "ArrowRight")).toBeNull();
    expect(treeKeyStep(ROWS, null, "ArrowRight")).toEqual({ focus: "a" });
  });

  it("ArrowLeft closes an open directory, otherwise steps out to the parent row", () => {
    expect(treeKeyStep(ROWS, "a/b", "ArrowLeft")).toEqual({ collapse: "a/b" });
    expect(treeKeyStep(ROWS, "a/y.md", "ArrowLeft")).toEqual({ focus: "a" });
    // A root-level file has no parent row to step out to.
    expect(treeKeyStep(ROWS, "x.txt", "ArrowLeft")).toBeNull();
    expect(treeKeyStep(ROWS, null, "ArrowLeft")).toBeNull();
  });

  it("ArrowLeft steps to the row above, never to a path that is not a row", () => {
    // The plugin browser's top-level rows are whole paths ("skills/<name>"): there is no
    // "skills" row to step out to, so a parent taken from the path would focus nothing.
    const rows = [
      dirRow("skills/humanizer", 0, 1, 1),
      fileRow("skills/humanizer/SKILL.md", 1, 1, 2),
      dirRow("skills/humanizer/reference", 1, 2, 2, { expanded: false }),
    ];
    expect(treeKeyStep(rows, "skills/humanizer/SKILL.md", "ArrowLeft")).toEqual({
      focus: "skills/humanizer",
    });
    expect(treeKeyStep(rows, "skills/humanizer", "ArrowLeft")).toEqual({
      collapse: "skills/humanizer",
    });
    expect(
      treeKeyStep(
        [dirRow("skills/humanizer", 0, 1, 1, { expanded: false })],
        "skills/humanizer",
        "ArrowLeft",
      ),
    ).toBeNull();
  });

  it("ignores keys that are not tree keys, and does nothing with no rows", () => {
    expect(treeKeyStep(ROWS, "a", "Enter")).toBeNull();
    expect(treeKeyStep([], null, "ArrowDown")).toBeNull();
  });
});
