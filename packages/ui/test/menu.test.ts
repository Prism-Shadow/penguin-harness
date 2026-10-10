/**
 * The menu rows (src/components/overlays/menu/menu.tsx): one row family at two densities, built
 * on the menu panel's row states, taking the menu roles inside a `Menu` and none outside one.
 */
import { createElement } from "react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { ICONS } from "../src/components/icons/icons";
import {
  Menu,
  MenuItem,
  MenuLabel,
  MenuRadioItem,
  MenuSeparator,
} from "../src/components/overlays/menu/menu";
import { classTokens, renderStatic } from "../src/testing";

const inMenu = (density: "sm" | "md", ...rows: ReactElement[]) =>
  renderStatic(createElement(Menu, { label: "Workspace", density, children: rows }));

describe("Menu", () => {
  it("is a named menu whose rows are menu items", () => {
    const html = inMenu("md", createElement(MenuItem, { key: "a", label: "Rename" }));
    expect(html).toMatch(/^<div role="menu" aria-label="Workspace"/);
    expect(html).toContain('<button type="button" role="menuitem"');
    expect(html).toContain(">Rename</span>");
  });

  it("sets its rows on the body rung at md and the small rung at sm", () => {
    const md = inMenu("md", createElement(MenuItem, { key: "a", label: "Settings" }));
    const sm = inMenu("sm", createElement(MenuItem, { key: "a", label: "Copy path" }));
    expect(classTokens(md)).toContain("text-sm");
    expect(classTokens(md)).not.toContain("text-xs");
    expect(classTokens(sm)).toContain("text-xs");
    expect(classTokens(sm)).not.toContain("text-sm");
  });

  it("gives a choice its menu role and checked state", () => {
    const html = inMenu(
      "sm",
      createElement(MenuRadioItem, { key: "a", label: "By Workspace", checked: true }),
      createElement(MenuRadioItem, { key: "b", label: "By agent", checked: false }),
      createElement(MenuItem, { key: "c", label: "Wrap lines", checked: false }),
    );
    expect(html.match(/role="menuitemradio"/g)).toHaveLength(2);
    expect(html).toContain('role="menuitemradio" aria-checked="true"');
    expect(html).toContain('role="menuitemradio" aria-checked="false"');
    expect(html).toContain('role="menuitemcheckbox" aria-checked="false"');
  });

  it("rules groups apart and names them without making either a row", () => {
    const html = inMenu(
      "sm",
      createElement(MenuLabel, { key: "l", children: "Group by" }),
      createElement(MenuSeparator, { key: "s" }),
    );
    expect(html).toContain('<div role="presentation"');
    expect(html).toContain(">Group by</div>");
    expect(html).toContain('<div role="separator" class="my-1 border-t border-line-muted"></div>');
    expect(html).not.toContain("<button");
  });
});

describe("MenuItem", () => {
  const render = (props: Parameters<typeof MenuItem>[0]) =>
    renderStatic(createElement(MenuItem, props));

  it("is a plain button with no menu role outside a Menu", () => {
    const html = render({ label: "Rename", checked: true });
    expect(html).toMatch(/^<button type="button" class="/);
    expect(html).not.toContain("role=");
    expect(html).not.toContain("aria-checked");
  });

  it("takes a listbox option's role and state when its container asks for one", () => {
    const html = render({ label: "Local", role: "option", checked: true });
    expect(html).toContain('role="option" aria-selected="true"');
  });

  it("draws a registry glyph as a muted decorative mark, and a node as given", () => {
    const glyph = render({ label: "Rename", glyph: ICONS.pencil });
    expect(glyph).toContain(`d="${ICONS.pencil}"`);
    expect(glyph).toContain('data-role="menu"');
    expect(classTokens(glyph)).toEqual(expect.arrayContaining(["ui-icon-decor", "text-fg-subtle"]));
    const node = render({ label: "Me", glyph: createElement("i", { className: "avatar" }) });
    expect(node).toContain('<i class="avatar"></i>');
    expect(node).not.toContain("ui-icon-decor");
    // A false left by `cond && <X />` draws nothing, not an empty slot.
    expect(render({ label: "Plain", glyph: false })).not.toContain("shrink-0 items-center");
  });

  it("keeps the danger tone on the row and lets its glyph inherit it", () => {
    const html = render({ label: "Delete", glyph: ICONS.trash, danger: true });
    const tokens = classTokens(html);
    expect(tokens).toEqual(
      expect.arrayContaining(["text-tone-danger-fg", "hover:bg-tone-danger-bg"]),
    );
    expect(tokens).not.toContain("text-fg-subtle");
    expect(tokens).not.toContain("hover:bg-surface-muted");
  });

  it("fills and checks the current choice, and keeps the check's slot on the others", () => {
    const on = classTokens(render({ label: "A", checked: true }));
    const off = render({ label: "B", checked: false });
    expect(on).toEqual(expect.arrayContaining(["bg-surface-muted", "font-medium"]));
    expect(off).toMatch(/<span aria-hidden="true" class="[^"]*w-3[^"]*"><\/span><\/button>$/);
    // An action row carries no check slot at all.
    expect(render({ label: "C" })).not.toContain("w-3");
  });

  it("sets a description under the label and a note at the row's end, both muted", () => {
    const html = render({ label: "Read & write", description: "Edits files", trailing: "v1.2" });
    expect(html).toContain('<span class="mt-0.5 block text-xs text-fg-muted">Edits files</span>');
    expect(html).toContain('<span class="shrink-0 text-xs text-fg-subtle">v1.2</span>');
  });

  it("becomes a link for an address, and passes the caller's data attributes through", () => {
    const link = render({ label: "Download", href: "/f/a.txt", download: "a.txt" });
    expect(link).toMatch(/^<a href="\/f\/a.txt" download="a.txt"/);
    const tagged = render({ label: "Trace", "data-testid": "dock-add-trace", disabled: true });
    expect(tagged).toContain('data-testid="dock-add-trace"');
    expect(tagged).toContain('disabled=""');
  });

  it("colours only through tokens and never sets its label in mono", () => {
    const tokens = classTokens(render({ label: "Row", glyph: ICONS.pencil, checked: true }));
    expect(tokens.filter((t) => /gray|dark:|red-|white/.test(t))).toEqual([]);
    expect(tokens).not.toContain("font-mono");
  });
});
