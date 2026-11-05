/**
 * The menu rows (src/components/overlays/menu/menu.tsx): one row family at two densities, built
 * on the menu panel's row states, taking the menu roles inside a `Menu` and none outside one.
 * `MenuRow` is the same row drawing the marks its caller hands it.
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
  MenuRow,
  MenuSeparator,
} from "../src/components/overlays/menu/menu";
import { classTokens, renderStatic, markupStructure } from "../src/testing";

const inMenu = (density: "sm" | "md", ...rows: ReactElement[]) =>
  renderStatic(createElement(Menu, { label: "Workspace", density, children: rows }));

describe("Menu", () => {
  it("is a named menu whose rows are menu items", () => {
    const html = inMenu("md", createElement(MenuItem, { key: "a", label: "Rename" }));
    expect(html).toMatch(/^<div role="menu" aria-label="Workspace"/);
    expect(html).toContain('<button type="button" role="menuitem"');
    expect(html).toContain(">Rename</span>");
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
    expect(markupStructure(html)).toContain('<div role="separator"></div>');
    expect(html).not.toContain("<button");
  });
});

describe("MenuItem", () => {
  const render = (props: Parameters<typeof MenuItem>[0]) =>
    renderStatic(createElement(MenuItem, props));

  it("is a plain button with no menu role outside a Menu", () => {
    const html = render({ label: "Rename", checked: true });
    expect(html).toMatch(/^<button type="button" /);
    expect(html).not.toContain("role=");
    expect(html).not.toContain("aria-checked");
  });

  it("takes a listbox option's role and state when its container asks for one", () => {
    const html = render({ label: "Local", role: "option", checked: true });
    expect(html).toContain('role="option" aria-selected="true"');
  });

  it("draws a registry glyph as a decorative mark, and a node as given", () => {
    const glyph = render({ label: "Rename", glyph: ICONS.pencil });
    expect(glyph).toContain(`d="${ICONS.pencil}"`);
    expect(glyph).toContain('data-role="menu"');
    expect(classTokens(glyph)).toContain("ui-icon-decor");
    const node = render({ label: "Me", glyph: createElement("i", { className: "avatar" }) });
    expect(node).toContain('<i class="avatar"></i>');
    expect(node).not.toContain("ui-icon-decor");
  });

  it("keeps the check's slot on a row that is not the current choice, and none on an action row", () => {
    const slot = /<span aria-hidden="true"[^>]*><\/span><\/button>$/;
    expect(render({ label: "B", checked: false })).toMatch(slot);
    expect(render({ label: "C" })).not.toMatch(slot);
  });

  it("sets a description under the label and a note at the row's end", () => {
    const html = render({ label: "Read & write", description: "Edits files", trailing: "v1.2" });
    expect(markupStructure(html)).toContain("<span>Edits files</span>");
    expect(markupStructure(html)).toContain("<span>v1.2</span>");
  });

  it("becomes a link for an address, and passes the caller's data attributes through", () => {
    const link = render({ label: "Download", href: "/f/a.txt", download: "a.txt" });
    expect(link).toMatch(/^<a href="\/f\/a.txt" download="a.txt"/);
    const tagged = render({ label: "Trace", "data-testid": "dock-add-trace", disabled: true });
    expect(tagged).toContain('data-testid="dock-add-trace"');
    expect(tagged).toContain('disabled=""');
  });
});

describe("MenuRow", () => {
  const row = (checked: boolean) =>
    inMenu(
      "md",
      createElement(MenuRow, {
        key: "a",
        label: "English",
        role: "menuitemradio",
        checked,
        lead: createElement("i", { className: "lead" }),
        check: createElement("b", { className: "mark" }),
      }),
    );

  it("draws the caller's lead, and the caller's check on the current choice only", () => {
    const on = row(true);
    expect(on).toContain('role="menuitemradio" aria-checked="true"');
    expect(on).toContain('<i class="lead"></i>');
    expect(on).toMatch(
      /<span aria-hidden="true" class="[^"]*w-3[^"]*"><b class="mark"><\/b><\/span>/,
    );
    // Nothing of the theme icon sets comes with the row itself.
    expect(on).not.toContain("ui-glyph");
    expect(row(false)).toMatch(/<span aria-hidden="true" class="[^"]*w-3[^"]*"><\/span><\/button>/);
  });
});
