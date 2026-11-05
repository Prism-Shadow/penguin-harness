/**
 * The two pieces every dialog, drawer, sheet and menu in the app inherits from the UI package
 * (components/overlays/esc-layers): the Tab ring inside an open dialog and the Escape stack.
 * They have no test in packages/ui yet, so they are exercised here.
 *
 * - Tab steps forward and Shift+Tab backward, wrapping at either end; from the panel itself
 *   focus enters at the end the direction implies, and a single-element ring holds in place.
 * - Only the topmost Escape layer may act, and popping it restores the one below (a menu inside
 *   a dialog closes first); while any layer is open the app's global shortcuts hold back.
 * - Layers may be removed out of order, and a double pop is a no-op, never a throw.
 */
import { describe, expect, it } from "vitest";
import {
  hasEscLayers,
  isTopEscLayer,
  nextFocusIndex,
  popEscLayer,
  pushEscLayer,
} from "@prismshadow/penguin-ui";

describe("nextFocusIndex", () => {
  it("steps forward and wraps past the last element", () => {
    expect(nextFocusIndex(3, 0, false)).toBe(1);
    expect(nextFocusIndex(3, 2, false)).toBe(0);
  });

  it("steps backward and wraps past the first element", () => {
    expect(nextFocusIndex(3, 2, true)).toBe(1);
    expect(nextFocusIndex(3, 0, true)).toBe(2);
  });

  it("enters the ring at the end the direction implies when focus is on the panel itself", () => {
    // -1 is focus sitting on the container: a dialog whose focusable content mounted after
    // open, or one whose only control was just disabled. Shift+Tab must reach the last
    // element, not the second-to-last — the plain modulo gets this wrong.
    expect(nextFocusIndex(4, -1, false)).toBe(0);
    expect(nextFocusIndex(4, -1, true)).toBe(3);
  });

  it("holds a single-element ring in place rather than escaping it", () => {
    expect(nextFocusIndex(1, 0, false)).toBe(0);
    expect(nextFocusIndex(1, 0, true)).toBe(0);
  });
});

describe("esc layer stack", () => {
  it("only the topmost layer may act; popping restores the one below", () => {
    const modal = pushEscLayer();
    expect(isTopEscLayer(modal)).toBe(true);
    // An open layer is what holds the app's global shortcuts back.
    expect(hasEscLayers()).toBe(true);
    // A menu opened inside the modal stacks above it: the first Escape belongs to the menu.
    const menu = pushEscLayer();
    expect(isTopEscLayer(menu)).toBe(true);
    expect(isTopEscLayer(modal)).toBe(false);
    popEscLayer(menu);
    expect(isTopEscLayer(modal)).toBe(true);
    popEscLayer(modal);
    expect(isTopEscLayer(modal)).toBe(false);
    expect(hasEscLayers()).toBe(false);
  });

  it("tolerates out-of-order removal (an outer layer unmounting first)", () => {
    const outer = pushEscLayer();
    const inner = pushEscLayer();
    popEscLayer(outer); // e.g. the host dialog unmounts while its menu is still open
    expect(isTopEscLayer(inner)).toBe(true);
    popEscLayer(inner);
    // Double-pop is a no-op, never a throw (effect cleanups can race in tests/strict mode).
    popEscLayer(inner);
    expect(isTopEscLayer(inner)).toBe(false);
  });
});
