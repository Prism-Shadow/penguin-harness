// @vitest-environment jsdom
/**
 * A machine's Agent on the Agent settings page (features/agents/agent-settings-page.tsx at
 * `?machine=<id>`): every read and write goes to that machine, never to this server's Agent of
 * the same id (lib/agent-location.ts).
 *
 * - Given a connected machine's `helper`, walking every tab reads the Agent from that machine
 *   alone — nothing about `helper` is asked of this server — and the header names the machine.
 * - Saving the name writes it on the machine; this server's `helper` is written nothing.
 * - Switching tabs keeps the page on the machine.
 * - Given the address a machine Session's links write (the conversation's memory "manage" link
 *   and the composer's Agent settings, features/chat/chat-page.tsx), the page opens on that tab
 *   with the machine's Agent, and asks this server nothing about `helper`.
 * - Given the machine is being brought back, the page says so and asks the machine nothing.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { AgentSettingsPage } from "../src/features/agents/agent-settings-page";
import { agentSettingsPath } from "../src/lib/agent-location";
import { AGENT_ID, PROJECT_ID, agentServer, mountAgentApp, whereIs } from "./helpers/agent-app";
import type { FakeMachine } from "./helpers/agent-app";
import { button, click, field, type, unmountAll, waitFor } from "./helpers/dom";

const GPU: FakeMachine = {
  machineId: "gpu1",
  alias: "gpu-box",
  agents: ["default_agent", AGENT_ID],
};
const PAGE = `/agents/${AGENT_ID}?machine=gpu1`;
/** Every request about the Agent itself, wherever it went. */
const AGENT_PATH = `/api/projects/${PROJECT_ID}/agents/${AGENT_ID}`;

const TABS = [
  en.agent.tabPrompt,
  en.agent.tabRuntime,
  en.agent.tabTools,
  en.agent.tabSkills,
  en.agent.tabHooks,
  en.agent.tabWorkbenches,
  en.agent.tabMemory,
  en.agent.tabVault,
  en.agent.tabSchedules,
  en.agent.tabApi,
  en.agent.tabOverview,
];

async function openPage(machine: FakeMachine = GPU) {
  const server = agentServer(undefined, { machines: [machine] });
  const router = await mountAgentApp(h(AgentSettingsPage), { at: PAGE });
  return { server, router };
}

describe("a machine's Agent on its settings page", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  it("reads every tab from the machine alone, and names the machine in the header", async () => {
    const { server, router } = await openPage();
    await waitFor(
      () => document.body.textContent?.includes(en.chat.machineTag("gpu-box")) === true,
    );
    for (const tab of TABS) {
      await click(button(tab));
      await waitFor(() => whereIs(router).includes("machine=gpu1"));
    }
    const aboutAgent = server.fetch.requests.filter((r) => r.path.startsWith(AGENT_PATH));
    expect(aboutAgent.length).toBeGreaterThan(TABS.length);
    expect(aboutAgent.filter((r) => r.machine !== "gpu1")).toEqual([]);
    // The tabs' Project-level reads (models, new-chat defaults) are the machine's too.
    const projectReads = server.fetch.requests.filter((r) =>
      [`/api/projects/${PROJECT_ID}/models`, `/api/projects/${PROJECT_ID}/chat-defaults`].includes(
        r.path,
      ),
    );
    expect(projectReads.length).toBeGreaterThan(0);
    expect(projectReads.filter((r) => r.machine !== "gpu1")).toEqual([]);
  });

  it("writes a saved name on the machine and nothing on this server's Agent of the same id", async () => {
    const { server } = await openPage();
    await waitFor(() => document.querySelector("input") !== null);
    await type(field(en.common.name), "Remote helper");
    await click(button(en.common.save));
    await waitFor(() => server.writes("/config").length === 1);
    const [write] = server.writes("/config");
    expect(write!.machine).toBe("gpu1");
    expect(write!.body).toEqual({ config: { name: "Remote helper" } });
    expect(
      server.fetch.requests.filter(
        (r) => r.machine === null && r.method !== "GET" && r.path.startsWith(AGENT_PATH),
      ),
    ).toEqual([]);
  });

  it("opens a machine Session's link on its tab with the machine's Agent", async () => {
    const server = agentServer(undefined, { machines: [GPU] });
    const router = await mountAgentApp(h(AgentSettingsPage), {
      at: agentSettingsPath(AGENT_ID, "gpu1", "memory"),
    });
    await waitFor(() => server.fetch.requests.some((r) => r.path === `${AGENT_PATH}/memory`));
    expect(whereIs(router)).toBe(`/agents/${AGENT_ID}?machine=gpu1&tab=memory`);
    const aboutAgent = server.fetch.requests.filter((r) => r.path.startsWith(AGENT_PATH));
    expect(aboutAgent.filter((r) => r.path === `${AGENT_PATH}/memory`).length).toBeGreaterThan(0);
    expect(aboutAgent.filter((r) => r.machine !== "gpu1")).toEqual([]);
  });

  it("says a machine being brought back is reconnecting, and asks it nothing", async () => {
    const { server } = await openPage({ ...GPU, reconnecting: true });
    await waitFor(
      () => document.body.textContent?.includes(en.machines.composer.reconnecting) === true,
    );
    expect(server.fetch.requests.filter((r) => r.machine === "gpu1")).toEqual([]);
    expect(server.fetch.requests.filter((r) => r.path.startsWith(AGENT_PATH))).toEqual([]);
  });
});
