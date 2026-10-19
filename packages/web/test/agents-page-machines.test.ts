// @vitest-environment jsdom
/**
 * A machine's Agents on the Agents page (features/agents/agents-page.tsx): that machine's own,
 * never folded into this server's (lib/agent-location.ts), and listed beside them in one list
 * (lib/machine-agent-lists.ts), the way the sidebar mixes machine Workspaces with local ones.
 *
 * - Given this server's `helper` and a connected machine that has a `default_agent` and a
 *   `helper` of its own, the page lists all three in one list, by creation, no section for the
 *   machine — the shared id is two cards — each of the machine's named `[SSH: gpu-box]` after
 *   its name, and none of this server's.
 * - A machine card's name and Settings open that Agent's settings page on that machine; the card
 *   does not make it the current Agent here.
 * - Delete on a machine card names the machine before it deletes, deletes through that machine,
 *   and leaves this server's Agent of the same id where it was.
 * - Once a machine-only Agent is deleted, the session list stops asking that machine for its
 *   Sessions: they no longer show.
 * - Given a machine being brought back, the Agents it was last seen with stay in the list,
 *   greyed, the reason beside the tag and on every control, every control off; nothing is
 *   asked of that machine.
 * - The search box narrows the one list, machine Agents included.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createElement as h } from "react";
import type { AgentSummary, SessionsBatchRequest } from "@prismshadow/penguin-server/api";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { AgentsPage } from "../src/features/agents/agents-page";
import { rememberMachineAgents } from "../src/lib/machine-cache";
import { PROJECT_ID, agentServer, mountAgentApp, topDialog, whereIs } from "./helpers/agent-app";
import type { FakeMachine } from "./helpers/agent-app";
import { button, click, type, unmountAll, waitFor } from "./helpers/dom";

const GPU: FakeMachine = {
  machineId: "gpu1",
  alias: "gpu-box",
  agents: ["default_agent", "helper"],
};
const LAB: FakeMachine = { machineId: "lab1", alias: "lab", agents: [], reconnecting: true };

const tagOf = (alias: string) => en.chat.machineTag(alias);

/** The cards on the page, top to bottom. */
const cards = () => [...document.querySelectorAll<HTMLElement>(".ui-frame")];

/** What a card is: its name, and the machine tag after it when it has one. */
function describeCard(card: HTMLElement): string {
  const title = card.querySelector("div > div")!;
  const name = title.querySelector("a, span.font-bold, span.text-base")?.textContent ?? "";
  const tag = [...title.querySelectorAll("span")].find((s) => s.textContent?.startsWith("[SSH:"));
  return tag === undefined ? name : `${name} ${tag.textContent}`;
}

/** The card of `name`, on `alias` or (no alias) on this server. */
function cardOf(name: string, alias?: string): HTMLElement {
  const want = alias === undefined ? name : `${name} ${tagOf(alias)}`;
  const card = cards().find((c) => describeCard(c) === want);
  if (card === undefined) throw new Error(`no card for ${want}`);
  return card;
}

const sectionTitles = () =>
  [...document.querySelectorAll("section h2")].map((title) => title.textContent);

async function openPage(machines: FakeMachine[]) {
  const server = agentServer(undefined, { machines });
  const router = await mountAgentApp(h(AgentsPage), { route: "/list", at: "/list" });
  return { server, router };
}

describe("a machine's Agents on the Agents page", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
    localStorage.clear();
  });

  it("lists them in one list with this server's, by creation, a shared id as two cards", async () => {
    await openPage([GPU]);
    await waitFor(() => cards().length === 3);
    expect(cards().map(describeCard)).toEqual([
      "Helper",
      `default_agent ${tagOf("gpu-box")}`,
      `helper ${tagOf("gpu-box")}`,
    ]);
    // No section of its own: the machine is named on its cards, nowhere else.
    expect(sectionTitles()).toEqual([]);
  });

  it("opens a machine Agent's settings on that machine, from its name and from Settings", async () => {
    const { router } = await openPage([GPU]);
    await waitFor(() => cards().length === 3);
    const card = cardOf("helper", "gpu-box");
    expect(card.querySelector("a")!.getAttribute("href")).toBe("/agents/helper?machine=gpu1");
    await click(
      [...card.querySelectorAll("button")].find((b) => b.textContent === en.common.settings)!,
    );
    expect(whereIs(router)).toBe("/agents/helper?machine=gpu1");
  });

  it("deletes a machine's Agent through that machine, after naming it, and keeps this server's", async () => {
    const { server } = await openPage([GPU]);
    await waitFor(() => cards().length === 3);
    await click(
      cardOf("helper", "gpu-box").querySelector(`button[aria-label="${en.agent.deleteAgent}"]`)!,
    );
    expect(topDialog().textContent).toContain(en.agent.deleteConfirmOnMachine("helper", "gpu-box"));
    await click(button(en.common.delete));
    await waitFor(() => cards().length === 2);

    const deletes = server.fetch.requests.filter((r) => r.method === "DELETE");
    expect(deletes.map((r) => [r.machine, r.path])).toEqual([
      ["gpu1", `/api/projects/${PROJECT_ID}/agents/helper`],
    ]);
    expect(server.machineAgents("gpu1")).toEqual(["default_agent"]);
    expect(cards().map(describeCard)).toEqual(["Helper", `default_agent ${tagOf("gpu-box")}`]);
  });

  it("stops asking the machine for a deleted machine-only Agent's Sessions", async () => {
    const { server } = await openPage([{ ...GPU, agents: ["default_agent", "trainer"] }]);
    const batchPath = `/api/projects/${PROJECT_ID}/sessions/batch`;
    const lastBatchAsks = () =>
      (
        server.fetch.requests.filter((r) => r.machine === "gpu1" && r.path === batchPath).at(-1)
          ?.body as SessionsBatchRequest | undefined
      )?.requests.map((r) => r.agentId) ?? [];
    await waitFor(() => lastBatchAsks().includes("trainer"));
    await click(
      cardOf("trainer", "gpu-box").querySelector(`button[aria-label="${en.agent.deleteAgent}"]`)!,
    );
    await click(button(en.common.delete));
    await waitFor(() => !lastBatchAsks().includes("trainer"));
    expect(lastBatchAsks()).toContain("default_agent");
  });

  it("keeps a machine being brought back as last seen, greyed, inert, the reason on the card", async () => {
    rememberMachineAgents(PROJECT_ID, "lab1", [
      {
        agentId: "trainer",
        name: "Trainer",
        createdAt: "2026-10-01T00:00:00Z",
        sessionActivity: [],
        pluginUpdates: [],
      } as unknown as AgentSummary,
    ]);
    const { server } = await openPage([LAB]);
    await waitFor(() => cards().length === 2);
    expect(cards().map(describeCard)).toEqual(["Helper", `Trainer ${tagOf("lab")}`]);
    const card = cardOf("Trainer", "lab");
    const reason = en.machines.composer.reconnecting;
    // The reason sits beside the tag, named for assistive technology, and on every control.
    expect(card.querySelector(`[role="img"][aria-label="${reason}"]`)).not.toBeNull();
    expect(card.querySelector("a")).toBeNull();
    for (const name of [en.chat.newSessionMenu, en.common.settings]) {
      const control = [...card.querySelectorAll("button")].find((b) => b.textContent === name)!;
      expect(control.disabled).toBe(true);
      expect(control.getAttribute("data-tooltip") ?? control.getAttribute("title")).toBe(reason);
    }
    const remove = card.querySelector<HTMLButtonElement>(
      `button[aria-label="${en.agent.deleteAgent}"]`,
    )!;
    expect(remove.disabled).toBe(true);
    expect(server.fetch.requests.filter((r) => r.machine === "lab1")).toEqual([]);
  });

  it("narrows the one list with the search box, machine Agents included", async () => {
    await openPage([{ ...GPU, agents: ["default_agent", "trainer"] }]);
    await waitFor(() => cards().length === 3);
    const search = document.querySelector<HTMLInputElement>(
      `input[placeholder="${en.agent.searchPlaceholder}"]`,
    )!;
    await type(search, "train");
    expect(cards().map(describeCard)).toEqual([`trainer ${tagOf("gpu-box")}`]);
    await type(search, "helper");
    expect(cards().map(describeCard)).toEqual(["Helper"]);
  });
});
