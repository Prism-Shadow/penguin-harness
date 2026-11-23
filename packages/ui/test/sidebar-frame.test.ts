/**
 * The pinned sidebar's frame and its pieces (src/components/shell/sidebar-frame/), and the page
 * row on the navigation column (NavRow on the muted surface).
 *
 * - Given fixed entries (New chat and the nav's entries), the frame stands them between the
 *   switcher and the scroll area, never inside the element that scrolls; the scroll area holds
 *   exactly what it is given.
 * - Given no fixed entries, the column keeps an empty gap under the switcher, and no fixed nav.
 * - An entry hangs its badge over the row's end, outside its link, and carries no control of its
 *   own: nothing to star, drag or fold.
 * - The list header's label is the eyebrow rung, and the column takes washes in place of
 *   surface steps.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ICONS } from "../src/components/icons/icons";
import { NAV_FILL, NavRow, navRowClass } from "../src/components/navigation/nav-list/nav-list";
import type { NavRowLinkProps } from "../src/components/navigation/nav-list/nav-list";
import {
  SidebarAccountButton,
  SidebarControl,
  SidebarFrame,
  SidebarListHeader,
  SidebarNavEntry,
  sidebarControlClass,
} from "../src/components/shell/sidebar-frame/sidebar-frame";
import type { SidebarNavEntryProps } from "../src/components/shell/sidebar-frame/sidebar-frame";
import { classTokens, renderStatic, markupStructure } from "../src/testing";

const frame = (props: Partial<Parameters<typeof SidebarFrame>[0]> = {}) =>
  renderStatic(
    createElement(SidebarFrame, {
      switcher: createElement("span", null, "Project"),
      account: createElement("span", null, "Account"),
      children: createElement("span", null, "List"),
      findRegion: "sessions",
      ...props,
    }),
  );

/** The scroll area's own markup: the element that scrolls (it carries the find region) and all it holds. */
const SCROLL_AREA =
  /<div data-find-region="sessions" class="[^"]*">(.*?)<\/div><div class="shrink-0 border-t/;

describe("SidebarFrame", () => {
  it("stands the fixed entries between the switcher and the scroll area, never inside what scrolls", () => {
    const fixed = createElement(
      "div",
      null,
      createElement("button", { type: "button" }, "New chat"),
      createElement("a", { href: "/agents" }, "Agents"),
    );
    const html = frame({ pinned: fixed });
    expect(html.indexOf("Project")).toBeLessThan(html.indexOf("New chat"));
    expect(html.indexOf('href="/agents"')).toBeLessThan(html.indexOf("data-find-region"));
    // The scroll area holds exactly the list it was given: nothing of the fixed block.
    expect(SCROLL_AREA.exec(html)?.[1]).toBe("<span>List</span>");
    expect(html.indexOf("data-find-region")).toBeLessThan(html.indexOf("Account"));
  });

  it("keeps an empty gap under the switcher with no fixed entries", () => {
    const html = frame();
    expect(html).toMatch(/<div class="[^"]*"><\/div><div data-find-region="sessions"/);
    expect(html).not.toContain("<nav");
  });

  it("names the mode switch's group and the fold button from the caller's words", () => {
    const html = frame({
      modeSwitch: { label: "工作模式", control: createElement("span", null, "switch") },
      collapse: { label: "收起侧栏", onClick: () => {} },
    });
    expect(html).toContain('role="group" aria-label="工作模式"');
    expect(html).toContain('data-tooltip="收起侧栏" aria-label="收起侧栏"');
    expect(frame()).not.toContain("aria-label");
  });
});

describe("SidebarNavEntry", () => {
  const entry = (props: Partial<SidebarNavEntryProps> = {}) =>
    renderStatic(
      createElement(SidebarNavEntry, {
        label: "App Center",
        glyph: ICONS.tiles,
        href: "/apps",
        ...props,
      }),
    );

  it("hangs its badge over the row's end, outside the link, so the link keeps the whole row", () => {
    const html = entry({ badge: createElement("i", { "data-dot": "" }) });
    expect(html.indexOf("</a>")).toBeLessThan(html.indexOf("data-dot"));
    expect(html).toMatch(/<span class="pointer-events-none absolute[^"]*"><i data-dot=""><\/i>/);
  });

  it("carries no control of its own: no star, no drag, no fold toggle", () => {
    const html = entry({ badge: createElement("i", { "data-dot": "" }) });
    expect(html).not.toContain("<button");
    expect(html).not.toContain("draggable");
    expect(html).not.toContain("aria-pressed");
  });

  it("takes the column's washes", () => {
    expect(classTokens(entry())).toContain(NAV_FILL.hover);
    expect(classTokens(entry({ active: true }))).toContain(NAV_FILL.selected);
  });
});

describe("SidebarListHeader", () => {
  const header = (searching: boolean) =>
    renderStatic(
      createElement(SidebarListHeader, {
        label: "Sessions",
        searching,
        children: createElement("button", { type: "button" }, "search"),
      }),
    );

  it.each([true, false])(
    "places the workspace disclosure after the label when open is %s",
    (open) => {
      const html = renderStatic(
        createElement(SidebarListHeader, {
          label: "Apps",
          fold: { open, toggle: () => {} },
          children: createElement("button", null, "Search"),
        }),
      );
      const toggle = html.match(/<button[^>]*aria-label="Apps"[^>]*>(.*?)<\/button>/)?.[1] ?? "";
      expect(html).toContain(`aria-expanded="${open}"`);
      expect(toggle).toMatch(/>Apps<\/span><svg/);
      expect(classTokens(toggle).includes("rotate-90")).toBe(open);
    },
  );

  it("sets its label on the eyebrow hook", () => {
    const tokens = classTokens(header(false));
    expect(tokens).toContain("ui-eyebrow");
  });

  it("gives the search the label's column under the layout motion", () => {
    expect(header(true)).toContain('data-layout-motion="true"');
  });
});

describe("the column's controls", () => {
  it("name an icon control by its hint, and fill it while its menu is open", () => {
    const html = renderStatic(
      createElement(SidebarControl, {
        label: "List options",
        glyph: ICONS.slidersHorizontal,
        active: true,
        "aria-haspopup": "menu",
        "aria-expanded": true,
        onClick: () => {},
      }),
    );
    expect(html).toContain(
      'data-tooltip="List options" aria-label="List options" aria-haspopup="menu" aria-expanded="true"',
    );
    expect(sidebarControlClass(true)).toContain(NAV_FILL.selected);
    expect(sidebarControlClass(false)).toContain(NAV_FILL.hover);
  });

  it("open the account menu from a named trigger with the role after the name", () => {
    const html = renderStatic(
      createElement(SidebarAccountButton, {
        avatar: createElement("span", null, "A"),
        name: "Ada",
        role: "Admin",
        expanded: false,
        onClick: () => {},
      }),
    );
    expect(html).toContain('aria-haspopup="menu" aria-expanded="false"');
    expect(markupStructure(html)).toContain("<span>Admin</span>");
    expect(html).not.toContain("aria-label");
  });
});

describe("NavRow on the navigation column", () => {
  it("takes the column's washes in place of the surface steps", () => {
    const active = navRowClass({ active: true, surface: "muted" });
    expect(active).toContain(NAV_FILL.selected);
    const rest = navRowClass({ surface: "muted" });
    expect(rest).toContain(NAV_FILL.hover);
  });

  it("answers to the enclosing group's hover when asked, leaving a selected row's fill alone", () => {
    const rest = navRowClass({ surface: "muted", groupHover: true }).split(" ");
    expect(rest).not.toContain(NAV_FILL.hover);
    const active = navRowClass({ active: true, surface: "muted", groupHover: true }).split(" ");
    expect(active).toContain(NAV_FILL.selected);
  });

  it("hands a router its link: the address, the row's classes and the current page", () => {
    const seen: NavRowLinkProps[] = [];
    const html = renderStatic(
      createElement(NavRow, {
        label: "Agents",
        glyph: ICONS.robot,
        href: "/agents",
        active: true,
        surface: "muted",
        tooltip: "Update available",
        renderLink: (link: NavRowLinkProps) => {
          seen.push(link);
          return createElement(
            "a",
            { href: `#${link.href}`, className: link.className },
            link.children,
          );
        },
      }),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      href: "/agents",
      "aria-current": "page",
      "data-tooltip": "Update available",
    });
    expect(seen[0]!.className).toContain(NAV_FILL.selected);
    expect(html).toContain('href="#/agents"');
    expect(html).toContain('data-role="nav"');
  });

  it("keeps a disabled link's place without handing it to the router", () => {
    let called = false;
    const html = renderStatic(
      createElement(NavRow, {
        label: "Overview",
        href: "",
        disabled: true,
        surface: "muted",
        renderLink: () => {
          called = true;
          return null;
        },
      }),
    );
    expect(called).toBe(false);
    expect(html).toMatch(/^<span role="link" aria-disabled="true" class="/);
  });
});
