// @vitest-environment jsdom
/**
 * The built-in tools table on the Agent settings Tools tab (features/agents/tools-form.ts and
 * the tab in agent-settings-page.tsx): a typed table whose rows always exist, with a
 * `call_description` switch on each row that commits on its own.
 *
 * - The switch writes at once: the stored table with that one row flipped. A timeout typed
 *   beside it is neither sent nor reset — it stays typed and unsaved.
 * - A flip alone leaves nothing unsaved, so leaving the tab after it asks nothing.
 * - A later Save lays the typed cells over the table as it now is, so it never undoes the flip.
 * - A refused flip puts the switch back and says why.
 * - A cell holding a number the server refuses is named under it and holds Save; a cell cleared
 *   of an override is a valid change that drops the override.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { hasUnsaved, toastStore } from "@prismshadow/penguin-ui";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { AgentSettingsPage } from "../src/features/agents/agent-settings-page";
import { AGENT_ID, agentConfig, agentServer, mountAgentApp, whereIs } from "./helpers/agent-app";
import {
  button,
  click,
  field,
  hasButton,
  switchNamed,
  type,
  unmountAll,
  waitFor,
} from "./helpers/dom";

const STORED_TOOLS = agentConfig().config.toolsBuiltin;

async function openTools() {
  const server = agentServer();
  const router = await mountAgentApp(h(AgentSettingsPage), {
    at: `/agents/${AGENT_ID}?tab=tools`,
  });
  await waitFor(() => document.querySelector('button[role="switch"]') !== null);
  return { server, router };
}

const timeout = () => field(`exec_command ${en.agent.toolTimeout}`);
const readFileSwitch = () => switchNamed(`read_file ${en.agent.toolCallDescription}`);
const save = () => button(en.common.save);
type ToolsBody = { config: { toolsBuiltin: typeof STORED_TOOLS } };
const tableSent = (server: ReturnType<typeof agentServer>, i: number) =>
  (server.writes("/config")[i]!.body as ToolsBody).config.toolsBuiltin;

describe("the built-in tools table", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  beforeEach(() => toastStore.setState({ items: [] }));
  afterEach(async () => {
    await unmountAll();
  });

  it("writes a flipped switch at once, alone, and leaves the typed timeout typed and unsent", async () => {
    const { server } = await openTools();
    await type(timeout(), "90000");
    await click(readFileSwitch());
    await waitFor(() => server.writes("/config").length === 1);
    expect(tableSent(server, 0)).toEqual(
      STORED_TOOLS.map((t) => (t.name === "read_file" ? { ...t, call_description: true } : t)),
    );
    await waitFor(() => readFileSwitch().getAttribute("aria-checked") === "true");
    expect(timeout().value).toBe("90000");
    expect(save().disabled).toBe(false);
    expect(hasUnsaved()).toBe(true);
  });

  it("leaves the tab without asking after a flip alone", async () => {
    const { server, router } = await openTools();
    await click(readFileSwitch());
    await waitFor(() => server.writes("/config").length === 1);
    expect(hasUnsaved()).toBe(false);
    await click(button(en.agent.tabRuntime));
    expect(hasButton(en.common.discard)).toBe(false);
    expect(whereIs(router)).toBe(`/agents/${AGENT_ID}?tab=runtime`);
  });

  it("saves the typed cells over the table as it now is, keeping an earlier flip", async () => {
    const { server } = await openTools();
    await type(timeout(), "90000");
    await click(readFileSwitch());
    await waitFor(() => server.writes("/config").length === 1);
    await click(save());
    await waitFor(() => server.writes("/config").length === 2);
    const sent = tableSent(server, 1);
    expect(sent.find((t) => t.name === "exec_command")?.timeoutMs).toBe(90000);
    expect(sent.find((t) => t.name === "read_file")?.call_description).toBe(true);
    await waitFor(() => save().disabled);
    expect(hasUnsaved()).toBe(false);
  });

  it("puts a refused flip back and says why", async () => {
    const { server } = await openTools();
    server.refuseNext(400, "invalid_config");
    await click(readFileSwitch());
    await waitFor(() => toastStore.getState().items.length > 0);
    expect(toastStore.getState().items.map((t) => t.kind)).toEqual(["error"]);
    expect(readFileSwitch().getAttribute("aria-checked")).toBe("false");
    expect(server.config().config.toolsBuiltin).toEqual(STORED_TOOLS);
  });

  it("names a refused number and holds Save; a cleared override is a valid change", async () => {
    const { server } = await openTools();
    await type(timeout(), "0");
    expect(save().disabled).toBe(true);
    expect(document.body.textContent).toContain(
      en.agent.toolFieldInvalid("exec_command", "timeoutMs"),
    );

    await type(timeout(), "");
    expect(save().disabled).toBe(false);
    await click(save());
    await waitFor(() => server.writes("/config").length === 1);
    expect(tableSent(server, 0).find((t) => t.name === "exec_command")).not.toHaveProperty(
      "timeoutMs",
    );
  });
});
