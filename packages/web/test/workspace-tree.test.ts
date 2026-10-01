/**
 * The Files panel's logic (lib/workspace-tree.ts).
 *
 * - A path names its parent and the directories above it; expanding to a file opens the way
 *   down without treating the file as a directory, and collapsing closes only that directory.
 * - Listings sort directories before files by name; an entry upserts into sorted position,
 *   replacing a same-named one, starting a listing where there was none, never mutating.
 * - The tree's rows walk open directories depth first, number each row within its directory,
 *   and mark an open directory still loading or empty; a whole-Workspace search draws a flat
 *   list of hits named by their whole path, carrying size and time.
 * - A drop lands on a folder row, in a file row's directory, or in the current directory.
 * - Below the width threshold the panel is one column (two panes while unmeasured); an
 *   undragged tree takes about a third within readable bounds, and a dragged width is clamped.
 * - A file's kind comes from its name, or from its bytes when the name says nothing (UTF-8 text
 *   cut mid-character is still text; NUL, control-heavy or non-UTF-8 bytes are not); the
 *   read-only browser reads HTML as source and an unknown name as unsupported; only whole
 *   text-like previews offer the editor, and leaving typed changes asks first.
 * - The tree width, soft wrap and tree visibility preferences parse tolerantly, keep a stored
 *   explicit answer over a new default, round-trip, and fall back when storage throws.
 * - A line range is written as an editor writes it; a directory reference carries a trailing
 *   slash.
 * - "Add to conversation" hands the composer a reference (the text it will send and its file),
 *   still fenced as a quotation, never text for the draft.
 */
import { describe, expect, it } from "vitest";
import type { WorkspaceFileEntry, WorkspaceSearchHit } from "@prismshadow/penguin-server/api";
import { blockedStorage, memoryStorage } from "./helpers/storage";
import {
  type ComposerReference,
  type Listings,
  PREVIEW_MIN_WIDTH,
  TREE_LAYOUT_MIN_WIDTH,
  TREE_MIN_WIDTH,
  ancestorDirs,
  canEditPreview,
  clampTreeWidth,
  defaultTreeWidth,
  dropTargetDir,
  expandTo,
  searchRows,
  flattenTree,
  isDirty,
  isNarrowLayout,
  looksLikeText,
  maxTreeWidth,
  needsDiscardConfirm,
  parentDir,
  parseWrapLines,
  parseTreeVisible,
  parseTreeWidth,
  pathReference,
  previewKindFor,
  previewKindOf,
  readWrapLines,
  readTreeVisible,
  readTreeWidth,
  selectionBlock,
  lineSuffix,
  sortEntries,
  upsertEntry,
  utf8Complete,
  withExpanded,
  writeWrapLines,
  writeTreeVisible,
  writeTreeWidth,
} from "../src/lib/workspace-tree";

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

  it("numbers each row within its own directory, so a flat tree can state its set", () => {
    const rows = flattenTree(LISTINGS, new Set(["a"]));
    expect(rows.map((r) => [r.path, r.posInSet, r.setSize])).toEqual([
      ["a", 1, 2],
      ["a/b", 1, 2],
      ["a/y.md", 2, 2],
      ["x.txt", 2, 2],
    ]);
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

  it("gives an undragged tree about a third of the panel within readable bounds", () => {
    expect(defaultTreeWidth(480)).toBe(173);
    expect(defaultTreeWidth(320)).toBe(168);
    expect(defaultTreeWidth(1200)).toBe(256);
  });

  it("clamps a dragged width to the tree's minimum and the preview's room", () => {
    expect(clampTreeWidth(300, 1000)).toBe(300);
    expect(clampTreeWidth(40, 1000)).toBe(TREE_MIN_WIDTH);
    expect(clampTreeWidth(900, 1000)).toBe(1000 - PREVIEW_MIN_WIDTH);
    // A panel with no room for both still has bounds, just no range between them.
    expect(maxTreeWidth(300)).toBe(TREE_MIN_WIDTH);
    expect(clampTreeWidth(300, 300)).toBe(TREE_MIN_WIDTH);
    // Unmeasured (0, before the first ResizeObserver callback): no ceiling to apply yet.
    expect(clampTreeWidth(400, 0)).toBe(400);
    expect(clampTreeWidth(Number.NaN, 1000)).toBe(TREE_MIN_WIDTH);
  });
});

describe("searchRows", () => {
  const hits: WorkspaceSearchHit[] = [
    { path: "notes.md", kind: "file", sizeBytes: 12, mtime: "2026-09-11T00:00:00.000Z" },
    { path: "a/deep", kind: "dir", sizeBytes: 0, mtime: "2026-09-11T00:00:01.000Z" },
    { path: "a/deep/notes.md", kind: "file", sizeBytes: 34, mtime: "2026-09-11T00:00:02.000Z" },
  ];

  it("names each hit by its whole path, because where it is is the part the query did not say", () => {
    // The base name is what the reader just typed; two hits called notes.md are told apart
    // only by the directory in front of them.
    expect(searchRows(hits).map((r) => r.name)).toEqual(["notes.md", "a/deep", "a/deep/notes.md"]);
    expect(searchRows(hits).map((r) => r.path)).toEqual(["notes.md", "a/deep", "a/deep/notes.md"]);
  });

  it("draws a flat list, not a tree: every row is depth 0 and closed", () => {
    // A hit can live in a directory the lazy tree never listed, so there is nothing to nest it
    // under; an open directory row here would promise children the panel cannot draw.
    const rows = searchRows(hits);
    expect(rows.every((r) => r.depth === 0)).toBe(true);
    expect(rows.every((r) => !r.expanded)).toBe(true);
    expect(rows.map((r) => r.posInSet)).toEqual([1, 2, 3]);
    expect(rows.every((r) => r.setSize === 3)).toBe(true);
  });

  it("carries the size and time the row renderer shows, so a hit reads like a tree entry", () => {
    expect(searchRows(hits).map((r) => r.sizeBytes)).toEqual([12, 0, 34]);
    expect(searchRows(hits)[2]?.mtime).toBe("2026-09-11T00:00:02.000Z");
    expect(searchRows([])).toEqual([]);
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

  it("reads HTML as source and an unknown name as unsupported in the read-only browser", () => {
    expect(previewKindOf("index.html")).toBe("text");
    expect(previewKindOf("Makefile")).toBe("unsupported");
    expect(previewKindOf("README.md")).toBe("md");
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
    const version = 'W/"1-1000"';
    const clean = { path: "a.txt", baseline: "x", draft: "x", version };
    const dirty = { path: "a.txt", baseline: "x", draft: "xy", version };
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

describe("tree width preference", () => {
  it("takes a positive integer and treats everything else as unset", () => {
    expect(parseTreeWidth(null)).toBeNull();
    expect(parseTreeWidth(" 220 ")).toBe(220);
    expect(parseTreeWidth("240px")).toBe(240);
    expect(parseTreeWidth("garbage")).toBeNull();
    expect(parseTreeWidth("0")).toBeNull();
    expect(parseTreeWidth("-40")).toBeNull();
  });

  it("round-trips through storage and reads as unset when storage throws", () => {
    const storage = memoryStorage();
    expect(readTreeWidth(storage)).toBeNull();
    writeTreeWidth(233.4, storage);
    expect(readTreeWidth(storage)).toBe(233);
    expect(readTreeWidth(blockedStorage())).toBeNull();
    expect(() => writeTreeWidth(200, blockedStorage())).not.toThrow();
  });
});

describe("soft wrap preference", () => {
  it("wraps unless an explicit off value is stored, so a stored answer survives the new default", () => {
    expect(parseWrapLines(null)).toBe(true);
    expect(parseWrapLines("garbage")).toBe(true);
    expect(parseWrapLines("1")).toBe(true);
    expect(parseWrapLines("0")).toBe(false);
    expect(parseWrapLines(" FALSE ")).toBe(false);
  });

  it("round-trips through storage and reads as on when storage throws", () => {
    const storage = memoryStorage();
    expect(readWrapLines(storage)).toBe(true);
    writeWrapLines(false, storage);
    expect(readWrapLines(storage)).toBe(false);
    writeWrapLines(true, storage);
    expect(readWrapLines(storage)).toBe(true);
    expect(readWrapLines(blockedStorage())).toBe(true);
    expect(() => writeWrapLines(false, blockedStorage())).not.toThrow();
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
    const storage = memoryStorage();
    expect(readTreeVisible(storage)).toBe(true);
    writeTreeVisible(false, storage);
    expect(readTreeVisible(storage)).toBe(false);
    writeTreeVisible(true, storage);
    expect(readTreeVisible(storage)).toBe(true);
    expect(readTreeVisible(blockedStorage())).toBe(true);
    expect(() => writeTreeVisible(false, blockedStorage())).not.toThrow();
  });
});

describe("lineSuffix", () => {
  it("writes a range the way an editor and a stack trace do", () => {
    expect(lineSuffix(12, 18)).toBe(":12-18");
    expect(lineSuffix(7, 7)).toBe(":7");
  });
});

describe("composer references", () => {
  it("marks a directory with a trailing slash and leaves a file bare", () => {
    expect(pathReference("src/lib/tree.ts", "file")).toBe("@src/lib/tree.ts");
    expect(pathReference("src/lib", "dir")).toBe("@src/lib/");
  });
});

describe("what the panel hands the composer is a reference, not text for the draft", () => {
  const block = selectionBlock({
    path: "src/app.ts",
    language: "ts",
    selection: "const x = 1;",
    fromLine: 3,
    toLine: 3,
  });

  it("carries the text it will send and the file it came from", () => {
    // The chip shows the path; the block is what the message carries. Keeping the two on one
    // object is what lets the composer show one and send the other.
    const reference: ComposerReference = {
      kind: "quote",
      path: "src/app.ts",
      text: block,
      fromLine: 3,
      toLine: 3,
    };
    expect(reference.text).toContain("@src/app.ts:3");
    expect(reference.text).toContain("const x = 1;");
    expect(reference.path).toBe("src/app.ts");
  });

  it("still fences the quotation, so the composer could not have shown it as a line of the draft", () => {
    // The reason this is a chip at all: what it carries is a multi-line block, and splicing a
    // block into a half-typed sentence buries the sentence.
    expect(block.split("\n").length).toBeGreaterThan(2);
    expect(block).toMatch(/```/);
  });

  it("carries a file and a directory the same way, each naming its own kind", () => {
    // All three kinds go through one channel, so the composer has one chip to draw and the
    // panel has no second path that could put text in the draft again.
    const file: ComposerReference = {
      kind: "file",
      path: "src/app.ts",
      text: pathReference("src/app.ts", "file"),
    };
    const dir: ComposerReference = {
      kind: "dir",
      path: "src/lib",
      text: pathReference("src/lib", "dir"),
    };
    expect(file.text).toBe("@src/app.ts");
    expect(dir.text).toBe("@src/lib/");
    expect([file.kind, dir.kind]).toEqual(["file", "dir"]);
    // Neither carries a line range: a whole entry has no lines to name.
    expect(file.fromLine).toBeUndefined();
    expect(dir.fromLine).toBeUndefined();
  });
});
