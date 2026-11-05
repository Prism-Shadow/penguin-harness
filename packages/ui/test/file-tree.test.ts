/**
 * The file tree (src/components/files/file-tree/file-tree.tsx): the WAI-ARIA tree shape over the
 * caller's flat rows, the attributes a caller's hit test resolves a row by, an open directory's
 * children nested in a group, the caller's words for an empty directory, and inks from tokens.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { FileTree } from "../src/components/files/file-tree/file-tree";
import type { FileTreeRow } from "../src/components/files/file-tree/tree-rows";
import { classTokens, renderStatic } from "../src/testing";

const row = (
  path: string,
  kind: "dir" | "file",
  depth: number,
  posInSet: number,
  setSize: number,
  extra: Partial<FileTreeRow> = {},
): FileTreeRow => ({
  path,
  name: path.slice(path.lastIndexOf("/") + 1),
  kind,
  depth,
  posInSet,
  setSize,
  expanded: false,
  loaded: kind === "file",
  empty: false,
  ...extra,
});

const ROWS: FileTreeRow[] = [
  row("src", "dir", 0, 1, 3, { expanded: true, loaded: true }),
  row("src/rag.ts", "file", 1, 1, 2),
  row("src/empty", "dir", 1, 2, 2, { expanded: true, loaded: true, empty: true }),
  row("docs", "dir", 0, 2, 3),
  row("README.md", "file", 0, 3, 3),
];

const render = (props: Partial<Parameters<typeof FileTree<FileTreeRow>>[0]> = {}) =>
  renderStatic(
    createElement(FileTree<FileTreeRow>, {
      rows: ROWS,
      label: "Workspace",
      selectedPath: "src/rag.ts",
      emptyLabel: "Empty directory",
      onToggleDir: () => undefined,
      onOpenFile: () => undefined,
      ...props,
    }),
  );

describe("FileTree", () => {
  it("is a named tree whose rows state their level, place in their set and state", () => {
    const html = render();
    expect(html).toContain('role="tree" aria-label="Workspace"');
    expect(html.match(/role="treeitem"/g)).toHaveLength(ROWS.length);
    expect(html).toContain(
      'aria-level="2" aria-posinset="1" aria-setsize="2" aria-selected="true"',
    );
    expect(html).toMatch(/aria-selected="false" aria-expanded="true"[^>]*data-tree-path="src"/);
    expect(html).toContain('data-tree-path="README.md" data-tree-kind="file"');
    // The selected row is the one tab stop.
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toMatch(/tabindex="0"[^>]*data-tree-path="src\/rag.ts"/);
  });

  it("nests an open directory's rows in a named group, and says an empty one is empty", () => {
    const html = render();
    expect(html).toContain('role="group" aria-label="src"');
    expect(html).toContain('role="group" aria-label="empty"');
    expect(html).toContain(">Empty directory</p>");
    // A closed directory draws no group.
    expect(html).not.toContain('aria-label="docs"');
  });

  it("rings the folder a drag would drop into in the info tone, and takes every ink from tokens", () => {
    const html = render({ dropTargetDir: "docs" });
    const tokens = classTokens(html);
    expect(tokens).toEqual(
      expect.arrayContaining(["bg-tone-info-bg", "ring-tone-info-emphasis/60", "text-fg"]),
    );
    expect(html).not.toMatch(/gray-|sky-|dark:/);
  });

  it("shows the caller's empty state in place of rows when there are none", () => {
    const html = render({ rows: [], children: createElement("p", null, "No files") });
    expect(html).toContain(">No files</p>");
    expect(html).not.toContain("treeitem");
  });
});
