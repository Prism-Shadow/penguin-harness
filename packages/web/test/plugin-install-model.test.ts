// @vitest-environment jsdom
/**
 * A plugin's one install control and its flow: the server first, then the Agents.
 *
 * - Given a server install under way, the card's install control says the step it is at, in its
 *   one-line words — looking up, downloading with its percent, installing, starting — over the
 *   install's staged bar; the flow says the step as a sentence under the same bar.
 * - Given a plugin not on the server whose offline archive carries Agent content, an admin's
 *   Install opens the flow with no bar: it says what installing on the server does, and its
 *   button hands the install to the page; while it runs the flow shows the staged bar and the
 *   step's sentence, and says the install carries on if the sheet is closed; a failure stops the
 *   bar where the server's reports stood, with the reason, Try again and the next steps (Plugin
 *   Sources, a zip import, dismiss).
 * - Given the install this sheet ran is complete, the flow hands over to the Agents with a way
 *   to choose later, and once one is added says the plugin is ready and who has it.
 * - Members can request an Agent package or an unread release, from the card or its detail.
 *   A request never runs the server install or opens the Agent chooser.
 * - A prepared plugin opens at agent selection. Only the chosen copy is added or removed.
 * - Given a module the build ships that another Project's shared table lists, the detail's
 *   Disable server module is held and described by the shared tag and its hint.
 */
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSummary, PluginIndexEntry, PluginItem } from "@prismshadow/penguin-server/api";
import { PluginCard, type PluginCardProps } from "@prismshadow/penguin-library-plugin/web/plugin-card";
import type { PluginRow } from "@prismshadow/penguin-library-plugin/web/plugin-groups";
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
/** The staged bar's segments under `scope`, each as `stage:state`. */
const stagesOf = (scope: ParentNode) =>
  [...scope.querySelectorAll("[data-stage]")].map(
    (segment) => `${segment.getAttribute("data-stage")}:${segment.getAttribute("data-state")}`,
  );

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
      // The same staged bar the flow draws, at the control's size.
      expect(installControl(label)!.querySelector('[role="progressbar"]'), label).not.toBeNull();
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
    expect(dialog()!.textContent).toMatch(/all projects on this server/i);
    expect(dialog()!.textContent).toContain(words.prepareForAgents);
    await click(buttonWithText(en.skills.install, dialog()!)!);
    expect(onInstallServer).toHaveBeenCalledOnce();
  });

  it("distinguishes a confirmed server-only package from a listing with unknown contents", async () => {
    for (const known of [true, false]) {
      const { offline: _offline, ...published } = ENTRY;
      const entry = known
        ? { ...published, offline: { version: ENTRY.version, library: false, modules: true } }
        : published;
      const row = { ...marketRow, module: { ...marketRow.module!, entry } };
      const page = await show(props({ row }));
      await click(installControl(en.skills.install)!);
      expect(dialog()!.textContent).toMatch(/all projects on this server/i);
      expect(dialog()!.textContent).toContain(known ? words.prepareService : words.preparePackage);
      expect(dialog()!.querySelector("input[type=radio]")).toBeNull();
      await page.unmount();
    }
  });

  it("shows the step's sentence under the staged bar while it runs, and a failure with its next steps", async () => {
    const running = await show(props({ busy: true, stage: { stage: "checking" } }));
    await click(installControl(words.stepShort.checking)!);
    const status = dialog()!.querySelector('[role="status"]')!;
    expect(status.textContent).toContain(words.checking);
    expect(stagesOf(status)).toEqual([
      "check:running",
      "fetch:pending",
      "start:pending",
      "agents:pending",
    ]);
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
    await click(installControl(en.skills.install)!);
    const failure = dialog()!.querySelector('[data-testid="install-failure"]')!;
    expect(failure.textContent).toContain(words.failedTitle("computer-use"));
    expect(failure.textContent).toContain(reason);
    // The bar stops in the download, where the server's last report stood.
    expect(stagesOf(dialog()!)).toEqual([
      "check:done",
      "fetch:stopped",
      "start:pending",
      "agents:pending",
    ]);
    await click(buttonWithText(en.common.retry, dialog()!)!);
    expect(onInstallServer).toHaveBeenCalledOnce();
    await click(buttonWithText(words.sourcesSettings)!);
    await click(buttonWithText(words.importFromFile)!);
    await click(buttonWithText(words.dismiss)!);
    expect(p.onOpenSources).toHaveBeenCalledOnce();
    expect(p.onImportFile).toHaveBeenCalledOnce();
    expect(p.onDismissFailure).toHaveBeenCalledOnce();
  });

  it.each(["archive", "published card", "published detail"])(
    "lets a member request a package from its %s",
    async (entryPoint) => {
      const onAskAdmin = vi.fn(async () => undefined);
      const onInstallServer = vi.fn();
      const { offline: _offline, ...published } = ENTRY;
      const row =
        entryPoint === "archive"
          ? marketRow
          : { ...marketRow, module: { ...marketRow.module!, entry: published } };
      await show(props({ row, isAdmin: false, onAskAdmin, onInstallServer }));
      if (entryPoint === "published detail") {
        await click(document.querySelector<HTMLElement>(".showcase-card-open")!);
        await click(buttonNamed(`${words.askAdmin} computer-use`)!);
      } else {
        await click(installControl(en.skills.install)!);
      }
      const flow = [...document.querySelectorAll('[role="dialog"]')].at(-1)!;
      expect(flow.textContent).toContain(words.askBody);
      expect(buttonWithText(words.installServer, flow)).toBeUndefined();
      expect(buttonWithText(words.uninstallServer, flow)).toBeUndefined();
      await click(buttonWithText(words.askAdmin, flow)!);
      expect(onAskAdmin).toHaveBeenCalledOnce();
      expect(onInstallServer).not.toHaveBeenCalled();
      expect(flow.textContent).toContain(words.asked);
      expect(flow.querySelector("[type=radio]")).toBeNull();
    },
  );
});

describe("the install this sheet ran, once the server has the plugin", () => {
  it("hands over to the Agents, then says the plugin is ready and who has it", async () => {
    const before = props({ onInstallServer: vi.fn() });
    const page = await show(before);
    await click(installControl(en.skills.install)!);
    // The server's answer lands: the same card now carries the library plugin.
    const after = {
      ...before,
      row: installedRow,
      status: "installed" as const,
      usage: { usedBy: [], behind: [] },
    };
    await page.rerender(h(LocaleProvider, null, h(PluginCard, after)));
    expect(dialog()!.textContent).toContain(words.chooseAfterInstall);
    expect(stagesOf(dialog()!)).toEqual([
      "check:done",
      "fetch:done",
      "start:done",
      "agents:waiting",
    ]);
    expect(buttonWithText(words.chooseLater, dialog()!)).toBeDefined();
    await click(buttonNamed(words.addToAgent("helper"))!);
    expect(dialog()!.textContent).toContain(words.doneTitle("computer-use"));
    expect(dialog()!.textContent).toContain(words.doneAgents("helper"));
    expect(dialog()!.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe(
      "100",
    );
  });
});

describe("a plugin on the server", () => {
  it("opens on its agents and only adds the selected copy", async () => {
    const p = props({ row: installedRow, status: "installed", usage: { usedBy: [], behind: [] } });
    await show(p);
    await click(installControl(en.skills.install)!);
    expect(dialog()!.textContent).toContain(words.chooseAgentHelp);
    expect(dialog()!.querySelector('[role="progressbar"]')).toBeNull();
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
    await click(buttonWithText(words.enableNow, dialog()!)!);
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
