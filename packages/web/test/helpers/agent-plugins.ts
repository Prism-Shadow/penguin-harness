/**
 * The Agent the Plugins tab's suites look at (agent-plugins-subpage.test.ts,
 * agent-parts-subpages.test.ts): an Agent carrying all of the Charts plugin — its Skill, its hook
 * package, its MCP server and its Board workbench — beside a Skill and a workbench of the user's
 * own, on a server whose library also has Notes kit, which the Agent carries nothing of. The
 * server is the shared fake (agent-app.ts); this only says what it holds, and how to reach the
 * tab's parts on screen.
 */
import { createElement as h } from "react";
import type { ReactElement } from "react";
import type {
  AgentMcpServerItem,
  HookItem,
  PluginItem,
  SkillMetadataItem,
  WorkbenchInfo,
} from "@prismshadow/penguin-server/api";
import { toastStore } from "@prismshadow/penguin-ui";
import { AgentSettingsPage } from "../../src/features/agents/agent-settings-page";
import { en } from "../../src/lib/strings-en";
import { AGENT_ID, PROJECT_ID, agentServer, mountAgentApp } from "./agent-app";
import { waitFor } from "./dom";

export const AGENT_PATH = `/api/projects/${PROJECT_ID}/agents/${AGENT_ID}`;

export const CHART: SkillMetadataItem = {
  name: "chart",
  description: "Draw a chart",
  version: "1",
};
/** The user's own Skill: no library plugin contributes one of its name. */
export const NOTES: SkillMetadataItem = { name: "notes", description: "Keep notes", version: "" };
export const HOOK: HookItem = {
  name: "charts",
  description: "Checks charts",
  version: "1",
  events: ["stop"],
};
export const MCP: AgentMcpServerItem = {
  name: "chart-api",
  transport: "http",
  target: "https://charts.example/mcp",
  plugin: "charts",
  missingKeys: [],
  signIn: false,
};

export const CHARTS = {
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

/** A library plugin of one Skill, which the Agent does not carry. */
export const NOTES_KIT = {
  name: "notes-kit",
  title: "Notes kit",
  description: "Jot things down",
  version: "0.3.0",
  package: "@penguinharness/notes-kit",
  source: "builtin",
  skills: [{ name: "jot", description: "Jot a note", version: "1" }],
  hooks: [],
  mcpServers: [],
  workbenches: [],
} as unknown as PluginItem;

export const workbench = (id: string, name: string, tab?: string): WorkbenchInfo => ({
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

/**
 * The Agent's settings at `at` (its Plugins sub-page by default), once `ready` holds — by default
 * once the Charts plugin is named on screen.
 */
export async function openAgentPlugins({
  at = `/agents/${AGENT_ID}?tab=plugins`,
  hooks = [HOOK],
  ready = () => document.body.textContent?.includes("Charts") === true,
  extra = [],
  ...options
}: Options & {
  at?: string;
  hooks?: HookItem[];
  ready?: () => boolean;
  /** More pages beside the settings page, at their own routes. */
  extra?: Array<{ path: string; element: ReactElement }>;
} = {}) {
  const server = agentServer(undefined, {
    library: [CHARTS, NOTES_KIT],
    workbenches: [workbench("board", "board", "Board"), workbench("todo", "Todo")],
    parts: {
      skills: [CHART, NOTES],
      hooks,
      mcpServers: [MCP],
      receipts: [{ name: "board", plugin: "charts", version: "1" }],
    },
    ...options,
  });
  const router = await mountAgentApp(h(AgentSettingsPage), { at, extra });
  await waitFor(ready);
  return { server, router };
}

/** One of the sub-page switch's buttons, by its label. */
export function subPageButton(label: string): HTMLButtonElement {
  const group = document.querySelector(`[role="group"][aria-label="${en.agentPlugins.subNav}"]`);
  const found = [...(group?.querySelectorAll("button") ?? [])].find(
    (b) => b.textContent?.trim() === label,
  );
  if (found === undefined) throw new Error(`no sub-page named ${JSON.stringify(label)}`);
  return found;
}

/** The list row whose title is `name`. */
export function rowOf(name: string): HTMLLIElement {
  const found = [...document.querySelectorAll("li")].find((li) =>
    [...li.querySelectorAll("span")].some(
      (span) => span.children.length === 0 && span.textContent?.trim() === name,
    ),
  );
  if (found === undefined) throw new Error(`no row named ${JSON.stringify(name)}`);
  return found;
}

/** The plugin card named `name` (the plugin's name, not its title). */
export function cardOf(name: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-plugin="${name}"]`);
  if (found === null) throw new Error(`no card for ${JSON.stringify(name)}`);
  return found;
}

/** Opens a plugin's detail the way a reader does: the card's title, the body's button. */
export const cardButton = (name: string): HTMLButtonElement =>
  cardOf(name).querySelector("button")!;

/** The titles of the sections of cards on screen. */
export const sectionTitles = (): string[] =>
  [...document.querySelectorAll('section [data-slot="head"] button > span:first-child')].map(
    (span) => span.textContent?.trim() ?? "",
  );

/** The title of the section (Installed / Available) a plugin's card is listed in. */
export function sectionOf(name: string): string | undefined {
  const section = cardOf(name).closest("section");
  return section
    ?.querySelector('[data-slot="head"] button > span:first-child')
    ?.textContent?.trim();
}

/** Every DELETE the page sent, by path. */
export const deletes = (server: ReturnType<typeof agentServer>) =>
  server
    .writes()
    .filter((r) => r.method === "DELETE")
    .map((r) => r.path);

/** The toasts on screen, by kind. */
export const toasts = (kind: "success" | "error") =>
  toastStore
    .getState()
    .items.filter((item) => item.kind === kind)
    .map((item) => item.text);
