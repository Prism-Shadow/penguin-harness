// @vitest-environment jsdom
/**
 * The market card's install action names one state, on one line
 * (features/plugins/plugin-card.tsx, the `marketCard` branch). It used to key its word off the
 * current Agent and add the Project-wide count on a second line, so a plugin some other Agent
 * had read "Install" over "Installed on 1 Agent".
 *
 * - Given a plugin installed on the machine's Agent and not on the current Agent, once both have
 *   answered the action reads the count alone; until the machine answers it may read Install,
 *   but no frame shows the two together. Pressing the count opens the install flow on its Agents
 *   (the server has the plugin), which offers the current Agent Install and shows the machine's
 *   Agent with it.
 * - Given a plugin installed nowhere, the action reads Install; pressing it opens the same flow,
 *   where Install on the current Agent installs it, and from then on the action reads the count.
 *   No frame of the card shows both.
 * - Either way the action is one line of words, in the cards and in the list.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createElement as h } from "react";
import type { PluginItem } from "@prismshadow/penguin-server/api";
import * as api from "../src/api/endpoints";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { PluginsPage } from "../src/features/plugins/plugins-page";
import { AGENT_ID, PROJECT_ID, agentServer, mountAgentApp, topDialog } from "./helpers/agent-app";
import type { FakeMachine } from "./helpers/agent-app";
import { button, click, unmountAll, waitFor, watchText } from "./helpers/dom";

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

const GPU: FakeMachine = {
  machineId: "gpu1",
  alias: "gpu-box",
  agents: [AGENT_ID],
  library: [CHARTS],
};

const ACTION = '[data-plugin="charts"] .showcase-card-bar button:first-child';
const INSTALL = en.skills.install;
const ON_ONE = en.plugins.marketAgentInstalls(1);
const action = () => document.querySelector<HTMLButtonElement>(ACTION);

/** Every word the action showed was one state's whole label (or nothing, before the card). */
const singleStates = (texts: string[]) =>
  texts.every((words) => ["", INSTALL, ON_ONE].includes(words));

/** The action's words are one line: a text node alone, no element under its label. */
const oneLine = (node: HTMLButtonElement) =>
  node.children.length === 0 && !node.textContent!.includes("\n");

async function openMarket(layout: "cards" | "list") {
  localStorage.setItem("penguin.pluginsLayout", layout);
  return mountAgentApp(h(PluginsPage), { route: "/plugins", at: "/plugins" });
}

describe("the market card's install action", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
    localStorage.clear();
  });

  for (const layout of ["cards", "list"] as const) {
    it(`reads the count alone for a plugin another Agent has, and opens the install flow (${layout})`, async () => {
      agentServer(undefined, { machines: [GPU], library: [CHARTS] });
      await api.installAgentPlugins(PROJECT_ID, AGENT_ID, ["charts"], "gpu1");
      const seen = watchText(ACTION);
      await openMarket(layout);
      await waitFor(() => action()?.textContent === ON_ONE, 40);
      expect(oneLine(action()!)).toBe(true);
      expect(singleStates(seen.texts())).toBe(true);

      await click(action()!);
      expect(topDialog().getAttribute("aria-label")).toBe(
        en.plugins.installModel.flowTitle("Charts"),
      );
      expect(button(en.plugins.installModel.addToAgent("Helper")).disabled).toBe(false);
      await click(
        topDialog().querySelector<HTMLInputElement>('input[value="gpu1/' + AGENT_ID + '"]')!,
      );
      expect(
        button(`${en.skills.uninstall} ${AGENT_ID} ${en.chat.machineTag("gpu-box")}`),
      ).toBeDefined();
    });
  }

  it("reads Install for a plugin no Agent has, installs it on the current Agent from the flow, then reads the count", async () => {
    agentServer(undefined, { library: [CHARTS] });
    await openMarket("cards");
    await waitFor(() => action()?.textContent === INSTALL && !action()!.disabled, 40);
    expect(oneLine(action()!)).toBe(true);
    const seen = watchText(ACTION);

    await click(action()!);
    await click(button(en.plugins.installModel.addToAgent("Helper")));
    await waitFor(() => action()?.textContent === ON_ONE, 40);
    expect(oneLine(action()!)).toBe(true);
    expect(seen.texts()).toEqual([INSTALL, ON_ONE]);
  });
});
