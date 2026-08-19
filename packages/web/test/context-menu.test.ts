/**
 * context-menu.ts unit tests: the rules deciding which gesture asks for a row's context
 * menu and where the panel lands.
 *
 * Two things matter beyond the arithmetic. **Anchoring** has to distinguish a real
 * secondary click from the keyboard chord browsers synthesize a `contextmenu` event for,
 * because a keyboard user has no pointer and a pointer-anchored panel would open in the
 * corner of the screen. And the feature must not be mouse-only: touch screens have
 * neither hover nor a secondary button, which is exactly why
 * `design/specs/06-PROTOTYPE.md` requires touch to keep a path of its own.
 *
 * The second half pins **suppression scope** against the source text. Preventing the
 * browser's own menu is correct on the row and wrong everywhere else, and nothing in a
 * node-only suite (`environment: "node"`, no jsdom) would notice a `preventDefault` that
 * had crept onto a document-level listener — so the scan asserts there is no global
 * contextmenu listener in the package, and that the one handler doing the suppressing
 * lives in the hook the row spreads onto itself (title-reveal.test.ts convention).
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LONG_PRESS_MS,
  LONG_PRESS_SETTLE_MS,
  LONG_PRESS_SLOP_PX,
  contextMenuAnchor,
  isContextMenuKey,
  isLongPressPointer,
  isPointerContextMenu,
  longPressMoved,
  pointerAnchor,
  withinSettleWindow,
} from "../src/lib/context-menu";

const ROW = { top: 100, bottom: 132, left: 8, right: 260 };

describe("pointerAnchor", () => {
  it("is a zero-size box at the point, so the panel hangs off the click itself", () => {
    expect(pointerAnchor(420, 300)).toEqual({ top: 300, bottom: 300, left: 420, right: 420 });
  });
});

describe("isPointerContextMenu", () => {
  it("recognizes a secondary click", () => {
    expect(isPointerContextMenu({ button: 2, clientX: 420, clientY: 300 })).toBe(true);
  });

  it("rejects the keyboard-synthesized event, which reports no button", () => {
    expect(isPointerContextMenu({ button: 0, clientX: 130, clientY: 110 })).toBe(false);
  });

  it("rejects the (0, 0) coordinates some browsers report for the Menu key", () => {
    expect(isPointerContextMenu({ button: 2, clientX: 0, clientY: 0 })).toBe(false);
  });
});

describe("contextMenuAnchor", () => {
  it("opens at the pointer for a right-click", () => {
    expect(contextMenuAnchor({ button: 2, clientX: 420, clientY: 300 }, ROW)).toEqual(
      pointerAnchor(420, 300),
    );
  });

  it("falls back to the row's own box when the keyboard asked, not to the viewport corner", () => {
    expect(contextMenuAnchor({ button: 0, clientX: 0, clientY: 0 }, ROW)).toEqual(ROW);
  });
});

describe("isContextMenuKey", () => {
  it("is Shift+F10, the platform chord for the focused element's context menu", () => {
    expect(isContextMenuKey({ key: "F10", shiftKey: true })).toBe(true);
  });

  it("ignores a bare F10 and other shifted keys, so the row eats no ordinary typing", () => {
    expect(isContextMenuKey({ key: "F10", shiftKey: false })).toBe(false);
    expect(isContextMenuKey({ key: "F11", shiftKey: true })).toBe(false);
    expect(isContextMenuKey({ key: "Enter", shiftKey: true })).toBe(false);
  });
});

describe("press-and-hold (the touch path)", () => {
  it("holds for touch and pen only — a mouse has a secondary button and uses it", () => {
    expect(isLongPressPointer("touch")).toBe(true);
    expect(isLongPressPointer("pen")).toBe(true);
    expect(isLongPressPointer("mouse")).toBe(false);
    expect(isLongPressPointer("")).toBe(false);
  });

  it("tolerates a finger's jitter but treats real travel as a scroll", () => {
    const from = { x: 100, y: 200 };
    expect(longPressMoved(from, { x: 100, y: 200 })).toBe(false);
    expect(longPressMoved(from, { x: 100 + LONG_PRESS_SLOP_PX, y: 200 })).toBe(false);
    expect(longPressMoved(from, { x: 100, y: 200 + LONG_PRESS_SLOP_PX + 1 })).toBe(true);
    expect(longPressMoved(from, { x: 100 - LONG_PRESS_SLOP_PX - 1, y: 200 })).toBe(true);
  });

  it("waits long enough not to fire on a tap, and settles before a dismiss is believed", () => {
    // A tap is well under the hold, and the replayed compatibility click that follows a
    // hold arrives inside the settle window rather than after it.
    expect(LONG_PRESS_MS).toBeGreaterThanOrEqual(400);
    expect(LONG_PRESS_SETTLE_MS).toBeGreaterThan(0);
    expect(LONG_PRESS_SETTLE_MS).toBeLessThan(LONG_PRESS_MS);
  });

  it("ignores the dismiss a touch screen replays right after the hold, then stops ignoring", () => {
    const opened = 10_000;
    expect(withinSettleWindow(opened, opened)).toBe(true);
    expect(withinSettleWindow(opened, opened + LONG_PRESS_SETTLE_MS - 1)).toBe(true);
    expect(withinSettleWindow(opened, opened + LONG_PRESS_SETTLE_MS)).toBe(false);
    expect(withinSettleWindow(opened, opened + 5_000)).toBe(false);
  });
});

/** Every .ts/.tsx under packages/web/src, as [relative path, source] pairs. */
function sourceFiles(): Array<[string, string]> {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
  const out: Array<[string, string]> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name))
        out.push([full.slice(root.length + 1), readFileSync(full, "utf8")]);
    }
  };
  walk(root);
  return out;
}

describe("native-menu suppression scope", () => {
  it("registers no global contextmenu listener, so the browser's own menu survives off the row", () => {
    const global = sourceFiles().filter(([, src]) =>
      /addEventListener\(\s*["']contextmenu["']/.test(src),
    );
    expect(global.map(([path]) => path)).toEqual([]);
  });

  it("suppresses the native menu in exactly one place: the hook a row spreads onto itself", () => {
    const handlers = sourceFiles()
      .filter(([, src]) => src.includes("onContextMenu"))
      .map(([path]) => path)
      .sort();
    // The hook defines the handler; the sidebar row receives it via {...ctx.rowProps}.
    expect(handlers).toEqual(["components/ui/context-menu.tsx"]);
  });

  it("scopes the row's handlers to the row element, not to a document-level listener", () => {
    const hook = sourceFiles().find(([path]) => path === "components/ui/context-menu.tsx");
    expect(hook).toBeDefined();
    const src = hook![1];
    expect(src).toContain("e.preventDefault()");
    expect(src).not.toContain("document.addEventListener");
    expect(src).not.toContain("window.addEventListener");
  });

  it("gives the sidebar row all three openers, so the menu is not mouse-only", () => {
    const sidebar = sourceFiles().find(([path]) => path === "components/layout/sidebar.tsx");
    expect(sidebar).toBeDefined();
    // The row spreads the hook's handlers (contextmenu + Shift+F10 + press-and-hold) and
    // guards its own click against the one a hold replays.
    expect(sidebar![1]).toContain("{...ctx.rowProps}");
    expect(sidebar![1]).toContain("ctx.consumeLongPressClick()");
  });
});
