// @vitest-environment jsdom
/**
 * A plugin's one install control and its flow: the server first, then the Agents.
 *
 * - Given a server install under way, the card's install control says the step it is at, in its
 *   one-line words — checking, downloading with its percent, installing, loading — never a word
 *   that says nothing; the flow says the step whole.
 * - Given a plugin not on the server whose offline archive carries Agent content, an admin's
 *   Install opens the flow on step 1 of 2: it says what installing on the server does, and its
 *   button hands the install to the page; while it runs the step shows its words and a bar; a
 *   failure stays on the step with the next steps (Plugin Sources, a zip import, dismiss).
 * - Given the same plugin, a member's flow ends at step 1: it asks an admin and says it did.
 * - A prepared plugin opens at agent selection. Only the chosen copy is added or removed.
 * - Given a module the build ships that another Project's shared table lists, the detail's
 *   Disable server module is held and described by the shared tag and its hint.
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
  marketCard: true,
  layout: "cover",
  row: marketRow,
  status: "available",
  usage: null,
  categoryTitle: "Office",
  showCategory: true,
  targets: [{ key: "helper", agent: agent("helper"), machine: null }],
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
const buttonWithText = (text: string, scope: ParentNode = document) =>
  [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
/** The market card's install control: its words, then the card's title. */
const installControl = (label: string) => buttonNamed(`${label} · computer-use`);
const dialog = () => document.querySelector('[role="dialog"]');

describe("the install control under way", () => {
  it("says each step the server install reaches", async () => {
    const steps: Array<[Partial<PluginCardProps>, string]> = [
      [{ stage: { stage: "checking" } }, words.stepShort.checking],
      [{ progress: { received: 40, total: 100 } }, en.plugins.downloading(40)],
      [{ stage: { stage: "installing", source: "offline" } }, words.stepShort.fromOffline],
      [{ stage: { stage: "loading" } }, words.stepShort.loading],
    ];
    for (const [step, label] of steps) {
      const page = await show(props({ busy: true, ...step }));
      expect(installControl(label), label).toBeDefined();
      await page.unmount();
    }
  });
});

describe("the flow of a plugin not on the server", () => {
  it("explains the shared server copy before starting an install", async () => {
    const onInstallServer = vi.fn();
    await show(props({ onInstallServer }));
    await click(installControl(en.skills.install)!);
    expect(dialog()!.querySelector('[role="progressbar"]')).toBeNull();
    expect(dialog()!.textContent).toContain(words.prepareForAgents);
    await click(buttonWithText(words.installServer)!);
    expect(onInstallServer).toHaveBeenCalledOnce();
  });

  it("shows the step's words while it runs, and a failure with its next steps", async () => {
    const running = await show(props({ busy: true, stage: { stage: "checking" } }));
    await click(installControl(words.stepShort.checking)!);
    expect(dialog()!.querySelector('[role="status"]')?.textContent).toContain(words.checking);
    await running.unmount();

    const p = props({
      failure: "@penguinharness/computer-use is not published on registry.npmjs.org yet.",
      onOpenSources: vi.fn(),
      onImportFile: vi.fn(),
      onDismissFailure: vi.fn(),
    });
    await show(p);
    await click(installControl(en.skills.install)!);
    expect(dialog()!.querySelector('[data-testid="install-failure"]')?.textContent).toContain(
      words.failedNote("@penguinharness/computer-use is not published on registry.npmjs.org yet."),
    );
    await click(buttonWithText(words.sourcesSettings)!);
    await click(buttonWithText(words.importFromFile)!);
    await click(buttonWithText(words.dismiss)!);
    expect(p.onOpenSources).toHaveBeenCalledOnce();
    expect(p.onImportFile).toHaveBeenCalledOnce();
    expect(p.onDismissFailure).toHaveBeenCalledOnce();
  });

  it("ends a member's at step 1: it asks an admin, and says it did", async () => {
    const onAskAdmin = vi.fn(async () => undefined);
    await show(props({ isAdmin: false, onAskAdmin }));
    await click(installControl(en.skills.install)!);
    expect(dialog()!.textContent).toContain(words.askBody);
    expect(buttonWithText(words.installServer)).toBeUndefined();
    await click(buttonWithText(words.askAdmin)!);
    expect(onAskAdmin).toHaveBeenCalledOnce();
    expect(dialog()!.textContent).toContain(words.asked);
  });
});

describe("a plugin on the server", () => {
  it("opens on its agents and only adds the selected copy", async () => {
    const p = props({ row: installedRow, status: "installed", usage: { usedBy: [], behind: [] } });
    await show(p);
    await click(installControl(en.skills.install)!);
    expect(dialog()!.textContent).toContain(words.chooseAgentHelp);
    expect(dialog()!.querySelector('input[value="helper"]:checked')).not.toBeNull();
    await click(buttonNamed(words.addToAgent("helper"))!);
    expect(p.onToggleInstall).toHaveBeenCalledWith("helper", LIBRARY, true);
  });

  it.each(["card", "detail"] as const)(
    "navigates in both directions without mutating the installation from the %s",
    async (entry) => {
      const onServerUninstall = vi.fn();
      const p = props({ row: installedRow, status: "installed", onServerUninstall });
      await show(p);
      if (entry === "detail") {
        await click(document.querySelector<HTMLElement>(".showcase-card-open")!);
        await click(buttonNamed(`${words.installAgent} computer-use`)!);
      } else {
        await click(installControl(en.skills.install)!);
      }
      await click(buttonWithText(words.backToServer)!);
      expect(buttonWithText(words.toAgents)).toBeDefined();
      expect(buttonWithText(words.uninstallServer)).toBeDefined();
      expect(onServerUninstall).not.toHaveBeenCalled();
      await click(buttonWithText(words.toAgents)!);
      expect(buttonNamed(words.addToAgent("helper"))).toBeDefined();
      expect(p.onToggleInstall).not.toHaveBeenCalled();
      await click(buttonWithText(words.backToServer)!);
      await click(buttonWithText(words.uninstallServer)!);
      expect(onServerUninstall).toHaveBeenCalledOnce();
    },
  );

  it.each([
    { isAdmin: false, row: installedRow },
    {
      isAdmin: true,
      row: { ...installedRow, library: { ...LIBRARY, source: "builtin" as const } },
    },
  ])("keeps server removal unavailable after going back", async (options) => {
    await show(props({ ...options, status: "installed", onServerUninstall: vi.fn() }));
    await click(installControl(en.skills.install)!);
    await click(buttonWithText(words.backToServer)!);
    expect(buttonWithText(words.uninstallServer)).toBeUndefined();
  });
});

describe("a shipped Skill with a Project server module", () => {
  const row = (state: NonNullable<PluginRow["module"]>["state"]): PluginRow => ({
    ...installedRow,
    library: { ...LIBRARY, source: "builtin", modules: true },
    module: { ...installedRow.module!, shipped: true, state },
  });
  it("offers an admin a single server install before selecting Agents", async () => {
    const apply = vi.fn();
    await show(
      props({
        row: row("none"),
        onInstallServer: apply,
        usage: { usedBy: ["helper"], behind: [] },
      }),
    );
    await click(installControl(en.skills.install)!);
    expect(dialog()!.querySelector('[role="progressbar"]')).toBeNull();
    await click(buttonWithText(words.enableModule, dialog()!)!);
    expect(apply).toHaveBeenCalledOnce();
  });
  it("keeps the member's Agent install and shows that the Project module is off", async () => {
    await show(props({ row: row("none"), isAdmin: false }));
    await click(installControl(en.skills.install)!);
    expect(dialog()!.textContent).toContain(words.projectServiceOff);
    expect(buttonNamed(words.addToAgent("helper"))).toBeDefined();
    await click(buttonWithText(words.backToServer)!);
    expect(buttonWithText(words.enableModule)).toBeUndefined();
  });
  it("shows a module-loading failure even when the package already carries a Skill", async () => {
    const failed = row("failed");
    failed.module!.error = "The module did not load.";
    await show(props({ row: failed, status: "failed" }));
    await click(installControl(en.plugins.status.failed)!);
    expect(dialog()!.textContent).toContain("The module did not load.");
    expect(dialog()!.querySelector('[role="progressbar"]')).toBeNull();
  });
});

describe("a shipped module another Project shares", () => {
  it("holds the detail's Disable server module, described by the shared tag and its hint", async () => {
    const shared: PluginRow = {
      key: "module:@penguinharness/sandbox-bwrap",
      name: "sandbox-bwrap",
      category: "sandbox",
      module: {
        specifier: "@penguinharness/sandbox-bwrap",
        entry: undefined,
        state: "active",
        shipped: true,
        shared: true,
        removeBlocked: en.plugins.sharedHint,
      },
    };
    await show(props({ row: shared, status: "installed", layout: "row", marketCard: false }));
    await click(document.querySelector<HTMLElement>("[data-plugin] button")!);
    const disable = buttonNamed(`${words.disableModule} sandbox-bwrap`)!;
    expect(disable.disabled).toBe(true);
    const ids = disable.getAttribute("aria-describedby")!.split(" ");
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toEqual([
      en.plugins.sharedTag,
      en.plugins.sharedHint,
    ]);
  });
});
