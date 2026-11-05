/**
 * The Files panel following a rename, and naming a new entry (lib/workspace-tree.ts).
 *
 * - A folder's move carries it and every path under it to the new place, and leaves a sibling
 *   that only shares its prefix where it was.
 * - The open folders and the loaded listings follow the move, so the tree keeps its shape.
 * - A new text file's name field selects the stem, so typing replaces `untitled` and keeps the
 *   extension; a dotfile's leading dot is part of its stem.
 * - A typed name loses the slashes at its ends, and a slash inside it stays: it creates the
 *   folders in between.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEXT_FILE_NAME,
  movedListings,
  movedPath,
  movedSet,
  newEntryName,
  stemEnd,
} from "../src/lib/workspace-tree";

const entry = (name: string, kind: "dir" | "file") => ({
  name,
  kind,
  sizeBytes: 1,
  mtime: "2026-10-01T00:00:00.000Z",
});

describe("following a move", () => {
  it("a folder's move carries it and everything under it, and leaves a prefix-sharing sibling", () => {
    expect(movedPath("docs", "docs", "handbook/docs")).toBe("handbook/docs");
    expect(movedPath("docs/guide/intro.md", "docs", "handbook/docs")).toBe(
      "handbook/docs/guide/intro.md",
    );
    expect(movedPath("docs-old/intro.md", "docs", "handbook/docs")).toBeNull();
    expect(movedPath("src/docs", "docs", "handbook/docs")).toBeNull();
  });

  it("the open folders and the loaded listings follow the move", () => {
    const expanded = movedSet(new Set(["", "docs", "docs/guide", "src"]), "docs", "manual");
    expect([...expanded].sort()).toEqual(["", "manual", "manual/guide", "src"]);

    const listings = movedListings(
      new Map([
        ["", [entry("docs", "dir"), entry("src", "dir")]],
        ["docs/guide", [entry("intro.md", "file")]],
        ["src", [entry("app.ts", "file")]],
      ]),
      "docs",
      "manual",
    );
    expect([...listings.keys()].sort()).toEqual(["", "manual/guide", "src"]);
    expect(listings.get("manual/guide")?.map((e) => e.name)).toEqual(["intro.md"]);
  });
});

describe("naming a new entry", () => {
  it("a new text file's name field selects the stem and keeps the extension", () => {
    expect(DEFAULT_TEXT_FILE_NAME.slice(0, stemEnd(DEFAULT_TEXT_FILE_NAME))).toBe("untitled");
    expect(stemEnd("archive.tar.gz")).toBe("archive.tar".length);
    expect(stemEnd(".env")).toBe(".env".length);
    expect(stemEnd("Makefile")).toBe("Makefile".length);
  });

  it("a typed name loses the slashes at its ends, and a slash inside creates the folders between", () => {
    expect(newEntryName("  drafts/ ")).toBe("drafts");
    expect(newEntryName("/notes.md")).toBe("notes.md");
    expect(newEntryName("2026/q4/plan.md")).toBe("2026/q4/plan.md");
    expect(newEntryName(" / ")).toBe("");
  });
});
