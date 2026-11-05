/**
 * The menu panel (src/components/overlays/menu-panel/menu-panel.tsx): the panel, row states and
 * check mark every picker and menu shares, in tokens.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  ChoiceCheck,
  menuPanelClass,
  menuRowClass,
  menuRowTone,
} from "../src/components/overlays/menu-panel/menu-panel";
import { renderStatic } from "../src/testing";

const tokens = (classes: string) => classes.split(/\s+/);

describe("menu panel", () => {
  it("draws the panel as a hairline box on the overlay layer, one shadow step", () => {
    expect(tokens(menuPanelClass)).toEqual(
      expect.arrayContaining(["border", "border-line", "bg-overlay", "shadow-lg", "py-1"]),
    );
  });

  it("fills the current choice and only hovers the rest", () => {
    const current = tokens(menuRowTone(true));
    const other = tokens(menuRowTone(false));
    expect(current).toEqual(expect.arrayContaining(["bg-surface-muted", "font-medium"]));
    expect(current.some((token) => token.startsWith("hover:"))).toBe(false);
    expect(other).toContain("hover:bg-surface-muted");
    expect(other).not.toContain("font-medium");
    expect(menuRowTone()).toBe(menuRowTone(false));
    expect(tokens(menuRowClass)).toContain("transition-colors");
  });

  it("keeps the check's slot whether or not the row is the current choice", () => {
    const on = renderStatic(createElement(ChoiceCheck, { on: true }));
    const off = renderStatic(createElement(ChoiceCheck, { on: false }));
    expect(on).toMatch(/^<span aria-hidden="true" class="[^"]*w-3[^"]*"><svg/);
    expect(on).toContain("text-fg-muted");
    expect(off).toMatch(/^<span aria-hidden="true" class="[^"]*w-3[^"]*"><\/span>$/);
  });
});
