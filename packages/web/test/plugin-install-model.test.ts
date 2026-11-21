// @vitest-environment jsdom
/**
 * A plugin card's two installs (05 「插件库」 「安装模型」): the server's control and the Agent's.
 *
 * - Given a server install under way, the control that was clicked says the step it is at —
 *   downloading with its percent, then installing from the offline archive, then loading the
 *   module — and takes no second press; it never sits on a word that says nothing.
 * - Given the last server install failed, the card says why and offers the next steps: the Plugin
 *   Sources settings, a zip import (an admin's only), and dismissing it.
 * - Given a plugin not on the server whose offline archive carries Agent content, the card offers
 *   Install on Agent; its dialog says, before any click, that the server install comes first (an
 *   admin) or that an admin is asked (a member); Install on this server's Agent hands that Agent
 *   to the page, and a machine's Agent is held, saying why.
 * - Given a plugin an admin put on the server, its dialog says uninstalling it from the server
 *   uninstalls it from every Agent, and the server control asks the page to uninstall it.
 */
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSummary, PluginIndexEntry, PluginItem } from "@prismshadow/penguin-server/api";
import { PluginCard, type PluginCardProps } from "../src/features/plugins/plugin-card";
import type { PluginRow } from "../src/features/plugins/plugin-groups";
import { LocaleProvider } from "../src/state/locale";
import { setActiveStrings } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { click, mount, unmountAll } from "./helpers/dom";

const words = en.plugins.installModel;

beforeEach(() => {
  localStorage.setItem("penguin.lang", "en");
  setActiveStrings(en);
});
afterEach(unmountAll);

const ENTRY: PluginIndexEntry = {
  name: "@penguinharness/computer-use",
  version: "0.2.18",
  description: "Computer use.",
  authors: ["Prism Shadow"],
  license: "Apache-2.0",
  offline: { version: "0.2.18", library: true, modules: true },
};

/** Not on the server yet: a market row, its offline archive saying it carries a Skill. */
const marketRow: PluginRow = {
  key: "module:@penguinharness/computer-use",
  name: "computer-use",
  category: "office-productivity",
  module: { specifier: ENTRY.name, entry: ENTRY, state: "none", shipped: false },
};

const LIBRARY: PluginItem = {
  name: "computer-use",
  package: ENTRY.name,
  source: "installed",
  version: "0.2.18",
  description: "Computer use.",
  skills: [{ name: "computer-use", description: "", version: "2026.11.19.1" }],
  hooks: [],
  mcpServers: [],
};

/** On the server: installed by an admin, its module listed and running. */
const installedRow: PluginRow = {
  ...marketRow,
  key: "library:computer-use",
  library: LIBRARY,
  module: { ...marketRow.module!, state: "active" },
};

const agent = (agentId: string): AgentSummary => ({ agentId }) as AgentSummary;

const props = (over: Partial<PluginCardProps> = {}): PluginCardProps => ({
  row: marketRow,
  status: "available",
  usage: null,
  categoryTitle: "Office",
  showCategory: true,
  targets: [
    { key: "helper", agent: agent("helper"), machine: null },
    {
      key: "m1/helper",
      agent: agent("helper"),
      machine: { machineId: "m1", label: "gpu-box", live: true },
    },
  ],
  installed: new Map(),
  canQuickStart: false,
  isAdmin: true,
  isOwner: true,
  projectId: "A",
  busy: false,
  blocked: false,
  onQuickStart: vi.fn(),
  onToggleInstall: vi.fn(async () => true),
  onUpdateOutdated: vi.fn(async () => undefined),
  onModuleApply: vi.fn(),
  onMcpChanged: vi.fn(),
  ...over,
});

const show = (p: PluginCardProps) => mount(h(LocaleProvider, null, h(PluginCard, p)));
const buttonNamed = (name: string) =>
  [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === name);
const buttonWithText = (text: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);

describe("the server control under way", () => {
  it("says each step the install reaches, and takes no second press", async () => {
    const steps: Array<[Partial<PluginCardProps>, string]> = [
      [{ progress: { received: 40, total: 100 } }, en.plugins.downloading(40)],
      [{ stage: { stage: "installing", source: "offline" } }, words.fromOffline],
      [{ stage: { stage: "loading" } }, words.loading],
      [{ stage: { stage: "installing", source: "registry" } }, words.installing],
    ];
    for (const [step, label] of steps) {
      const page = await show(props({ busy: true, ...step }));
      const control = buttonNamed(`${label} computer-use`);
      expect(control, label).toBeDefined();
      expect(control!.disabled).toBe(true);
      expect(control!.getAttribute("aria-busy")).toBe("true");
      await page.unmount();
    }
  });
});

describe("a failed server install", () => {
  it("says why under the card and offers the next steps", async () => {
    const p = props({
      failure: "@penguinharness/computer-use is not published on registry.npmjs.org yet.",
      onOpenSources: vi.fn(),
      onImportFile: vi.fn(),
      onDismissFailure: vi.fn(),
    });
    await show(p);
    const note = document.querySelector('[data-testid="install-failure"]');
    expect(note?.textContent).toContain(
      words.failedNote("@penguinharness/computer-use is not published on registry.npmjs.org yet."),
    );
    await click(buttonWithText(words.sourcesSettings)!);
    await click(buttonWithText(words.importFromFile)!);
    await click(buttonWithText(words.dismiss)!);
    expect(p.onOpenSources).toHaveBeenCalledOnce();
    expect(p.onImportFile).toHaveBeenCalledOnce();
    expect(p.onDismissFailure).toHaveBeenCalledOnce();
    // The control is back, ready for another try.
    expect(buttonNamed(`${words.installServer} computer-use`)?.disabled).toBe(false);
  });

  it("offers a member no zip import", async () => {
    await show(
      props({
        isAdmin: false,
        failure: "unreachable",
        onOpenSources: vi.fn(),
        onImportFile: vi.fn(),
      }),
    );
    expect(buttonWithText(words.importFromFile)).toBeUndefined();
  });
});

describe("installing on an Agent before the server has it", () => {
  it("says the server install comes first, then hands this server's Agent to the page", async () => {
    const onInstallBeforeServer = vi.fn(async () => undefined);
    await show(props({ onInstallBeforeServer }));
    await click(buttonNamed(`${words.installAgent} computer-use`)!);
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain(words.notOnServerAdmin);
    await click(buttonNamed(`${en.skills.install} helper`)!);
    expect(onInstallBeforeServer).toHaveBeenCalledWith("helper");
    // A machine's Agent installs from that machine's own server: held, saying so.
    const there = buttonNamed(`${en.skills.install} helper ${en.chat.machineTag("gpu-box")}`)!;
    expect(there.disabled).toBe(true);
    expect(there.getAttribute("title") ?? there.getAttribute("data-tooltip")).toBe(
      words.machineFirst,
    );
  });

  it("tells a member an admin is asked", async () => {
    await show(props({ isAdmin: false, onInstallBeforeServer: vi.fn(async () => undefined) }));
    await click(buttonNamed(`${words.installAgent} computer-use`)!);
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain(
      words.notOnServerMember,
    );
  });

  it("shows the row's step while its server install runs", async () => {
    await show(
      props({
        onInstallBeforeServer: vi.fn(async () => undefined),
        agentBusy: { key: "helper", label: words.loading },
      }),
    );
    await click(buttonNamed(`${words.installAgent} computer-use`)!);
    const row = buttonNamed(`${en.skills.install} helper`)!;
    expect(row.textContent).toBe(words.loading);
    expect(row.disabled).toBe(true);
  });
});

describe("a plugin on the server", () => {
  it("says uninstalling from the server takes it from every Agent, and asks the page to", async () => {
    const onServerUninstall = vi.fn();
    await show(props({ row: installedRow, status: "installed", onServerUninstall }));
    await click(buttonNamed(`${words.uninstallServer} computer-use`)!);
    expect(onServerUninstall).toHaveBeenCalledOnce();
    await click(buttonNamed(`${words.installAgent} computer-use`)!);
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain(words.onServer);
  });
});
