// @vitest-environment jsdom
/**
 * The Skill, hook and workbench import dialogs under the settings commit model: the Agent
 * settings Plugins tab's Import skill (features/agents/agent-skills.tsx), Import hook
 * (features/agents/agent-hooks.tsx) and Import workbench (features/agents/agent-workbenches.tsx),
 * each opened from its sub-page's Import button. In each, what the source field holds is the
 * dialog's draft; every scenario runs on all three.
 *
 * - Closing with a source typed asks first, and "keep editing" keeps it; a source typed back to
 *   empty is no change, and the dialog closes at once.
 * - While a zip upload is in flight, Esc does nothing and asks nothing; once the upload was
 *   refused, the typed source is still there and Esc asks again.
 * - Opening the chat with a typed source moves to the conversation without asking, and leaves
 *   nothing unsaved.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { hasUnsaved } from "@prismshadow/penguin-ui";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { PluginsTab } from "../src/features/agents/plugins-tab";
import type { PluginsSubPage } from "../src/features/agents/plugins-subpages";
import {
  AGENT_ID,
  agentServer,
  buttonIn,
  fieldIn,
  mountAgentApp,
  topDialog,
  whereIs,
  type AgentServer,
} from "./helpers/agent-app";

import {
  button,
  click,
  dialogs,
  hasButton,
  pickFile,
  pressEscape,
  run,
  type,
  unmountAll,
  waitFor,
} from "./helpers/dom";

const promptOpen = () => hasButton(en.common.discard);

type Router = Awaited<ReturnType<typeof mountAgentApp>>;

/**
 * Mounts the Agent settings Plugins tab on one kind's sub-page and opens its import dialog from
 * its Import button, once its lists have loaded.
 */
async function openFromTab(subPage: PluginsSubPage, importAction: string) {
  const server = agentServer();
  const router = await mountAgentApp(
    h(PluginsTab, { agentId: AGENT_ID, subPage, onSubPage: () => undefined }),
    { at: `/agents/${AGENT_ID}` },
  );
  await waitFor(() => hasButton(importAction) && !button(importAction).disabled);
  await click(button(importAction));
  await waitFor(() => dialogs().length === 1);
  return { server, router };
}

interface ImportDialog {
  name: string;
  /** Mounts the page the dialog belongs to, with the dialog open. */
  open: () => Promise<{ server: AgentServer; router: Router }>;
  /** The source field's label. */
  source: string;
  openChat: string;
  /** What the upload button says while a zip is on its way. */
  uploading: string;
  /** Where a zip goes, as the server's writes name it. */
  archive: string;
}

const DIALOGS: ImportDialog[] = [
  {
    name: "Import skill",
    open: () => openFromTab("skills", en.skills.importSkill),
    source: en.skills.importSourceLabel,
    openChat: en.skills.importOpenChat,
    uploading: en.skills.importUploading,
    archive: "/skills/archive",
  },
  {
    name: "Import hook",
    open: () => openFromTab("hooks", en.hooks.importHook),
    source: en.hooks.importSourceLabel,
    openChat: en.hooks.importOpenChat,
    uploading: en.hooks.importUploading,
    archive: "/hooks/archive",
  },
  {
    name: "Import workbench",
    open: () => openFromTab("workbenches", en.workbenches.importTitle),
    source: en.workbenches.importSourceLabel,
    openChat: en.workbenches.importOpenChat,
    uploading: en.workbenches.importUploading,
    archive: "/workbenches/archive",
  },
];

const SOURCE = "https://github.com/acme/kit/tree/main/notes";

describe.each(DIALOGS)("the $name dialog", (dialog) => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  const source = () => fieldIn(topDialog(), dialog.source);

  it("asks before Esc drops a typed source, and closes at once when it is empty again", async () => {
    await dialog.open();
    await type(source(), SOURCE);
    await pressEscape();
    expect(promptOpen()).toBe(true);
    await click(button(en.common.keepEditing));
    expect(source().value).toBe(SOURCE);

    await type(source(), "");
    await pressEscape();
    expect(promptOpen()).toBe(false);
    expect(dialogs()).toEqual([]);
  });

  it("does nothing on Esc while an upload is in flight, and asks again once it was refused", async () => {
    const { server } = await dialog.open();
    await type(source(), SOURCE);
    server.hold();
    server.refuseNext(400, "invalid_archive", "Not a package");
    await pickFile(
      topDialog().querySelector<HTMLInputElement>('input[type="file"]')!,
      new File(["PK"], "notes.zip"),
    );
    await waitFor(() => server.writes(dialog.archive).length === 1);
    await pressEscape();
    expect(promptOpen()).toBe(false);
    expect(dialogs()).toHaveLength(1);

    await run(server.release);
    await waitFor(() => topDialog().textContent?.includes(dialog.uploading) === false);
    expect(source().value).toBe(SOURCE);
    await pressEscape();
    expect(promptOpen()).toBe(true);
  });

  it("opens the chat with a typed source without asking, leaving nothing unsaved", async () => {
    const { router } = await dialog.open();
    await type(source(), SOURCE);
    await click(buttonIn(topDialog(), dialog.openChat));
    await waitFor(() => whereIs(router) === "/chat/new");
    expect(promptOpen()).toBe(false);
    expect(hasUnsaved()).toBe(false);
    expect(dialogs()).toEqual([]);
  });
});
