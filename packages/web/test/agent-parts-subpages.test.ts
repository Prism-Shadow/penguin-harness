// @vitest-environment jsdom
/**
 * The Skills, Hooks and Workbenches sub-pages of the Agent settings Plugins tab
 * (features/agents/plugins-tab.tsx with agent-skills.tsx, agent-hooks.tsx and
 * agent-workbenches.tsx): one kind each, a plugin's parts and the user's own in one list.
 *
 * - Given an old `?tab=hooks` address, the Plugins tab is selected on its Hooks sub-page: the hook
 *   package is listed with the mark of the plugin that installed it, "Enable hooks" is shown, and
 *   neither a Skill row nor "Enable skills" is.
 * - Given `?tab=skills`, the plugin's Skill carries the mark naming Charts and the user's own
 *   Skill carries none; pressing the mark lands on the Plugins sub-page with Charts' row marked
 *   and focused, and no detail open.
 * - Given a Skill, a hook package or a workbench, a click on its row (not on its name) opens a
 *   dialog titled with the part over the part's own folder in the Agent State, its lead file
 *   listed and previewed; every read names that folder, and nothing is written.
 * - Given the owner uninstalls a Skill a plugin installed, the confirmation also says which plugin
 *   installed it; the user's own Skill's does not.
 * - Given a member, each sub-page's switch shows its state greyed and nothing is written.
 * - Given a machine's Agent, pressing another sub-page keeps the machine in the address.
 * - Given the skills prompt holds unsaved edits, pressing another sub-page asks first, and "keep
 *   editing" leaves the address and the text alone.
 * - Given the Workbenches sub-page, the owner switches Board off by itself and its Open goes; with
 *   "Enable workbenches" off every row's switch is greyed at its own value; a machine older than
 *   the switches shows none.
 * - Given an Agent with no hook package, the Hooks sub-page says so and Import hook is still there.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { toastStore } from "@prismshadow/penguin-ui";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { AGENT_ID, buttonIn, topDialog, whereIs } from "./helpers/agent-app";
import type { FakeMachine } from "./helpers/agent-app";
import {
  AGENT_PATH,
  CHARTS,
  findPluginRow,
  openAgentPlugins,
  pluginRow,
  pluginRowButton,
  rowOf,
  subPageButton,
} from "./helpers/agent-plugins";
import {
  button,
  click,
  dialogs,
  field,
  hasButton,
  pressScrim,
  switchNamed,
  type,
  unmountAll,
  waitFor,
} from "./helpers/dom";

const PAGE = `/agents/${AGENT_ID}`;
const MARK = en.agentPlugins.partSource("Charts");
const GPU: FakeMachine = {
  machineId: "gpu1",
  alias: "gpu-box",
  agents: [AGENT_ID],
  library: [CHARTS],
};

/** Whether a row carries a plugin's mark. */
const markOf = (row: HTMLElement) =>
  row.querySelector<HTMLButtonElement>(`button[aria-label="${MARK}"]`);
const has = (text: string) => document.body.textContent?.includes(text) === true;
const promptOpen = () => hasButton(en.common.discard) && hasButton(en.common.keepEditing);

describe("the kind sub-pages of the Plugins tab", () => {
  beforeEach(() => {
    setActiveStrings(en);
    toastStore.setState({ items: [] });
  });
  afterEach(async () => {
    await unmountAll();
    localStorage.clear();
    setActiveStrings(zh);
  });

  it("opens an old ?tab=hooks address on the Hooks sub-page, its package marked with its plugin", async () => {
    await openAgentPlugins({
      at: `${PAGE}?tab=hooks`,
      ready: () => hasButton(`${en.hooks.exportHook} charts`),
    });
    const selected = document.querySelector('[role="tab"][aria-selected="true"]');
    expect(selected?.textContent).toBe(en.agent.tabPlugins);
    expect(subPageButton(en.agentPlugins.subPages.hooks).getAttribute("aria-pressed")).toBe("true");
    expect(markOf(rowOf("charts"))).not.toBeNull();
    expect(switchNamed(en.hooks.injection.enable)).toBeDefined();
    expect(() => switchNamed(en.skills.injection.enable)).toThrow();
    expect(hasButton(`${en.skills.uninstall} chart`)).toBe(false);
    expect(hasButton(`${en.skills.uninstall} notes`)).toBe(false);
  });

  it("marks the Skill a plugin installed and not the user's own, and the mark points at the plugin's row", async () => {
    const { router } = await openAgentPlugins({
      at: `${PAGE}?tab=skills`,
      ready: () => hasButton(`${en.skills.uninstall} notes`),
    });
    expect(markOf(rowOf("chart"))).not.toBeNull();
    expect(markOf(rowOf("notes"))).toBeNull();

    await click(markOf(rowOf("chart"))!);
    await waitFor(() => findPluginRow("Charts") !== null);
    expect(whereIs(router)).toBe(`${PAGE}?tab=plugins`);
    expect(dialogs()).toEqual([]);
    expect(subPageButton(en.agentPlugins.subPages.plugins).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(document.activeElement).toBe(pluginRowButton("Charts"));
    expect([...document.querySelectorAll("[data-marked]")]).toEqual([pluginRow("Charts")]);
  });

  it.each<{
    kind: string;
    tab: string;
    /** A button on screen once the sub-page's list is in. */
    ready: string;
    row: string;
    /** The row's description line: a click there is on the row's body. */
    body: string;
    folder: string;
    files: Record<string, string>;
    lead: string;
    /** Text the preview shows once the lead file is read. */
    shows: string;
  }>([
    {
      kind: "Skill",
      tab: "skills",
      ready: `${en.skills.uninstall} notes`,
      row: "chart",
      body: "Draw a chart",
      folder: "skills/chart",
      files: { "SKILL.md": "Draws a chart from a table.", "chart.py": "print(1)" },
      lead: "SKILL.md",
      shows: "Draws a chart from a table.",
    },
    {
      kind: "hook package",
      tab: "hooks",
      ready: `${en.hooks.exportHook} charts`,
      row: "charts",
      body: "Checks charts",
      folder: "hooks/charts",
      // No README: the manifest is what it opens on.
      files: { "hooks.json": '{ "stop": "lint-the-chart" }', "check.sh": "exit 0" },
      lead: "hooks.json",
      shows: "lint-the-chart",
    },
    {
      kind: "workbench",
      tab: "workbenches",
      ready: `${en.workbenches.more} Board`,
      row: "Board",
      body: "board",
      folder: "workbenches/board",
      files: { "README.md": "A board of charts.", "package.json": "{}" },
      lead: "README.md",
      shows: "A board of charts.",
    },
  ])(
    "opens a $kind's own files read-only from a click on its row",
    async ({ tab, ready, row, body, folder, files, lead, shows }) => {
      const workspace = `/data/agents/${AGENT_ID}/${folder}`;
      const { server } = await openAgentPlugins({
        at: `${PAGE}?tab=${tab}`,
        ready: () => hasButton(ready),
        files: { [workspace]: files },
      });
      const description = [...rowOf(row).querySelectorAll("span")].find(
        (span) => span.children.length === 0 && span.textContent === body,
      )!;
      await click(description);
      await waitFor(() => dialogs().length === 1 && topDialog().textContent!.includes(shows));

      const title = document.getElementById(topDialog().getAttribute("aria-labelledby")!);
      expect(title?.textContent).toBe(row);
      const listed = [...topDialog().querySelectorAll('[role="treeitem"]')].map(
        (item) => item.textContent ?? "",
      );
      expect(listed.some((text) => text.includes(lead))).toBe(true);
      const reads = server.fetch.requests.filter((r) => r.path.includes("/workspace-files"));
      expect(new Set(reads.map((r) => r.query.get("workspace")))).toEqual(new Set([workspace]));
      expect(server.writes()).toEqual([]);
    },
  );

  it("says which plugin installed a Skill before uninstalling it, and nothing of the kind for the user's own", async () => {
    const { server } = await openAgentPlugins({
      at: `${PAGE}?tab=skills`,
      ready: () => hasButton(`${en.skills.uninstall} notes`),
    });
    await click(button(`${en.skills.uninstall} chart`));
    expect(topDialog().textContent).toContain(en.agentPlugins.partFromPluginNote("Charts"));
    await pressScrim();
    await waitFor(() => dialogs().length === 0);

    await click(button(`${en.skills.uninstall} notes`));
    expect(topDialog().textContent).not.toContain(en.agentPlugins.partFromPluginNote("Charts"));
    await click(buttonIn(topDialog(), en.skills.uninstall));
    await waitFor(() => !hasButton(`${en.skills.uninstall} notes`));
    expect(server.writes().map((r) => [r.method, r.path])).toEqual([
      ["DELETE", `${AGENT_PATH}/skills/notes`],
    ]);
  });

  it("shows a member every sub-page's switch greyed at its state, and writes nothing", async () => {
    const { server } = await openAgentPlugins({
      role: "member",
      at: `${PAGE}?tab=skills`,
      ready: () => hasButton(`${en.skills.uninstall} notes`),
    });
    const greyed = async (name: string) => {
      const control = switchNamed(name);
      expect([control.disabled, control.getAttribute("aria-checked")]).toEqual([true, "true"]);
      await click(control);
    };
    await greyed(en.skills.injection.enable);
    await click(subPageButton(en.agentPlugins.subPages.hooks));
    await waitFor(() => hasButton(`${en.hooks.exportHook} charts`));
    await greyed(en.hooks.injection.enable);
    await click(subPageButton(en.agentPlugins.subPages.workbenches));
    await waitFor(() => hasButton(`${en.workbenches.more} Board`));
    await greyed(en.workbenches.enableAll);
    await greyed(en.workbenches.enableOne("Board"));
    expect(server.writes()).toEqual([]);
  });

  it("keeps a machine's Agent on its machine when another sub-page is pressed", async () => {
    const { router } = await openAgentPlugins({
      machines: [GPU],
      at: `${PAGE}?machine=gpu1&tab=skills`,
      ready: () => hasButton(`${en.skills.uninstall} notes`),
    });
    await click(subPageButton(en.agentPlugins.subPages.workbenches));
    expect(whereIs(router)).toBe(`${PAGE}?machine=gpu1&tab=workbenches`);
    await waitFor(() => hasButton(`${en.workbenches.more} Board`));
  });

  it("asks before another sub-page replaces an edited skills prompt, and keep editing stays", async () => {
    const { router } = await openAgentPlugins({
      at: `${PAGE}?tab=skills`,
      ready: () => document.querySelector("textarea") !== null,
    });
    await type(field(en.skills.injection.promptLabel), "Use them wisely.");
    await click(subPageButton(en.agentPlugins.subPages.hooks));
    expect(promptOpen()).toBe(true);
    await click(button(en.common.keepEditing));
    expect(whereIs(router)).toBe(`${PAGE}?tab=skills`);
    expect(field(en.skills.injection.promptLabel).value).toBe("Use them wisely.");
  });

  it("switches one workbench off by itself, and greys every switch while Enable workbenches is off", async () => {
    const { server } = await openAgentPlugins({
      at: `${PAGE}?tab=workbenches`,
      ready: () => hasButton(`${en.workbenches.open} Board`),
    });
    expect(markOf(rowOf("Board"))).not.toBeNull();
    expect(markOf(rowOf("Todo"))).toBeNull();
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

  it("shows a machine older than the workbench switches no switch at all", async () => {
    await openAgentPlugins({
      machines: [GPU],
      older: true,
      at: `${PAGE}?machine=gpu1&tab=workbenches`,
      ready: () => hasButton(`${en.workbenches.more} Board`),
    });
    expect(() => switchNamed(en.workbenches.enableAll)).toThrow();
    expect(() => switchNamed(en.workbenches.enableOne("Board"))).toThrow();
  });

  it("says an Agent has no hook package, and keeps Import hook", async () => {
    await openAgentPlugins({
      hooks: [],
      at: `${PAGE}?tab=hooks`,
      ready: () => has(en.agentPlugins.hooksEmpty),
    });
    expect(button(en.hooks.importHook).disabled).toBe(false);
  });
});
