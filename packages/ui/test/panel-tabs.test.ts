/**
 * PanelTabs (src/components/navigation/panel-tabs/panel-tabs.tsx): the strip inside a dock panel
 * — the browser's pages, a conversation's shells — under the dock's own pills.
 *
 * - Given a shown tab, it is the one tab selected and marked active; with none shown, none is.
 * - Every tab has its own × beside its select button (never inside it), named after the tab; the
 *   × carries a hover hint only when the caller gives one (a consequence, a shortcut).
 * - A tab's hint is its whole title, marked as saying more only when the caller says it does.
 * - The "+" is named by the caller, and every part carries the caller's test-id prefix.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { PanelTabs } from "../src/components/navigation/panel-tabs/panel-tabs";
import type {
  PanelTabItem,
  PanelTabsProps,
} from "../src/components/navigation/panel-tabs/panel-tabs";
import { renderStatic } from "../src/testing";

const TABS: PanelTabItem[] = [
  { key: "t1", label: "1: zsh", icon: "T", title: "zsh — /repo", titleExtra: true },
  { key: "t2", label: "2: vim notes.md", icon: "T" },
];

const render = (props: Partial<PanelTabsProps> = {}) =>
  renderStatic(
    createElement(PanelTabs, {
      tabs: TABS,
      active: "t2",
      onSelect: () => {},
      onClose: () => {},
      onNew: () => {},
      listLabel: "Terminal tabs",
      newLabel: "New terminal",
      closeLabel: "Kill this terminal",
      testIdPrefix: "terminal",
      ...props,
    }),
  );

describe("PanelTabs", () => {
  it("selects and marks exactly the shown tab, and none when nothing is shown", () => {
    const html = render();
    expect(html).toContain('role="tablist" aria-label="Terminal tabs"');
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html).toContain('data-tab-id="t2" data-active="true"');
    expect(html).toContain('data-tab-id="t1" data-active="false"');
    expect(render({ active: null })).not.toContain('aria-selected="true"');
  });

  it("gives every tab its own × beside the select button, named after the tab", () => {
    const html = render();
    expect(html).not.toMatch(/<button[^>]*role="tab"(?:(?!<\/button>).)*<button/);
    expect(html).toContain('aria-label="Kill this terminal: 1: zsh"');
    expect(html).toContain('aria-label="Kill this terminal: 2: vim notes.md"');
    expect(html.match(/data-testid="terminal-tab-close"/g)).toHaveLength(2);
    // No hint on a plain ×; the caller's hint when it says more than the glyph.
    expect(html).not.toMatch(/data-tooltip="[^"]*"[^>]*data-testid="terminal-tab-close"/);
    expect(render({ closeHint: "Kill this terminal (Ctrl+Alt+`)" })).toContain(
      'data-tooltip="Kill this terminal (Ctrl+Alt+`)" data-tooltip-extra="true"',
    );
  });

  it("hints a tab with its whole title, marked only when it says more than the name", () => {
    const html = render();
    expect(html).toContain('data-tooltip="zsh — /repo" data-tooltip-extra="true"');
    expect(html).toContain('data-tooltip="2: vim notes.md" data-tooltip-extra="false"');
  });

  it("names the + and prefixes every part's test id", () => {
    const html = render({ testIdPrefix: "builtin-browser", newLabel: "New tab" });
    expect(html).toContain('aria-label="New tab" data-testid="builtin-browser-new-tab"');
    expect(html.match(/data-testid="builtin-browser-tab"/g)).toHaveLength(2);
  });
});
