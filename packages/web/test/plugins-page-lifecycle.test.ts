// @vitest-environment jsdom
/** The real page's reads, confirmation and writes across Project visits; only external
 * contexts, API calls and presentation shells are replaced. No pure identity helper is
 * substituted for the page's request lifecycle. */
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InstalledPluginsResponse } from "@prismshadow/penguin-server/api";
import { mount, click, run, unmountAll } from "./helpers/dom";
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
import { PluginsPage } from "../src/features/plugins/plugins-page";

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
  vi.mocked(api.getPluginIndex).mockResolvedValue([]);
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
