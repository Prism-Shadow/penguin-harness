/**
 * The Files panel's file menu rows and its in-place editor.
 *
 * - The rows say the caller's words and differ by what the entry is: a folder offers new text
 *   files and folders inside it, an upload and a rename, never a download; a file offers its
 *   download, then rename and delete, delete in danger; the New menu alone offers the two New rows.
 * - The editor's textarea takes its name from the caller over the code surface it shares with
 *   the source view, in a scroll box that reserves the same scrollbar gutter as the preview's.
 * - When the text is replaced from outside, the caret keeps its line and column, pulled back to
 *   the last line and the end of its line where the new text is shorter; the opening caret sits
 *   at the start of the line in view.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { WorkspaceFileEditor } from "../src/components/content/workspace-file-editor/workspace-file-editor";
import {
  caretAfterReplace,
  lineStartOffset,
} from "../src/components/content/workspace-file-editor/caret";
import {
  WorkspaceFileMenuRows,
  WorkspaceNewMenuRows,
} from "../src/components/files/workspace-file-menu/workspace-file-menu";
import type { FileMenuTarget } from "../src/components/files/workspace-file-menu/workspace-file-menu";
import { renderStatic } from "../src/testing";

const LABELS = {
  copyPath: "Copy relative path",
  addToChat: "Add to conversation",
  addSelectionToChat: "Add selection to conversation",
  uploadHere: "Upload here",
  download: "Download",
  rename: "Rename or move",
  delete: "Delete",
  newTextFile: "New text file",
  newFolder: "New folder",
};
const noop = () => undefined;

const rows = (
  target: FileMenuTarget,
  extra: Partial<Parameters<typeof WorkspaceFileMenuRows>[0]> = {},
) =>
  renderStatic(
    createElement(WorkspaceFileMenuRows, {
      target,
      labels: LABELS,
      downloadHref: (path: string) => `/files/${path}?download=1`,
      downloadName: (path: string) => path.slice(path.lastIndexOf("/") + 1),
      onCopyPath: noop,
      onAddToChat: noop,
      onUploadInto: noop,
      onClose: noop,
      ...extra,
    }),
  );

describe("WorkspaceFileMenuRows", () => {
  it("offers a folder new files and folders inside it, an upload and a rename, and no download", () => {
    const html = rows(
      { path: "src", kind: "dir" },
      { onNewFile: noop, onNewFolder: noop, onRename: noop, onDelete: noop },
    );
    expect(html).toContain('role="menu"');
    expect(html).toContain(">Copy relative path</span>");
    expect(html.indexOf(">New text file<")).toBeLessThan(html.indexOf(">New folder<"));
    expect(html.indexOf(">New folder<")).toBeLessThan(html.indexOf(">Upload here<"));
    expect(html.indexOf(">Upload here<")).toBeLessThan(html.indexOf(">Rename or move<"));
    expect(html).not.toContain("Download");
    expect(html).not.toContain(">Delete<");
  });

  it("the New menu alone offers the two New rows", () => {
    const html = renderStatic(
      createElement(WorkspaceNewMenuRows, { labels: LABELS, onNewFile: noop, onNewFolder: noop }),
    );
    expect(html).toContain('role="menu"');
    expect(html.indexOf(">New text file<")).toBeLessThan(html.indexOf(">New folder<"));
    expect(html).not.toContain("Copy relative path");
  });

  it("offers a file its download as a link, and its rename and delete last, delete in danger", () => {
    const html = rows(
      { path: "src/rag.ts", kind: "file" },
      { onRename: noop, onDelete: noop, onAddSelection: noop },
    );
    expect(html).toContain('href="/files/src/rag.ts?download=1"');
    expect(html).toContain('download="rag.ts"');
    expect(html).toContain(">Add selection to conversation</span>");
    expect(html).not.toContain("Upload here");
    expect(html.indexOf(">Download<")).toBeLessThan(html.indexOf(">Rename or move<"));
    expect(html.indexOf(">Rename or move<")).toBeLessThan(html.indexOf(">Delete<"));
    expect(html).toMatch(/text-tone-danger-fg[^>]*>(?:(?!<\/button>).)*>Delete</);
  });
});

describe("WorkspaceFileEditor", () => {
  it("names its textarea from the caller and follows the wrap toggle", () => {
    const render = (wrap: boolean) =>
      renderStatic(
        createElement(WorkspaceFileEditor, {
          path: "src/rag.ts",
          value: "export {};",
          label: "Editing rag.ts",
          wrap,
          onChange: noop,
          onSave: noop,
        }),
      );
    const html = render(false);
    expect(html).toContain('aria-label="Editing rag.ts"');
    expect(html).toContain('spellCheck="false"');
    expect(html).toContain('wrap="off"');
    expect(html).toContain("code-editor-host");
    expect(html).toContain("[scrollbar-gutter:stable]");
    expect(render(true)).toContain('wrap="soft"');
  });

  it("an outside rewrite keeps the caret on its line and column", () => {
    const before = "alpha\nbeta\ngamma\n";
    const caret = before.indexOf("mma"); // line 2, column 2
    const after = "alpha\nBETA, rewritten\ngamma ray\ndelta\n";
    expect(caretAfterReplace(before, after, caret)).toBe(after.indexOf("mma ray"));
  });

  it("a shorter rewrite pulls the caret back to the end of its line and to the last line", () => {
    const before = "one\nsecond line\nthird\n";
    expect(caretAfterReplace(before, "one\nsec\nthird\n", before.indexOf("line"))).toBe(
      "one\nsec".length,
    );
    expect(caretAfterReplace(before, "only", before.indexOf("third"))).toBe(0);
    expect(caretAfterReplace(before, "", before.length)).toBe(0);
  });

  it("the opening caret sits at the start of the line in view", () => {
    const text = "a\nbb\nccc";
    expect(lineStartOffset(text, 0)).toBe(0);
    expect(lineStartOffset(text, 2)).toBe(text.indexOf("ccc"));
    expect(lineStartOffset(text, 9)).toBe(text.indexOf("ccc"));
  });
});
