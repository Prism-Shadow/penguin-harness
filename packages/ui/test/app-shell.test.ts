/**
 * The app window (src/components/shell/app-shell/), the folded rail (rail/), the phone's top
 * bar (mobile-top-bar/) and the desktop window's band controls (window-band/): the shell's slots
 * are the ones its theme recipes select on, its column folds under the theme's layout motion, and
 * every icon-only entry carries its name and a styled hint rather than a native title.
 *
 * - Given a band, the window lays it across its top before the columns, as a strip that drags the
 *   window and holds the caller's controls; without one there is no band slot at all.
 * - Given the window maximized, the middle window button shows the restore drawing; otherwise the
 *   maximize one.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ICONS } from "../src/components/icons/icons";
import type { NavRowLinkProps } from "../src/components/navigation/nav-list/nav-list";
import { NAV_FILL } from "../src/components/navigation/nav-list/nav-list";
import { AppShell } from "../src/components/shell/app-shell/app-shell";
import { WindowControls } from "../src/components/shell/window-band/window-band";
import { MobileTopBar } from "../src/components/shell/mobile-top-bar/mobile-top-bar";
import {
  Rail,
  RailAccountButton,
  RailDivider,
  RailItem,
  railItemClass,
} from "../src/components/shell/rail/rail";
import { renderStatic, markupStructure } from "../src/testing";

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
    expect(html).toMatch(/^<div class="ui-shell [^"]*"><aside data-slot="nav"/);
    expect(markupStructure(html)).toContain('<div data-slot="main"><span>Page</span></div>');
    expect(html).not.toContain('data-slot="dock"');
    expect(shell({ dock: text("Dock") })).toContain('data-slot="dock"');
  });

  it("folds the navigation column under the theme's layout motion", () => {
    const open = shell();
    expect(open).toContain('data-layout-motion="true"');
  });

  it("mounts its overlays beside the columns, in no slot", () => {
    const html = shell({ overlays: text("Dialog") });
    expect(html).toMatch(/<span>Page<\/span><\/div><span>Dialog<\/span><\/div>$/);
  });

  it("lays a given band across its top, before the columns, as a strip that drags the window", () => {
    const html = shell({ band: text("Controls") });
    expect(html).toContain('data-window-band=""');
    expect(html).toMatch(
      /<div data-slot="band" data-window-drag="true"[^>]*><span>Controls<\/span><\/div><aside data-slot="nav"/,
    );
  });
});

describe("WindowControls", () => {
  const controls = (maximized: boolean) =>
    renderStatic(
      createElement(WindowControls, {
        maximized,
        labels: { minimize: "Minimize", maximize: "Maximize", restore: "Restore", close: "Close" },
        onMinimize: () => {},
        onToggleMaximize: () => {},
        onClose: () => {},
      }),
    );

  it("draws the middle button as what it will do: maximize, or restore once maximized", () => {
    const restored = controls(false);
    expect(restored).toContain(`d="${ICONS.square}"`);
    expect(restored).not.toContain(`d="${ICONS.squareStack}"`);
    const maximized = controls(true);
    expect(maximized).toContain(`d="${ICONS.squareStack}"`);
    expect(maximized).not.toContain(`d="${ICONS.square}"`);
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
    expect(plain).toContain('aria-label="Sessions"');
    expect(plain).not.toContain("data-tooltip");
    expect(markupStructure(plain)).toContain("<span>PenguinHarness</span>");
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
      /<span>head<\/span><nav class="[^"]*"><span>entry<\/span><\/nav><span>foot<\/span>/,
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
    expect(markupStructure(renderStatic(createElement(RailDivider)))).toBe(
      '<span aria-hidden="true"></span>',
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
