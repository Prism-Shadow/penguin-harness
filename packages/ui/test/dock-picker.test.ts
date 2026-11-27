/**
 * DockPicker (src/components/shell/dock-picker/dock-picker.tsx): the start page of an empty dock.
 *
 * - Given choices, it renders one launch tile per choice, in the order given, each named by its
 *   choice; a choice's shortcut hint becomes the tile's marked tooltip, and a choice without one
 *   carries no tooltip of its own.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { DockPicker } from "../src/components/shell/dock-picker/dock-picker";
import { renderStatic } from "../src/testing";

describe("DockPicker", () => {
  it("renders one tile per choice in order, a shortcut as the tile's marked hint", () => {
    const html = renderStatic(
      createElement(DockPicker, {
        horizontal: false,
        label: "Open in this dock",
        choices: [
          { key: "agents", name: "Agents", icon: () => "A", onLaunch: () => {} },
          {
            key: "terminal",
            name: "Terminal",
            hint: "Terminal (Ctrl+`)",
            icon: () => "T",
            onLaunch: () => {},
          },
        ],
      }),
    );
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html.indexOf('data-testid="dock-pick-agents"')).toBeLessThan(
      html.indexOf('data-testid="dock-pick-terminal"'),
    );
    expect(html).toContain('data-tooltip="Terminal (Ctrl+`)" data-tooltip-extra="true"');
    expect(html.match(/data-tooltip=/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Open in this dock"');
  });
});
