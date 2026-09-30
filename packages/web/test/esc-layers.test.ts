/**
 * Escape-layer stack (the UI package's src/components/overlays/esc-layers/esc-layers.ts):
 * modals, drawers, sheets, the lightbox AND Dropdown menus register as layers, and Escape only
 * acts on the topmost one. This is what makes one Escape close a menu opened inside a dialog
 * while the dialog stays up (the next Escape closes it), and keeps nested dialogs closing one at
 * a time.
 */
import { describe, expect, it } from "vitest";
import { hasEscLayers, isTopEscLayer, popEscLayer, pushEscLayer } from "@prismshadow/penguin-ui";
import { expectEveryRootScanned, expectSingleHome, scanSources } from "./helpers/roots";

describe("esc layer sources", () => {
  it("scan every source root, and find the stack in one place", () => {
    const scan = scanSources();
    expectEveryRootScanned(scan);
    expectSingleHome(scan, "packages/ui/src/components/overlays/esc-layers/esc-layers.ts");
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
