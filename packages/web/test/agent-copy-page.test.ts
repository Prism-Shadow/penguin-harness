// @vitest-environment jsdom
/**
 * Copy agent on the Agent settings page (features/agents/agent-settings-page.tsx): the Agent
 * State row's action opens the copy dialog, and a copy lands where the Agent lives.
 *
 * - Given this server's Agent, the copy is created on this server from that Agent, and the page
 *   moves to the copy's settings.
 * - Given a machine's Agent, the copy is created on that machine, never on this server, and the
 *   page moves to the copy's settings on the machine.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { AgentSettingsPage } from "../src/features/agents/agent-settings-page";
import { AGENT_ID, PROJECT_ID, agentServer, mountAgentApp, whereIs } from "./helpers/agent-app";
import type { FakeMachine } from "./helpers/agent-app";
import { button, click, field, hasButton, type, unmountAll, waitFor } from "./helpers/dom";

const AGENTS = `/api/projects/${PROJECT_ID}/agents`;
const GPU: FakeMachine = {
  machineId: "gpu1",
  alias: "gpu-box",
  agents: ["default_agent", AGENT_ID],
};

/** Copies the open page's Agent under `agentId` through the dialog, keeping the suggested name. */
async function copyAs(agentId: string) {
  await waitFor(() => hasButton(en.agent.copyAgent), 40);
  await click(button(en.agent.copyAgent));
  await type(field(en.agent.id), agentId);
  await click(button(en.agent.copyConfirm));
}

describe("Copy agent on the settings page", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  it("copies this server's Agent here and opens the copy", async () => {
    const server = agentServer();
    const router = await mountAgentApp(h(AgentSettingsPage), { at: `/agents/${AGENT_ID}` });
    await copyAs("method_b");
    await waitFor(() => whereIs(router).startsWith("/agents/method_b"), 40);

    const creates = server.fetch.requests.filter((r) => r.method === "POST" && r.path === AGENTS);
    expect(creates.map((r) => [r.machine, r.body])).toEqual([
      // The name starts from the Agent's display name, which the fake config calls "Helper".
      [null, { agentId: "method_b", name: en.agent.copyNameOf("Helper"), copyFrom: AGENT_ID }],
    ]);
    expect(whereIs(router)).not.toContain("machine=");
  });

  it("copies a machine's Agent on that machine and opens the copy there", async () => {
    const server = agentServer(undefined, { machines: [GPU] });
    const router = await mountAgentApp(h(AgentSettingsPage), {
      at: `/agents/${AGENT_ID}?machine=gpu1`,
    });
    await copyAs("method_b");
    await waitFor(() => whereIs(router).startsWith("/agents/method_b"), 40);

    const creates = server.fetch.requests.filter((r) => r.method === "POST" && r.path === AGENTS);
    expect(creates.map((r) => r.machine)).toEqual(["gpu1"]);
    expect((creates[0]!.body as { copyFrom?: string }).copyFrom).toBe(AGENT_ID);
    expect(whereIs(router)).toContain("machine=gpu1");
  });
});
