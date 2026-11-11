// @vitest-environment jsdom
/**
 * The Skill, hook, workbench and Benchmark import dialogs under the settings commit model: the
 * Agent settings Plugins tab's Import skill (features/agents/agent-skills.tsx), Import hook
 * (features/agents/agent-hooks.tsx) and Import workbench (features/agents/agent-workbenches.tsx),
 * each opened from the tab's Import menu, and the Evaluation Center's Import benchmark
 * (features/benchmark/benchmark-import-modal.tsx). In each, what the source field holds is the
 * dialog's draft; every scenario runs on all four.
 *
 * - Closing with a source typed asks first, and "keep editing" keeps it; a source typed back to
 *   empty is no change, and the dialog closes at once.
 * - While a zip upload is in flight, Esc does nothing and asks nothing; once the upload was
 *   refused, the typed source is still there and Esc asks again.
 * - Opening the chat with a typed source moves to the conversation without asking, and leaves
 *   nothing unsaved.
 * - Choosing a Benchmark example fills the editable source without importing; opening the chat
 *   carries the edited source and the instructions for copying files.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createElement as h, useState } from "react";
import type { AgentSummary } from "@prismshadow/penguin-server/api";
import { hasUnsaved } from "@prismshadow/penguin-ui";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { draftKey, loadDraft } from "../src/features/chat/draft-cache";
import { ADMIN_ME } from "./helpers/admin-settings";
import { PluginsTab } from "../src/features/agents/plugins-tab";
import { ImportBenchmarkModal } from "../src/features/benchmark/benchmark-import-modal";
import {
  AGENT_ID,
  PROJECT_ID,
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
  menuItem,
  pickFile,
  pressEscape,
  run,
  type,
  unmountAll,
  waitFor,
} from "./helpers/dom";

const promptOpen = () => hasButton(en.common.discard);

type Router = Awaited<ReturnType<typeof mountAgentApp>>;

/** Mounts the Agent settings Plugins tab and opens one import dialog from its menu, once its lists have loaded. */
async function openFromTab(item: string) {
  const server = agentServer();
  const router = await mountAgentApp(h(PluginsTab, { agentId: AGENT_ID }), {
    at: `/agents/${AGENT_ID}`,
  });
  const importAction = en.agentPlugins.importAction;
  await waitFor(() => hasButton(importAction) && !button(importAction).disabled);
  await click(button(importAction));
  await click(menuItem(item));
  await waitFor(() => dialogs().length === 1);
  return { server, router };
}

/** The Evaluation Center's part: the dialog, mounted while it is open, sending to the Agent. */
function BenchmarkHarness() {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return h(ImportBenchmarkModal, {
    projectId: PROJECT_ID,
    agents: [{ agentId: AGENT_ID } as AgentSummary],
    onClose: () => setOpen(false),
    onImported: () => setOpen(false),
  });
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
    open: () => openFromTab(en.agentPlugins.importSkill),
    source: en.skills.importSourceLabel,
    openChat: en.skills.importOpenChat,
    uploading: en.skills.importUploading,
    archive: "/skills/archive",
  },
  {
    name: "Import hook",
    open: () => openFromTab(en.agentPlugins.importHook),
    source: en.hooks.importSourceLabel,
    openChat: en.hooks.importOpenChat,
    uploading: en.hooks.importUploading,
    archive: "/hooks/archive",
  },
  {
    name: "Import workbench",
    open: () => openFromTab(en.agentPlugins.importWorkbench),
    source: en.workbenches.importSourceLabel,
    openChat: en.workbenches.importOpenChat,
    uploading: en.workbenches.importUploading,
    archive: "/workbenches/archive",
  },
  {
    name: "Import benchmark",
    open: async () => {
      const server = agentServer();
      const router = await mountAgentApp(h(BenchmarkHarness), {
        route: "/benchmarks",
        at: "/benchmarks",
      });
      await waitFor(() => dialogs().length === 1);
      return { server, router };
    },
    source: en.benchmark.importSourceLabel,
    openChat: en.benchmark.importOpenChat,
    uploading: en.benchmark.importUploading,
    archive: `/api/projects/${PROJECT_ID}/benchmarks/archive`,
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

describe("Benchmark import examples", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(unmountAll);

  it("fills the source without importing, and carries an edited source into the chat draft", async () => {
    const server = agentServer();
    const router = await mountAgentApp(h(BenchmarkHarness), {
      route: "/chat/:sessionId",
      at: "/chat/import",
    });
    const example = topDialog().querySelector<HTMLButtonElement>('button[aria-pressed="false"]')!;
    await click(example);
    const source = fieldIn(topDialog(), en.benchmark.importSourceLabel);
    expect(source.value).toMatch(
      /^https:\/\/github.com\/Prism-Shadow\/penguin-harness-benchmark\/tree\/main\/packages\//,
    );
    expect(server.writes(`/api/projects/${PROJECT_ID}/benchmarks/archive`)).toEqual([]);
    expect(whereIs(router)).toBe("/chat/import");
    await type(source, SOURCE);
    expect(example.getAttribute("aria-pressed")).toBe("false");
    await click(buttonIn(topDialog(), en.benchmark.importOpenChat));
    await waitFor(() => whereIs(router) === "/chat/new");
    const text = loadDraft(draftKey(ADMIN_ME.user.userId, PROJECT_ID)).text as string;
    expect(text).toContain(SOURCE);
    expect(text).toContain("<app_data_dir>/benchmarks/<id>/");
    expect(text).not.toContain("penguin benchmark");
  });
});
