/**
 * NavList and NavRow (src/components/navigation/nav-list/nav-list.tsx): a named navigation whose
 * current row is the page, whose glyphs are decoration, whose labels are never mono, and whose
 * rows follow the list's orientation.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ICONS } from "../src/components/icons/icons";
import { NavList, NavRow, navRowClass } from "../src/components/navigation/nav-list/nav-list";
import { classTokens, renderStatic } from "../src/testing";

const list = (orientation: "vertical" | "responsive" = "vertical") =>
  renderStatic(
    createElement(
      NavList,
      { label: "Project settings", orientation },
      createElement(NavRow, { label: "General", glyph: ICONS.gear, active: true }),
      createElement(NavRow, { label: "Members", badge: createElement("span", null, "3") }),
      createElement(NavRow, { label: "Billing", disabled: true }),
    ),
  );

describe("NavList", () => {
  it("is a navigation named by its label, with exactly one current row", () => {
    const html = list();
    expect(html).toMatch(/^<nav aria-label="Project settings" class="flex flex-col gap-1 /);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*><span aria-hidden="true" class="ui-icon-decor /);
  });

  it("marks the glyph as a nav decoration and keeps labels in the text face", () => {
    const html = list();
    expect(html).toMatch(
      /<span aria-hidden="true" class="ui-icon-decor shrink-0 text-fg-subtle" data-role="nav"( data-tint="[a-z]+")?><svg/,
    );
    expect(classTokens(html)).not.toContain("font-mono");
  });

  it("takes a disabled row out of use and leaves the badge at the row's end", () => {
    const html = list();
    expect(html).toMatch(/<button type="button" disabled="" class="[^"]*cursor-not-allowed/);
    expect(html).toMatch(/<span class="ml-auto flex shrink-0 items-center"><span>3<\/span>/);
  });

  it("scrolls sideways below sm when responsive, with rows at their labels' width", () => {
    const html = list("responsive");
    expect(html).toContain("overflow-x-auto sm:flex-col");
    expect(classTokens(html)).toEqual(expect.arrayContaining(["shrink-0", "sm:w-full"]));
    expect(classTokens(list())).toContain("w-full");
  });
});

describe("NavRow", () => {
  it("is a link with an address, and a disabled link leaves the tab order", () => {
    const link = renderStatic(createElement(NavRow, { label: "Agents", href: "/agents" }));
    expect(link).toMatch(/^<a href="\/agents" class="/);
    const off = renderStatic(
      createElement(NavRow, { label: "Agents", href: "/agents", disabled: true }),
    );
    expect(off).toMatch(/^<span role="link" aria-disabled="true" class="/);
    expect(off).not.toContain("href");
  });

  it("gives a router link the same look through navRowClass", () => {
    const html = renderStatic(createElement(NavRow, { label: "Agents", active: true }));
    expect(html).toContain(`class="${navRowClass({ active: true })} "`);
  });
});
