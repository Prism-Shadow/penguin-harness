/**
 * handbook-tree.ts unit tests: the listing shaped into the pinned index and a nested explorer
 * tree (folders before files at every level, each group ordered case-insensitively, the index
 * apart); the walking the tree view does — the folders above a document, the rows an expanded
 * set makes visible, how many documents a subtree holds; the path rule mirrored from the
 * server; what the new-document dialog sends for what was typed; the body a new document
 * starts with; and how a relative link inside a document resolves to another document.
 */
import { describe, expect, it } from "vitest";
import type { OrgHandbookFile } from "@prismshadow/penguin-server/api";
import {
  HANDBOOK_INDEX,
  ancestorFolders,
  buildHandbookTree,
  completeHandbookPath,
  countDocuments,
  fileName,
  flattenVisible,
  isHandbookPath,
  isMarkdownPath,
  newDocumentBody,
  resolveHandbookLink,
} from "../src/features/company/handbook-tree";
import type { HandbookNode } from "../src/features/company/handbook-tree";

const file = (path: string, size = 10): OrgHandbookFile => ({
  path,
  size,
  updatedAt: "2026-09-02T10:00:00.000Z",
});

/** A node's path prefixed by its kind, so an assertion reads as the tree's shape. */
const shape = (nodes: readonly HandbookNode[]): string[] =>
  nodes.flatMap((n) =>
    n.kind === "folder" ? [`dir ${n.path}`, ...shape(n.children)] : [`doc ${n.path}`],
  );

const MIXED = [
  file("README.md"),
  file("decisions/2026/09/plan.md"),
  file("decisions/2026-09-02-hire-plan.md"),
  file("conventions.md"),
  file("decisions/2026-09-01-mission.md"),
  file("roles/hr.md"),
  file("Brand.md"),
];

describe("buildHandbookTree", () => {
  it("nests every path, folders before files at each level, with the index apart", () => {
    const tree = buildHandbookTree(MIXED);
    expect(tree.index?.path).toBe(HANDBOOK_INDEX);
    expect(shape(tree.nodes)).toEqual([
      "dir decisions",
      "dir decisions/2026",
      "dir decisions/2026/09",
      "doc decisions/2026/09/plan.md",
      "doc decisions/2026-09-01-mission.md",
      "doc decisions/2026-09-02-hire-plan.md",
      "dir roles",
      "doc roles/hr.md",
      "doc Brand.md",
      "doc conventions.md",
    ]);
    // A row carries its own name for display and the whole path for selection.
    const decisions = tree.nodes[0]!;
    expect(decisions.kind === "folder" && decisions.name).toBe("decisions");
    const brand = tree.nodes[2]!;
    expect(brand.kind === "file" && brand.name).toBe("Brand.md");
    expect(brand.kind === "file" && brand.file.size).toBe(10);
  });

  it("orders each level case-insensitively, case deciding only a tie", () => {
    const tree = buildHandbookTree([file("beta.md"), file("Alpha.md"), file("alpha.md")]);
    expect(shape(tree.nodes)).toEqual(["doc Alpha.md", "doc alpha.md", "doc beta.md"]);
  });

  it("ignores the order the listing came in, and copes with a missing index", () => {
    const tree = buildHandbookTree([file("z.md"), file("a.md"), file("m/x.md"), file("b/y.md")]);
    expect(tree.index).toBeNull();
    expect(shape(tree.nodes)).toEqual([
      "dir b",
      "doc b/y.md",
      "dir m",
      "doc m/x.md",
      "doc a.md",
      "doc z.md",
    ]);
  });

  it("is empty but for the index when the handbook holds nothing else", () => {
    const tree = buildHandbookTree([file("README.md")]);
    expect(tree.index).not.toBeNull();
    expect(tree.nodes).toEqual([]);
  });
});

describe("ancestorFolders", () => {
  it("names the folders above a document, root first", () => {
    expect(ancestorFolders("decisions/2026/09/plan.md")).toEqual([
      "decisions",
      "decisions/2026",
      "decisions/2026/09",
    ]);
    expect(ancestorFolders("conventions.md")).toEqual([]);
    expect(ancestorFolders(HANDBOOK_INDEX)).toEqual([]);
  });
});

describe("flattenVisible", () => {
  const tree = buildHandbookTree(MIXED);

  it("shows only the top level while everything is collapsed", () => {
    const rows = flattenVisible(tree.nodes, new Set());
    expect(rows.map((r) => r.node.path)).toEqual([
      "decisions",
      "roles",
      "Brand.md",
      "conventions.md",
    ]);
    expect(rows.every((r) => r.depth === 0)).toBe(true);
  });

  it("walks an expanded folder's children in place, one level deeper", () => {
    const rows = flattenVisible(tree.nodes, new Set(["decisions", "decisions/2026"]));
    expect(rows.map((r) => `${r.depth} ${r.node.path}`)).toEqual([
      "0 decisions",
      "1 decisions/2026",
      "2 decisions/2026/09",
      "1 decisions/2026-09-01-mission.md",
      "1 decisions/2026-09-02-hire-plan.md",
      "0 roles",
      "0 Brand.md",
      "0 conventions.md",
    ]);
  });

  it("keeps a folder's children hidden while the folder above it is closed", () => {
    const rows = flattenVisible(tree.nodes, new Set(["decisions/2026"]));
    expect(rows.map((r) => r.node.path)).toEqual([
      "decisions",
      "roles",
      "Brand.md",
      "conventions.md",
    ]);
  });
});

describe("countDocuments", () => {
  it("counts the documents of a subtree however deep, folders themselves counting for none", () => {
    const tree = buildHandbookTree(MIXED);
    expect(countDocuments(tree.nodes)).toBe(6);
    const decisions = tree.nodes[0]!;
    expect(decisions.kind === "folder" ? countDocuments(decisions.children) : -1).toBe(3);
    expect(countDocuments([])).toBe(0);
  });
});

describe("isHandbookPath", () => {
  it("accepts plain segments joined by slashes", () => {
    for (const rel of [
      "README.md",
      "conventions.md",
      "decisions/2026-09-02-hire-plan.md",
      "a/b/c/d/e/f/g/h.md",
      "notes.v2",
      "2026",
    ]) {
      expect(isHandbookPath(rel), rel).toBe(true);
    }
  });

  it("refuses hidden files, traversal, empty segments, other characters and a ninth level", () => {
    for (const rel of [
      "",
      ".hidden.md",
      "decisions/.draft.md",
      "../org_config.toml",
      "a/../b.md",
      "/abs.md",
      "a//b.md",
      "a/",
      "hire plan.md",
      "notes:1.md",
      "a/b/c/d/e/f/g/h/i.md",
    ]) {
      expect(isHandbookPath(rel), rel).toBe(false);
    }
  });
});

describe("completeHandbookPath", () => {
  it("trims, drops a leading ./ or / and a trailing /, and adds .md when the name has no extension", () => {
    expect(completeHandbookPath("  decisions/hire-plan  ")).toBe("decisions/hire-plan.md");
    expect(completeHandbookPath("./conventions.md")).toBe("conventions.md");
    expect(completeHandbookPath("/roles/hr")).toBe("roles/hr.md");
    expect(completeHandbookPath("roles/")).toBe("roles.md");
  });

  it("leaves a name with an extension alone, and an empty input empty", () => {
    expect(completeHandbookPath("notes.txt")).toBe("notes.txt");
    expect(completeHandbookPath("notes.v2")).toBe("notes.v2");
    expect(completeHandbookPath("   ")).toBe("");
  });
});

describe("file names and bodies", () => {
  it("names a file by its last segment and renders Markdown by extension", () => {
    expect(fileName("decisions/2026-09-02-hire-plan.md")).toBe("2026-09-02-hire-plan.md");
    expect(fileName("README.md")).toBe("README.md");
    expect(isMarkdownPath("README.md")).toBe(true);
    expect(isMarkdownPath("notes.MARKDOWN")).toBe(true);
    expect(isMarkdownPath("notes.txt")).toBe(false);
    expect(isMarkdownPath("2026")).toBe(false);
  });

  it("starts a new document with a title made of its file name", () => {
    expect(newDocumentBody("decisions/2026-09-02-hire-plan.md")).toBe("# 2026-09-02-hire-plan\n");
    expect(newDocumentBody("notes.v2")).toBe("# notes\n");
  });
});

describe("resolveHandbookLink", () => {
  it("resolves a relative link against the linking document's folder", () => {
    expect(resolveHandbookLink("README.md", "decisions/hire-plan.md")).toBe(
      "decisions/hire-plan.md",
    );
    expect(resolveHandbookLink("README.md", "./conventions.md")).toBe("conventions.md");
    expect(resolveHandbookLink("decisions/hire-plan.md", "../conventions.md")).toBe(
      "conventions.md",
    );
    expect(resolveHandbookLink("decisions/hire-plan.md", "mission.md")).toBe(
      "decisions/mission.md",
    );
    expect(resolveHandbookLink("decisions/hire-plan.md", "/roles/hr.md")).toBe("roles/hr.md");
  });

  it("drops a fragment or query, and decodes the path", () => {
    expect(resolveHandbookLink("README.md", "conventions.md#naming")).toBe("conventions.md");
    expect(resolveHandbookLink("README.md", "conventions.md?x=1")).toBe("conventions.md");
    expect(resolveHandbookLink("README.md", "hire%2Dplan.md")).toBe("hire-plan.md");
  });

  it("is null for anything that is not a document of the handbook", () => {
    for (const href of [
      "",
      "#top",
      "https://example.com/README.md",
      "mailto:ceo@example.com",
      "//example.com/x.md",
      "../org_config.toml",
      "../../etc/passwd",
      ".hidden.md",
      "%E0%A4%A",
    ]) {
      expect(resolveHandbookLink("README.md", href), href).toBeNull();
    }
    expect(resolveHandbookLink("decisions/plan.md", "../../out.md")).toBeNull();
  });
});
