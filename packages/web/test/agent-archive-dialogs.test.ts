// @vitest-environment jsdom
/**
 * The Agent export and import dialogs (features/agents/agent-export-dialog.tsx and
 * agent-import-dialog.tsx), opened where a user opens them.
 *
 * - Export, from a card: the parts and conversations chosen are the query of one download,
 *   saved under the server's file name, and the dialog closes.
 * - Import: a picked file suggests the id from its name and goes up as it is; the new Agent is
 *   announced and appears on the list.
 * - A taken id says so in place: "Use another id" puts the cursor in the id, and the owner may
 *   overwrite after one confirmation, which sends the file again with `overwrite`. A member is
 *   never offered the overwrite.
 * - Replace from file, on the settings page, holds only the file; Replace sends it as this Agent
 *   with `overwrite`, after the same confirmation and not before.
 * - Migrate: "Open a new chat" opens a conversation with the default agent holding the prompt the
 *   fold shows; an agent without the porting plugin gets it installed first, and one that has the
 *   agent-porting Skill is left alone. One with the plugin's other Skills but not that one is
 *   asked before the update overwrites them: cancelling installs nothing and opens no chat,
 *   confirming updates the plugin and opens it.
 */
import { createElement as h } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginItem } from "@prismshadow/penguin-server/api";
import { toastStore } from "@prismshadow/penguin-ui";
import { AgentsPage } from "../src/features/agents/agents-page";
import { AgentSettingsPage } from "../src/features/agents/agent-settings-page";
import { draftKey, loadDraft } from "../src/features/chat/draft-cache";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { ADMIN_ME } from "./helpers/admin-settings";
import {
  AGENT_ID,
  PROJECT_ID,
  agentServer,
  buttonIn,
  fieldIn,
  mountAgentApp,
  topDialog,
  whereIs,
} from "./helpers/agent-app";
import {
  button,
  click,
  dialogs,
  hasButton,
  pickFile,
  run,
  type,
  unmountAll,
  waitFor,
} from "./helpers/dom";

const IMPORT = `/api/projects/${PROJECT_ID}/agents/import`;
const PLUGINS = `/api/projects/${PROJECT_ID}/agents/${AGENT_ID}/plugins`;

/** The library plugin that ships agent-porting. */
const PORTING = {
  name: "skill-porting",
  description: "Porting",
  version: "1.0.0",
  skills: ["agent-porting", "plugin-porting", "skill-porting"].map((name) => ({
    name,
    description: name,
    version: "2026.11.09.1",
  })),
  hooks: [],
  mcpServers: [],
} as unknown as PluginItem;

async function openList(options: Parameters<typeof agentServer>[1] = {}) {
  const server = agentServer(undefined, options);
  const router = await mountAgentApp(h(AgentsPage), { route: "/list", at: "/list" });
  await waitFor(() => hasButton(en.agent.exportAgent));
  return { server, router };
}

async function openImport() {
  await click(button(en.agent.importAgent));
  await waitFor(() => dialogs().length === 1);
}

const pick = (name: string) =>
  pickFile(
    topDialog().querySelector<HTMLInputElement>('input[type="file"]')!,
    new File(["PK"], name),
  );

const successToasts = () =>
  toastStore
    .getState()
    .items.filter((item) => item.kind === "success")
    .map((item) => item.text);

/** What each upload asked for, as its query. */
const uploads = (server: ReturnType<typeof agentServer>) =>
  server.writes(IMPORT).map((write) => Object.fromEntries(write.query));

describe("the Agent export and import dialogs", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  beforeEach(() => toastStore.setState({ items: [] }));
  afterEach(async () => {
    await unmountAll();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("exports the chosen parts and conversations from a card, under the server's file name", async () => {
    const { server } = await openList();
    // jsdom has no object URLs and navigates nowhere: the anchor's click is where the file is saved.
    const NodeUrl = globalThis.URL;
    vi.stubGlobal(
      "URL",
      class extends NodeUrl {
        static createObjectURL = () => "blob:agent";
        static revokeObjectURL = () => {};
      },
    );
    const saved: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved.push(this.download);
    });
    await click(button(en.agent.exportAgent));
    const hooks = [...topDialog().querySelectorAll("label")].find(
      (label) => label.textContent?.trim() === en.agent.exportHooks,
    );
    await click(hooks!.querySelector("input")!);
    await click(buttonIn(topDialog(), en.agent.exportTracesLast));
    await type(fieldIn(topDialog(), en.agent.exportTracesCount), "5");
    await click(buttonIn(topDialog(), en.agent.exportAction));
    await waitFor(() => saved.length === 1);
    expect(saved).toEqual([`${AGENT_ID}-20261109.zip`]);
    const download = server.fetch.requests.find((r) => r.path.endsWith(`/${AGENT_ID}/archive`));
    expect(Object.fromEntries(download!.query)).toEqual({
      skills: "1",
      hooks: "0",
      memory: "1",
      workbenches: "1",
      workbenchData: "1",
      schedules: "0",
      traces: "last:5",
    });
    expect(dialogs()).toHaveLength(0);
  });

  it("imports a picked file as it is, as the id its name suggests, says so and lists the agent", async () => {
    const { server } = await openList();
    await openImport();
    await pick("writer-20261109.zip");
    expect(fieldIn(topDialog(), en.agent.id).value).toBe("writer");
    await click(buttonIn(topDialog(), en.agent.importAction));
    await waitFor(() => dialogs().length === 0);
    expect(uploads(server)).toEqual([{ agentId: "writer" }]);
    expect(server.writes(IMPORT)[0]!.body).toBeInstanceOf(File);
    expect(successToasts()).toHaveLength(1);
    expect(successToasts()[0]).toContain("writer");
    await waitFor(() => server.localAgents().includes("writer"));
    await waitFor(() => document.body.textContent?.includes("writer") === true);
  });

  it("says a taken id is taken; another id takes the cursor, and the owner overwrites after one confirmation", async () => {
    const { server } = await openList();
    await openImport();
    await pick(`${AGENT_ID}-20261109.zip`);
    await click(buttonIn(topDialog(), en.agent.importAction));
    await waitFor(() => topDialog().querySelector('[role="alert"]') !== null);
    expect(dialogs()).toHaveLength(1);
    await click(buttonIn(topDialog(), en.agent.importRename));
    expect(document.activeElement).toBe(fieldIn(topDialog(), en.agent.id));
    await click(buttonIn(topDialog(), en.agent.importOverwrite));
    await waitFor(() => dialogs().length === 2);
    expect(uploads(server)).toHaveLength(1);
    await click(buttonIn(topDialog(), en.agent.importOverwrite));
    await waitFor(() => dialogs().length === 0);
    expect(uploads(server)).toEqual([{ agentId: AGENT_ID }, { agentId: AGENT_ID, overwrite: "1" }]);
  });

  it("never offers a member the overwrite of a taken id", async () => {
    await openList({ role: "member" });
    await openImport();
    await pick(`${AGENT_ID}-20261109.zip`);
    await click(buttonIn(topDialog(), en.agent.importAction));
    await waitFor(() => topDialog().querySelector('[role="alert"]') !== null);
    expect(hasButton(en.agent.importRename)).toBe(true);
    expect(hasButton(en.agent.importOverwrite)).toBe(false);
  });

  it("replaces this agent's State from a file on the settings page, only once confirmed", async () => {
    const server = agentServer();
    await mountAgentApp(h(AgentSettingsPage), { at: `/agents/${AGENT_ID}` });
    await waitFor(() => hasButton(en.agent.replaceOpen));
    await click(button(en.agent.replaceOpen));
    // Only the file: no migration, no id.
    expect(hasButton(en.skills.importOpenChat)).toBe(false);
    expect(topDialog().querySelectorAll('input:not([type="file"])')).toHaveLength(0);
    await pick("anything.zip");
    await click(buttonIn(topDialog(), en.agent.replaceAction));
    await waitFor(() => dialogs().length === 2);
    expect(uploads(server)).toEqual([]);
    await click(buttonIn(topDialog(), en.agent.replaceAction));
    await waitFor(() => dialogs().length === 0);
    expect(uploads(server)).toEqual([{ agentId: AGENT_ID, overwrite: "1" }]);
  });

  it("opens a chat with the default agent holding the prompt it shows, installing the Skill's plugin only where it is missing", async () => {
    const { server, router } = await openList({ library: [PORTING] });
    await openImport();
    const shown = topDialog().querySelector("pre")!.textContent;
    await click(buttonIn(topDialog(), en.skills.importOpenChat));
    await waitFor(() => whereIs(router) === "/chat/new");
    expect(loadDraft(draftKey(ADMIN_ME.user.userId, PROJECT_ID)).text).toBe(shown);
    expect(server.writes(PLUGINS).map((write) => write.body)).toEqual([
      { names: ["skill-porting"] },
    ]);
    expect(server.skillsOn(null, AGENT_ID)).toContain("agent-porting");

    await run(() => router.navigate("/list"));
    await waitFor(() => hasButton(en.agent.importAgent));
    await openImport();
    await click(buttonIn(topDialog(), en.skills.importOpenChat));
    await waitFor(() => whereIs(router) === "/chat/new");
    expect(server.writes(PLUGINS)).toHaveLength(1);
  });

  it("asks before updating the plugin over the default agent's own copies of its Skills", async () => {
    const skills = ["plugin-porting", "skill-porting"];
    const { server, router } = await openList({ library: [PORTING], skills });
    await openImport();
    await click(buttonIn(topDialog(), en.skills.importOpenChat));
    await waitFor(() => dialogs().length === 2);
    await click(buttonIn(topDialog(), en.common.cancel));
    await waitFor(() => dialogs().length === 1);
    expect(whereIs(router)).toBe("/list");
    expect(server.writes(PLUGINS)).toEqual([]);

    await click(buttonIn(topDialog(), en.skills.importOpenChat));
    await waitFor(() => dialogs().length === 2);
    await click(buttonIn(topDialog(), en.skills.updateAction));
    await waitFor(() => whereIs(router) === "/chat/new");
    expect(server.writes(PLUGINS).map((write) => write.body)).toEqual([
      { names: ["skill-porting"] },
    ]);
  });
});
