// @vitest-environment jsdom
/**
 * A plugin's one button and its install steps: the server first, then the Agents, then ready.
 *
 * - Given a server install under way, the button says the step it is at, in its one-line words —
 *   looking up, downloading with its percent, installing, starting — busy, over the install's
 *   staged bar.
 * - Given a plugin not on the server whose offline archive carries Agent content, an admin's
 *   Install opens the steps on the server's page, the run's steps named above it (server, Agents,
 *   ready) and no bar: it says what installing on the server does, and its Install hands the
 *   install to the page. While it runs the page shows the staged bar, the step's sentence and that
 *   closing carries on; a failed install's button is Retry, whose page stops the bar where the
 *   server's reports stood, with the reason, Retry and the next steps (Plugin Sources, a zip
 *   import, dismiss).
 * - Given the install the steps ran completes, they move on to the Agents by themselves with a
 *   way to choose later, and once one is added, Next says the plugin is ready and who has it.
 * - A member asks an admin from the card or the page, in one page with no run of steps; asking
 *   never runs the server install or opens the Agent chooser.
 * - A plugin on the server opens on its Agents, and only the chosen copy is added. An admin whose
 *   install it is may page back to the server (to uninstall it there) and on again, changing
 *   nothing; a member, or a plugin the build ships, has no server page.
 * - Given a module the build ships that another Project's shared table lists, its page's Disable
 *   server module is held, saying why.
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
/** The install steps' run, by name, and the one on show. */
const stepNames = () =>
  [...(dialog()?.querySelectorAll("ol > li") ?? [])].map(
    (li) => li.querySelector("span.truncate")?.firstChild?.textContent ?? "",
  );
const currentStep = () =>
  dialog()?.querySelector('[aria-current="step"] span.truncate')?.firstChild?.textContent;
/** The staged bar's segments under `scope`, each as `stage:state`. */
const stagesOf = (scope: ParentNode) =>
  [...scope.querySelectorAll("[data-stage]")].map(
    (segment) => `${segment.getAttribute("data-stage")}:${segment.getAttribute("data-state")}`,
  );

describe("the button under way", () => {
  it("says each step the server install reaches, over the install's staged bar", async () => {
    const steps: Array<[Partial<PluginCardProps>, string]> = [
      [{ stage: { stage: "checking" } }, words.stepShort.checking],
      [{ progress: { received: 40, total: 100 } }, en.plugins.downloading(40)],
      [{ stage: { stage: "installing", source: "offline" } }, words.stepShort.fromOffline],
      [{ stage: { stage: "loading" } }, words.stepShort.loading],
    ];
    for (const [step, label] of steps) {
      const page = await show(props({ busy: true, ...step }));
      expect(installControl(label), label).toBeDefined();
      expect(installControl(label)!.getAttribute("aria-busy"), label).toBe("true");
      expect(installControl(label)!.querySelector('[role="progressbar"]'), label).not.toBeNull();
      await page.unmount();
    }
  });
});

describe("the steps of a plugin not on the server", () => {
  it("open on the server's page, which says what installing there does, with the run's steps above", async () => {
    const onInstallServer = vi.fn();
    await show(props({ onInstallServer }));
    await click(installControl(en.skills.install)!);
    expect(dialog()!.querySelector('[role="progressbar"]')).toBeNull();
    expect(stepNames()).toEqual([words.stepServer, words.stepAgents, words.stepReady]);
    expect(currentStep()).toBe(words.stepServer);
    expect(dialog()!.textContent).toContain(words.prepareForAgents);
    await click(buttonWithText(en.skills.install, dialog()!)!);
    expect(onInstallServer).toHaveBeenCalledOnce();
  });

  it("distinguish a confirmed server-only package from a listing with unknown contents", async () => {
    for (const known of [true, false]) {
      const { offline: _offline, ...published } = ENTRY;
      const entry = known
        ? { ...published, offline: { version: ENTRY.version, library: false, modules: true } }
        : published;
      const row = { ...marketRow, module: { ...marketRow.module!, entry } };
      const page = await show(props({ row }));
      await click(installControl(en.skills.install)!);
      expect(dialog()!.textContent).toContain(known ? words.prepareService : words.preparePackage);
      expect(dialog()!.querySelector("input[type=radio]")).toBeNull();
      await page.unmount();
    }
  });

  it("show the step's sentence under the staged bar while it runs, and a failure with its next steps", async () => {
    const running = await show(props({ busy: true, stage: { stage: "checking" } }));
    await click(installControl(words.stepShort.checking)!);
    const status = dialog()!.querySelector('[role="status"]')!;
    expect(status.textContent).toContain(words.checking);
    expect(stagesOf(status)).toEqual(["check:running", "fetch:pending", "start:pending"]);
    expect(dialog()!.textContent).toContain(words.noCancel);
    expect(buttonWithText(words.background, dialog()!)).toBeDefined();
    await running.unmount();

    const reason = "@penguinharness/computer-use is not published on registry.npmjs.org yet.";
    const onInstallServer = vi.fn();
    const p = props({
      failure: {
        failure: { text: reason, report: null },
        stage: { stage: "installing", source: "channel" },
        progress: { received: 60, total: 100 },
      },
      onInstallServer,
      onOpenSources: vi.fn(),
      onImportFile: vi.fn(),
      onDismissFailure: vi.fn(),
    });
    await show(p);
    // A failed install's button is Retry, which opens the server's page with why.
    await click(installControl(en.common.retry)!);
    const failure = dialog()!.querySelector('[data-testid="install-failure"]')!;
    expect(failure.textContent).toContain(words.failedTitle("computer-use"));
    expect(failure.textContent).toContain(reason);
    // The bar stops in the download, where the server's last report stood.
    expect(stagesOf(dialog()!)).toEqual(["check:done", "fetch:stopped", "start:pending"]);
    await click(buttonWithText(en.common.retry, dialog()!)!);
    expect(onInstallServer).toHaveBeenCalledOnce();
    await click(buttonWithText(words.sourcesSettings, dialog()!)!);
    await click(buttonWithText(words.importFromFile, dialog()!)!);
    await click(buttonWithText(words.dismiss, dialog()!)!);
    expect(p.onOpenSources).toHaveBeenCalledOnce();
    expect(p.onImportFile).toHaveBeenCalledOnce();
    expect(p.onDismissFailure).toHaveBeenCalledOnce();
  });

  it.each(["card", "page"] as const)(
    "let a member ask an admin from the plugin's %s, in one page with no run of steps",
    async (surface) => {
      const onAskAdmin = vi.fn(async () => undefined);
      const onInstallServer = vi.fn();
      const { offline: _offline, ...published } = ENTRY;
      const row = { ...marketRow, module: { ...marketRow.module!, entry: published } };
      await show(props({ row, surface, isAdmin: false, onAskAdmin, onInstallServer }));
      await click(installControl(en.skills.install)!);
      const flow = dialog()!;
      expect(flow.textContent).toContain(words.askBody);
      expect(stepNames()).toEqual([]);
      await click(buttonWithText(words.askAdmin, flow)!);
      expect(onAskAdmin).toHaveBeenCalledOnce();
      expect(onInstallServer).not.toHaveBeenCalled();
      expect(flow.textContent).toContain(words.asked);
      expect(flow.querySelector("[type=radio]")).toBeNull();
    },
  );
});

describe("the steps an install ran, once the server has the plugin", () => {
  it("move on to the Agents by themselves, then say the plugin is ready and who has it", async () => {
    const before = props({ onInstallServer: vi.fn() });
    const page = await show(before);
    await click(installControl(en.skills.install)!);
    await click(buttonWithText(en.skills.install, dialog()!)!);
    // The install runs on the button while the steps stay open, then the server's answer lands:
    // the same card now carries the library plugin.
    await page.rerender(
      h(
        LocaleProvider,
        null,
        h(PluginCard, { ...before, busy: true, stage: { stage: "loading" } }),
      ),
    );
    const after = {
      ...before,
      row: installedRow,
      status: "installed" as const,
      usage: { usedBy: [], behind: [] },
    };
    await page.rerender(h(LocaleProvider, null, h(PluginCard, after)));
    expect(currentStep()).toBe(words.stepAgents);
    expect(dialog()!.textContent).toContain(words.chooseAfterInstall);
    expect(buttonWithText(words.chooseLater, dialog()!)).toBeDefined();
    await click(buttonNamed(words.addToAgent("helper"))!);
    await click(buttonWithText(words.next, dialog()!)!);
    expect(currentStep()).toBe(words.stepReady);
    expect(dialog()!.textContent).toContain(words.doneTitle("computer-use"));
    expect(dialog()!.textContent).toContain(words.doneAgents("helper"));
  });
});

describe("a plugin on the server", () => {
  it("opens its steps on the Agents and adds only the selected copy", async () => {
    const p = props({ row: installedRow, status: "installed", usage: { usedBy: [], behind: [] } });
    await show(p);
    await click(installControl(en.skills.install)!);
    expect(currentStep()).toBe(words.stepAgents);
    expect(dialog()!.textContent).toContain(words.chooseAgentHelp);
    expect(dialog()!.querySelector('[role="progressbar"]')).toBeNull();
    expect(dialog()!.querySelector('input[value="helper"]:checked')).not.toBeNull();
    await click(buttonNamed(words.addToAgent("helper"))!);
    expect(p.onToggleInstall).toHaveBeenCalledWith("helper", LIBRARY, true);
  });

  it("lets an admin page back to the server and on again without changing anything", async () => {
    const onServerUninstall = vi.fn();
    const p = props({ row: installedRow, status: "installed", onServerUninstall });
    await show(p);
    await click(installControl(en.skills.install)!);
    expect(stepNames()).toEqual([words.stepServer, words.stepAgents, words.stepReady]);
    await click(buttonWithText(words.back, dialog()!)!);
    expect(currentStep()).toBe(words.stepServer);
    expect(buttonWithText(words.uninstallServer, dialog()!)).toBeDefined();
    expect(onServerUninstall).not.toHaveBeenCalled();
    await click(buttonWithText(words.next, dialog()!)!);
    expect(buttonNamed(words.addToAgent("helper"))).toBeDefined();
    expect(p.onToggleInstall).not.toHaveBeenCalled();
    await click(buttonWithText(words.back, dialog()!)!);
    await click(buttonWithText(words.uninstallServer, dialog()!)!);
    expect(onServerUninstall).toHaveBeenCalledOnce();
  });

  it.each([
    { isAdmin: false, row: installedRow },
    {
      isAdmin: true,
      row: { ...installedRow, library: { ...LIBRARY, source: "builtin" as const } },
    },
  ])("offers no server page where nothing there is the reader's to change", async (options) => {
    await show(props({ ...options, status: "installed", onServerUninstall: vi.fn() }));
    await click(installControl(en.skills.install)!);
    expect(stepNames()).toEqual([words.stepAgents, words.stepReady]);
    expect(buttonWithText(words.back, dialog()!)).toBeUndefined();
    expect(buttonWithText(words.uninstallServer)).toBeUndefined();
  });
});

describe("a shipped Skill with a Project server module", () => {
  const row = (state: NonNullable<PluginRow["module"]>["state"]): PluginRow => ({
    ...installedRow,
    library: { ...LIBRARY, source: "builtin", modules: true },
    module: { ...installedRow.module!, shipped: true, state },
  });
  it("offers an admin a single server enable before selecting Agents", async () => {
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
    await click(buttonWithText(words.enableNow, dialog()!)!);
    expect(apply).toHaveBeenCalledOnce();
  });
  it("keeps the member's Agent install and shows that the Project module is off", async () => {
    await show(props({ row: row("none"), isAdmin: false }));
    await click(installControl(en.skills.install)!);
    expect(currentStep()).toBe(words.stepAgents);
    expect(dialog()!.textContent).toContain(words.projectServiceOff);
    expect(buttonNamed(words.addToAgent("helper"))).toBeDefined();
    await click(buttonWithText(words.back, dialog()!)!);
    expect(buttonWithText(words.enableNow)).toBeUndefined();
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
  it("holds its page's Disable server module, saying why", async () => {
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
    await show(props({ row: shared, status: "installed", surface: "page" }));
    await click(buttonNamed(en.plugins.moreActions("sandbox-bwrap"))!);
    const disable = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (item) => item.textContent?.includes(words.disableModule),
    )!;
    expect(disable.disabled || disable.getAttribute("aria-disabled") === "true").toBe(true);
    expect(disable.textContent).toContain(en.plugins.sharedHint);
  });
});
