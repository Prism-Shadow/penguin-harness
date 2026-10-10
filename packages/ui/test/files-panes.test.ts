/**
 * The Files panel's panes and its drop feedback (src/components/files): the tree pane's header
 * and the one state its body says, the preview pane's views with the pill and the editor over
 * the body, and the drop overlay as pure, hidden feedback in its two shapes.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { DropOverlay } from "../src/components/files/drop-overlay/drop-overlay";
import { PreviewPane } from "../src/components/files/preview-pane/preview-pane";
import type {
  PreviewPaneProps,
  PreviewView,
} from "../src/components/files/preview-pane/preview-pane";
import { TreePane } from "../src/components/files/tree-pane/tree-pane";
import type { TreePaneProps } from "../src/components/files/tree-pane/tree-pane";
import { classTokens, renderStatic } from "../src/testing";

const search = { value: "", onChange: () => undefined, placeholder: "Search files" };
const tree = createElement("div", { role: "tree" }, "rows");

describe("TreePane", () => {
  it("heads the tree with its search box, named by its placeholder, and the caller's actions", () => {
    const html = renderStatic(
      createElement(TreePane, {
        search,
        actions: createElement("button", { type: "button" }, "Refresh"),
        children: tree,
      }),
    );
    expect(html).toContain('placeholder="Search files"');
    expect(html).toContain('aria-label="Search files"');
    expect(html.indexOf("Search files")).toBeLessThan(html.indexOf(">Refresh<"));
    expect(html).toContain('role="tree"');
  });

  it("says the first of: a failure, a first load, a pending search — and only then the tree", () => {
    const pane = (props: Partial<TreePaneProps>) =>
      renderStatic(createElement(TreePane, { search, children: tree, ...props }));
    const failed = pane({ error: "Could not list", loading: true, pending: "Searching…" });
    expect(failed).toContain(">Could not list</p>");
    expect(failed).not.toContain("rows");
    expect(classTokens(failed)).toContain("text-tone-danger-fg");
    expect(pane({ loading: true, pending: "Searching…" })).not.toContain("Searching…");
    const waiting = pane({ pending: "Searching…" });
    expect(waiting).toContain(">Searching…</p>");
    expect(waiting).not.toContain('role="tree"');
    const cut = pane({ note: "Showing the first 200" });
    expect(cut).toContain('role="tree"');
    expect(cut).toContain(">Showing the first 200</p>");
  });
});

describe("PreviewPane", () => {
  const pane = (view: PreviewView, props: Partial<PreviewPaneProps> = {}) =>
    renderStatic(createElement(PreviewPane, { view, ...props }));

  it("shows the empty state's title and action while nothing is chosen", () => {
    const html = pane({
      kind: "empty",
      title: "Select a file to preview",
      action: createElement("button", { type: "button" }, "Show tree"),
    });
    expect(html).toContain(">Select a file to preview</p>");
    expect(html).toContain(">Show tree</button>");
  });

  it("sets source flush on the code surface, and pads every other body", () => {
    const source = pane({ kind: "source", code: "let a = 1;", language: "ts", wrap: false });
    expect(source).toContain('tabindex="-1"');
    expect(source).not.toMatch(/tabindex="-1" class="[^"]*\bp-3\b/);
    const unsupported = pane({ kind: "unsupported", message: "No preview for this type" });
    expect(unsupported).toMatch(/tabindex="-1" class="[^"]*\bp-3\b/);
    expect(unsupported).toContain(">No preview for this type</p>");
  });

  it("notes a cut-short file under the text", () => {
    const html = pane({
      kind: "source",
      code: "x",
      language: "text",
      wrap: true,
      truncatedNote: "Preview truncated",
    });
    expect(html).toContain(">… Preview truncated</p>");
  });

  it("pins the caller's actions in a pill over the body, and keeps them over the editor", () => {
    const actions = createElement("button", { type: "button" }, "Wrap");
    const view: PreviewView = { kind: "source", code: "x", language: "text", wrap: false };
    const reading = pane(view, { actions });
    expect(reading).toContain(">Wrap</button>");
    expect(classTokens(reading)).toEqual(
      expect.arrayContaining(["absolute", "right-4", "top-2.5", "bg-surface", "border-line"]),
    );
    const editing = pane(view, {
      actions,
      editor: createElement("textarea", { "aria-label": "Editing a" }),
    });
    expect(editing).toContain('aria-label="Editing a"');
    expect(editing).toContain(">Wrap</button>");
    // The editor replaces the body, so the body's own box is gone.
    expect(editing).not.toContain('tabindex="-1"');
  });
});

describe("DropOverlay", () => {
  it("is hidden, pointer-transparent feedback carrying the caller's words", () => {
    const veil = renderStatic(
      createElement(DropOverlay, {
        glyph: "M0 0h24",
        title: "Drop files to attach",
        description: "Images and files are added to the message draft",
      }),
    );
    expect(veil).toMatch(/^<div aria-hidden="true" class="[^"]*pointer-events-none/);
    expect(veil).toContain(">Drop files to attach</p>");
    expect(veil).toContain(">Images and files are added to the message draft</p>");
    expect(classTokens(veil)).toEqual(expect.arrayContaining(["border-dashed", "z-50"]));
  });

  it("frames a panel with its label at the foot", () => {
    const frame = renderStatic(
      createElement(DropOverlay, { variant: "frame", glyph: "M0 0h24", title: "Drop into src" }),
    );
    expect(frame).toMatch(/^<div aria-hidden="true" class="[^"]*pointer-events-none/);
    expect(frame).toContain(">Drop into src</span>");
    expect(classTokens(frame)).toEqual(expect.arrayContaining(["items-end", "z-20"]));
    expect(frame).not.toMatch(/gray-|white|dark:|backdrop-blur/);
  });
});
