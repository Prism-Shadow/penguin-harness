// @vitest-environment jsdom
/**
 * A plugin's page offers no global Delete: given an installed package the build ships (its own
 * Project's, or one another Project's shared table lists), the page's More menu disables its
 * server module for this Project — held, saying why, where the shared table lists it.
 */
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
  it(`offers no global Delete on an installed library/module page (${shared ? "shared" : "own"})`, async () => {
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
      onToggleInstall: vi.fn(),
      onUpdateOutdated: vi.fn(),
      onModuleApply: vi.fn(),
      onMcpChanged: vi.fn(),
      surface: "page",
    };
    await mount(h(LocaleProvider, null, h(PluginCard, props)));
    const more = [...document.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === en.plugins.moreActions("mixed"),
    );
    expect(more).toBeDefined();
    await click(more!);
    const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    expect(items.some((b) => b.textContent?.includes(en.plugins.deletePlugin))).toBe(false);
    // Shipped with the build: its server module is disabled for this Project, never uninstalled.
    const removes = items.filter((b) =>
      b.textContent?.includes(en.plugins.installModel.disableModule),
    );
    expect(removes).toHaveLength(1);
    expect(removes[0]!.disabled).toBe(shared);
  });
}
