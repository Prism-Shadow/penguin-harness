/**
 * The row context menu's rules and hook (src/components/overlays/portal-panel/context-menu.ts and
 * use-row-context-menu.ts): which gesture asks for a row's menu, where the panel lands, and how
 * the hook keeps the browser's own menu to the row it serves.
 *
 * Two things matter beyond the arithmetic. **Anchoring** has to distinguish a real secondary click
 * from the keyboard chord browsers synthesize a `contextmenu` event for, because a keyboard user
 * has no pointer and a pointer-anchored panel would open in the corner of the screen. And the
 * feature must not be mouse-only: touch screens have neither hover nor a secondary button, so
 * touch keeps a path of its own (press-and-hold).
 *
 * The hook and the Dropdown it drives need a DOM this suite does not have, so what they must do
 * is pinned against their source: the one handler that suppresses the native menu, the
 * containment guard that keeps the portaled panel's own events from re-anchoring it, and the
 * Dropdown asking `scrollMovesAnchor` before an anchored panel dismisses itself (the rule's cases
 * are in portal-panel.test.ts). How the app wires rows to it is the web app's
 * `context-menu.test.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  IDLE_HOLD,
  LONG_PRESS_MS,
  LONG_PRESS_SETTLE_MS,
  LONG_PRESS_SLOP_PX,
  contextMenuAnchor,
  isContextMenuKey,
  isLongPressPointer,
  isPointerContextMenu,
  longPressMoved,
  pointerAnchor,
  reduceHold,
  withinSettleWindow,
} from "../src/components/overlays/portal-panel/context-menu";
import type { HoldEvent } from "../src/components/overlays/portal-panel/context-menu";
import { SRC_DIR } from "./helpers/paths";

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

  it("waits long enough not to fire on an ordinary tap", () => {
    expect(LONG_PRESS_MS).toBeGreaterThanOrEqual(400);
    expect(LONG_PRESS_SETTLE_MS).toBeGreaterThan(0);
  });

  it("ignores a dismiss inside the grace window that started at the given moment", () => {
    const opened = 10_000;
    expect(withinSettleWindow(opened, opened)).toBe(true);
    expect(withinSettleWindow(opened, opened + LONG_PRESS_SETTLE_MS - 1)).toBe(true);
    expect(withinSettleWindow(opened, opened + LONG_PRESS_SETTLE_MS)).toBe(false);
    expect(withinSettleWindow(opened, opened + 5_000)).toBe(false);
  });
});

/**
 * The gesture lifecycle, driven as ordered sequences. This is where the interesting bugs
 * live — every one of the cases below is a real touch sequence, not a synthetic one — and
 * it is only reachable from a node-only suite because the decisions were kept pure.
 */
describe("reduceHold", () => {
  /** Feed a sequence, returning each step's outcome. */
  const play = (events: HoldEvent[]) => {
    let state = IDLE_HOLD;
    return events.map((e) => {
      const out = reduceHold(state, e);
      state = out.state;
      return out;
    });
  };

  it("opens on the hold and swallows the click the lift replays", () => {
    const [, held, , click] = play([
      { kind: "pointerdown", pointerType: "touch" },
      { kind: "hold", at: 1_000 },
      { kind: "pointerup", at: 1_200 },
      { kind: "click" },
    ]);
    expect(held!.open).toBe("held");
    expect(click!.swallow).toBe(true);
  });

  it("measures the grace window from the LIFT, so reading the menu before lifting is safe", () => {
    // The whole point: the menu opens at 1s and the user studies it for two seconds before
    // lifting. The compatibility mousedown arrives at the lift, not at the open — anchoring
    // the window to the open time would dismiss the menu the gesture just produced.
    const [, , , dismiss] = play([
      { kind: "pointerdown", pointerType: "touch" },
      { kind: "hold", at: 1_000 },
      { kind: "pointerup", at: 3_000 },
      { kind: "dismiss", at: 3_010 },
    ]);
    expect(dismiss!.close).toBe(false);
  });

  it("believes a dismiss once the replayed events can no longer be in flight", () => {
    const [, , , dismiss] = play([
      { kind: "pointerdown", pointerType: "touch" },
      { kind: "hold", at: 1_000 },
      { kind: "pointerup", at: 3_000 },
      { kind: "dismiss", at: 3_000 + LONG_PRESS_SETTLE_MS },
    ]);
    expect(dismiss!.close).toBe(true);
  });

  it("treats a native contextmenu raised during a touch hold as the hold itself", () => {
    // Android raises its own contextmenu mid-hold and can beat our timer to it. If that is
    // not recognized as a hold, the lift's replayed click falls through and opens the
    // conversation on top of the menu.
    const [, native, , click] = play([
      { kind: "pointerdown", pointerType: "touch" },
      { kind: "nativemenu", at: 1_000 },
      { kind: "pointerup", at: 1_100 },
      { kind: "click" },
    ]);
    expect(native!.open).toBe("event");
    expect(native!.state.held).toBe(true);
    expect(click!.swallow).toBe(true);
  });

  it("does not re-anchor an already-held menu when the browser raises its own afterwards", () => {
    const [, , native] = play([
      { kind: "pointerdown", pointerType: "touch" },
      { kind: "hold", at: 1_000 },
      { kind: "nativemenu", at: 1_050 },
    ]);
    expect(native!.open).toBeNull();
  });

  it("leaves a mouse right-click free of hold semantics", () => {
    const [, native, dismiss, click] = play([
      { kind: "pointerdown", pointerType: "mouse" },
      { kind: "nativemenu", at: 1_000 },
      { kind: "dismiss", at: 1_010 },
      { kind: "click" },
    ]);
    expect(native!.open).toBe("event");
    expect(native!.state.held).toBe(false);
    // No grace window for a mouse: the very next outside click closes the menu.
    expect(dismiss!.close).toBe(true);
    expect(click!.swallow).toBe(false);
  });

  it("clears a hold flag left over from a gesture whose replayed click never came", () => {
    const [, , down, click] = play([
      { kind: "pointerdown", pointerType: "touch" },
      { kind: "hold", at: 1_000 },
      // No click followed; the next gesture starts clean rather than eating its tap.
      { kind: "pointerdown", pointerType: "touch" },
      { kind: "click" },
    ]);
    expect(down!.state.held).toBe(false);
    expect(click!.swallow).toBe(false);
  });

  it("swallows only one click per hold", () => {
    const [, , , first, second] = play([
      { kind: "pointerdown", pointerType: "touch" },
      { kind: "hold", at: 1_000 },
      { kind: "pointerup", at: 1_100 },
      { kind: "click" },
      { kind: "click" },
    ]);
    expect(first!.swallow).toBe(true);
    expect(second!.swallow).toBe(false);
  });
});

const read = (rel: string) => readFileSync(join(SRC_DIR, rel), "utf8");
const HOOK = read("components/overlays/portal-panel/use-row-context-menu.ts");
const DROPDOWN = read("components/overlays/dropdown/dropdown.tsx");

describe("anchored dismissal wiring", () => {
  it("asks scrollMovesAnchor before dismissing an anchored panel", () => {
    // What a node-only suite cannot reach is the component consulting the rule at all, and that
    // is where this silently breaks: drop the call and every case of the rule still passes while
    // the reported bug — a streaming message list wiping a menu opened in the sidebar — comes
    // straight back.
    const onScroll = /const onScroll = \(e: Event\) => \{([\s\S]*?)\n {4}\};/.exec(DROPDOWN);
    expect(onScroll, "onScroll should be declared in dropdown.tsx").not.toBeNull();
    expect(onScroll![1]).toContain("scrollMovesAnchor(");
    // The owner is the element the anchorRect was measured from, read at event time.
    expect(onScroll![1]).toContain("anchorOwnerRef.current");
  });
});

describe("native-menu suppression scope", () => {
  it("calls preventDefault inside the contextmenu handler itself, not somewhere adjacent", () => {
    // Tied to the handler rather than to the file: preventDefault also appears in onKeyDown, so
    // file-level presence would prove nothing about the native menu.
    const handler = /onContextMenu:\s*\(e\)\s*=>\s*\{([\s\S]*?)\n {4}\},/.exec(HOOK);
    expect(handler).not.toBeNull();
    expect(handler![1]).toContain("e.preventDefault()");
  });

  it("ignores events that bubbled out of the portaled panel rather than the row", () => {
    // React propagates through its own tree, so the Dropdown's body portal — a React child of
    // the row — would otherwise re-anchor the open menu when one of its items is right-clicked.
    // A DOM containment check separates the two trees.
    expect(HOOK).toContain("host.contains(e.target as Node)");
    for (const handler of ["onContextMenu", "onKeyDown", "onPointerDown"]) {
      const body = new RegExp(`${handler}:\\s*\\(e\\)\\s*=>\\s*\\{([\\s\\S]*?)\\n {4}\\},`).exec(
        HOOK,
      );
      expect(body, `${handler} should exist`).not.toBeNull();
      expect(body![1], `${handler} should guard on fromRow`).toContain("if (!fromRow(e)) return;");
    }
  });
});
