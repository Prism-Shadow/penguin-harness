/**
 * Files panel logic (lib/workspace-tree.ts): the tree's rows from lazily loaded listings,
 * the search box's filter over them, where a drop lands, the narrow-layout
 * decision and the tree pane's width bounds, how much of a path the
 * toolbar can show, which files count as text (by name, or by their bytes when the name says
 * nothing), the preferences' tolerant parses, and when leaving the editor has to ask.
 */
import { describe, expect, it } from "vitest";
import type { WorkspaceFileEntry } from "@prismshadow/penguin-server/api";
import {
  PREVIEW_MIN_WIDTH,
  TREE_LAYOUT_MIN_WIDTH,
  TREE_MIN_WIDTH,
  ancestorDirs,
  canEditPreview,
  clampTreeWidth,
  defaultTreeWidth,
  dropTargetDir,
  expandTo,
  filterTreeRows,
  flattenTree,
  isDirty,
  isNarrowLayout,
  looksLikeText,
  maxTreeWidth,
  needsDiscardConfirm,
  parentDir,
  parseEditorWrap,
  parseTreeVisible,
  parseTreeWidth,
  previewKindFor,
  readEditorWrap,
  readTreeVisible,
  readTreeWidth,
  sortEntries,
  upsertEntry,
  utf8Complete,
  visibleCrumbSegments,
  withExpanded,
  writeEditorWrap,
  writeTreeVisible,
  writeTreeWidth,
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

describe("filterTreeRows", () => {
  /** Every listed directory walked open, which is what the panel filters over. */
  const all = flattenTree(LISTINGS, new Set(LISTINGS.keys()));

  it("keeps a match with the ancestors it hangs under, and nothing else", () => {
    expect(filterTreeRows(all, "y").map((r) => r.path)).toEqual(["a", "a/y.md"]);
  });

  it("shows a matching directory with its loaded children", () => {
    expect(filterTreeRows(all, "a").map((r) => r.path)).toEqual(["a", "a/b", "a/y.md"]);
  });

  it("matches the name case-insensitively, keeps everything for an empty query, and drops everything for a miss", () => {
    expect(filterTreeRows(all, "X.TXT").map((r) => r.path)).toEqual(["x.txt"]);
    expect(filterTreeRows(all, "  ").map((r) => r.path)).toEqual(all.map((r) => r.path));
    expect(filterTreeRows(all, "nothing-like-this")).toEqual([]);
  });
});

describe("visibleCrumbSegments", () => {
  /** A fixed advance per character, so the fit is arithmetic rather than a font. */
  const measure = (text: string): number => text.length * 10;

  it("shows the whole path when it fits", () => {
    expect(visibleCrumbSegments(["root", "aa", "bb"], 1000, measure)).toEqual({
      visible: ["root", "aa", "bb"],
      collapsed: false,
    });
    expect(visibleCrumbSegments([], 1000, measure)).toEqual({ visible: [], collapsed: false });
  });

  it("drops leading segments until the rest fit, pricing in the ellipsis they become", () => {
    // "cc" 20 + "bb" 20 + the ellipsis still ahead of them 10 = 50, within 60; "aa" would
    // make it 70.
    expect(visibleCrumbSegments(["root", "aa", "bb", "cc"], 60, measure)).toEqual({
      visible: ["bb", "cc"],
      collapsed: true,
    });
    // At 100 the first segment fits too, and with nothing left ahead of it there is no
    // ellipsis to pay for.
    expect(visibleCrumbSegments(["root", "aa", "bb", "cc"], 100, measure)).toEqual({
      visible: ["root", "aa", "bb", "cc"],
      collapsed: false,
    });
  });

  it("always keeps the current directory, however little room there is", () => {
    expect(visibleCrumbSegments(["root", "aa", "bb"], 0, measure)).toEqual({
      visible: ["bb"],
      collapsed: true,
    });
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

/** In-memory stand-in for localStorage, and one that throws the way blocked site data does. */
function memPreferences(): {
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
} {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  };
}

const brokenPreferences = {
  getItem: (): string | null => {
    throw new Error("blocked");
  },
  setItem: (): void => {
    throw new Error("blocked");
  },
};

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
    const storage = memPreferences();
    expect(readTreeWidth(storage)).toBeNull();
    writeTreeWidth(233.4, storage);
    expect(readTreeWidth(storage)).toBe(233);
    expect(readTreeWidth(brokenPreferences)).toBeNull();
    expect(() => writeTreeWidth(200, brokenPreferences)).not.toThrow();
  });
});

describe("editor wrap preference", () => {
  it("wraps only on an explicit on value", () => {
    expect(parseEditorWrap(null)).toBe(false);
    expect(parseEditorWrap("0")).toBe(false);
    expect(parseEditorWrap("garbage")).toBe(false);
    expect(parseEditorWrap("1")).toBe(true);
    expect(parseEditorWrap(" TRUE ")).toBe(true);
  });

  it("round-trips through storage and reads as off when storage throws", () => {
    const storage = memPreferences();
    expect(readEditorWrap(storage)).toBe(false);
    writeEditorWrap(true, storage);
    expect(readEditorWrap(storage)).toBe(true);
    writeEditorWrap(false, storage);
    expect(readEditorWrap(storage)).toBe(false);
    expect(readEditorWrap(brokenPreferences)).toBe(false);
    expect(() => writeEditorWrap(true, brokenPreferences)).not.toThrow();
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
    const storage = memPreferences();
    expect(readTreeVisible(storage)).toBe(true);
    writeTreeVisible(false, storage);
    expect(readTreeVisible(storage)).toBe(false);
    writeTreeVisible(true, storage);
    expect(readTreeVisible(storage)).toBe(true);
    expect(readTreeVisible(brokenPreferences)).toBe(true);
    expect(() => writeTreeVisible(false, brokenPreferences)).not.toThrow();
  });
});
