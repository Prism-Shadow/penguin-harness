// @vitest-environment jsdom
/**
 * The Plugins sub-page of the Agent settings Plugins tab (features/agents/agent-plugins-page.tsx
 * and its card, detail and writes): the Agent's plugins as the Plugins page's cards, in two
 * sections, with install, update and uninstall for this one Agent.
 *
 * - Given an Agent with all of Charts and a library that also has Notes kit, Charts is listed
 *   under Installed and Notes kit under Available; the user's own Skill is no card.
 * - Given a member installs Notes kit, one install naming it alone is sent, its card moves to
 *   Installed, and no card offers Uninstall.
 * - Given a plugin with a stdio server, Install asks first, naming the command; cancelling writes
 *   nothing.
 * - Given the owner uninstalls Charts, the confirmation names each of its parts and warns that
 *   its workbench's data goes too; cancelling writes nothing, confirming sends one DELETE for the
 *   plugin and none for a part, and Charts moves to Available.
 * - Given the server could not remove one part, the toast names it with the reason.
 * - Given a plugin missing a part, its card reads Incomplete with Update; Update asks first, then
 *   reinstalls it from the library.
 * - Given a machine older than the uninstall, its 404 reads as the machine needing an update, and
 *   the card stays where it was.
 * - Given a machine's Agent, the library, the detail's files and an install all go to that machine.
 * - Given a card is pressed, its detail opens and the address names the plugin; "On this agent"
 *   lists its Skill, hook package, MCP server and workbench, and "Manage in Skills" lands on the
 *   Skills sub-page with the dialog closed.
 * - Given an address naming a plugin, its detail is open; one naming nothing is dropped.
 * - Given a search, only the cards it matches and their sections show; one matching nothing says
 *   so.
 * - Given an install here, the Plugins page opened next counts this Agent on that plugin without
 *   asking the Agent again.
 */
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PluginItem } from "@prismshadow/penguin-server/api";
import { toastStore } from "@prismshadow/penguin-ui";
import { PluginsPage } from "../src/features/plugins/plugins-page";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { AGENT_ID, buttonIn, topDialog, whereIs } from "./helpers/agent-app";
import type { FakeMachine } from "./helpers/agent-app";
import {
  AGENT_PATH,
  CHARTS,
  NOTES_KIT,
  cardButton,
  cardOf,
  deletes,
  openAgentPlugins,
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
    await unmountAll();
    localStorage.clear();
    setActiveStrings(zh);
  });

  it("lists the plugins the Agent carries under Installed and the library's others under Available", async () => {
    await openAgentPlugins();
    expect(sectionOf("charts")).toBe(INSTALLED);
    expect(sectionOf("notes-kit")).toBe(AVAILABLE);
    expect(document.querySelector('[data-plugin="notes"]')).toBeNull();
  });

  it("lets a member install a plugin, which moves to Installed, and offers a member no Uninstall", async () => {
    const { server } = await openAgentPlugins({ role: "member" });
    expect(hasButton(`${en.skills.uninstall} Charts`)).toBe(false);
    await click(button(`${en.skills.install} Notes kit`));
    await waitFor(() => sectionOf("notes-kit") === INSTALLED);
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
    await waitFor(() => sectionOf("charts") === AVAILABLE);
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
    expect(cardOf("charts").textContent).toContain(en.agentPlugins.status.incomplete);
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

  it("says a machine older than the uninstall needs an update, and the card stays", async () => {
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
    expect(sectionOf("charts")).toBe(INSTALLED);
  });

  it("asks a machine's Agent's machine for the library, the detail's files and the install", async () => {
    const { server } = await openAgentPlugins({
      at: `${PAGE}?tab=plugins&machine=gpu1`,
      machines: [GPU],
    });
    await click(cardButton("charts"));
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

  it("opens a card's detail at an address of its own, lists what the Agent carries, and leads to where each kind is managed", async () => {
    const { router } = await openAgentPlugins();
    await click(cardButton("charts"));
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

  it("shows only the cards a search matches, in their sections, and says when nothing does", async () => {
    await openAgentPlugins();
    await type(field(en.plugins.searchPlaceholder), "chart");
    expect(sectionOf("charts")).toBe(INSTALLED);
    expect(document.querySelector('[data-plugin="notes-kit"]')).toBeNull();
    expect(sectionTitles()).toEqual([INSTALLED]);

    await type(field(en.plugins.searchPlaceholder), "nothing like it");
    expect(document.querySelector("[data-plugin]")).toBeNull();
    expect(document.body.textContent).toContain(en.plugins.noMatch);
  });

  it("hands an install here to the Plugins page, which counts this Agent without asking it again", async () => {
    const { server, router } = await openAgentPlugins({
      extra: [{ path: "/plugins", element: h(PluginsPage) }],
    });
    await click(button(`${en.skills.install} Notes kit`));
    await waitFor(() => sectionOf("notes-kit") === INSTALLED);
    const asked = () =>
      server.requests().filter((r) => r.method === "GET" && r.path === `${AGENT_PATH}/plugins`)
        .length;
    const before = asked();
    await click(button(en.agentPlugins.openMarket));
    await waitFor(() => whereIs(router) === "/plugins");
    const usedBy = '[data-plugin="notes-kit"] [data-testid="plugin-used-by"]';
    await waitFor(() => document.querySelector(usedBy) !== null);
    expect(document.querySelector(usedBy)?.textContent).toBe(en.plugins.usedByAgents(1));
    expect(asked()).toBe(before);
  });
});
