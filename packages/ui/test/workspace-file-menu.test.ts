/**
 * The Files panel's file menu rows and its in-place editor: the rows say the caller's words and
 * differ by what the entry is, and the editor's textarea takes its name from the caller over the
 * code surface it shares with the source view.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { WorkspaceFileEditor } from "../src/components/content/workspace-file-editor/workspace-file-editor";
import { WorkspaceFileMenuRows } from "../src/components/files/workspace-file-menu/workspace-file-menu";
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
  it("offers a folder an upload, and no download", () => {
    const html = rows({ path: "src", kind: "dir" });
    expect(html).toContain('role="menu"');
    expect(html).toContain(">Copy relative path</span>");
    expect(html).toContain(">Upload here</span>");
    expect(html).not.toContain("Download");
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
    expect(render(true)).toContain('wrap="soft"');
  });
});
