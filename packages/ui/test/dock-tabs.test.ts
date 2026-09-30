/**
 * DockTabs (src/components/navigation/dock-tabs/dock-tabs.tsx): a dock's tab strip — a tab list
 * on the underline hook, whose pills hold a select button and a sibling ×.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { DockTabs } from "../src/components/navigation/dock-tabs/dock-tabs";
import type { DockTabItem } from "../src/components/navigation/dock-tabs/dock-tabs";
import { classTokens, renderStatic } from "../src/testing";

const TABS: DockTabItem[] = [
  { key: "workspace", label: "Files", glyph: "F", closeLabel: "Close tab" },
  {
    key: "terminal:t1",
    label: "1: zsh",
    title: "zsh — /repo",
    glyph: "T",
    badge: true,
    closeLabel: "Kill shell",
    closeShortcut: "Ctrl+W",
    terminalId: "t1",
  },
];

const render = (active: string | null = "workspace") =>
  renderStatic(
    createElement(DockTabs, { tabs: TABS, active, onSelect: () => {}, onClose: () => {} }),
  );

describe("DockTabs", () => {
  it("is a tab list on the underline hook, with exactly the shown tab selected", () => {
    const html = render();
    expect(html).toMatch(
      /^<div role="tablist" data-testid="dock-tab-strip" class="ui-underline-nav /,
    );
    expect(html.match(/role="tab"/g)).toHaveLength(2);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html).toContain('data-tab-id="workspace" data-active="true"');
    expect(render(null)).not.toContain('aria-selected="true"');
  });

  it("keeps the × a sibling of the select button, never nested in it", () => {
    const html = render();
    expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>).)*<button/);
    expect(html.match(/data-testid="dock-tab-close"/g)).toHaveLength(2);
  });

  it("names each × after its tab, with the shortcut in the tooltip only", () => {
    const html = render();
    expect(html).toContain('aria-label="Close tab: Files"');
    expect(html).toContain('aria-label="Kill shell: 1: zsh"');
    expect(html).toContain('data-tooltip="Kill shell (Ctrl+W)"');
    expect(html).toContain('data-tooltip="zsh — /repo"');
    expect(html).toContain('data-terminal-id="t1"');
  });

  it("marks a tab's badge with the attention dot, in tokens", () => {
    const html = render();
    expect(html.match(/bg-tone-attention-emphasis/g)).toHaveLength(1);
    expect(classTokens(html)).toEqual(
      expect.arrayContaining(["bg-line-muted", "text-fg-muted", "text-fg-subtle"]),
    );
  });
});
