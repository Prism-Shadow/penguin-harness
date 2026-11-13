/** @vitest-environment jsdom */
/**
 * The workbench chat import on the Agent settings Plugins tab (Import → Workbench, the dialog in
 * features/agents/agent-workbenches.tsx, through the shared chat-or-zip-import-dialog.tsx and
 * workbench-import.ts). The zip path is agent-workbench-archive.test.ts's, and closing with a
 * source typed is import-dialogs-guard's.
 *
 * - Import → Workbench opens the Import workbench dialog; Copy prompt and Open a new chat wait
 *   for a source.
 * - With a source typed, Copy prompt copies the prompt the preview shows, and Open a new chat
 *   opens a conversation with this Agent holding that same prompt, which names the source, the
 *   Project and the Agent.
 * - For an Agent on a machine, the conversation opens on that machine.
 */
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClipboardWriterProvider } from "@prismshadow/penguin-ui";
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
import type { FakeMachine } from "./helpers/agent-app";
import {
  button,
  click,
  dialogs,
  hasButton,
  menuItem,
  type,
  unmountAll,
  waitFor,
} from "./helpers/dom";

const GPU: FakeMachine = { machineId: "gpu1", alias: "gpu-box", agents: [AGENT_ID] };
const SOURCE = "https://github.com/acme/workbenches/tree/main/kanban";

/** The clipboard the copy button writes to. */
const clipboard = vi.fn<(text: string) => Promise<boolean>>();

/** The Plugins tab of this Agent, on `machine` when one is named, with Import → Workbench open. */
async function openImport(machine?: FakeMachine) {
  agentServer(undefined, machine !== undefined ? { machines: [machine] } : {});
  const query = machine !== undefined ? `&machine=${machine.machineId}` : "";
  const router = await mountAgentApp(
    h(ClipboardWriterProvider, { write: clipboard }, h(AgentSettingsPage)),
    { at: `/agents/${AGENT_ID}?tab=plugins${query}` },
  );
  const action = en.agentPlugins.importAction;
  await waitFor(() => hasButton(action) && !button(action).disabled);
  await click(button(action));
  await click(menuItem(en.agentPlugins.importWorkbench));
  await waitFor(() => dialogs().length === 1);
  return router;
}

const sourceField = () => fieldIn(topDialog(), en.workbenches.importSourceLabel);
const preview = () => fieldIn(topDialog(), en.workbenches.importPromptLabel).value;
const draft = () => loadDraft(draftKey(ADMIN_ME.user.userId, PROJECT_ID));

describe("the workbench chat import on the Plugins tab", () => {
  beforeEach(() => {
    setActiveStrings(en);
    localStorage.clear();
    clipboard.mockReset();
    clipboard.mockResolvedValue(true);
  });
  afterEach(async () => {
    await unmountAll();
    setActiveStrings(zh);
  });

  it("opens Import workbench from the Import menu, whose copy and chat wait for a source", async () => {
    await openImport();
    const titleId = topDialog().getAttribute("aria-labelledby")!;
    expect(document.getElementById(titleId)?.textContent).toBe(en.workbenches.importTitle);
    expect(buttonIn(topDialog(), en.workbenches.importCopyPrompt).disabled).toBe(true);
    expect(buttonIn(topDialog(), en.workbenches.importOpenChat).disabled).toBe(true);

    await type(sourceField(), "   ");
    expect(buttonIn(topDialog(), en.workbenches.importOpenChat).disabled).toBe(true);
  });

  it("copies the prompt it shows, and opens a chat with this agent holding it", async () => {
    const router = await openImport();
    await type(sourceField(), `  ${SOURCE}  `);
    const shown = preview();
    for (const named of [SOURCE, PROJECT_ID, AGENT_ID]) expect(shown).toContain(named);

    await click(buttonIn(topDialog(), en.workbenches.importCopyPrompt));
    expect(clipboard.mock.calls).toEqual([[shown]]);

    await click(buttonIn(topDialog(), en.workbenches.importOpenChat));
    await waitFor(() => whereIs(router) === "/chat/new");
    expect(dialogs()).toEqual([]);
    expect(draft()).toMatchObject({ agentId: AGENT_ID, text: shown });
    expect(draft().machineId).toBeUndefined();
  });

  it("opens the chat on the machine the agent lives on", async () => {
    const router = await openImport(GPU);
    await type(sourceField(), SOURCE);
    const shown = preview();
    await click(buttonIn(topDialog(), en.workbenches.importOpenChat));
    await waitFor(() => whereIs(router) === "/chat/new");
    expect(draft()).toMatchObject({ agentId: AGENT_ID, machineId: GPU.machineId, text: shown });
  });
});
