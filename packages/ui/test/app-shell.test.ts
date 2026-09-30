/**
 * The app window (src/components/shell/app-shell/), the folded rail (rail/) and the phone's top
 * bar (mobile-top-bar/): the shell's slots are the ones its theme recipes select on, its column
 * folds under the theme's layout motion, and every icon-only entry carries its name and a styled
 * hint rather than a native title.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ICONS } from "../src/components/icons/icons";
import type { NavRowLinkProps } from "../src/components/navigation/nav-list/nav-list";
import { NAV_FILL } from "../src/components/navigation/nav-list/nav-list";
import { AppShell } from "../src/components/shell/app-shell/app-shell";
import { MobileTopBar } from "../src/components/shell/mobile-top-bar/mobile-top-bar";
import {
  Rail,
  RailAccountButton,
  RailDivider,
  RailItem,
  railItemClass,
} from "../src/components/shell/rail/rail";
import { classTokens, renderStatic } from "../src/testing";

const text = (value: string) => createElement("span", null, value);

describe("AppShell", () => {
  const shell = (props: Partial<Parameters<typeof AppShell>[0]> = {}) =>
    renderStatic(
      createElement(AppShell, {
        nav: text("Sidebar"),
        children: text("Page"),
        ...props,
      }),
    );

  it("is the ui-shell window with its nav and main slots, and a dock slot only when docked", () => {
    const html = shell();
    expect(html).toMatch(/^<div class="ui-shell flex h-full"><aside data-slot="nav"/);
    expect(html).toContain(
      '<div data-slot="main" class="flex min-w-0 flex-1 flex-col"><span>Page</span></div>',
    );
    expect(html).not.toContain('data-slot="dock"');
    expect(shell({ dock: text("Dock") })).toContain('data-slot="dock"');
  });

  it("folds the navigation column's width under the theme's layout motion", () => {
    const open = shell();
    expect(open).toContain('data-layout-motion="true"');
    expect(classTokens(open)).toEqual(
      expect.arrayContaining(["w-64", "lg:w-72", "md:block", "hidden"]),
    );
    const folded = shell({ navCollapsed: true });
    expect(classTokens(folded)).toContain("w-12");
    expect(classTokens(folded)).not.toContain("w-64");
    expect(classTokens(open).filter((t) => t.startsWith("transition"))).toEqual([]);
  });

  it("mounts its overlays beside the columns, in no slot", () => {
    const html = shell({ overlays: text("Dialog") });
    expect(html).toMatch(/<span>Page<\/span><\/div><span>Dialog<\/span><\/div>$/);
  });
});

describe("MobileTopBar", () => {
  it("is the phone's bar, its drawer button named by the caller and hinted only with a badge", () => {
    const plain = renderStatic(
      createElement(MobileTopBar, {
        title: "PenguinHarness",
        menuLabel: "Sessions",
        onMenu: () => {},
      }),
    );
    expect(classTokens(plain)).toContain("md:hidden");
    expect(plain).toContain('aria-label="Sessions"');
    expect(plain).not.toContain("data-tooltip");
    expect(plain).toContain('<span class="text-sm font-semibold">PenguinHarness</span>');
    const badged = renderStatic(
      createElement(MobileTopBar, {
        title: "PenguinHarness",
        menuLabel: "Sessions · Update available",
        menuHint: "Update available",
        menuBadge: createElement("i", { "aria-hidden": true }),
        onMenu: () => {},
      }),
    );
    expect(badged).toContain(
      'aria-label="Sessions · Update available" data-tooltip="Update available"',
    );
    expect(badged).toContain('<i aria-hidden="true"></i></button>');
  });
});

describe("Rail", () => {
  it("scrolls its entries in a nav, the head and foot staying put", () => {
    const html = renderStatic(
      createElement(Rail, { head: text("head"), foot: text("foot"), children: text("entry") }),
    );
    expect(html).toMatch(
      /<span>head<\/span><nav class="[^"]*overflow-y-auto[^"]*"><span>entry<\/span><\/nav><span>foot<\/span>/,
    );
  });

  it("names an icon entry and hints it with the styled tooltip, never a native title", () => {
    const html = renderStatic(
      createElement(RailItem, { label: "New chat", glyph: ICONS.penLine, onClick: () => {} }),
    );
    expect(html).toContain('<button type="button" aria-label="New chat"');
    expect(html).not.toContain("title=");
  });

  it("presses a toggle and fills a selected entry with the column's wash", () => {
    const pressed = renderStatic(
      createElement(RailItem, { label: "Company", glyph: ICONS.building, pressed: true }),
    );
    expect(pressed).toContain('aria-pressed="true"');
    expect(railItemClass({ active: true })).toContain(NAV_FILL.selected);
    expect(railItemClass()).not.toContain(` ${NAV_FILL.selected}`);
    expect(railItemClass({ disabled: true })).toContain("cursor-not-allowed");
  });

  it("hands a link entry to the router, the current page marked, and parks a dead one", () => {
    const seen: NavRowLinkProps[] = [];
    renderStatic(
      createElement(RailItem, {
        label: "Models",
        glyph: ICONS.chip,
        href: "/models",
        active: true,
        renderLink: (link: NavRowLinkProps) => {
          seen.push(link);
          return createElement("a", { href: link.href }, link.children);
        },
      }),
    );
    expect(seen[0]).toMatchObject({
      href: "/models",
      "aria-current": "page",
      "aria-label": "Models",
    });
    const dead = renderStatic(
      createElement(RailItem, {
        label: "Overview",
        glyph: ICONS.dashboard,
        href: "",
        disabled: true,
      }),
    );
    expect(dead).toContain('<span role="link" aria-label="Overview" aria-disabled="true"');
  });

  it("rules runs of entries apart and opens the account menu from a named square", () => {
    expect(renderStatic(createElement(RailDivider))).toBe(
      '<span aria-hidden="true" class="my-0.5 h-px w-5 shrink-0 bg-line"></span>',
    );
    const account = renderStatic(
      createElement(RailAccountButton, {
        label: "Ada",
        expanded: false,
        onClick: () => {},
        children: text("A"),
      }),
    );
    expect(account).toContain('aria-label="Ada" aria-haspopup="menu" aria-expanded="false"');
  });
});
