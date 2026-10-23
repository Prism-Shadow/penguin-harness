// @vitest-environment jsdom
/** The real page's reads, confirmation and writes across Project visits; only external
 * contexts, API calls and presentation shells are replaced. No pure identity helper is
 * substituted for the page's request lifecycle.
 *
 * A server module installed for the machine in view:
 * - Given the machine has not answered since the install, the row keeps the state it had; once
 *   it answers, the row shows what the machine reports — installed when it runs it, "not on
 *   that machine" only from an answer that lacks it.
 *
 * The registry's sources:
 * - Given the server answers while still reading a source, the page says so and lists what has
 *   answered; it reads the registry again after a pause, not before, and once the source has
 *   answered its plugins list, the note goes and the reads stop.
 * - Given a re-read fails, the rows already listed stay, the note goes and the reads stop. */
import { act, createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InstalledPluginsResponse } from "@prismshadow/penguin-server/api";
import { mount, click, run, unmountAll, watchText } from "./helpers/dom";
import { en } from "../src/lib/strings-en";
import { setActiveStrings } from "../src/lib/strings";

const context = vi.hoisted(() => ({ projectId: "A", machines: [] as string[] }));
vi.mock("react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("../src/state/project", () => ({
  useProject: () => ({
    currentProject: { projectId: context.projectId, role: "owner" },
    agents: [],
    currentAgent: null,
    setCurrentAgentId: vi.fn(),
    reloadAgents: vi.fn(),
  }),
  agentDisplayName: () => "Agent",
}));
vi.mock("../src/state/auth", () => ({
  useAuth: () => ({ user: { userId: "admin", isAdmin: true } }),
}));
vi.mock("../src/state/locale", () => ({ useLocale: () => ({ locale: "en" }) }));
vi.mock("../src/state/sessions", () => ({
  useSessions: () => ({ machineIds: context.machines, machineLabels: new Map() }),
}));
vi.mock("../src/lib/use-update-badges", () => ({ useUpdateBadges: () => ({ todos: {} }) }));
vi.mock("../src/features/plugins/plugin-repair", () => ({
  usePluginRepair: () => ({ repair: vi.fn(), modal: null }),
}));
vi.mock("../src/features/settings/settings-dialog", () => ({ SettingsDialog: () => null }));
vi.mock("../src/features/plugins/plugin-import-modal", () => ({ ImportPluginModal: () => null }));
vi.mock("../src/features/chat/chat-page", () => ({ DRAFT_SESSION_ID: "draft" }));
vi.mock("../src/features/machines/machine-picker", () => ({
  MachinePicker: (props: { choices: { value: string }[]; onChange: (id: string) => void }) =>
    h(
      "div",
      null,
      props.choices.map((c) =>
        h(
          "button",
          { key: c.value, "data-machine": c.value, onClick: () => props.onChange(c.value) },
          c.value,
        ),
      ),
    ),
}));
vi.mock("../src/features/plugins/plugin-card", () => ({
  libraryQuickStart: () => null,
  ModuleApplyBody: () => null,
  PluginCard: (props: import("../src/features/plugins/plugin-card").PluginCardProps) =>
    h(
      "div",
      {
        "data-row": props.row.name,
        "data-state": props.row.module?.state,
        "data-delete": props.onDeletePlugin === null ? "closed" : "open",
      },
      h("span", { "data-status": true }, props.status),
      h(
        "button",
        {
          disabled: props.blocked || props.busy,
          onClick: () => props.onModuleApply(props.row.module?.state === "none"),
        },
        "apply",
      ),
    ),
}));
vi.mock("@prismshadow/penguin-ui", async (original) => ({
  ...(await original<typeof import("@prismshadow/penguin-ui")>()),
  ConfirmModal: (props: { onConfirm: () => void }) =>
    h("button", { "data-confirm": true, onClick: props.onConfirm }, "confirm"),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock("../src/api/endpoints", () => ({
  getInstalledPlugins: vi.fn(),
  installPlugin: vi.fn(),
  uninstallPlugin: vi.fn(),
  getPluginLibrary: vi.fn(),
  getPluginIndex: vi.fn(),
}));
import * as api from "../src/api/endpoints";
import { INDEX_RECHECK_MS, PluginsPage } from "../src/features/plugins/plugins-page";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function snapshot(name: string): InstalledPluginsResponse {
  return {
    machineId: "self",
    file: "project.toml",
    restartPending: false,
    shipped: [],
    plugins: [
      {
        specifier: name,
        active: true,
        builtin: true,
        modules: [],
        replaces: [],
        everywhere: false,
        machines: ["self"],
        here: true,
      },
    ],
  };
}
const row = (name: string) => document.querySelector(`[data-row="${name}"]`);

beforeEach(() => {
  vi.resetAllMocks();
  context.projectId = "A";
  context.machines = [];
  localStorage.clear();
  setActiveStrings(en);
  vi.mocked(api.getPluginLibrary).mockResolvedValue({ groups: [] });
  vi.mocked(api.getPluginIndex).mockResolvedValue({ plugins: [], failures: [], pending: [] });
});
afterEach(unmountAll);

describe("the Plugins page's response lifecycle", () => {
  for (const readFirst of [true, false]) {
    it(`rejects an old A write after A → B → A, with the new A read ${readFirst ? "already complete" : "still pending"}`, async () => {
      const write = deferred<InstalledPluginsResponse>();
      const read = deferred<InstalledPluginsResponse>();
      vi.mocked(api.getInstalledPlugins)
        .mockResolvedValueOnce({ ...snapshot("initial"), plugins: [], shipped: ["initial"] })
        .mockResolvedValueOnce(snapshot("B"))
        .mockReturnValueOnce(read.promise);
      vi.mocked(api.installPlugin).mockReturnValueOnce(write.promise);
      const page = await mount(h(PluginsPage));
      await click(row("initial")!.querySelector("button")!);
      await click(document.querySelector("[data-confirm]")!);
      expect(api.installPlugin).toHaveBeenCalledWith("A", "initial", "self");
      context.projectId = "B";
      await page.rerender(h(PluginsPage));
      context.projectId = "A";
      await page.rerender(h(PluginsPage));
      if (readFirst) await run(() => read.resolve(snapshot("fresh")));
      await run(() => write.resolve(snapshot("stale")));
      expect(row("stale")).toBeNull();
      if (!readFirst) await run(() => read.resolve(snapshot("fresh")));
      expect(row("fresh")).not.toBeNull();
      expect(row("fresh")!.querySelector("button")!.disabled).toBe(false);
      expect(api.getInstalledPlugins).toHaveBeenCalledTimes(3);
      expect(api.uninstallPlugin).not.toHaveBeenCalled();
    });
  }

  it("specific machine Install and Remove both carry the selected own-table target", async () => {
    context.machines = ["Other00000000000"];
    const empty = { ...snapshot("unused"), plugins: [], shipped: ["@acme/plugin"] };
    vi.mocked(api.getInstalledPlugins).mockResolvedValue(empty);
    const installed = {
      ...snapshot("@acme/plugin"),
      plugins: snapshot("@acme/plugin").plugins.map((p) => ({
        ...p,
        machines: ["Other00000000000"],
        here: false,
      })),
    };
    vi.mocked(api.installPlugin).mockResolvedValue(installed);
    vi.mocked(api.uninstallPlugin).mockResolvedValue(empty);
    await mount(h(PluginsPage));
    await click(document.querySelector('[data-machine="Other00000000000"]')!);
    await click(row("plugin")!.querySelector("button")!);
    await click(document.querySelector("[data-confirm]")!);
    expect(api.installPlugin).toHaveBeenCalledWith("A", "@acme/plugin", "Other00000000000");
    await click(row("plugin")!.querySelector("button")!);
    await click(document.querySelector("[data-confirm]")!);
    expect(api.uninstallPlugin).toHaveBeenCalledWith("A", "@acme/plugin", "Other00000000000");
  });

  it("does not wire package-global Delete into the page, including an installed library/module row", async () => {
    vi.mocked(api.getInstalledPlugins).mockResolvedValue(snapshot("@penguinharness/mixed"));
    vi.mocked(api.getPluginLibrary).mockResolvedValue({
      groups: [
        {
          id: "other",
          title: "Other",
          plugins: [
            {
              name: "mixed",
              package: "@penguinharness/mixed",
              source: "installed",
              version: "1",
              description: "Mixed",
              skills: [],
              hooks: [],
              mcpServers: [],
            },
          ],
        },
      ],
    });
    await mount(h(PluginsPage));
    expect(row("mixed")?.getAttribute("data-delete")).toBe("closed");
    expect(api.uninstallPlugin).not.toHaveBeenCalled();
  });
});

describe("a server module installed for the machine in view", () => {
  const OTHER = "Other00000000000";
  /** One row of the Project's tables (or the machine's own list): `@acme/plugin`, on OTHER. */
  const listed = (active: boolean): InstalledPluginsResponse["plugins"][number] => ({
    specifier: "@acme/plugin",
    active,
    builtin: false,
    modules: [],
    replaces: [],
    everywhere: false,
    machines: [OTHER],
    here: active,
  });
  const tables = (lists: boolean): InstalledPluginsResponse => ({
    machineId: "self",
    file: "project.toml",
    restartPending: false,
    shipped: ["@acme/plugin"],
    plugins: lists ? [listed(false)] : [],
  });
  const machineAnswer = (runs: boolean): InstalledPluginsResponse => ({
    ...tables(false),
    machineId: OTHER,
    plugins: runs ? [listed(true)] : [],
  });

  it.each([
    [true, "installed"],
    [false, "not-here"],
  ] as const)(
    "keeps the row's state until the machine answers (runs it: %s), then shows %s",
    async (runs, after) => {
      context.machines = [OTHER];
      const afterInstall = deferred<InstalledPluginsResponse>();
      let machineReads = 0;
      vi.mocked(api.getInstalledPlugins).mockImplementation((_project, server) => {
        if (server === null) return Promise.resolve(tables(false));
        machineReads += 1;
        return machineReads === 1 ? Promise.resolve(machineAnswer(false)) : afterInstall.promise;
      });
      vi.mocked(api.installPlugin).mockResolvedValue(tables(true));
      await mount(h(PluginsPage));
      await click(document.querySelector(`[data-machine="${OTHER}"]`)!);
      const state = watchText('[data-row="plugin"] [data-status]');
      expect(state.texts()).toEqual(["available"]);

      await click(row("plugin")!.querySelector("button")!);
      await click(document.querySelector("[data-confirm]")!);
      expect(api.installPlugin).toHaveBeenCalledWith("A", "@acme/plugin", OTHER);
      expect(machineReads).toBe(2);
      expect(state.texts()).toEqual(["available"]);

      await run(() => afterInstall.resolve(machineAnswer(runs)));
      expect(state.texts()).toEqual(["available", after]);
    },
  );
});

describe("the registry's sources", () => {
  const shipped = {
    name: "@penguinharness/sandbox-bwrap",
    version: "1.0.0",
    description: "Shipped",
    authors: [],
    license: "MIT",
  };
  const published = { ...shipped, name: "@example/published", description: "Published" };
  const source = "https://index.example/index.json";
  const pendingNote = () => document.body.textContent?.includes(en.pluginRegistry.sourcePending(1));
  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(api.getInstalledPlugins).mockResolvedValue({ ...snapshot("unused"), plugins: [] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a source still loading is said, read again after a pause, and its plugins list once it answers", async () => {
    vi.mocked(api.getPluginIndex)
      .mockResolvedValueOnce({ plugins: [shipped], failures: [], pending: [source] })
      .mockResolvedValueOnce({ plugins: [shipped, published], failures: [], pending: [] });
    await mount(h(PluginsPage));
    expect(row("sandbox-bwrap")).not.toBeNull();
    expect(row("published")).toBeNull();
    expect(pendingNote()).toBe(true);

    await advance(INDEX_RECHECK_MS - 1);
    expect(api.getPluginIndex).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(row("published")).not.toBeNull();
    expect(pendingNote()).toBe(false);

    await advance(INDEX_RECHECK_MS * 3);
    expect(api.getPluginIndex).toHaveBeenCalledTimes(2);
  });

  it("a re-read that fails keeps the rows already listed, and stops reading", async () => {
    vi.mocked(api.getPluginIndex)
      .mockResolvedValueOnce({ plugins: [shipped], failures: [], pending: [source] })
      .mockRejectedValueOnce(new Error("offline"));
    await mount(h(PluginsPage));
    await advance(INDEX_RECHECK_MS);
    expect(api.getPluginIndex).toHaveBeenCalledTimes(2);
    expect(row("sandbox-bwrap")).not.toBeNull();
    expect(pendingNote()).toBe(false);

    await advance(INDEX_RECHECK_MS * 3);
    expect(api.getPluginIndex).toHaveBeenCalledTimes(2);
  });
});
