// @vitest-environment jsdom
/**
 * The system Agent in the Web App (lib/builtin-agents.ts): the Project's built-in owner of the
 * system apps, which holds no conversation, takes no plugin and keeps its identity.
 *
 * - Given the Project's system Agent, the Agents page shows its card under the dictionary's name
 *   (not its file's), tagged System, with Settings and the built-in Agents' disabled delete only:
 *   no New chat, no Usage, no Export, and no runtime statistics. Alongside Skills and Plugins it counts system apps the
 *   viewer sees, which opens its settings' list of them. Opening it keeps the Agent the user
 *   talks to current.
 * - Its card is pinned above the list whichever way the list is grouped, in no author group and
 *   in no group's count.
 * - Given an Agent of the user's that already holds the id `system_agent` (no system flag), the
 *   Project's owner is asked to move it to another id, and its card can be deleted as any other;
 *   a member is not asked.
 * - A connected machine's own system Agent is not listed beside this server's Agents.
 * - The system Agent's settings page has only the Overview and Plugins tabs, a deep link to any
 *   other tab included: the overview names it from the dictionary and offers no save or export,
 *   and the Plugins tab lists the system apps the viewer sees, read-only, each opening its page:
 *   Machines is available to administrators.
 * - The plugin market's manage-installs list offers neither this server's system Agent nor a
 *   machine's.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import type { PluginItem } from "@prismshadow/penguin-server/api";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { AgentsPage } from "../src/features/agents/agents-page";
import { AGENTS_GROUP_BY_KEY } from "../src/features/agents/agent-groups";
import { AgentSettingsPage } from "../src/features/agents/agent-settings-page";
import { PluginsPage } from "../src/features/plugins/plugins-page";
import {
  AGENT_ID,
  PROJECT_ID,
  agentConfig,
  agentServer,
  mountAgentApp,
  topDialog,
} from "./helpers/agent-app";
import type { FakeMachine } from "./helpers/agent-app";
import { button, click, hasButton, unmountAll, waitFor } from "./helpers/dom";
import { SYSTEM_APP_PAGES } from "./helpers/system-app-pages";

/** This server's system Agent, its file naming it otherwise than the dictionary does. */
const SYSTEM = {
  agentId: "system_agent",
  name: "Platform owner",
  system: true as const,
  pluginCount: 0,
};

const GPU: FakeMachine = {
  machineId: "gpu1",
  alias: "gpu-box",
  agents: ["default_agent", "system_agent"],
};

/** The cards on the Agents page, top to bottom. */
const cards = () => [...document.querySelectorAll<HTMLElement>("[data-agent-card]")];

/** The card whose title line names `name`. */
function cardNamed(name: string): HTMLElement {
  const card = cards().find((c) =>
    [...c.querySelectorAll("a, span")].some((e) => e.textContent === name),
  );
  if (card === undefined) throw new Error(`no card named ${name}`);
  return card;
}

/** Whether `card` holds a button named `label`, by its text or its accessible name. */
const cardHas = (card: HTMLElement, label: string) =>
  [...card.querySelectorAll("button")].some(
    (b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label,
  );

describe("the system Agent on the Agents page", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
    localStorage.clear();
  });

  it("is a card of its own words with only its settings and a delete it cannot use", async () => {
    agentServer(undefined, { moreAgents: [SYSTEM] });
    await mountAgentApp(h(AgentsPage), { route: "/list", at: "/list" });
    await waitFor(() => cards().length === 2);
    const card = cardNamed(en.agent.systemName);
    expect(card.textContent).not.toContain(SYSTEM.name);
    expect(card.textContent).toContain(en.agent.systemTag);
    expect(card.textContent).toContain(en.agent.systemDescription);
    expect(cardHas(card, en.common.settings)).toBe(true);
    for (const gone of [
      en.chat.newSessionMenu,
      en.nav.usage,
      en.agent.exportAgent,
      en.agent.deleteAgent,
    ]) {
      expect(cardHas(card, gone)).toBe(false);
    }
    expect(card.querySelector(`[aria-label="${en.agent.builtinUndeletable}"]`)).not.toBeNull();
    const plugins = card.querySelector(`button[aria-label="${en.plugins.pluginCount(0)}"]`);
    const skills = card.querySelector(`button[aria-label="${en.skills.skillCount(0)}"]`);
    expect(plugins).not.toBeNull();
    expect(plugins?.nextElementSibling).toBe(skills);
    expect(skills).not.toBeNull();
    expect(card.querySelector(`[data-tooltip="${en.agent.sessionCount(0)}"]`)).toBeNull();
  });

  it("counts the system apps the viewer sees, and the count opens their list", async () => {
    agentServer(undefined, { moreAgents: [SYSTEM], admin: false });
    const router = await mountAgentApp(h(AgentsPage), {
      route: "/list",
      at: "/list",
      pages: SYSTEM_APP_PAGES,
    });
    await waitFor(() => cards().length === 2);
    await click(button(en.agent.systemAppCount(3)));
    expect(router.state.location.pathname).toBe("/agents/system_agent");
    expect(router.state.location.search).toBe("?tab=workbenches");
  });

  it("is pinned above the author groups, in none of them and in no count", async () => {
    agentServer(undefined, { moreAgents: [SYSTEM] });
    await mountAgentApp(h(AgentsPage), { route: "/list", at: "/list" });
    await waitFor(() => cards().length === 2);
    expect(cards()[0]).toBe(cardNamed(en.agent.systemName));
    const people = [...document.querySelectorAll("button[aria-expanded]")].find((b) =>
      b.textContent?.includes(en.agent.authorGroups.user),
    )!;
    expect(people.textContent).toContain(en.agent.agentCount(1));
    const body = document.getElementById(people.getAttribute("aria-controls")!)!;
    expect(body.contains(cardNamed(en.agent.systemName))).toBe(false);
    expect(body.contains(cardNamed("Helper"))).toBe(true);
  });

  it("is pinned above the list when it is not grouped", async () => {
    localStorage.setItem(AGENTS_GROUP_BY_KEY, "none");
    agentServer(undefined, { moreAgents: [SYSTEM] });
    await mountAgentApp(h(AgentsPage), { route: "/list", at: "/list" });
    await waitFor(() => cards().length === 2);
    expect(cards().map((c) => c === cardNamed(en.agent.systemName))).toEqual([true, false]);
  });

  it("keeps the current Agent when its card is opened", async () => {
    localStorage.setItem(`penguin.lastAgentId.${PROJECT_ID}`, AGENT_ID);
    agentServer(undefined, { moreAgents: [SYSTEM] });
    await mountAgentApp(h(AgentsPage), { route: "/list", at: "/list" });
    await waitFor(() => cards().length === 2);
    await click(cardNamed(en.agent.systemName).querySelector("a")!);
    expect(localStorage.getItem(`penguin.lastAgentId.${PROJECT_ID}`)).toBe(AGENT_ID);
  });

  it("asks the owner to move an Agent of theirs that holds its id, which deletes as any other", async () => {
    agentServer(undefined, { moreAgents: [{ agentId: "system_agent", name: "Old helper" }] });
    await mountAgentApp(h(AgentsPage), { route: "/list", at: "/list" });
    await waitFor(() => cards().length === 2);
    expect(document.body.textContent).toContain(en.agent.systemIdHeld("Old helper"));
    expect(cardHas(cardNamed("Old helper"), en.agent.deleteAgent)).toBe(true);
  });

  it("asks a member nothing about it", async () => {
    agentServer(undefined, {
      role: "member",
      moreAgents: [{ agentId: "system_agent", name: "Old helper" }],
    });
    await mountAgentApp(h(AgentsPage), { route: "/list", at: "/list" });
    await waitFor(() => cards().length === 2);
    expect(document.body.textContent).not.toContain(en.agent.systemIdHeld("Old helper"));
  });

  it("does not list a machine's own system Agent", async () => {
    agentServer(undefined, { machines: [GPU] });
    await mountAgentApp(h(AgentsPage), { route: "/list", at: "/list" });
    await waitFor(() =>
      cards().some((c) => c.textContent?.includes(en.chat.machineTag("gpu-box"))),
    );
    expect(cards()).toHaveLength(2);
    expect(document.body.textContent).not.toContain("system_agent");
  });
});

describe("the system Agent's settings page", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
    localStorage.clear();
  });

  /** The page of an Agent the server reports as the system Agent, opened at `tab`. */
  async function openSystemPage(tab?: string, { serverAdmin = true } = {}) {
    const config = agentConfig();
    config.config.system = true;
    agentServer(config, { admin: serverAdmin });
    const at = `/agents/${AGENT_ID}${tab === undefined ? "" : `?tab=${tab}`}`;
    const router = await mountAgentApp(h(AgentSettingsPage), {
      at,
      pages: SYSTEM_APP_PAGES,
      extra: [{ path: "/models", element: h("p", null, "Models page") }],
    });
    await waitFor(() => hasButton(en.agent.tabOverview));
    return router;
  }

  /** The system apps' rows on the Plugins tab, by the name each shows. */
  const appRows = () =>
    [...document.querySelectorAll<HTMLElement>("li")]
      .filter((row) => row.textContent?.includes(en.agent.systemAppTag))
      .map((row) => row.textContent!.replace(en.agent.systemAppTag, "").replace(/Open$/, ""));

  it("has only the Overview and Plugins tabs, and a deep link to another lands on the overview", async () => {
    await openSystemPage("tools");
    expect(hasButton(en.agent.tabPlugins)).toBe(true);
    for (const gone of [
      en.agent.tabPrompt,
      en.agent.tabRuntime,
      en.agent.tabTools,
      en.agent.tabMemory,
      en.agent.tabVault,
      en.agent.tabSchedules,
      en.agent.tabApi,
    ]) {
      expect(hasButton(gone)).toBe(false);
    }
    expect(document.body.textContent).toContain(en.agent.systemDescription);
  });

  it("names it from the dictionary on a read-only overview", async () => {
    await openSystemPage();
    expect(document.body.textContent).toContain(en.agent.systemName);
    expect(document.body.textContent).not.toContain("Helps");
    expect(document.querySelector("input, textarea, select")).toBeNull();
    for (const gone of [en.common.save, en.agent.exportOpen, en.agent.resetConfigAction]) {
      expect(hasButton(gone)).toBe(false);
    }
  });

  it("lists its system apps on the Plugins tab, read-only, and Open goes to the page", async () => {
    const router = await openSystemPage("workbenches");
    await waitFor(() => appRows().length > 0);
    expect(appRows()).toEqual(["Models", "Plugins", "Machines", "Cost Center"]);
    expect(hasButton(en.workbenches.importTitle)).toBe(false);
    expect(document.querySelector('[role="switch"], input[type="checkbox"]')).toBeNull();
    await click(button(`${en.appCenter.menu.open} Models`));
    expect(router.state.location.pathname).toBe("/models");
  });

  it("lists a member the system apps they can open, without Machines", async () => {
    await openSystemPage("workbenches", { serverAdmin: false });
    await waitFor(() => appRows().length > 0);
    expect(appRows()).toEqual(["Models", "Plugins", "Cost Center"]);
  });
});

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

describe("the plugin market's manage-installs list", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
    localStorage.clear();
  });

  it("offers neither this server's system Agent nor a machine's", async () => {
    // jsdom has no ResizeObserver, which the card grid's container queries do not need here.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    agentServer(undefined, {
      library: [CHARTS],
      moreAgents: [SYSTEM],
      machines: [{ ...GPU, library: [CHARTS] }],
    });
    await mountAgentApp(h(PluginsPage), { route: "/plugins", at: "/plugins?plugin=charts" });
    await waitFor(() => hasButton(`${en.plugins.installModel.installAgent} charts`));
    await click(button(`${en.plugins.installModel.installAgent} charts`));
    const rows = () =>
      [...topDialog().querySelectorAll<HTMLInputElement>('input[type="radio"]')].map(
        (input) => input.value,
      );
    const machineDefault = "gpu1/default_agent";
    await waitFor(() => rows().includes(machineDefault));
    expect(rows()).toEqual([AGENT_ID, machineDefault]);
  });
});
