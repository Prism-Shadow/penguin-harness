// @vitest-environment jsdom
/**
 * The Agent settings page's Plugins tab (features/agents/plugins-tab.tsx): the Agent's plugins
 * with the parts each brought, the switches, and the uninstall that takes a whole plugin away.
 *
 * - Given an old `?tab=hooks` address, the Plugins tab opens, listing the Charts plugin as
 *   installed and the Skill the user made under "Not from a plugin".
 * - Given the owner uninstalls Charts, the confirmation names each of its parts and warns that
 *   its workbench's data goes too; cancelling writes nothing, confirming sends one DELETE for the
 *   plugin and no DELETE for any part, and Charts leaves the list while the user's own Skill stays.
 * - Given the server could not remove one part, the toast names it with the reason.
 * - Given a machine older than the uninstall, it answers 404 and the tab says the machine needs an
 *   update; it lists no `enabled`, so no workbench switch is shown.
 * - Given a member, every switch shows its state greyed, there is no Uninstall, and nothing is
 *   written.
 * - Given the owner switches the Board workbench off, the write names it alone and its Open goes;
 *   with "Enable workbenches" off, every workbench switch is greyed at its own value.
 * - Given a plugin missing a part, Update asks first, then reinstalls it from the library.
 */
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AgentMcpServerItem,
  HookItem,
  PluginItem,
  SkillMetadataItem,
  WorkbenchInfo,
} from "@prismshadow/penguin-server/api";
import { toastStore } from "@prismshadow/penguin-ui";
import { AgentSettingsPage } from "../src/features/agents/agent-settings-page";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import {
  AGENT_ID,
  PROJECT_ID,
  agentServer,
  buttonIn,
  mountAgentApp,
  topDialog,
} from "./helpers/agent-app";
import type { FakeMachine } from "./helpers/agent-app";
import {
  button,
  click,
  dialogs,
  hasButton,
  pressScrim,
  switchNamed,
  unmountAll,
  waitFor,
} from "./helpers/dom";

const AGENT_PATH = `/api/projects/${PROJECT_ID}/agents/${AGENT_ID}`;

const CHART: SkillMetadataItem = { name: "chart", description: "Draw a chart", version: "1" };
const NOTES: SkillMetadataItem = { name: "notes", description: "Keep notes", version: "" };
const HOOK: HookItem = {
  name: "charts",
  description: "Checks charts",
  version: "1",
  events: ["stop"],
};
const MCP: AgentMcpServerItem = {
  name: "chart-api",
  transport: "http",
  target: "https://charts.example/mcp",
  plugin: "charts",
  missingKeys: [],
  signIn: false,
};

const CHARTS = {
  name: "charts",
  title: "Charts",
  description: "Draw charts",
  version: "1.0.0",
  package: "@penguinharness/charts",
  source: "builtin",
  skills: [CHART],
  hooks: ["stop"],
  hookVersion: "1",
  mcpServers: [
    {
      name: "chart-api",
      transport: "http",
      target: MCP.target,
      setup: [],
      oauth: false,
      signIn: false,
    },
  ],
  workbenches: [{ name: "board", version: "1" }],
} as PluginItem;

const workbench = (id: string, name: string, tab?: string): WorkbenchInfo => ({
  id,
  name,
  version: "1",
  revision: "current",
  uiRev: null,
  loadedAt: "2026-11-05T00:00:00Z",
  error: null,
  hints: [],
  tabs:
    tab === undefined
      ? []
      : [{ id: `${id}.main`, key: "main", title: tab, renderer: { iframe: { src: `/${id}` } } }],
});

type Options = NonNullable<Parameters<typeof agentServer>[1]>;

/** The Agent with all of Charts and the user's own Skill and workbench, on its Plugins tab. */
async function openTab({
  at = `/agents/${AGENT_ID}?tab=plugins`,
  hooks = [HOOK],
  ...options
}: Options & { at?: string; hooks?: HookItem[] } = {}) {
  const server = agentServer(undefined, {
    library: [CHARTS],
    workbenches: [workbench("board", "board", "Board"), workbench("todo", "Todo")],
    parts: {
      skills: [CHART, NOTES],
      hooks,
      mcpServers: [MCP],
      receipts: [{ name: "board", plugin: "charts", version: "1" }],
    },
    ...options,
  });
  const router = await mountAgentApp(h(AgentSettingsPage), { at });
  await waitFor(() => document.body.textContent?.includes("Charts") === true);
  return { server, router };
}

/** Unfolds a plugin's row to show its parts. */
async function unfold(title: string): Promise<void> {
  const toggle = [...document.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")].find(
    (b) => b.getAttribute("aria-expanded") === "false" && b.textContent?.includes(title),
  );
  if (toggle === undefined) throw new Error(`no folded row for ${title}`);
  await click(toggle);
}

/** Every DELETE the page sent, by path. */
const deletes = (server: ReturnType<typeof agentServer>) =>
  server
    .writes()
    .filter((r) => r.method === "DELETE")
    .map((r) => r.path);

const toasts = (kind: "success" | "error") =>
  toastStore
    .getState()
    .items.filter((item) => item.kind === kind)
    .map((item) => item.text);

describe("the Agent settings Plugins tab", () => {
  beforeEach(() => {
    setActiveStrings(en);
    toastStore.setState({ items: [] });
  });
  afterEach(async () => {
    await unmountAll();
    localStorage.clear();
    setActiveStrings(zh);
  });

  it("opens from an old ?tab=hooks address, listing the plugin and the user's own parts", async () => {
    await openTab({ at: `/agents/${AGENT_ID}?tab=hooks` });
    const selected = document.querySelector('[role="tab"][aria-selected="true"]');
    expect(selected?.textContent).toBe(en.agent.tabPlugins);
    const charts = [...document.querySelectorAll("button[aria-expanded]")].find((b) =>
      b.textContent?.includes("Charts"),
    );
    expect(charts?.textContent).toContain(en.agentPlugins.status.installed);
    const own = document.querySelector(`ul[aria-label="${en.agentPlugins.ownTitle}"]`);
    expect(own?.textContent).toContain("notes");
    expect(own?.textContent).not.toContain("chart");
  });

  it("uninstalls a whole plugin with one request after naming its parts, and never part by part", async () => {
    const { server } = await openTab();
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
    await waitFor(() => !document.body.textContent?.includes("Charts"));
    expect(deletes(server)).toEqual([`${AGENT_PATH}/plugins/charts`]);
    expect(dialogs()).toEqual([]);
    expect(document.body.textContent).toContain("notes");
    expect(toasts("error")).toEqual([]);
  });

  it("names a part the server could not remove, with the reason", async () => {
    await openTab({
      uninstallFailures: [{ kind: "skill", name: "chart", error: "permission denied" }],
    });
    await click(button(`${en.skills.uninstall} Charts`));
    await click(buttonIn(topDialog(), en.skills.uninstall));
    await waitFor(() => toasts("error").length === 1);
    expect(toasts("error")[0]).toContain(en.agentPlugins.failedPart("chart", "permission denied"));
    expect(toasts("success")).toEqual([]);
  });

  it("says a machine older than the uninstall needs an update, and shows it no workbench switch", async () => {
    const gpu: FakeMachine = {
      machineId: "gpu1",
      alias: "gpu-box",
      agents: [AGENT_ID],
      library: [CHARTS],
    };
    const { server } = await openTab({
      at: `/agents/${AGENT_ID}?tab=plugins&machine=gpu1`,
      machines: [gpu],
      older: true,
    });
    expect(() => switchNamed(en.workbenches.enableAll)).toThrow();
    await unfold("Charts");
    expect(() => switchNamed(en.workbenches.enableOne("Board"))).toThrow();

    await click(button(`${en.skills.uninstall} Charts`));
    await click(buttonIn(topDialog(), en.skills.uninstall));
    await waitFor(() => toasts("error").length === 1);
    expect(toasts("error")).toEqual([en.errors.byCode.machine_outdated]);
    expect(server.writes().map((r) => [r.method, r.machine, r.path])).toEqual([
      ["DELETE", "gpu1", `${AGENT_PATH}/plugins/charts`],
    ]);
  });

  it("shows a member every switch greyed at its state, offers no Uninstall, and writes nothing", async () => {
    const { server } = await openTab({ role: "member" });
    await unfold("Charts");
    const switches = [
      switchNamed(en.skills.injection.enable),
      switchNamed(en.hooks.injection.enable),
      switchNamed(en.workbenches.enableAll),
      switchNamed(en.workbenches.enableOne("Board")),
    ];
    for (const control of switches) {
      expect(control.disabled).toBe(true);
      expect(control.getAttribute("aria-checked")).toBe("true");
      await click(control);
    }
    expect(hasButton(`${en.skills.uninstall} Charts`)).toBe(false);
    expect(server.writes()).toEqual([]);
  });

  it("switches one workbench off by itself, and greys every switch while Enable workbenches is off", async () => {
    const { server } = await openTab();
    await unfold("Charts");
    expect(hasButton(`${en.workbenches.open} Board`)).toBe(true);
    await click(switchNamed(en.workbenches.enableOne("Board")));
    await waitFor(() => !hasButton(`${en.workbenches.open} Board`));
    expect(server.writes().map((r) => [r.method, r.path, r.body])).toEqual([
      ["PUT", `${AGENT_PATH}/workbenches/board/enabled`, { enabled: false }],
    ]);

    await click(switchNamed(en.workbenches.enableAll));
    await waitFor(() => switchNamed(en.workbenches.enableOne("Todo")).disabled);
    expect(server.writes().at(-1)).toMatchObject({
      method: "PUT",
      path: `${AGENT_PATH}/workbenches/enabled`,
      body: { enabled: false },
    });
    const board = switchNamed(en.workbenches.enableOne("Board"));
    const todo = switchNamed(en.workbenches.enableOne("Todo"));
    expect([board.disabled, board.getAttribute("aria-checked")]).toEqual([true, "false"]);
    expect([todo.disabled, todo.getAttribute("aria-checked")]).toEqual([true, "true"]);
  });

  it("asks before Update reinstalls a plugin that is missing a part", async () => {
    const { server } = await openTab({ hooks: [] });
    const charts = [...document.querySelectorAll("button[aria-expanded]")].find((b) =>
      b.textContent?.includes("Charts"),
    );
    expect(charts?.textContent).toContain(en.agentPlugins.status.incomplete);
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
});
