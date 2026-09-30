/**
 * The pinned sidebar's frame and its pieces (src/components/shell/sidebar-frame/), and the page
 * row on the navigation column (NavRow on the muted surface): one column whose scroll area is the
 * only block that shrinks, a page nav that folds under its toggle, a list header whose label is
 * the eyebrow rung, and the column's washes in place of surface steps.
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
  SidebarNavGroup,
  sidebarControlClass,
} from "../src/components/shell/sidebar-frame/sidebar-frame";
import { classTokens, renderStatic } from "../src/testing";

const frame = (props: Partial<Parameters<typeof SidebarFrame>[0]> = {}) =>
  renderStatic(
    createElement(SidebarFrame, {
      switcher: createElement("span", null, "Project"),
      account: createElement("span", null, "Account"),
      children: createElement("span", null, "List"),
      ...props,
    }),
  );

describe("SidebarFrame", () => {
  it("stacks the switcher, the scroll area and the account row, only the scroll area shrinking", () => {
    const html = frame();
    expect(html).toMatch(/^<div class="flex h-full w-full flex-col">/);
    expect(html).toContain(
      '<div class="relative min-h-0 flex-1 overflow-y-auto overflow-x-clip px-2 pb-2"><span>List</span></div>',
    );
    expect(html).toContain(
      '<div class="shrink-0 border-t border-line p-2"><span>Account</span></div>',
    );
  });

  it("keeps the gap under the switcher with no pinned entry, and pads the one it has", () => {
    expect(frame()).toContain('<div class="shrink-0 pb-2"></div>');
    expect(frame({ pinned: createElement("span", null, "New chat") })).toContain(
      '<div class="shrink-0 px-2 pb-2 pt-2"><span>New chat</span></div>',
    );
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

  it("paints no background of its own: the column holding it does", () => {
    expect(classTokens(frame()).filter((t) => t.startsWith("bg-"))).toEqual([]);
  });
});

describe("SidebarNavGroup", () => {
  const group = (collapsed: boolean) =>
    renderStatic(
      createElement(SidebarNavGroup, {
        collapsed,
        onToggle: () => {},
        expandLabel: "展开",
        collapseLabel: "折叠",
        children: createElement("a", { href: "/agents" }, "Agents"),
      }),
    );

  it("folds under the theme's layout motion, turning the folded rows inert", () => {
    expect(group(false)).toContain('data-layout-motion="true" class="grid grid-rows-[1fr]"');
    expect(group(true)).toContain('class="grid grid-rows-[0fr]"');
    expect(group(true)).toContain('inert=""');
    expect(group(false)).not.toContain("inert");
    expect(classTokens(group(false)).filter((t) => t.startsWith("transition-["))).toEqual([]);
  });

  it("names its toggle by what pressing it does", () => {
    expect(group(false)).toContain('aria-expanded="true" aria-label="折叠" data-tooltip="折叠"');
    expect(group(true)).toContain('aria-expanded="false" aria-label="展开" data-tooltip="展开"');
  });

  it("spaces its rows on the rhythm", () => {
    expect(classTokens(group(false))).toContain("space-y-px");
    expect(classTokens(group(false))).not.toContain("space-y-0.5");
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

  it("sets its label on the eyebrow rung, spelling no case, tracking or size of its own", () => {
    const tokens = classTokens(header(false));
    expect(tokens).toEqual(expect.arrayContaining(["ui-eyebrow", "text-fg-subtle"]));
    for (const own of ["uppercase", "tracking-wide", "text-[11px]"]) {
      expect(tokens).not.toContain(own);
    }
  });

  it("gives the search the label's column under the layout motion", () => {
    expect(header(false)).toContain("grid-cols-[1fr_1fr]");
    expect(header(true)).toContain("grid-cols-[0fr_1fr]");
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
    expect(html).toContain('<span class="text-xs text-fg-subtle">Admin</span>');
    expect(html).not.toContain("aria-label");
  });
});

describe("NavRow on the navigation column", () => {
  it("takes the column's washes in place of the surface steps", () => {
    const active = navRowClass({ active: true, surface: "muted" });
    expect(active).toContain(NAV_FILL.selected);
    expect(active).not.toContain("bg-line-muted");
    const rest = navRowClass({ surface: "muted" });
    expect(rest).toContain(NAV_FILL.hover);
    expect(rest).not.toContain("hover:bg-surface-muted");
    // The default surface is untouched.
    expect(navRowClass({ active: true })).toContain("bg-line-muted");
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
