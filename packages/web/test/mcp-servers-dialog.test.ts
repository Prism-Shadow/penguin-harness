// @vitest-environment jsdom
/**
 * The MCP Server add / edit dialog (features/agents/mcp-server-dialog.tsx, opened from the
 * Tools tab's MCP section) as one record form under the settings commit model.
 *
 * - Save waits for a name and an address; a broken address is named as soon as it is typed,
 *   while an untouched required field shows only its asterisk.
 * - Esc, Cancel, a press outside and the × each ask while anything is typed; "keep editing"
 *   leaves the dialog and the typing.
 * - An untouched dialog closes at once.
 * - A saved entry closes the dialog without asking and joins the list.
 * - A refused save keeps the dialog open with the reason at its foot, still unsaved.
 * - An edit typed back to the stored entry is no change: Save stays held, and Cancel asks
 *   nothing.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createElement as h } from "react";
import type { MCPServerConfig } from "@prismshadow/penguin-core/interfaces";
import { hasUnsaved } from "@prismshadow/penguin-ui";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { McpServersSection } from "../src/features/agents/mcp-servers-section";
import {
  AGENT_ID,
  agentServer,
  buttonIn,
  fieldIn,
  mountAgentApp,
  topDialog,
} from "./helpers/agent-app";
import {
  button,
  click,
  dialogs,
  hasButton,
  pressEscape,
  pressScrim,
  type,
  unmountAll,
  waitFor,
} from "./helpers/dom";

const STORED: MCPServerConfig = {
  name: "search",
  config: { transport: "http", url: "https://search.example/mcp" },
};

async function openSection(initial: MCPServerConfig[] = []) {
  const server = agentServer();
  await mountAgentApp(h(McpServersSection, { agentId: AGENT_ID, initial }), {
    at: `/agents/${AGENT_ID}`,
  });
  await waitFor(() => hasButton(en.agent.mcpAdd));
  return server;
}

const inDialog = (title: string) => fieldIn(topDialog(), title);
const dialogSave = () => buttonIn(topDialog(), en.common.save);
const promptOpen = () => hasButton(en.common.discard);

async function addOne() {
  await click(button(en.agent.mcpAdd));
  await type(inDialog(en.agent.mcpName), "files");
  await type(inDialog(en.agent.mcpUrl), "https://files.example/mcp");
}

describe("the MCP Server dialog", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  it("waits for a name and an address, naming a broken address but not an untouched one", async () => {
    await openSection();
    await click(button(en.agent.mcpAdd));
    expect(dialogSave().disabled).toBe(true);
    await type(inDialog(en.agent.mcpName), "files");
    expect(dialogSave().disabled).toBe(true);
    expect(topDialog().textContent).not.toContain(en.common.requiredField);

    await type(inDialog(en.agent.mcpUrl), "ftp://files.example");
    expect(dialogSave().disabled).toBe(true);
    expect(topDialog().textContent).toContain(en.agent.mcpUrlInvalid);
    await type(inDialog(en.agent.mcpUrl), "https://files.example/mcp");
    expect(dialogSave().disabled).toBe(false);
  });

  it.each([
    ["Escape", pressEscape],
    ["Cancel", () => click(buttonIn(topDialog(), en.common.cancel))],
    ["a press outside", pressScrim],
    ["the ×", () => click(buttonIn(topDialog(), "Close"))],
  ])("asks on %s with anything typed, and keep editing keeps the typing", async (_, leave) => {
    await openSection();
    await click(button(en.agent.mcpAdd));
    await type(inDialog(en.agent.mcpName), "files");
    await leave();
    expect(promptOpen()).toBe(true);
    await click(button(en.common.keepEditing));
    expect(dialogs()).toHaveLength(1);
    expect(inDialog(en.agent.mcpName).value).toBe("files");
  });

  it("closes an untouched dialog at once", async () => {
    await openSection();
    await click(button(en.agent.mcpAdd));
    await click(buttonIn(topDialog(), en.common.cancel));
    expect(promptOpen()).toBe(false);
    expect(dialogs()).toEqual([]);
  });

  it("closes without asking once saved, and the entry joins the list", async () => {
    const server = await openSection();
    await addOne();
    await click(dialogSave());
    await waitFor(() => dialogs().length === 0);
    expect(promptOpen()).toBe(false);
    expect(hasUnsaved()).toBe(false);
    expect(server.config().config.mcpServers).toEqual([
      { name: "files", config: { transport: "http", url: "https://files.example/mcp" } },
    ]);
    expect(document.body.textContent).toContain("https://files.example/mcp");
  });

  it("keeps a refused save open with the reason at its foot, still unsaved", async () => {
    const server = await openSection();
    server.refuseNext(400, "invalid_config", "the transport refused it");
    await addOne();
    await click(dialogSave());
    await waitFor(() => topDialog().textContent?.includes("the transport refused it") === true);
    expect(hasUnsaved()).toBe(true);
    await click(buttonIn(topDialog(), en.common.cancel));
    expect(promptOpen()).toBe(true);
  });

  it("holds Save on an edit typed back to the stored entry, and closes without asking", async () => {
    await openSection([STORED]);
    await click(button(en.common.edit));
    await type(inDialog(en.agent.mcpName), "search2");
    expect(dialogSave().disabled).toBe(false);
    await type(inDialog(en.agent.mcpName), "search");
    expect(dialogSave().disabled).toBe(true);
    await click(buttonIn(topDialog(), en.common.cancel));
    expect(promptOpen()).toBe(false);
    expect(dialogs()).toEqual([]);
  });
});
