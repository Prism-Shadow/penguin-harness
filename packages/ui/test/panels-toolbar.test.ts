/**
 * PanelsToolbar (src/components/shell/panels-toolbar/panels-toolbar.tsx): the toolbar's dock
 * toggles, each saying whether its dock is open.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { PanelsToolbar } from "../src/components/shell/panels-toolbar/panels-toolbar";
import { renderStatic } from "../src/testing";

describe("PanelsToolbar", () => {
  it("says which docks are open, and dots only the toggle that asks for it", () => {
    const html = renderStatic(
      createElement(PanelsToolbar, {
        toggles: [
          {
            key: "bottom",
            label: "Bottom dock",
            glyph: "M0 0h1",
            active: false,
            onToggle: () => {},
          },
          {
            key: "right",
            label: "Right dock",
            glyph: "M0 0h1",
            active: true,
            badge: true,
            onToggle: () => {},
          },
        ],
      }),
    );
    expect(html).toContain('data-testid="panels-toolbar"');
    expect(html).toMatch(/aria-expanded="false"[^>]*aria-label="Bottom dock"/);
    expect(html).toMatch(/aria-expanded="true"[^>]*aria-label="Right dock"/);
    expect(html).toContain('data-testid="dock-toggle-right"');
    expect(html.match(/bg-tone-attention-emphasis/g)).toHaveLength(1);
  });
});
