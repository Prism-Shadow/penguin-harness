/**
 * Button, IconButton and buttonClass: token-drawn variants with no mono label (de-slop rule 16),
 * the tooltip layer instead of a native title, a square button that is always named, and the one
 * Spinner standing in while loading.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Button, IconButton, buttonClass } from "../src/components/actions/button/button";
import { DEFAULT_UI_STRINGS, UiStringsProvider } from "../src/strings";
import { classTokens, renderStatic } from "../src/testing";

const glyph = createElement("svg", { id: "glyph" });

describe("Button", () => {
  it("shows its title through the tooltip layer, and names a square button by it", () => {
    const text = renderStatic(createElement(Button, { title: "Save the draft" }, "Save"));
    expect(text).toContain('data-tooltip="Save the draft"');
    expect(text).not.toContain("title=");
    expect(text).not.toContain("aria-label=");
    const square = renderStatic(createElement(Button, { size: "icon", title: "Add" }, glyph));
    expect(square).toContain('aria-label="Add"');
  });

  it("puts the leading mark before the label", () => {
    const html = renderStatic(createElement(Button, { leading: glyph }, "New"));
    expect(html.indexOf('id="glyph"')).toBeLessThan(html.indexOf("New"));
  });

  it("stands the spinner in for the leading mark while loading, busy and disabled", () => {
    const html = renderStatic(createElement(Button, { loading: true, leading: glyph }, "Save"));
    expect(html).toMatch(/^<button type="button" aria-busy="true" disabled=""/);
    expect(html).toContain('role="status" aria-label="Loading…"');
    expect(html).not.toContain('id="glyph"');
    expect(html).toContain("Save");
    // The caller's word first, the injected fallback next.
    const named = renderStatic(
      createElement(Button, { loading: true, loadingLabel: "Saving the draft" }, "Save"),
    );
    expect(named).toContain('aria-label="Saving the draft"');
    const injected = renderStatic(
      createElement(
        UiStringsProvider,
        { strings: { ...DEFAULT_UI_STRINGS, close: "关闭", copied: "已复制", loading: "加载中…" } },
        createElement(Button, { loading: true }, "保存"),
      ),
    );
    expect(injected).toContain('aria-label="加载中…"');
  });

  it("keeps one mark in a square: the spinner replaces the glyph", () => {
    const html = renderStatic(
      createElement(Button, { size: "icon", "aria-label": "Add", loading: true }, glyph),
    );
    expect(html).toContain('role="status"');
    expect(html).not.toContain('id="glyph"');
  });
});

describe("IconButton", () => {
  it("is named and tooltipped by its required label, or by a shorter title", () => {
    const html = renderStatic(createElement(IconButton, { label: "Delete notes.md" }, glyph));
    expect(html).toContain('aria-label="Delete notes.md"');
    expect(html).toContain('data-tooltip="Delete notes.md"');
    const titled = renderStatic(
      createElement(IconButton, { label: "Delete notes.md", title: "Delete" }, glyph),
    );
    expect(titled).toContain('aria-label="Delete notes.md"');
    expect(titled).toContain('data-tooltip="Delete"');
  });
});

describe("buttonClass", () => {
  it("is the Button look on a label, with the focus of the input inside", () => {
    const label = buttonClass("secondary", "sm").split(/\s+/);
    const button = classTokens(
      renderStatic(createElement(Button, { variant: "secondary", size: "sm" }, "Upload")),
    );
    for (const token of ["bg-control", "border-line-emphasis", "px-2.5", "text-xs"]) {
      expect(label).toContain(token);
      expect(button).toContain(token);
    }
    expect(label).toContain("has-[:focus-visible]:[outline:var(--ui-focus-ring)]");
  });
});
