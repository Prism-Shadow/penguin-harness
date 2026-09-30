/**
 * Button, IconButton and buttonClass: token-drawn variants with no mono label (de-slop rule 16),
 * the tooltip layer instead of a native title, a square button that is always named, and the one
 * Spinner standing in while loading.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Button, IconButton, buttonClass } from "../src/components/actions/button/button";
import type { ButtonSize, ButtonVariant } from "../src/components/actions/button/button";
import { UiStringsProvider } from "../src/strings";
import { classTokens, renderStatic } from "../src/testing";

const VARIANTS: ButtonVariant[] = ["primary", "secondary", "danger", "ghost", "link"];
const SIZES: ButtonSize[] = ["xs", "sm", "md", "icon", "icon-sm"];
const glyph = createElement("svg", { id: "glyph" });

describe("Button", () => {
  it("draws every variant in tokens, and never sets a label in mono", () => {
    for (const variant of VARIANTS) {
      for (const size of SIZES) {
        const tokens = classTokens(renderStatic(createElement(Button, { variant, size }, "Save")));
        expect(tokens).not.toContain("font-mono");
      }
    }
    const tokens = (variant: ButtonVariant) =>
      classTokens(renderStatic(createElement(Button, { variant }, "Save")));
    expect(tokens("secondary")).toEqual(
      expect.arrayContaining(["bg-surface", "text-fg", "border-line-emphasis", "rounded-control"]),
    );
    expect(tokens("danger")).toEqual(
      expect.arrayContaining([
        "text-tone-danger-fg",
        "hover:border-tone-danger-line",
        "hover:bg-tone-danger-bg",
      ]),
    );
    expect(tokens("ghost")).toEqual(expect.arrayContaining(["text-fg-muted", "hover:text-fg"]));
    // A link-button is text: the link colour, and no box around it.
    expect(tokens("link")).toEqual(expect.arrayContaining(["text-link", "hover:underline"]));
    expect(tokens("link")).not.toContain("border");
    expect(tokens("link")).not.toContain("px-3");
  });

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
        { strings: { close: "关闭", copied: "已复制", loading: "加载中…" } },
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

  it("takes the square sizes", () => {
    const md = classTokens(renderStatic(createElement(IconButton, { label: "Add" }, glyph)));
    expect(md).toContain("p-1.5");
    const sm = classTokens(
      renderStatic(createElement(IconButton, { label: "Add", size: "sm" }, glyph)),
    );
    expect(sm).toContain("p-1");
  });
});

describe("buttonClass", () => {
  it("is the Button look on a label, with a pointer and the focus of the input inside", () => {
    const label = buttonClass("secondary", "sm").split(/\s+/);
    const button = classTokens(
      renderStatic(createElement(Button, { variant: "secondary", size: "sm" }, "Upload")),
    );
    for (const token of ["bg-surface", "border-line-emphasis", "px-2.5", "text-xs"]) {
      expect(label).toContain(token);
      expect(button).toContain(token);
    }
    expect(label).toContain("cursor-pointer");
    expect(label).toContain("has-[:focus-visible]:[outline:var(--ui-focus-ring)]");
    expect(label).not.toContain("font-mono");
  });
});
