/**
 * Files panel logic (lib/workspace-tree.ts): the tree's rows from lazily loaded listings,
 * the keyboard step over those rows, where a drop lands, the narrow-layout decision, which
 * files count as text (by name, or by their bytes when the name says nothing), the
 * tree-visibility preference's tolerant parse, and when leaving the editor has to ask.
 */
import { describe, expect, it } from "vitest";
import type { WorkspaceFileEntry } from "@prismshadow/penguin-server/api";
import {
  TREE_LAYOUT_MIN_WIDTH,
  ancestorDirs,
  canEditPreview,
  dropTargetDir,
  expandTo,
  flattenTree,
  isDirty,
  isNarrowLayout,
  looksLikeText,
  needsDiscardConfirm,
  parentDir,
  parseTreeVisible,
  previewKindFor,
  readTreeVisible,
  sortEntries,
  treeKeyStep,
  treePaneWidth,
  upsertEntry,
  utf8Complete,
  withExpanded,
  writeTreeVisible,
} from "../src/lib/workspace-tree";
import type { Listings } from "../src/lib/workspace-tree";

const MTIME = "2026-09-02T00:00:00.000Z";
const dir = (name: string): WorkspaceFileEntry => ({
  name,
  kind: "dir",
  sizeBytes: 0,
  mtime: MTIME,
});
const file = (name: string, sizeBytes = 1): WorkspaceFileEntry => ({
  name,
  kind: "file",
  sizeBytes,
  mtime: MTIME,
});

/** root: a/ (b/ empty, y.md), x.txt — the shape every tree test walks. */
const LISTINGS: Listings = new Map([
  ["", [dir("a"), file("x.txt")]],
  ["a", [dir("b"), file("y.md")]],
  ["a/b", []],
]);

describe("paths", () => {
  it("names a path's parent and the directories above it, root first", () => {
    expect(parentDir("x.txt")).toBe("");
    expect(parentDir("a/b/c.txt")).toBe("a/b");
    expect(ancestorDirs("x.txt")).toEqual([""]);
    expect(ancestorDirs("a/b/c.txt")).toEqual(["", "a", "a/b"]);
  });

  it("expandTo opens the way down to a file without opening the file's own name as a directory", () => {
    expect([...expandTo(new Set(), "a/b/c.txt")].sort()).toEqual(["", "a", "a/b"]);
  });

  it("withExpanded opens a directory with its ancestors and closes only the directory itself", () => {
    const opened = withExpanded(new Set(), "a/b", true);
    expect(opened.has("a")).toBe(true);
    expect(opened.has("a/b")).toBe(true);
    // Closing "a" leaves "a/b" recorded, so reopening "a" shows the subtree as it was left.
    const closed = withExpanded(opened, "a", false);
    expect(closed.has("a")).toBe(false);
    expect(closed.has("a/b")).toBe(true);
  });
});

describe("listings", () => {
  it("sorts directories before files, each group by name", () => {
    expect(
      sortEntries([file("z.txt"), dir("m"), file("a.txt"), dir("b")]).map((e) => e.name),
    ).toEqual(["b", "m", "a.txt", "z.txt"]);
  });

  it("upsertEntry inserts in sorted position, replaces a same-named entry, and leaves the input alone", () => {
    const withFile = upsertEntry(LISTINGS, "", file("m.txt"));
    expect(withFile.get("")!.map((e) => e.name)).toEqual(["a", "m.txt", "x.txt"]);
    const withDir = upsertEntry(withFile, "", dir("z"));
    expect(withDir.get("")!.map((e) => e.name)).toEqual(["a", "z", "m.txt", "x.txt"]);
    const replaced = upsertEntry(withDir, "", file("x.txt", 99));
    expect(replaced.get("")!.filter((e) => e.name === "x.txt")).toEqual([file("x.txt", 99)]);
    expect(LISTINGS.get("")!.map((e) => e.name)).toEqual(["a", "x.txt"]);
  });

  it("upsertEntry into a directory with no listing yet starts one", () => {
    expect(upsertEntry(LISTINGS, "new", file("n.txt")).get("new")).toEqual([file("n.txt")]);
  });
});

describe("flattenTree", () => {
  it("walks open directories depth-first and skips closed ones", () => {
    const rows = flattenTree(LISTINGS, new Set(["a", "a/b"]));
    expect(rows.map((r) => [r.path, r.depth])).toEqual([
      ["a", 0],
      ["a/b", 1],
      ["a/y.md", 1],
      ["x.txt", 0],
    ]);
    expect(flattenTree(LISTINGS, new Set()).map((r) => r.path)).toEqual(["a", "x.txt"]);
  });

  it("marks an open directory that is still loading, and an open one that is empty", () => {
    const loading = flattenTree(new Map([["", [dir("a")]]]), new Set(["a"]));
    expect(loading).toHaveLength(1);
    expect(loading[0]).toMatchObject({ path: "a", expanded: true, loaded: false, empty: false });
    const rows = flattenTree(LISTINGS, new Set(["a", "a/b"]));
    expect(rows.find((r) => r.path === "a/b")).toMatchObject({ loaded: true, empty: true });
    expect(rows.find((r) => r.path === "a")).toMatchObject({ loaded: true, empty: false });
  });
});

describe("treeKeyStep", () => {
  const rows = flattenTree(LISTINGS, new Set(["a", "a/b"]));

  it("moves down and up within the rows on screen, clamped at the ends", () => {
    expect(treeKeyStep(rows, null, "ArrowDown")).toEqual({ focus: "a" });
    expect(treeKeyStep(rows, "a", "ArrowDown")).toEqual({ focus: "a/b" });
    expect(treeKeyStep(rows, "x.txt", "ArrowDown")).toEqual({ focus: "x.txt" });
    expect(treeKeyStep(rows, "a/b", "ArrowUp")).toEqual({ focus: "a" });
    expect(treeKeyStep(rows, "a", "ArrowUp")).toEqual({ focus: "a" });
    expect(treeKeyStep(rows, "a/b", "Home")).toEqual({ focus: "a" });
    expect(treeKeyStep(rows, "a", "End")).toEqual({ focus: "x.txt" });
  });

  it("ArrowRight opens a closed directory, steps into an open one, and does nothing on a file or an empty directory", () => {
    const closed = flattenTree(LISTINGS, new Set());
    expect(treeKeyStep(closed, "a", "ArrowRight")).toEqual({ expand: "a" });
    expect(treeKeyStep(rows, "a", "ArrowRight")).toEqual({ focus: "a/b" });
    expect(treeKeyStep(rows, "a/b", "ArrowRight")).toBeNull();
    expect(treeKeyStep(rows, "a/y.md", "ArrowRight")).toBeNull();
    expect(treeKeyStep(rows, null, "ArrowRight")).toEqual({ focus: "a" });
  });

  it("ArrowLeft closes an open directory, otherwise steps out to the parent row", () => {
    expect(treeKeyStep(rows, "a/b", "ArrowLeft")).toEqual({ collapse: "a/b" });
    expect(treeKeyStep(rows, "a/y.md", "ArrowLeft")).toEqual({ focus: "a" });
    // A root-level file has no parent row to step out to.
    expect(treeKeyStep(rows, "x.txt", "ArrowLeft")).toBeNull();
    expect(treeKeyStep(rows, null, "ArrowLeft")).toBeNull();
  });

  it("ignores keys that are not tree keys, and does nothing with no rows", () => {
    expect(treeKeyStep(rows, "a", "Enter")).toBeNull();
    expect(treeKeyStep([], null, "ArrowDown")).toBeNull();
  });
});

describe("dropTargetDir", () => {
  it("lands on a folder row, in a file row's directory, or in the current directory", () => {
    expect(dropTargetDir({ kind: "dir", path: "docs/api" }, "src")).toBe("docs/api");
    expect(dropTargetDir({ kind: "file", path: "docs/api/README.md" }, "src")).toBe("docs/api");
    expect(dropTargetDir({ kind: "file", path: "top.txt" }, "src")).toBe("");
    expect(dropTargetDir(null, "src")).toBe("src");
  });
});

describe("layout", () => {
  it("falls back to one column below the threshold and keeps two panes while unmeasured", () => {
    expect(isNarrowLayout(0)).toBe(false);
    expect(isNarrowLayout(TREE_LAYOUT_MIN_WIDTH - 1)).toBe(true);
    expect(isNarrowLayout(TREE_LAYOUT_MIN_WIDTH)).toBe(false);
  });

  it("gives the tree about a third of the panel within readable bounds", () => {
    expect(treePaneWidth(480)).toBe(173);
    expect(treePaneWidth(320)).toBe(168);
    expect(treePaneWidth(1200)).toBe(256);
  });
});

describe("file kinds", () => {
  it("decides the preview kind from the name, leaving an unknown name to be sniffed", () => {
    expect(previewKindFor("README.md")).toBe("md");
    expect(previewKindFor("index.HTML")).toBe("html");
    expect(previewKindFor(".gitignore")).toBe("text");
    expect(previewKindFor("photo.PNG")).toBe("image");
    expect(previewKindFor("paper.pdf")).toBe("pdf");
    expect(previewKindFor("Makefile")).toBe("unknown");
    expect(previewKindFor("archive.tar.gz")).toBe("unknown");
  });

  it("takes UTF-8 text for text, including a chunk cut inside a multi-byte character", () => {
    const encode = (s: string) => new TextEncoder().encode(s);
    expect(looksLikeText(encode("all: build\n\tgo build ./...\n"))).toBe(true);
    expect(looksLikeText(encode("[32mok[0m 世界\n"))).toBe(true);
    // "世界" is six bytes; four of them end mid-character, which is a boundary, not binary.
    expect(looksLikeText(encode("世界").subarray(0, 4))).toBe(true);
    expect(utf8Complete(encode("世界").subarray(0, 4))).toEqual(encode("世"));
    expect(looksLikeText(new Uint8Array())).toBe(true);
  });

  it("rejects a NUL byte, a control-heavy sample, and bytes that are not UTF-8", () => {
    expect(
      looksLikeText(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])),
    ).toBe(false);
    expect(looksLikeText(Uint8Array.from([1, 2, 3, 4, 5, 0x41]))).toBe(false);
    // "café" in Latin-1: the lone 0xE9 followed by ASCII is not a UTF-8 sequence.
    expect(looksLikeText(Uint8Array.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0x61]))).toBe(false);
  });
});

describe("editing", () => {
  it("offers the editor for whole text-like previews only", () => {
    expect(canEditPreview({ kind: "text" })).toBe(true);
    expect(canEditPreview({ kind: "md", truncated: false })).toBe(true);
    expect(canEditPreview({ kind: "html" })).toBe(true);
    // A truncated read must stay read-only: saving it would write the cut text over the file.
    expect(canEditPreview({ kind: "text", truncated: true })).toBe(false);
    expect(canEditPreview({ kind: "image" })).toBe(false);
    expect(canEditPreview({ kind: "unsupported" })).toBe(false);
  });

  it("asks before leaving typed changes, not for a clean editor or the file being edited", () => {
    const clean = { path: "a.txt", baseline: "x", draft: "x" };
    const dirty = { path: "a.txt", baseline: "x", draft: "xy" };
    expect(isDirty(null)).toBe(false);
    expect(isDirty(clean)).toBe(false);
    expect(isDirty(dirty)).toBe(true);
    expect(needsDiscardConfirm(null, "b.txt")).toBe(false);
    expect(needsDiscardConfirm(clean, "b.txt")).toBe(false);
    expect(needsDiscardConfirm(dirty, "b.txt")).toBe(true);
    expect(needsDiscardConfirm(dirty, null)).toBe(true);
    expect(needsDiscardConfirm(dirty, "a.txt")).toBe(false);
  });
});

describe("tree visibility preference", () => {
  it("shows the tree unless an explicit off value is stored", () => {
    expect(parseTreeVisible(null)).toBe(true);
    expect(parseTreeVisible("1")).toBe(true);
    expect(parseTreeVisible("garbage")).toBe(true);
    expect(parseTreeVisible("0")).toBe(false);
    expect(parseTreeVisible(" FALSE ")).toBe(false);
  });

  it("round-trips through storage and defaults to shown when storage throws", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    expect(readTreeVisible(storage)).toBe(true);
    writeTreeVisible(false, storage);
    expect(readTreeVisible(storage)).toBe(false);
    writeTreeVisible(true, storage);
    expect(readTreeVisible(storage)).toBe(true);
    const broken = {
      getItem: (): string | null => {
        throw new Error("blocked");
      },
      setItem: (): void => {
        throw new Error("blocked");
      },
    };
    expect(readTreeVisible(broken)).toBe(true);
    expect(() => writeTreeVisible(false, broken)).not.toThrow();
  });
});
