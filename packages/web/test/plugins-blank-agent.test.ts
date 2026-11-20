// @vitest-environment jsdom
/**
 * The plugin market's 「新建空白 Agent」 (features/plugins/blank-agent.tsx, in plugin-card.tsx's
 * manage-installs dialog): a new Agent made for one plugin through the Agents page's Create agent
 * dialog, opened over the list.
 *
 * - Given the manage-installs list of a library plugin, its first row opens Create agent over the
 *   list, named after the plugin's title; Create sends one request that creates the Agent with
 *   the plugin, and nothing else is installed on the side.
 * - Once created, the dialog closes, the list stays open — the page goes nowhere — and the new
 *   Agent is in it, already reading Installed when the list shows again.
 * - One Escape closes the untouched Create agent dialog without asking and leaves the list; the
 *   next closes the list.
 * - A plugin with a stdio MCP server asks before the Agent is created, naming the command it runs
 *   on this server; nothing is created until that is confirmed.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import type { PluginItem } from "@prismshadow/penguin-server/api";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { PluginsPage } from "../src/features/plugins/plugins-page";
import {
  AGENT_ID,
  PROJECT_ID,
  agentServer,
  buttonIn,
  fieldIn,
  mountAgentApp,
  topDialog,
  whereIs,
} from "./helpers/agent-app";
import {
  button,
  click,
  dialogs,
  hasButton,
  pressEscape,
  type,
  unmountAll,
  waitFor,
} from "./helpers/dom";

const CHARTS = {
  name: "charts",
  description: "Draw charts",
  version: "1.0.0",
  title: "Charts",
  category: "office-productivity",
  skills: [{ name: "chart", description: "Draw a chart", version: "2026.10.01.1" }],
  hooks: [],
  mcpServers: [],
} as unknown as PluginItem;

/** A plugin whose MCP server is a command this server runs. */
const MAIL = {
  name: "mail",
  description: "Mail tools",
  version: "1.0.0",
  title: "Mail tools",
  category: "office-productivity",
  skills: [{ name: "send-mail", description: "Send mail", version: "2026.10.01.1" }],
  hooks: [],
  mcpServers: [
    {
      name: "mail",
      transport: "stdio",
      target: "node mail-server.js",
      setup: [],
      oauth: false,
      signIn: false,
    },
  ],
} as unknown as PluginItem;

const AGENTS_PATH = `/api/projects/${PROJECT_ID}/agents`;

/** The plugin market with `plugin`'s manage-installs list open. */
async function openInstalls(plugin: PluginItem) {
  // jsdom has no ResizeObserver, which the card grid's container queries do not need here.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const server = agentServer(undefined, { library: [plugin] });
  const router = await mountAgentApp(h(PluginsPage), { route: "/plugins", at: "/plugins" });
  const manage = `${en.skills.manageInstall} ${plugin.name}`;
  await waitFor(() => hasButton(manage));
  await click(button(manage));
  await waitFor(() => hasButton(`${en.skills.install} ${AGENT_ID}`));
  return { server, router };
}

/** Presses the list's first row: Create agent opens over it. */
async function openBlank() {
  await click(buttonIn(topDialog(), en.plugins.blankAgentCreate));
  await waitFor(() => dialogs().length === 2);
}

const listTitle = (plugin: PluginItem) => en.skills.manageInstallTitle(plugin.title!);
const create = () => buttonIn(topDialog(), en.common.create);

describe("installing a plugin on a new blank Agent", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
    localStorage.clear();
  });

  it("opens Create agent over the list named after the plugin, and creates the Agent with it in one request", async () => {
    const { server } = await openInstalls(CHARTS);
    await openBlank();
    expect(fieldIn(topDialog(), en.common.name).value).toBe("Charts");

    await type(fieldIn(topDialog(), en.agent.id), "chart_maker");
    await click(create());
    await waitFor(() => server.writes(AGENTS_PATH).length === 1);
    expect(server.writes(AGENTS_PATH)[0]!.body).toEqual({
      agentId: "chart_maker",
      author: "user",
      name: "Charts",
      plugins: ["charts"],
    });
    expect(server.writes(`${AGENTS_PATH}/chart_maker/plugins`)).toEqual([]);
  });

  it("closes the dialog and keeps the list open, the new Agent in it reading Installed", async () => {
    const { router } = await openInstalls(CHARTS);
    await openBlank();
    await type(fieldIn(topDialog(), en.agent.id), "chart_maker");
    await click(create());
    await waitFor(() => dialogs().length === 1);
    expect(topDialog().textContent).toContain(listTitle(CHARTS));
    // Already Installed when the list shows again: the row never passes through Install.
    expect(hasButton(`${en.skills.uninstall} chart_maker`)).toBe(true);
    expect(hasButton(`${en.skills.install} chart_maker`)).toBe(false);
    expect(whereIs(router)).toBe("/plugins");
  });

  it("closes the untouched dialog on one Escape without asking, and the list on the next", async () => {
    await openInstalls(CHARTS);
    await openBlank();
    await pressEscape();
    expect(hasButton(en.common.discard)).toBe(false);
    expect(dialogs()).toHaveLength(1);
    expect(topDialog().textContent).toContain(listTitle(CHARTS));
    await pressEscape();
    expect(dialogs()).toEqual([]);
  });

  it("asks before creating an Agent whose plugin runs a stdio server, and creates nothing until confirmed", async () => {
    const { server } = await openInstalls(MAIL);
    await openBlank();
    await type(fieldIn(topDialog(), en.agent.id), "mailer");
    await click(create());
    expect(dialogs()).toHaveLength(3);
    expect(topDialog().textContent).toContain("node mail-server.js");
    expect(server.writes(AGENTS_PATH)).toEqual([]);

    await click(buttonIn(topDialog(), en.common.create));
    await waitFor(() => server.writes(AGENTS_PATH).length === 1);
    expect(server.writes(AGENTS_PATH)[0]!.body).toMatchObject({ plugins: ["mail"] });
  });
});
