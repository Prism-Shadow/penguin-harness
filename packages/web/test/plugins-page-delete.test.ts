// @vitest-environment jsdom
import { createElement as h } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PluginCard, type PluginCardProps } from "../src/features/plugins/plugin-card";
import { LocaleProvider } from "../src/state/locale";
import { setActiveStrings } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { mount, click, unmountAll } from "./helpers/dom";

beforeEach(() => {
  localStorage.setItem("penguin.lang", "en");
  setActiveStrings(en);
});
afterEach(unmountAll);
for (const shared of [true, false]) {
  it(`does not offer global Delete in an installed library/module detail (${shared ? "shared" : "own"})`, async () => {
    const props: PluginCardProps = {
      row: {
        key: "library:mixed",
        name: "mixed",
        category: "other",
        library: {
          name: "mixed",
          package: "@penguinharness/mixed",
          source: "installed",
          version: "1",
          description: "Mixed",
          skills: [],
          hooks: [],
          mcpServers: [],
        },
        module: {
          specifier: "@penguinharness/mixed",
          entry: undefined,
          state: "active",
          shipped: true,
          ...(shared ? { shared: true, removeBlocked: en.plugins.sharedHint } : {}),
        },
      },
      status: "installed",
      usage: { usedBy: [], behind: [] },
      categoryTitle: "Other",
      showCategory: true,
      targets: [],
      installed: new Map(),
      canQuickStart: false,
      isAdmin: true,
      isOwner: true,
      projectId: "A",
      busy: false,
      blocked: false,
      onQuickStart: vi.fn(),
      onDeletePlugin: null,
      onToggleInstall: vi.fn(),
      onUpdateOutdated: vi.fn(),
      onModuleApply: vi.fn(),
      onMcpChanged: vi.fn(),
    };
    await mount(h(LocaleProvider, null, h(PluginCard, props)));
    const detail = document.querySelector("button");
    expect(detail).not.toBeNull();
    await click(detail!);
    const buttons = [...document.querySelectorAll("button")];
    expect(buttons.some((b) => b.textContent?.includes(en.plugins.deletePlugin))).toBe(false);
    const removes = buttons.filter(
      (b) => b.getAttribute("aria-label") === `${en.plugins.uninstall} mixed`,
    );
    expect(removes.length).toBeGreaterThan(0);
    expect(removes.every((b) => b.disabled === shared)).toBe(true);
  });
}
