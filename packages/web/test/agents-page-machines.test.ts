// @vitest-environment jsdom
/**
 * A machine's Agents on the Agents page (features/agents/agents-page.tsx): that machine's own,
 * never folded into this server's (lib/agent-machine.ts, lib/machine-agents.ts).
 *
 * - Given this server's `helper` and a connected machine that has a `default_agent` and a
 *   `helper` of its own, the page lists this server's `helper` in its list and the machine's two
 *   in a section of the machine's own — the shared id is two cards — each of the machine's
 *   named `[SSH: gpu-box]` after its name, and none of this server's.
 * - A machine card's name and Settings open that Agent's settings page on the machine; the card
 *   does not make it the current Agent here.
 * - Delete on a machine card names the machine before it deletes, deletes through that machine,
 *   and leaves this server's Agent of the same id where it was.
 * - Once a machine-only Agent is deleted, the session list stops asking that machine for its
 *   Sessions: they no longer show.
 * - Given a machine being brought back, its section says so above what it was last seen holding,
 *   every control on those cards is off, and nothing is asked of that machine.
 * - The search box narrows the machine sections too, hiding one with no match.
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

/** A machine's section: the ruled section whose title names it. */
function sectionOf(alias: string): HTMLElement | null {
  const title = en.agent.machineSection(alias);
  return (
    [...document.querySelectorAll<HTMLElement>("section")].find((s) =>
      s.querySelector("h2")?.textContent?.includes(title),
    ) ?? null
  );
}

/** The card in `scope` whose title line holds `name`. */
function cardIn(scope: ParentNode, name: string): HTMLElement {
  const card = [...scope.querySelectorAll<HTMLElement>(".ui-frame")].find((c) =>
    [...c.querySelectorAll("a, span")].some((e) => e.textContent === name),
  );
  if (card === undefined) throw new Error(`no card for ${name}`);
  return card;
}

/** The list of this server's Agents: everything outside the machine sections. */
const hereCards = () =>
  [...document.querySelectorAll<HTMLElement>(".ui-frame")].filter(
    (c) => c.closest("section") === null,
  );

const tagOf = (alias: string) => en.chat.machineTag(alias);

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

  it("lists them in the machine's own section, a shared id as two cards, named with the machine", async () => {
    await openPage([GPU]);
    await waitFor(() => sectionOf("gpu-box")?.querySelectorAll(".ui-frame").length === 2);
    const section = sectionOf("gpu-box")!;
    expect(section.textContent).toContain("default_agent");
    expect(cardIn(section, "helper").textContent).toContain(tagOf("gpu-box"));
    expect(cardIn(section, "default_agent").textContent).toContain(tagOf("gpu-box"));
    // This server's helper is its own card, outside the section and without a machine.
    const here = hereCards();
    expect(here).toHaveLength(1);
    expect(here[0]!.textContent).toContain("Helper");
    expect(here[0]!.textContent).not.toContain("[SSH:");
  });

  it("opens a machine Agent's settings on that machine, from its name and from Settings", async () => {
    const { router } = await openPage([GPU]);
    await waitFor(() => sectionOf("gpu-box") !== null);
    const card = cardIn(sectionOf("gpu-box")!, "helper");
    expect(card.querySelector("a")!.getAttribute("href")).toBe("/agents/helper?machine=gpu1");
    await click(
      [...card.querySelectorAll("button")].find((b) => b.textContent === en.common.settings)!,
    );
    expect(whereIs(router)).toBe("/agents/helper?machine=gpu1");
  });

  it("deletes a machine's Agent through that machine, after naming it, and keeps this server's", async () => {
    const { server } = await openPage([GPU]);
    await waitFor(() => sectionOf("gpu-box")?.querySelectorAll(".ui-frame").length === 2);
    const card = cardIn(sectionOf("gpu-box")!, "helper");
    await click(card.querySelector(`button[aria-label="${en.agent.deleteAgent}"]`)!);
    expect(topDialog().textContent).toContain(en.agent.deleteConfirmOnMachine("helper", "gpu-box"));
    await click(button(en.common.delete));
    await waitFor(() => sectionOf("gpu-box")?.querySelectorAll(".ui-frame").length === 1);

    const deletes = server.fetch.requests.filter((r) => r.method === "DELETE");
    expect(deletes.map((r) => [r.machine, r.path])).toEqual([
      ["gpu1", `/api/projects/${PROJECT_ID}/agents/helper`],
    ]);
    expect(server.machineAgents("gpu1")).toEqual(["default_agent"]);
    expect(hereCards()).toHaveLength(1);
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
    const card = cardIn(sectionOf("gpu-box")!, "trainer");
    await click(card.querySelector(`button[aria-label="${en.agent.deleteAgent}"]`)!);
    await click(button(en.common.delete));
    await waitFor(() => !lastBatchAsks().includes("trainer"));
    expect(lastBatchAsks()).toContain("default_agent");
  });

  it("shows a machine being brought back as it was last seen, inert, and asks it nothing", async () => {
    rememberMachineAgents(PROJECT_ID, "lab1", [
      {
        agentId: "trainer",
        name: "Trainer",
        sessionActivity: [],
        pluginUpdates: [],
      } as unknown as AgentSummary,
    ]);
    const { server } = await openPage([LAB]);
    await waitFor(() => sectionOf("lab") !== null);
    const section = sectionOf("lab")!;
    expect(section.textContent).toContain(en.machines.composer.reconnecting);
    const card = cardIn(section, "Trainer");
    expect(card.querySelector("a")).toBeNull();
    for (const name of [en.chat.newSessionMenu, en.common.settings]) {
      expect(
        [...card.querySelectorAll("button")].find((b) => b.textContent === name)!.disabled,
      ).toBe(true);
    }
    expect(
      card.querySelector<HTMLButtonElement>(`button[aria-label="${en.agent.deleteAgent}"]`)!
        .disabled,
    ).toBe(true);
    expect(server.fetch.requests.filter((r) => r.machine === "lab1")).toEqual([]);
  });

  it("narrows the machine sections with the search box, hiding one with no match", async () => {
    await openPage([{ ...GPU, agents: ["default_agent", "trainer"] }]);
    await waitFor(() => sectionOf("gpu-box")?.querySelectorAll(".ui-frame").length === 2);
    await type(
      document.querySelector<HTMLInputElement>(
        `input[placeholder="${en.agent.searchPlaceholder}"]`,
      )!,
      "train",
    );
    expect(sectionOf("gpu-box")!.querySelectorAll(".ui-frame")).toHaveLength(1);
    expect(hereCards()).toHaveLength(0);
    await type(
      document.querySelector<HTMLInputElement>(
        `input[placeholder="${en.agent.searchPlaceholder}"]`,
      )!,
      "helper",
    );
    expect(sectionOf("gpu-box")).toBeNull();
    expect(hereCards()).toHaveLength(1);
  });
});
