// @vitest-environment jsdom
/**
 * The plugin market's form dialogs under the settings commit model: an MCP server's Set up
 * (features/plugins/plugin-mcp.tsx) and the import dialog (features/plugins/plugin-import-modal.tsx).
 *
 * - Set up's Save waits for a value; it writes the vault with every key the vault holds kept,
 *   and the dialog closes without asking.
 * - Set up asks before Esc drops a typed value, "keep editing" keeps it, and a value typed back
 *   to empty is no change: Save is held again and Esc closes at once.
 * - The import dialog, opened on the npm tab, asks before Esc drops a typed package name; with
 *   nothing typed it closes at once.
 * - While an install is in flight, Esc does nothing and asks nothing; once the install was
 *   refused, the typed name is still there and Esc asks again.
 * - Opening the chat with a typed source moves to the conversation without asking, and leaves
 *   nothing unsaved.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement as h, useState } from "react";
import type { PluginItem } from "@prismshadow/penguin-server/api";
import { hasUnsaved } from "@prismshadow/penguin-ui";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { McpSetUpModal } from "../src/features/plugins/plugin-mcp";
import { ImportPluginModal } from "../src/features/plugins/plugin-import-modal";
import { AGENT_ID, PROJECT_ID, agentServer, mountAgentApp, whereIs } from "./helpers/agent-app";
import {
  button,
  click,
  dialogs,
  field,
  hasButton,
  pressEscape,
  run,
  type,
  unmountAll,
  waitFor,
} from "./helpers/dom";

const promptOpen = () => hasButton(en.common.discard);

/** A plugin whose MCP server waits for two vault values: one the vault holds, one it lacks. */
const SEARCH: Pick<PluginItem, "mcpServers"> = {
  mcpServers: [
    {
      name: "search",
      transport: "http",
      target: "https://search.example/mcp",
      setup: [{ key: "GITHUB_TOKEN" }, { key: "SEARCH_KEY", label: "Search API key" }],
      oauth: false,
      signIn: false,
    },
  ],
};
const KEY_FIELD = "Search API key";

/** The card's part: mounts Set up while it is open, and drops it on close. */
function SetUpHarness({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return h(McpSetUpModal, {
    projectId: PROJECT_ID,
    agentId: AGENT_ID,
    agentName: "Helper",
    title: "Search",
    plugin: SEARCH,
    onClose: () => setOpen(false),
    onSaved,
  });
}

async function openSetUp() {
  const server = agentServer();
  const onSaved = vi.fn();
  await mountAgentApp(h(SetUpHarness, { onSaved }), { route: "/setup", at: "/setup" });
  await waitFor(() => document.querySelector('input[type="password"]') !== null);
  return { server, onSaved };
}

describe("an MCP server's Set up", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  it("waits for a value, then writes it with every key the vault holds kept, and closes", async () => {
    const { server, onSaved } = await openSetUp();
    expect(button(en.common.save).disabled).toBe(true);
    await type(field(KEY_FIELD), "sk-search");
    expect(button(en.common.save).disabled).toBe(false);
    await click(button(en.common.save));
    await waitFor(() => dialogs().length === 0);
    expect(promptOpen()).toBe(false);
    expect(hasUnsaved()).toBe(false);
    expect(server.writes("/vault").map((w) => w.body)).toEqual([
      { entries: [{ key: "GITHUB_TOKEN" }, { key: "SEARCH_KEY", value: "sk-search" }] },
    ]);
    expect(server.vaultKeys()).toEqual(["GITHUB_TOKEN", "SEARCH_KEY"]);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("asks before Esc drops a typed value, and a value typed back to empty is no change", async () => {
    await openSetUp();
    await type(field(KEY_FIELD), "sk-search");
    await pressEscape();
    expect(promptOpen()).toBe(true);
    await click(button(en.common.keepEditing));
    expect(field(KEY_FIELD).value).toBe("sk-search");

    await type(field(KEY_FIELD), "");
    expect(button(en.common.save).disabled).toBe(true);
    await pressEscape();
    expect(promptOpen()).toBe(false);
    expect(dialogs()).toEqual([]);
  });
});

/** The page's part: the import dialog, closed by its own close. */
function ImportHarness() {
  const [open, setOpen] = useState(true);
  return h(ImportPluginModal, {
    open,
    projectId: PROJECT_ID,
    agentId: AGENT_ID,
    onClose: () => setOpen(false),
    onInstalled: () => {},
  });
}

async function openImport() {
  const server = agentServer();
  // The chat the "Ask an agent" path opens is a conversation page beside this one.
  const router = await mountAgentApp(h(ImportHarness), {
    route: "/chat/:sessionId",
    at: "/chat/import",
  });
  await waitFor(() => dialogs().length === 1);
  return { server, router };
}

const npmField = () => field(en.plugins.importNpmLabel);

describe("the plugin import dialog", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  it("asks before Esc drops a typed package name, and closes at once with nothing typed", async () => {
    await openImport();
    await click(button(en.plugins.importTabs.npm));
    await type(npmField(), "@acme/notes");
    await pressEscape();
    expect(promptOpen()).toBe(true);
    await click(button(en.common.keepEditing));
    expect(npmField().value).toBe("@acme/notes");

    await type(npmField(), "");
    await pressEscape();
    expect(promptOpen()).toBe(false);
    expect(dialogs()).toEqual([]);
  });

  it("does nothing on Esc while an install is in flight, and asks again once it was refused", async () => {
    const { server } = await openImport();
    server.hold();
    await click(button(en.plugins.importTabs.npm));
    await type(npmField(), "@acme/notes");
    await click(button(en.plugins.install));
    await pressEscape();
    expect(promptOpen()).toBe(false);
    expect(dialogs()).toHaveLength(1);

    await run(server.release);
    await waitFor(() => hasButton(en.plugins.install));
    expect(npmField().value).toBe("@acme/notes");
    await pressEscape();
    expect(promptOpen()).toBe(true);
  });

  it("opens the chat with a typed source without asking, leaving nothing unsaved", async () => {
    // The dialog opens on the agent tab.
    const { router } = await openImport();
    await type(
      field(en.plugins.importSourceLabel),
      "https://github.com/acme/plugins/tree/main/notes",
    );
    await click(button(en.skills.importOpenChat));
    await waitFor(() => whereIs(router) !== "/chat/import");
    expect(promptOpen()).toBe(false);
    expect(hasUnsaved()).toBe(false);
    expect(dialogs()).toEqual([]);
  });
});
