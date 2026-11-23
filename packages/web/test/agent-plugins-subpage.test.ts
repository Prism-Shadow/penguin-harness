// @vitest-environment jsdom
/**
 * The Plugins sub-page of the Agent settings Plugins tab (features/agents/agent-plugins-page.tsx
 * and its row, detail and writes): the Agent's plugins as one column of rows, in two sections,
 * with install, update and uninstall for this one Agent.
 *
 * - Given an Agent with all of Charts and a library that also has Notes kit, Charts is listed
 *   under Installed and Notes kit under Available; the user's own Skill is no row of its own here.
 * - Given an installed plugin, its row reads its one-line description under its name, and the
 *   Plugins page's tags beside it: its category, and built in with what that means on hover.
 * - Given a member installs Notes kit, one install naming it alone is sent, its row moves to
 *   Installed, and no row offers Uninstall.
 * - Given a plugin with a stdio server, Install asks first, naming the command; cancelling writes
 *   nothing.
 * - Given the owner uninstalls Charts, the confirmation names each of its parts and warns that
 *   its workbench's data goes too; cancelling writes nothing, confirming sends one DELETE for the
 *   plugin and none for a part, and Charts moves to Available.
 * - Given the server could not remove one part, the toast names it with the reason.
 * - Given a plugin missing a part, its row reads Incomplete with Update; Update asks first, then
 *   reinstalls it from the library.
 * - Given a machine older than the uninstall, its 404 reads as the machine needing an update, and
 *   the row stays where it was.
 * - Given a machine's Agent, the library, the detail's files and an install all go to that machine.
 * - Given a row's name is pressed, its detail opens and the address names the plugin; "On this agent"
 *   lists its Skill, hook package, MCP server and workbench, and "Manage in Skills" lands on the
 *   Skills sub-page with the dialog closed.
 * - Given an address naming a plugin, its detail is open; one naming nothing is dropped.
 * - Given a search, only the rows it matches and their sections show; one matching nothing says
 *   so.
 * - Given an install here, the Plugins page opened next counts this Agent on that plugin without
 *   asking the Agent again.
 */
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginItem } from "@prismshadow/penguin-server/api";
import { toastStore } from "@prismshadow/penguin-ui";
import { PluginsPage } from "../src/features/plugins/plugins-page";
import * as api from "../src/api/endpoints";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { AGENT_ID, buttonIn, topDialog, whereIs } from "./helpers/agent-app";
import type { FakeMachine } from "./helpers/agent-app";
import {
  AGENT_PATH,
  CHARTS,
  NOTES_KIT,
  deletes,
  findPluginRow,
  openAgentPlugins,
  pluginRow,
  pluginRowButton,
  pluginRowTitles,
  sectionOf,
  sectionTitles,
  subPageButton,
  toasts,
} from "./helpers/agent-plugins";
import {
  button,
  click,
  dialogs,
  field,
  hasButton,
  pressScrim,
  type,
  unmountAll,
  waitFor,
} from "./helpers/dom";

const PAGE = `/agents/${AGENT_ID}`;
const INSTALLED = en.agentPlugins.installedSection;
const AVAILABLE = en.agentPlugins.availableSection;

/** A plugin whose one MCP server runs a command wherever the Agent's Sessions start. */
const SHELL = {
  name: "shell-kit",
  title: "Shell kit",
  description: "A shell",
  version: "0.1.0",
  package: "@penguinharness/shell-kit",
  source: "builtin",
  skills: [],
  hooks: [],
  mcpServers: [
    {
      name: "sh",
      transport: "stdio",
      target: "npx shell-mcp",
      setup: [],
      oauth: false,
      signIn: false,
    },
  ],
  workbenches: [],
} as unknown as PluginItem;

const GPU: FakeMachine = {
  machineId: "gpu1",
  alias: "gpu-box",
  agents: [AGENT_ID],
  library: [CHARTS, NOTES_KIT],
};

describe("the Plugins sub-page of an Agent's settings", () => {
  beforeEach(() => {
    setActiveStrings(en);
    toastStore.setState({ items: [] });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await unmountAll();
    localStorage.clear();
    setActiveStrings(zh);
  });

  it("lists the plugins the Agent carries under Installed and the library's others under Available", async () => {
    await openAgentPlugins();
    expect(sectionOf("Charts")).toBe(INSTALLED);
    expect(sectionOf("Notes kit")).toBe(AVAILABLE);
    expect(findPluginRow("notes")).toBeNull();
  });

  it("updates the server library from an installed Agent plugin, reports progress and retries a failed download", async () => {
    let upgraded = false;
    const release = "1.2.0";
    vi.spyOn(api, "getPluginIndex").mockImplementation(async () => ({
      plugins: [
        {
          name: CHARTS.package,
          description: "",
          authors: [],
          license: "MIT",
          version: release,
          localInstall: {
            version: upgraded ? release : "1.0.0",
            libraryOnly: true,
            updateAvailable: !upgraded,
          },
        },
      ],
      failures: [],
      pending: [],
    }));
    const gate = Promise.withResolvers<void>();
    const write = vi
      .spyOn(api, "installPluginStream")
      .mockImplementationOnce(async (_project, _pkg, _server, progress) => {
        progress(4, 8);
        await gate.promise;
        throw new Error("Download interrupted");
      })
      .mockImplementationOnce(async (project) => {
        upgraded = true;
        return api.getInstalledPlugins(project, null);
      });
    await openAgentPlugins();
    const label = `${en.plugins.updatePackageTo(release)} Charts`;
    await waitFor(() => hasButton(label));
    await click(button(label));
    expect(topDialog().textContent).toContain(
      en.plugins.packageUpdateBody("Charts", "1.0.0", release),
    );
    await click(buttonIn(topDialog(), en.skills.updateAction));
    await waitFor(() => topDialog().textContent!.includes("50%"));
    gate.resolve();
    await waitFor(() => !buttonIn(topDialog(), en.skills.updateAction).disabled);
    expect(toasts("error").join(" ")).toContain("Couldn’t update Charts");
    await click(buttonIn(topDialog(), en.skills.updateAction));
    await waitFor(() => !hasButton(label) && dialogs().length === 0);
    expect(toasts("success")).toContain(en.plugins.packageUpdated("Charts", release));
    expect(write.mock.calls.map((call) => call.slice(1, 3))).toEqual([
      [`${CHARTS.package}@${release}`, "local-machine"],
      [`${CHARTS.package}@${release}`, "local-machine"],
    ]);
  });

  it("keeps a Project member's Agent install separate from an administrator's library update", async () => {
    const read = vi.spyOn(api, "getPluginIndex");
    await openAgentPlugins({ role: "member", admin: false });
    expect(read).not.toHaveBeenCalled();
    expect(hasButton(`${en.plugins.updatePackageTo("1.2.0")} Charts`)).toBe(false);
  });

  it("shows an installed plugin's description under its name and the Plugins page's tags beside it", async () => {
    await openAgentPlugins();
    const describedBy = pluginRowButton("Charts").getAttribute("aria-describedby");
    expect(document.getElementById(describedBy ?? "")?.textContent).toBe("Draw charts");
    const tag = (text: string) =>
      [...pluginRow("Charts").querySelectorAll("span")].find(
        (span) => span.children.length === 0 && span.textContent === text,
      );
    // The fake library lists every plugin under one category, "All".
    expect(tag("All")).toBeDefined();
    expect(tag(en.plugins.builtin)?.getAttribute("data-tooltip")).toBe(
      en.plugins.libraryBuiltinHint,
    );
  });

  it("lets a member install a plugin, which moves to Installed, and offers a member no Uninstall", async () => {
    const { server } = await openAgentPlugins({ role: "member" });
    expect(hasButton(`${en.skills.uninstall} Charts`)).toBe(false);
    await click(button(`${en.skills.install} Notes kit`));
    await waitFor(() => sectionOf("Notes kit") === INSTALLED);
    expect(server.writes().map((r) => [r.method, r.path, r.body])).toEqual([
      ["POST", `${AGENT_PATH}/plugins`, { names: ["notes-kit"] }],
    ]);
    expect(hasButton(`${en.skills.uninstall} Notes kit`)).toBe(false);
    expect(hasButton(`${en.skills.uninstall} Charts`)).toBe(false);
  });

  it("asks before installing a plugin whose server runs a command, and a cancel writes nothing", async () => {
    const { server } = await openAgentPlugins({ library: [CHARTS, NOTES_KIT, SHELL] });
    await click(button(`${en.skills.install} Shell kit`));
    expect(topDialog().textContent).toContain("npx shell-mcp");
    await pressScrim();
    await waitFor(() => dialogs().length === 0);
    expect(server.writes()).toEqual([]);
  });

  it("uninstalls a whole plugin with one request after naming its parts, and never part by part", async () => {
    const { server } = await openAgentPlugins();
    await click(button(`${en.skills.uninstall} Charts`));
    const body = topDialog().textContent ?? "";
    for (const part of [
      en.agentPlugins.partSkill("chart"),
      en.agentPlugins.partHook("charts"),
      en.agentPlugins.partMcp("chart-api"),
      en.agentPlugins.partWorkbench("board"),
      en.agentPlugins.uninstallWorkbenchData,
    ]) {
      expect(body).toContain(part);
    }
    expect(body).not.toContain("notes");
    await pressScrim();
    expect(server.writes()).toEqual([]);

    await click(button(`${en.skills.uninstall} Charts`));
    await click(buttonIn(topDialog(), en.skills.uninstall));
    await waitFor(() => sectionOf("Charts") === AVAILABLE);
    expect(deletes(server)).toEqual([`${AGENT_PATH}/plugins/charts`]);
    expect(dialogs()).toEqual([]);
    expect(toasts("error")).toEqual([]);
  });

  it("names a part the server could not remove, with the reason", async () => {
    await openAgentPlugins({
      uninstallFailures: [{ kind: "skill", name: "chart", error: "permission denied" }],
    });
    await click(button(`${en.skills.uninstall} Charts`));
    await click(buttonIn(topDialog(), en.skills.uninstall));
    await waitFor(() => toasts("error").length === 1);
    expect(toasts("error")[0]).toContain(en.agentPlugins.failedPart("chart", "permission denied"));
    expect(toasts("success")).toEqual([]);
  });

  it("reads a plugin missing a part as Incomplete, and its Update asks before it reinstalls", async () => {
    const { server } = await openAgentPlugins({ hooks: [] });
    expect(pluginRow("Charts").textContent).toContain(en.agentPlugins.status.incomplete);
    await click(button(`${en.skills.updateAction} Charts`));
    expect(server.writes()).toEqual([]);
    await click(buttonIn(topDialog(), en.skills.updateAction));
    await waitFor(() => server.writes().length === 1);
    expect(server.writes()[0]).toMatchObject({
      method: "POST",
      path: `${AGENT_PATH}/plugins`,
      body: { names: ["charts"] },
    });
  });

  it("says a machine older than the uninstall needs an update, and the row stays", async () => {
    const { server } = await openAgentPlugins({
      at: `${PAGE}?tab=plugins&machine=gpu1`,
      machines: [GPU],
      older: true,
    });
    await click(button(`${en.skills.uninstall} Charts`));
    await click(buttonIn(topDialog(), en.skills.uninstall));
    await waitFor(() => toasts("error").length === 1);
    expect(toasts("error")).toEqual([en.errors.byCode.machine_outdated]);
    expect(server.writes().map((r) => [r.method, r.machine, r.path])).toEqual([
      ["DELETE", "gpu1", `${AGENT_PATH}/plugins/charts`],
    ]);
    expect(sectionOf("Charts")).toBe(INSTALLED);
  });

  it("asks a machine's Agent's machine for the library, the detail's files and the install", async () => {
    const { server } = await openAgentPlugins({
      at: `${PAGE}?tab=plugins&machine=gpu1`,
      machines: [GPU],
    });
    await click(pluginRowButton("Charts"));
    await waitFor(() => server.requests().some((r) => r.path === "/api/plugins/charts/files"));
    await pressScrim();
    await click(button(`${en.skills.install} Notes kit`));
    await waitFor(() => server.writes().length === 1);
    const asked = (path: string) =>
      server
        .requests()
        .filter((r) => r.path === path)
        .map((r) => r.machine);
    expect(asked("/api/plugins")).toContain("gpu1");
    expect(asked("/api/plugins")).not.toContain(null);
    expect(asked("/api/plugins/charts/files")).toEqual(["gpu1"]);
    expect(server.writes().map((r) => [r.method, r.machine, r.path])).toEqual([
      ["POST", "gpu1", `${AGENT_PATH}/plugins`],
    ]);
  });

  it("opens a row's detail at an address of its own, lists what the Agent carries, and leads to where each kind is managed", async () => {
    const { router } = await openAgentPlugins();
    await click(pluginRowButton("Charts"));
    await waitFor(() => dialogs().length === 1);
    expect(whereIs(router)).toBe(`${PAGE}?tab=plugins&plugin=charts`);
    const detail = topDialog();
    const onAgent = (label: string) =>
      detail.querySelector(`ul[aria-label="${label}"]`)?.textContent ?? "";
    expect(onAgent(en.agentPlugins.partKinds.skills)).toContain("chart");
    expect(onAgent(en.agentPlugins.partKinds.hooks)).toContain("charts");
    expect(onAgent(en.agentPlugins.partKinds.mcpServers)).toContain("chart-api");
    expect(onAgent(en.agentPlugins.partKinds.workbenches)).toContain("Board");

    await click(buttonIn(detail, en.agentPlugins.managePart.skills));
    await waitFor(() => dialogs().length === 0);
    expect(whereIs(router)).toBe(`${PAGE}?tab=skills`);
    expect(subPageButton(en.agentPlugins.subPages.skills).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("opens the detail an address names, and drops a name the page does not list", async () => {
    await openAgentPlugins({ at: `${PAGE}?tab=plugins&plugin=charts` });
    await waitFor(() => dialogs().length === 1);
    expect(topDialog().textContent).toContain(en.agentPlugins.onAgentTitle);
    await unmountAll();

    const { router } = await openAgentPlugins({ at: `${PAGE}?tab=plugins&plugin=gone` });
    await waitFor(() => whereIs(router) === `${PAGE}?tab=plugins`);
    expect(dialogs()).toEqual([]);
  });

  it("shows only the rows a search matches, in their sections, and says when nothing does", async () => {
    await openAgentPlugins();
    await type(field(en.plugins.searchPlaceholder), "chart");
    expect(sectionOf("Charts")).toBe(INSTALLED);
    expect(findPluginRow("Notes kit")).toBeNull();
    expect(sectionTitles()).toEqual([INSTALLED]);

    await type(field(en.plugins.searchPlaceholder), "nothing like it");
    expect(pluginRowTitles()).toEqual([]);
    expect(document.body.textContent).toContain(en.plugins.noMatch);
  });

  it("hands an install here to the Plugins page, which counts this Agent without asking it again", async () => {
    const { server, router } = await openAgentPlugins({
      extra: [{ path: "/plugins", element: h(PluginsPage) }],
    });
    await click(button(`${en.skills.install} Notes kit`));
    await waitFor(() => sectionOf("Notes kit") === INSTALLED);
    const asked = () =>
      server.requests().filter((r) => r.method === "GET" && r.path === `${AGENT_PATH}/plugins`)
        .length;
    const before = asked();
    await click(button(en.agentPlugins.openMarket));
    await waitFor(() => whereIs(router) === "/plugins");
    const count = '[data-plugin="notes-kit"] .showcase-card-bar button:first-child';
    await waitFor(
      () =>
        document.querySelector(count)?.textContent?.trim() === en.plugins.marketAgentInstalls(1),
    );
    expect(asked()).toBe(before);
  });
});
