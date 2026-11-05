/**
 * PanelsToolbar (src/components/shell/panels-toolbar/panels-toolbar.tsx): the toolbar's dock
 * toggles, each saying whether its dock is open; a toggle with nothing to open yet stays in
 * place, disabled for assistive technology, with its tooltip saying why.
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
            tooltip: "Right dock (Ctrl+Alt+R)",
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
    // The tooltip may add the shortcut; the name stays the label alone.
    expect(html).toContain('data-tooltip="Right dock (Ctrl+Alt+R)" aria-label="Right dock"');
    expect(html).toContain('data-tooltip="Bottom dock" aria-label="Bottom dock"');
    expect(html.match(/bg-tone-attention-emphasis/g)).toHaveLength(1);
  });

  it("a toggle with nothing to open yet is disabled and its tooltip says why", () => {
    const html = renderStatic(
      createElement(PanelsToolbar, {
        toggles: [
          {
            key: "files",
            label: "Files",
            tooltip: "Choose a folder to browse its files.",
            glyph: "M0 0h1",
            active: false,
            unavailable: true,
            onToggle: () => {},
          },
        ],
      }),
    );
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain(
      'data-tooltip="Choose a folder to browse its files." aria-label="Files"',
    );
  });
});
