/**
 * The pinned sidebar's frame and its pieces (src/components/shell/sidebar-frame/), and the page
 * row on the navigation column (NavRow on the muted surface).
 *
 * - Given fixed entries (New chat and the favourites), the frame stands them between the
 *   switcher and the scroll area, never inside the element that scrolls; the scroll area holds
 *   exactly what it is given. (That a scroll leaves them in place, how far apart their rows
 *   stand, and how a short column gives way are measured in a real engine:
 *   packages/ui-gallery/e2e/sidebar-favorites.spec.mjs.)
 * - Given no fixed entries, the column keeps the gap under the switcher.
 * - The fold folds through the shared `Fold`; with nothing to fold it draws nothing at all, and
 *   with a drop target it is ringed only while a drag it would take is over it.
 * - Entries carry a star toggle, drag as a whole, and move between the areas without a reveal.
 * - The list header's label is the eyebrow rung, and the column takes washes in place of
 *   surface steps.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ICONS } from "../src/components/icons/icons";
import { NAV_FILL, NavRow, navRowClass } from "../src/components/navigation/nav-list/nav-list";
import type { NavRowLinkProps } from "../src/components/navigation/nav-list/nav-list";
import { ROW_HOVER_BUTTON } from "../src/components/shell/session-row/session-row";
import {
  SidebarAccountButton,
  SidebarControl,
  SidebarFrame,
  SidebarListHeader,
  SidebarNavArea,
  SidebarNavEntry,
  SidebarNavGroup,
  sidebarControlClass,
} from "../src/components/shell/sidebar-frame/sidebar-frame";
import type {
  SidebarDropTarget,
  SidebarNavEntryProps,
} from "../src/components/shell/sidebar-frame/sidebar-frame";
import { classTokens, renderStatic } from "../src/testing";

/** A drop target's wiring, with a drag it would take over it or not. */
const dropTarget = (over: boolean): SidebarDropTarget => ({
  over,
  onDragOver: () => {},
  onDragLeave: () => {},
  onDrop: () => {},
});

/** The ring a drop target draws while a drag it would take is over it. */
const DROP_RING =
  '<span aria-hidden="true" class="pointer-events-none absolute inset-0 z-10 rounded-md ring-1 ring-inset ring-accent"></span>';

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

  it("keeps the gap under the switcher with no fixed entries", () => {
    const html = frame();
    expect(html).toContain('<div class="shrink-0 pb-2"></div><div data-find-region="sessions"');
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

  it("folds through the shared fold, under the theme's layout motion: open it holds its rows, folded none", () => {
    const open = group(false);
    expect(open).toContain('data-layout-motion="true" data-fold="settled" class="grid"');
    expect(open).toContain('href="/agents"');
    expect(open).not.toContain("inert");
    const folded = group(true);
    expect(folded).not.toContain("data-fold");
    expect(folded).not.toContain('href="/agents"');
    // Only colour and opacity move on the component's own classes: the size is the fold's.
    const lists = classTokens(open).filter((t) => t.startsWith("transition-["));
    expect(lists.filter((t) => /width|height|grid|transform/.test(t))).toEqual([]);
  });

  it("fades its rows in only when the reader unfolds them, never on a page load", () => {
    expect(classTokens(group(false))).not.toContain("starting:opacity-0");
  });

  it("names its toggle by what pressing it does, with no hover hint on a bare chevron", () => {
    expect(group(false)).toContain('aria-expanded="true" aria-label="折叠"');
    expect(group(true)).toContain('aria-expanded="false" aria-label="展开"');
    expect(group(false)).not.toMatch(/aria-label="折叠"[^>]*data-tooltip/);
  });

  it("spaces its rows on the rhythm", () => {
    expect(classTokens(group(false))).toContain("space-y-px");
    expect(classTokens(group(false))).not.toContain("space-y-0.5");
  });
});

describe("SidebarNavGroup with nothing to fold, and as a drop target", () => {
  const nav = (props: Partial<Parameters<typeof SidebarNavGroup>[0]> = {}) =>
    renderStatic(
      createElement(SidebarNavGroup, {
        collapsed: false,
        onToggle: () => {},
        expandLabel: "展开",
        collapseLabel: "折叠",
        children: createElement("a", { href: "/usage" }, "Cost Center"),
        ...props,
      }),
    );
  it("draws nothing at all with nothing to fold: no rows, no toggle, no empty landmark", () => {
    expect(nav({ foldable: false })).toBe("");
  });

  it("rings the fold and its toggle band while a drag it would take is over them, and only then", () => {
    expect(nav({ drop: dropTarget(true) })).toContain(`</button>${DROP_RING}</nav>`);
    expect(nav({ drop: dropTarget(false) })).not.toContain("ring-accent");
    expect(nav()).not.toContain("ring-accent");
  });
});

describe("SidebarNavArea", () => {
  it("rings its run while a drag it would take is over it", () => {
    const html = renderStatic(
      createElement(SidebarNavArea, { drop: dropTarget(true) }, createElement("a", null, "New")),
    );
    expect(html).toBe(`<div class="relative flex flex-col gap-px"><a>New</a>${DROP_RING}</div>`);
    expect(
      renderStatic(createElement(SidebarNavArea, { drop: dropTarget(false) }, "rows")),
    ).not.toContain("ring-accent");
  });

  it("holds a row's height with no rows in it only when asked to", () => {
    expect(classTokens(renderStatic(createElement(SidebarNavArea, { reserve: true })))).toContain(
      "min-h-8",
    );
    expect(classTokens(renderStatic(createElement(SidebarNavArea, {})))).not.toContain("min-h-8");
  });
});

describe("SidebarNavEntry", () => {
  const pin = (pinned: boolean) => ({
    pinned,
    label: "Pin",
    tooltip: pinned ? "Unpin" : "Pin",
    onToggle: () => {},
  });
  const entry = (props: Partial<SidebarNavEntryProps> = {}) =>
    renderStatic(
      createElement(SidebarNavEntry, {
        label: "Models",
        glyph: ICONS.chip,
        href: "/models",
        pin: pin(true),
        ...props,
      }),
    );

  it("names its pin the same either way and carries the state in aria-pressed, the hint naming the move", () => {
    expect(entry()).toContain('data-tooltip="Unpin" aria-label="Pin" aria-pressed="true"');
    expect(entry({ pin: pin(false) })).toContain(
      'data-tooltip="Pin" aria-label="Pin" aria-pressed="false"',
    );
  });

  it("draws the star solid on a favourite and as an outline otherwise, the drawing carrying the state", () => {
    const pinned = entry();
    const unpinned = entry({ pin: pin(false) });
    expect(pinned).toContain(`<path d="${ICONS.star}" fill="currentColor">`);
    expect(pinned).not.toContain(`<path d="${ICONS.star}" fill="none">`);
    expect(unpinned).toContain(`<path d="${ICONS.star}" fill="none">`);
    expect(unpinned).not.toContain(`<path d="${ICONS.star}" fill="currentColor">`);
  });

  it("reveals the pin as the conversation rows reveal their hover buttons, and always shows it where nothing hovers", () => {
    const tokens = classTokens(entry());
    expect(tokens).toEqual(expect.arrayContaining(ROW_HOVER_BUTTON.split(" ")));
    expect(tokens).toEqual(
      expect.arrayContaining([
        "[@media(hover:none)]:opacity-100",
        "[@media(hover:none)]:pointer-events-auto",
      ]),
    );
  });

  it("keeps the row's fill while the pointer is on the pin: the hover answers to the whole entry", () => {
    const tokens = classTokens(entry());
    expect(tokens).toEqual(expect.arrayContaining(["group", NAV_FILL.groupHover]));
    expect(tokens).not.toContain(NAV_FILL.hover);
    // A selected entry keeps its own fill under the pointer.
    const active = classTokens(entry({ active: true }));
    expect(active).toContain(NAV_FILL.selected);
    expect(active).not.toContain(NAV_FILL.groupHover);
  });

  it("moves between the areas without a reveal: the star filling is the whole feedback", () => {
    expect(entry()).not.toContain("data-reveal");
    expect(entry({ pin: pin(false) })).not.toContain("data-reveal");
  });

  it("drags as a whole: the entry is the handle, and its link starts no drag of its own", () => {
    expect(entry({ draggable: true, onDragStart: () => {}, onDragEnd: () => {} })).toMatch(
      /^<div class="group relative flex items-center" draggable="true"><a href="\/models" draggable="false" class="/,
    );
    expect(entry()).not.toContain("draggable");
  });

  it("never hides its badge: the badge steps just left of the pin wherever the pin shows", () => {
    const html = entry({ badge: createElement("i", { "data-dot": "" }) });
    expect(html.indexOf('aria-pressed="true"')).toBeLessThan(html.indexOf("data-dot"));
    expect(classTokens(html)).toContain("peer");
    const holder = /<span class="([^"]*)"><i data-dot/.exec(html)?.[1]?.split(" ") ?? [];
    expect(holder).toEqual(
      expect.arrayContaining([
        "right-0",
        "group-hover:right-5.5",
        "peer-focus-within:right-5.5",
        "[@media(hover:none)]:right-5.5",
      ]),
    );
    expect(holder.filter((t) => t.includes("opacity"))).toEqual([]);
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
    expect(navRowClass({ active: true })).toContain("bg-control-selected");
  });

  it("answers to the enclosing group's hover when asked, leaving a selected row's fill alone", () => {
    const rest = navRowClass({ surface: "muted", groupHover: true }).split(" ");
    expect(rest).toEqual(expect.arrayContaining([NAV_FILL.groupHover, "group-hover:text-fg"]));
    expect(rest).not.toContain(NAV_FILL.hover);
    const active = navRowClass({ active: true, surface: "muted", groupHover: true }).split(" ");
    expect(active).toContain(NAV_FILL.selected);
    expect(active.filter((token) => token.startsWith("group-hover:"))).toEqual([]);
  });

  it("hands a router a link that starts no drag of its own when the row is inside a handle", () => {
    const seen: NavRowLinkProps[] = [];
    renderStatic(
      createElement(NavRow, {
        label: "Agents",
        href: "/agents",
        surface: "muted",
        draggable: false,
        renderLink: (link: NavRowLinkProps) => {
          seen.push(link);
          return null;
        },
      }),
    );
    expect(seen[0]).toMatchObject({ href: "/agents", draggable: false });
    expect(renderStatic(createElement(NavRow, { label: "Agents", href: "/agents" }))).not.toContain(
      "draggable",
    );
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
