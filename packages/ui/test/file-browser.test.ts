/**
 * The read-only file browser (src/components/files/file-browser/file-browser.tsx): the tree
 * beside one preview, every word it draws on its own from the caller, and Markdown through the
 * shared reader with its frontmatter dropped on request.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { FileBrowser } from "../src/components/files/file-browser/file-browser";
import type {
  FileBrowserPreview,
  FileBrowserProps,
} from "../src/components/files/file-browser/file-browser";
import type { FileTreeRow } from "../src/components/files/file-tree/tree-rows";
import { classTokens, renderStatic } from "../src/testing";

const ROWS: FileTreeRow[] = [
  {
    path: "SKILL.md",
    name: "SKILL.md",
    kind: "file",
    depth: 0,
    posInSet: 1,
    setSize: 1,
    expanded: false,
    loaded: true,
    empty: false,
  },
];

const render = (
  preview: FileBrowserPreview | null,
  extra: Partial<FileBrowserProps<FileTreeRow>> = {},
) =>
  renderStatic(
    createElement(FileBrowser<FileTreeRow>, {
      rows: ROWS,
      treeLabel: "Plugin files",
      selectedPath: preview?.path ?? null,
      headerFallback: "docs-expert",
      preview,
      emptyPreview: "Nothing selected",
      emptyDirLabel: "Nothing here",
      truncatedLabel: "Cut short",
      unsupportedLabel: "Cannot show this",
      downloadLabel: "Save",
      onToggleDir: () => undefined,
      onOpenFile: () => undefined,
      ...extra,
    }),
  );

describe("FileBrowser", () => {
  it("names the tree and the header from the caller while nothing is open", () => {
    const html = render(null);
    expect(html).toContain('role="tree" aria-label="Plugin files"');
    expect(html).toContain(">docs-expert</p>");
    expect(html).toContain(">Nothing selected</p>");
  });

  it("says the caller's words for a cut-short file, an unsupported one and the download", () => {
    const cut = render({
      path: "notes.txt",
      name: "notes.txt",
      kind: "text",
      content: "a",
      truncated: true,
      downloadUrl: "/files/notes.txt",
    });
    expect(cut).toContain(">Cut short</p>");
    expect(cut).toContain('download="notes.txt"');
    expect(cut).toContain(">Save</a>");
    const odd = render({ path: "blob.bin", name: "blob.bin", kind: "unsupported" });
    expect(odd).toContain(">Cannot show this</p>");
  });

  it("reads Markdown in the reading box, dropping frontmatter when asked", () => {
    const md: FileBrowserPreview = {
      path: "SKILL.md",
      name: "SKILL.md",
      kind: "md",
      content: "---\nname: docs\n---\n# Docs Expert\n",
    };
    const stripped = render(md, { stripFrontmatter: true });
    expect(stripped).toContain("md-body");
    expect(stripped).toContain("Docs Expert</h1>");
    expect(stripped).not.toContain("name: docs");
    expect(render(md)).toContain("name: docs");
  });

  it("frames itself in tokens", () => {
    const html = render(null);
    expect(classTokens(html)).toEqual(expect.arrayContaining(["border-line", "rounded-md"]));
    expect(html).not.toMatch(/gray-|red-|dark:/);
  });
});
