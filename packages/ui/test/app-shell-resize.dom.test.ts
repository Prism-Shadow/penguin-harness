// @vitest-environment jsdom
/**
 * The app window's navigation column sized by the reader (src/components/shell/app-shell/
 * nav-column.tsx), held by a caller that stores every width it is handed, the way the Web App
 * persists it. jsdom lays nothing out, so the suite lays the column out itself: the column starts
 * at the window's left edge, its content is as wide as its inline width, and the theme's own
 * width (the classed content) is 288px. The window's width is set per scenario.
 *
 * - Given the theme's width, a drag on the handle follows the pointer with the layout motion off,
 *   and the release hands the caller the width once and turns the motion back on.
 * - Given a drag past either bound, the column stops at the bound, and that is what is kept.
 * - Given a narrow window, the ceiling is the window's share: a stored width past it is drawn at
 *   the ceiling without being handed back, and comes back whole once the window widens.
 * - Given a press that never moves, nothing is handed back; given a double click, null is: the
 *   theme's width again.
 * - Given a drag the browser cancels, the column goes back to where it was and nothing is kept.
 * - Given the handle focused, an arrow key steps the width from the one shown, the theme's
 *   measured width included, hands each step to the caller and reports the new value.
 * - Given a fold mid-drag, the drag is dropped: the rail has no handle, the fold keeps its motion,
 *   and the column unfolds at the width it had before the drag.
 * - Given no `navResize`, there is no handle and the column keeps the theme's width.
 */
import { createElement, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "../src/components/shell/app-shell/app-shell";
import { fire, mount, pointerEvent, unmountAll } from "./helpers/dom";

const THEME_WIDTH = 288;
const LABEL = "Resize sidebar";

function Caller(props: { stored: Array<number | null>; initial: number | null; folded: boolean }) {
  const [width, setWidth] = useState(props.initial);
  return createElement(AppShell, {
    nav: createElement("p", null, "Sidebar"),
    navCollapsed: props.folded,
    navResize: {
      width,
      label: LABEL,
      onChange: (next: number | null) => {
        props.stored.push(next);
        setWidth(next);
      },
    },
    children: createElement("p", null, "Page"),
  });
}

async function setUp(initial: number | null = null) {
  const stored: Array<number | null> = [];
  const shell = await mount(createElement(Caller, { stored, initial, folded: false }));
  const fold = (folded: boolean) =>
    shell.rerender(createElement(Caller, { stored, initial, folded }));
  return { stored, fold };
}

const column = () => document.querySelector<HTMLElement>('[data-slot="nav"]')!;
const handle = () =>
  document.querySelector<HTMLElement>(`[role="separator"][aria-label="${LABEL}"]`);
/**
 * The column's drawn width: its inline px, or which of the theme's widths its classes give it
 * (the rail's while folded, the theme's own while open).
 */
const drawn = () =>
  column().style.width || (column().classList.contains("w-12") ? "rail" : "theme");
const animates = () => column().hasAttribute("data-layout-motion");

async function setWindowWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  await fire(window, new Event("resize"));
}

async function press() {
  await fire(handle()!, pointerEvent("pointerdown", "mouse", 0, 300));
}
async function moveTo(x: number) {
  await fire(window, pointerEvent("pointermove", "mouse", x, 300));
}
async function release(x: number) {
  await fire(window, pointerEvent("pointerup", "mouse", x, 300));
}
async function key(name: string) {
  await fire(handle()!, new KeyboardEvent("keydown", { key: name, bubbles: true }));
}

beforeEach(async () => {
  await setWindowWidth(1440);
  // The layout jsdom does not do: the column at the window's left edge, a box as wide as its
  // inline width, and the theme's classes as wide as the theme's width.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const inline = Number.parseFloat(this.style.width);
    const width = Number.isFinite(inline)
      ? inline
      : this.classList.contains("w-64")
        ? THEME_WIDTH
        : 0;
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: width,
      bottom: 600,
      width,
      height: 600,
      toJSON: () => ({}),
    } as DOMRect;
  });
});

afterEach(async () => {
  await unmountAll();
  vi.restoreAllMocks();
});

describe("dragging the navigation column's edge", () => {
  it("follows the pointer without the layout motion, and keeps the width once, on release", async () => {
    const { stored } = await setUp();
    expect(drawn()).toBe("theme");
    expect(handle()!.getAttribute("aria-valuenow")).toBe(String(THEME_WIDTH));

    await press();
    expect(animates()).toBe(false);
    await moveTo(320);
    expect(drawn()).toBe("320px");
    await moveTo(360);
    expect(drawn()).toBe("360px");
    expect(stored).toEqual([]);

    await release(360);
    expect(stored).toEqual([360]);
    expect(drawn()).toBe("360px");
    expect(animates()).toBe(true);
    expect(handle()!.getAttribute("aria-valuenow")).toBe("360");
  });

  it("stops at either bound, and keeps the bound", async () => {
    const { stored } = await setUp();
    await press();
    await moveTo(40);
    expect(drawn()).toBe("240px");
    await moveTo(1200);
    expect(drawn()).toBe("480px");
    await release(1200);
    expect(stored).toEqual([480]);
    expect(handle()!.getAttribute("aria-valuemax")).toBe("480");
    expect(handle()!.getAttribute("aria-valuemin")).toBe("240");
  });

  it("draws a stored width at a narrow window's ceiling without rewriting it, and widens back", async () => {
    await setWindowWidth(900);
    const { stored } = await setUp(450);
    // 40% of the window.
    expect(drawn()).toBe("360px");
    expect(handle()!.getAttribute("aria-valuemax")).toBe("360");

    await setWindowWidth(1440);
    expect(drawn()).toBe("450px");
    expect(stored).toEqual([]);
  });

  it("keeps everything for a press that never moves, and goes back to the theme's width on a double click", async () => {
    const { stored } = await setUp(360);
    await press();
    await release(0);
    expect(stored).toEqual([]);
    expect(drawn()).toBe("360px");

    await fire(handle()!, new MouseEvent("dblclick", { bubbles: true }));
    expect(stored).toEqual([null]);
    expect(drawn()).toBe("theme");
    expect(animates()).toBe(true);
  });

  it("goes back to where it was when the browser cancels the drag, and keeps nothing", async () => {
    const { stored } = await setUp(300);
    await press();
    await moveTo(420);
    expect(drawn()).toBe("420px");
    await fire(window, pointerEvent("pointercancel", "mouse", 420, 300));
    expect(drawn()).toBe("300px");
    expect(animates()).toBe(true);
    expect(stored).toEqual([]);
  });
});

describe("the handle from the keyboard", () => {
  it("is a focusable separator whose arrow keys step the width shown, the theme's included", async () => {
    const { stored } = await setUp();
    expect(handle()!.tabIndex).toBe(0);

    await key("ArrowRight");
    expect(stored).toEqual([THEME_WIDTH + 16]);
    expect(drawn()).toBe(`${THEME_WIDTH + 16}px`);
    await key("ArrowLeft");
    await key("ArrowLeft");
    expect(stored).toEqual([THEME_WIDTH + 16, THEME_WIDTH, THEME_WIDTH - 16]);
    expect(handle()!.getAttribute("aria-valuenow")).toBe(String(THEME_WIDTH - 16));
    // Keys along the other axis are not the separator's.
    await key("ArrowDown");
    expect(stored).toHaveLength(3);
  });
});

describe("folding the navigation column", () => {
  it("drops a drag under way, folds with its motion, and unfolds at the width it had", async () => {
    const { stored, fold } = await setUp(300);
    await press();
    await moveTo(420);
    await fold(true);
    expect(handle()).toBeNull();
    expect(animates()).toBe(true);
    expect(drawn()).toBe("rail");
    await release(420);
    expect(stored).toEqual([]);

    await fold(false);
    expect(drawn()).toBe("300px");
    expect(handle()).not.toBeNull();
  });
});

describe("a column the reader cannot size", () => {
  it("has no handle and keeps the theme's width", async () => {
    await mount(
      createElement(AppShell, {
        nav: createElement("p", null, "Sidebar"),
        children: createElement("p", null, "Page"),
      }),
    );
    expect(handle()).toBeNull();
    expect(drawn()).toBe("theme");
  });
});
