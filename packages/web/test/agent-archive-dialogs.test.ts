// @vitest-environment jsdom
/**
 * Exporting and importing an Agent (features/agents/agent-export-dialog.tsx and
 * agent-import-dialog.tsx), from the Agents page and the Agent settings page.
 *
 * - The export dialog asks the preview with its choices — the defaults on opening, then what was
 *   switched once the changes stop — its line says what the latest answer holds, and Export
 *   downloads the zip of those same choices under the server's name.
 * - The line notes a selection larger than an import takes, and how many conversations a file too
 *   large leaves out; a selection within the limit carries neither note.
 * - A selection the server would refuse to export says why, and Export stays off; a part the
 *   export leaves out as a link is named by its tab.
 * - A date range exports the conversations of its dates; one that ends before it starts says so
 *   and exports nothing.
 * - Importing a file sends it under the id its name suggests; a new id creates the Agent, says
 *   what came in and what is left to fill in, and the Agent list is read again with it there.
 * - The import's notes are said in the dialog's words by their code; a code this client does not
 *   know keeps the server's own sentence.
 * - A taken id shows in place with "Use another id" and, for the Project owner, "Overwrite the
 *   existing agent", which asks once and sends the same file again with overwrite.
 * - A member meets a taken id with "Use another id" alone, which puts the cursor in the id field.
 * - With the id field empty, a taken id is the one the file records: the line names it, and the
 *   overwrite goes to it.
 * - A file larger than an import takes is refused in place, and nothing is sent.
 * - An older `.tar.gz` records no id: one whose name gives none leaves Import off until one is
 *   typed, and goes under that id. Replacing from such a file needs none: it goes under this
 *   Agent's.
 * - Closing with a picked file asks first, and keeping on keeps the file. While an upload is in
 *   flight, Esc does nothing; once it was refused, the file is still there and Esc asks again.
 * - Choosing a framework and a path opens a new chat with the Project's default agent, its prompt
 *   naming the framework, the path and the Project; "Other" opens none until something is typed.
 * - A default agent without the agent-porting Skill holds the chat and says so; installing the
 *   plugin that ships it from the dialog brings the Skill and lets the chat open. A refused
 *   install says why, and the chat stays held.
 * - When that agent already has Skills of the plugin, the install asks first with the update
 *   confirmation, naming them; Cancel sends nothing, Confirm installs.
 * - Opening the chat with a picked file asks first, since the file does not go with it; keeping
 *   on keeps the file, and discarding goes to the chat.
 * - Replacing the Agent State from the settings page asks once — Cancel sends nothing — and sends
 *   the file with overwrite under this Agent's id, then reads the config again.
 */
import { act, createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentArchivePreview, PluginItem } from "@prismshadow/penguin-server/api";
import { toastStore } from "@prismshadow/penguin-ui";
import { AgentsPage } from "../src/features/agents/agents-page";
import { AgentSettingsPage } from "../src/features/agents/agent-settings-page";
import { PREVIEW_DEBOUNCE_MS } from "../src/features/agents/agent-export-dialog";
import { draftKey, loadDraft } from "../src/features/chat/draft-cache";
import { ApiError } from "../src/api/client";
import { apiErrorText } from "../src/lib/api-error";
import { formatBytes } from "../src/lib/format";
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
import type { AgentServer } from "./helpers/agent-app";
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

const AGENTS = `/api/projects/${PROJECT_ID}/agents`;
const IMPORT = `${AGENTS}/import`;
const PREVIEW = `${AGENTS}/${AGENT_ID}/archive/preview`;
const ARCHIVE = `${AGENTS}/${AGENT_ID}/archive`;
/** The import's limit as the dialogs write it. */
const LIMIT = formatBytes(100 * 1024 * 1024);
/** The default agent (Helper here: the Project has no default_agent) already has the porting Skill. */
const PORTING = { skills: ["agent-porting"] };
/** The library plugin that ships it, as this server's library lists it. */
const SKILL_PORTING = {
  name: "skill-porting",
  description: "Port things in",
  version: "2026.11.05.1",
  title: "Skill porting",
  skills: ["agent-porting", "skill-porting", "plugin-porting"].map((name) => ({
    name,
    description: "",
    version: "2026.11.05.1",
  })),
  hooks: [],
  mcpServers: [],
} as unknown as PluginItem;

/** The toasts on screen, by kind. */
const toasts = (kind: "success" | "error") =>
  toastStore
    .getState()
    .items.filter((item) => item.kind === kind)
    .map((item) => item.text);

/** A preview whose numbers follow the query: a file per switched-on part, the Sessions it names. */
function previewFor(query: URLSearchParams): AgentArchivePreview {
  const part = (key: string) =>
    query.get(key) === "1" ? { files: 1, bytes: 1000 } : { files: 0, bytes: 0 };
  const last = /^last:(\d+)$/.exec(query.get("traces") ?? "");
  const sessions = last ? Number(last[1]) : 0;
  const parts = {
    skills: part("skills"),
    hooks: part("hooks"),
    memory: part("memory"),
    workbenches: part("workbenches"),
    schedules: part("schedules"),
  };
  return {
    parts,
    entries: Object.values(parts).reduce((sum, p) => sum + p.files, 0) + sessions,
    notes: [],
    traces: {
      sessions,
      files: sessions,
      bytes: sessions * 1000,
      skipped: [],
      newest: null,
      oldest: null,
    },
    totalBytes: 10_000 + sessions * 1000,
    vaultKeys: [],
    redacted: [],
  };
}

/** The labelled checkbox in the open dialog whose title is `name`. */
function checkbox(name: string): HTMLInputElement {
  const label = [...topDialog().querySelectorAll("label")].find(
    (l) => l.querySelector("span.block")?.textContent === name,
  );
  const input = label?.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (input == null) throw new Error(`no checkbox named ${JSON.stringify(name)}`);
  return input;
}

/** The preview requests answered so far, each as its query text. */
const previews = (server: AgentServer) =>
  server.fetch.requests.filter((r) => r.path === PREVIEW).map((r) => r.query.toString());

/** Lets the preview's wait after the last change run out. */
async function afterTheChangesStop(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(PREVIEW_DEBOUNCE_MS);
  });
}

/** jsdom saves nothing and has no object URLs: the anchor's click is where a file is saved. */
function catchSaves(): string[] {
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
  return saved;
}

/** The Agents page, with Helper's export dialog open. */
async function openExport(server: AgentServer) {
  await mountAgentApp(h(AgentsPage), { route: "/list", at: "/list" });
  await waitFor(
    () => document.querySelector(`button[aria-label="${en.agent.exportAgent}"]`) !== null,
  );
  // The preview waits on a timer after a change; the clock runs, and can be moved past it.
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout"] });
  await click(document.querySelector(`button[aria-label="${en.agent.exportAgent}"]`)!);
  await waitFor(() => dialogs().length === 1);
  await waitFor(() => previews(server).length === 1);
}

/** The Agents page, with the import dialog open. */
async function openImport() {
  const router = await mountAgentApp(h(AgentsPage), { route: "/list", at: "/list" });
  await waitFor(() => document.body.textContent?.includes(en.agent.importAgent) === true);
  await click(button(en.agent.importAgent));
  await waitFor(() => dialogs().length === 1);
  return router;
}

/** Whether the leave prompt (discard / keep editing) is up. */
const promptOpen = () => hasButton(en.common.discard);

/** Picks `name` in the open dialog's file input; `size` stands in for a file that large. */
async function pickArchive(name: string, size?: number): Promise<File> {
  const file = new File(["PK"], name);
  if (size !== undefined) Object.defineProperty(file, "size", { value: size });
  await pickFile(topDialog().querySelector<HTMLInputElement>('input[type="file"]')!, file);
  return file;
}

/** The imports sent so far: the id and the overwrite flag each asked for, and the body. */
const imports = (server: AgentServer) =>
  server.writes(IMPORT).map((r) => ({
    agentId: r.query.get("agentId"),
    overwrite: r.query.get("overwrite"),
    body: r.body,
  }));

describe("exporting and importing an Agent", () => {
  beforeEach(() => {
    setActiveStrings(en);
    toastStore.setState({ items: [] });
  });
  afterEach(async () => {
    await unmountAll();
    vi.useRealTimers();
    vi.restoreAllMocks();
    setActiveStrings(zh);
  });

  it("asks the preview and the download with the dialog's choices, and says what the latest answer holds", async () => {
    const server = agentServer(undefined, { archivePreview: previewFor });
    await openExport(server);
    expect(previews(server)).toEqual([
      "skills=1&hooks=1&memory=1&workbenches=1&workbenchData=1&schedules=0&traces=none",
    ]);
    await waitFor(() =>
      topDialog().textContent!.includes(en.agent.exportSummary(4, formatBytes(10_000), null)),
    );
    expect(topDialog().textContent).not.toContain(en.agent.exportOverLimit(LIMIT));

    await click(checkbox(en.agent.tabMemory));
    await click(checkbox(en.agent.tabSchedules));
    await click(buttonIn(topDialog(), en.agent.exportTracesLast));
    await type(fieldIn(topDialog(), en.agent.exportTracesCount), "5");
    await afterTheChangesStop();
    const chosen =
      "skills=1&hooks=1&memory=0&workbenches=1&workbenchData=1&schedules=1&traces=last%3A5";
    await waitFor(() => previews(server).at(-1) === chosen);
    await waitFor(() =>
      topDialog().textContent!.includes(en.agent.exportSummary(9, formatBytes(15_000), 5)),
    );

    const saved = catchSaves();
    await click(buttonIn(topDialog(), en.agent.exportAction));
    await waitFor(() => saved.length === 1);
    expect(saved).toEqual([`${AGENT_ID}-20261104.zip`]);
    const download = server.fetch.requests.find((r) => r.path === ARCHIVE);
    expect(download?.query.toString()).toBe(chosen);
    await waitFor(() => dialogs().length === 0);
  });

  it("exports the conversations of a date range, and nothing for one that ends before it starts", async () => {
    const server = agentServer(undefined, { archivePreview: previewFor });
    await openExport(server);
    await click(buttonIn(topDialog(), en.agent.exportTracesRange));
    await type(fieldIn(topDialog(), en.agent.exportTracesFrom), "2026-10-20");
    await type(fieldIn(topDialog(), en.agent.exportTracesTo), "2026-10-01");
    expect(topDialog().textContent).toContain(en.agent.exportTracesRangeError);
    expect(buttonIn(topDialog(), en.agent.exportAction).disabled).toBe(true);

    await type(fieldIn(topDialog(), en.agent.exportTracesFrom), "2026-09-01");
    await afterTheChangesStop();
    await waitFor(
      () => previews(server).at(-1)?.endsWith("traces=2026-09-01..2026-10-01") === true,
    );
    expect(previews(server).some((q) => q.includes("2026-10-20..2026-10-01"))).toBe(false);
    const saved = catchSaves();
    await click(buttonIn(topDialog(), en.agent.exportAction));
    await waitFor(() => saved.length === 1);
    const download = server.fetch.requests.find((r) => r.path === ARCHIVE);
    expect(download?.query.get("traces")).toBe("2026-09-01..2026-10-01");
  });

  it("notes a selection larger than an import takes, and how many conversations a file too large leaves out", async () => {
    const server = agentServer(undefined, {
      archivePreview: (query) => ({
        ...previewFor(query),
        totalBytes: 100 * 1024 * 1024 + 1,
        traces: {
          ...previewFor(query).traces,
          skipped: [
            { sessionId: "s1", reason: "too_large" },
            { sessionId: "s2", reason: "too_large" },
          ],
        },
      }),
    });
    await openExport(server);
    await waitFor(() => topDialog().textContent!.includes(en.agent.exportOverLimit(LIMIT)));
    expect(topDialog().textContent).toContain(en.agent.exportSkipped(2));
  });

  it("says why a selection the server would refuse cannot be exported, and names a part left out as a link", async () => {
    const server = agentServer(undefined, {
      archivePreview: (query) => ({
        ...previewFor(query),
        refusal: { reason: "inflated", limit: 1024 * 1024 * 1024 },
        notes: [{ code: "link_skipped", subject: "memory", message: "memory/ is a link" }],
      }),
    });
    await openExport(server);
    const refusal = en.agent.exportRefused.inflated(formatBytes(1024 * 1024 * 1024));
    await waitFor(() => topDialog().textContent!.includes(refusal));
    expect(topDialog().textContent).toContain(
      en.agent.archiveNotes.linkSkipped(en.agent.tabMemory),
    );
    expect(buttonIn(topDialog(), en.agent.exportAction).disabled).toBe(true);
  });

  it("says the import's notes in its own words by code, and a code it does not know in the server's", async () => {
    agentServer(undefined, {
      importReport: {
        notes: [
          { code: "unknown_tool", subject: "web_search", message: "the server's own sentence" },
          { code: "from_a_newer_server" as never, message: "a newer server's sentence" },
        ],
      },
    });
    await openImport();
    await pickArchive("notes-20261104.zip");
    await click(buttonIn(topDialog(), en.agent.importAction));
    await waitFor(() => toasts("success").length === 1);
    expect(toasts("success")[0]).toContain(en.agent.archiveNotes.unknownTool("web_search"));
    expect(toasts("success")[0]).not.toContain("the server's own sentence");
    expect(toasts("success")[0]).toContain("a newer server's sentence");
  });

  it("creates an Agent from a file under the id its name suggests, says what came in, and lists it", async () => {
    const server = agentServer(undefined, {
      importReport: {
        imported: {
          skills: 2,
          hooks: 0,
          memoryFiles: 0,
          workbenches: 0,
          schedules: 0,
          traces: { sessions: 3, files: 4 },
        },
        toFill: ["GITHUB_TOKEN"],
      },
    });
    await openImport();
    const file = await pickArchive("notes-20261104.zip");
    expect(fieldIn(topDialog(), en.agent.id).value).toBe("notes");
    const reads = server.fetch.requests.filter((r) => r.path === AGENTS && r.method === "GET");
    const before = reads.length;
    await click(buttonIn(topDialog(), en.agent.importAction));
    await waitFor(() => dialogs().length === 0);
    expect(imports(server)).toEqual([{ agentId: "notes", overwrite: null, body: file }]);
    expect(toasts("success")).toHaveLength(1);
    expect(toasts("success")[0]).toContain("notes");
    expect(toasts("success")[0]).toContain(en.agent.importCounts.skills(2));
    expect(toasts("success")[0]).toContain("GITHUB_TOKEN");
    await waitFor(
      () =>
        server.fetch.requests.filter((r) => r.path === AGENTS && r.method === "GET").length >
        before,
    );
    await waitFor(() => document.body.textContent?.includes("notes") === true);
    expect(server.localAgents()).toEqual([AGENT_ID, "notes"]);
  });

  it("shows a taken id in place, and the owner's overwrite asks once and sends the file again with overwrite", async () => {
    const server = agentServer();
    await openImport();
    const file = await pickArchive(`${AGENT_ID}-20261104.zip`);
    await click(buttonIn(topDialog(), en.agent.importAction));
    await waitFor(() => topDialog().textContent!.includes(en.agent.importExists(AGENT_ID)));
    expect(buttonIn(topDialog(), en.agent.importRename)).toBeDefined();

    await click(buttonIn(topDialog(), en.agent.importOverwrite));
    await waitFor(() => dialogs().length === 2);
    expect(topDialog().textContent).toContain(en.agent.overwriteBody(AGENT_ID, file.name));
    await click(buttonIn(topDialog(), en.agent.importOverwrite));
    await waitFor(() => dialogs().length === 0);
    expect(imports(server)).toEqual([
      { agentId: AGENT_ID, overwrite: null, body: file },
      { agentId: AGENT_ID, overwrite: "1", body: file },
    ]);
    expect(toasts("success")).toHaveLength(1);
    expect(server.localAgents()).toEqual([AGENT_ID]);
  });

  it("offers a member another id alone for a taken one, which puts the cursor in the id field", async () => {
    const server = agentServer(undefined, { role: "member" });
    await openImport();
    await pickArchive(`${AGENT_ID}.zip`);
    await click(buttonIn(topDialog(), en.agent.importAction));
    await waitFor(() => topDialog().textContent!.includes(en.agent.importExists(AGENT_ID)));
    expect(() => buttonIn(topDialog(), en.agent.importOverwrite)).toThrow();

    await click(buttonIn(topDialog(), en.agent.importRename));
    expect(document.activeElement).toBe(fieldIn(topDialog(), en.agent.id));
    await type(fieldIn(topDialog(), en.agent.id), "helper_copy");
    await click(buttonIn(topDialog(), en.agent.importAction));
    await waitFor(() => dialogs().length === 0);
    expect(imports(server).map((i) => [i.agentId, i.overwrite])).toEqual([
      [AGENT_ID, null],
      ["helper_copy", null],
    ]);
  });

  it("opens a chat with the default agent whose prompt names the framework, the path and the Project", async () => {
    const server = agentServer(undefined, PORTING);
    const router = await openImport();
    await click(topDialog().querySelector('button[aria-haspopup="listbox"]')!);
    await click(
      [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent === "Codex")!,
    );
    await type(fieldIn(topDialog(), en.agent.migratePath), "/srv/codex-home");
    await waitFor(() => !buttonIn(topDialog(), en.skills.importOpenChat).disabled);
    await click(buttonIn(topDialog(), en.skills.importOpenChat));
    await waitFor(() => whereIs(router) === "/chat/new");
    const draft = loadDraft(draftKey(ADMIN_ME.user.userId, PROJECT_ID));
    expect(draft.agentId).toBe(AGENT_ID);
    expect(draft.text).toContain("Codex");
    expect(draft.text).toContain("/srv/codex-home");
    expect(draft.text).toContain(`--project-id ${PROJECT_ID}`);
    expect(draft.text).toContain("agent-porting");
    expect(server.writes(IMPORT)).toEqual([]);
  });

  it("opens no chat for Other until its path or description is typed", async () => {
    agentServer(undefined, PORTING);
    await openImport();
    await click(topDialog().querySelector('button[aria-haspopup="listbox"]')!);
    await click(
      [...document.querySelectorAll('[role="option"]')].find(
        (o) => o.textContent === en.agent.migrateFrameworks.other,
      )!,
    );
    expect(buttonIn(topDialog(), en.skills.importOpenChat).disabled).toBe(true);
    await type(fieldIn(topDialog(), en.agent.migratePathOther), "~/my-agent");
    await waitFor(() => !buttonIn(topDialog(), en.skills.importOpenChat).disabled);
  });

  it("holds the chat while the default agent lacks agent-porting, and opens it once the plugin's install brings it", async () => {
    const server = agentServer(undefined, { library: [SKILL_PORTING] });
    const router = await openImport();
    await waitFor(() => topDialog().textContent!.includes(en.agent.migrateSkillMissing("Helper")));
    expect(buttonIn(topDialog(), en.skills.importOpenChat).disabled).toBe(true);

    await click(buttonIn(topDialog(), en.agent.migrateSkillInstall));
    await waitFor(() => !topDialog().textContent!.includes(en.agent.migrateSkillMissing("Helper")));
    expect(server.writes("/plugins").map((r) => r.body)).toEqual([{ names: ["skill-porting"] }]);
    expect(server.skillsOn(null, AGENT_ID)).toContain("agent-porting");
    expect(toasts("success")).toHaveLength(1);
    await click(buttonIn(topDialog(), en.skills.importOpenChat));
    await waitFor(() => whereIs(router) === "/chat/new");
  });

  it("says why a refused install did not bring the Skill, and keeps the chat held", async () => {
    agentServer();
    await openImport();
    await waitFor(() => hasButton(en.agent.migrateSkillInstall));
    await click(buttonIn(topDialog(), en.agent.migrateSkillInstall));
    const reason = apiErrorText(new ApiError(404, "plugin_not_found", "skill-porting"));
    await waitFor(() => topDialog().textContent!.includes(reason));
    expect(topDialog().textContent).toContain(en.agent.migrateSkillMissing("Helper"));
    expect(buttonIn(topDialog(), en.skills.importOpenChat).disabled).toBe(true);
  });

  it("asks before the install rewrites the Skills the agent has of the plugin: Cancel sends nothing, Confirm installs", async () => {
    const server = agentServer(undefined, {
      library: [SKILL_PORTING],
      skills: ["skill-porting", "plugin-porting"],
    });
    await openImport();
    await waitFor(() => hasButton(en.agent.migrateSkillInstall));
    await click(buttonIn(topDialog(), en.agent.migrateSkillInstall));
    await waitFor(() => dialogs().length === 2);
    expect(topDialog().textContent).toContain(en.plugins.updateConfirmWarning("skill-porting"));
    expect(topDialog().textContent).toContain("plugin-porting");
    await click(buttonIn(topDialog(), en.common.cancel));
    await waitFor(() => dialogs().length === 1);
    expect(server.writes("/plugins")).toEqual([]);

    await click(buttonIn(topDialog(), en.agent.migrateSkillInstall));
    await waitFor(() => dialogs().length === 2);
    await click(buttonIn(topDialog(), en.skills.updateAction));
    await waitFor(() => !buttonIn(topDialog(), en.skills.importOpenChat).disabled);
    expect(server.writes("/plugins").map((r) => r.body)).toEqual([{ names: ["skill-porting"] }]);
    expect(server.skillsOn(null, AGENT_ID)).toContain("agent-porting");
  });

  it("asks before the chat drops a picked file: keeping on keeps it, discarding goes to the chat", async () => {
    agentServer(undefined, PORTING);
    const router = await openImport();
    // A name that suggests no id: the file alone is what was picked.
    await pickArchive("My Agent.zip");
    await waitFor(() => !buttonIn(topDialog(), en.skills.importOpenChat).disabled);
    await click(buttonIn(topDialog(), en.skills.importOpenChat));
    expect(promptOpen()).toBe(true);
    await click(button(en.common.keepEditing));
    expect(topDialog().textContent).toContain("My Agent.zip");
    expect(whereIs(router)).toBe("/list");

    await click(buttonIn(topDialog(), en.skills.importOpenChat));
    await click(button(en.common.discard));
    await waitFor(() => whereIs(router) === "/chat/new");
    expect(dialogs()).toEqual([]);
  });

  it("asks before closing with a picked file, and keeping on keeps it", async () => {
    agentServer(undefined, PORTING);
    await openImport();
    // A name that suggests no id: the file alone is what was picked.
    await pickArchive("My Agent.zip");
    expect(fieldIn(topDialog(), en.agent.id).value).toBe("");
    await pressEscape();
    expect(promptOpen()).toBe(true);
    await click(button(en.common.keepEditing));
    expect(dialogs()).toHaveLength(1);
    expect(topDialog().textContent).toContain("My Agent.zip");
  });

  it("holds Esc while an upload is in flight, and keeps the file after a refusal, when Esc asks again", async () => {
    const server = agentServer(undefined, PORTING);
    await openImport();
    await pickArchive("notes-20261104.zip");
    server.refuseNext(400, "bad_request", "The archive has no manifest.json");
    server.hold();
    await click(buttonIn(topDialog(), en.agent.importAction));
    await waitFor(() => server.writes(IMPORT).length === 1);
    await pressEscape();
    expect(promptOpen()).toBe(false);
    expect(dialogs()).toHaveLength(1);

    await run(server.release);
    await waitFor(() => topDialog().textContent!.includes("The archive has no manifest.json"));
    expect(topDialog().textContent).toContain("notes-20261104.zip");
    await pressEscape();
    expect(promptOpen()).toBe(true);
  });

  it("names the id the file records when the id field was empty, and overwrites that Agent", async () => {
    const server = agentServer(undefined, { archiveAgentId: AGENT_ID });
    await openImport();
    const file = await pickArchive("My Agent.zip");
    expect(fieldIn(topDialog(), en.agent.id).value).toBe("");
    await click(buttonIn(topDialog(), en.agent.importAction));
    await waitFor(() => topDialog().textContent!.includes(en.agent.importExists(AGENT_ID)));
    await click(buttonIn(topDialog(), en.agent.importOverwrite));
    await waitFor(() => dialogs().length === 2);
    expect(topDialog().textContent).toContain(en.agent.overwriteBody(AGENT_ID, file.name));
    await click(buttonIn(topDialog(), en.agent.importOverwrite));
    await waitFor(() => dialogs().length === 0);
    expect(imports(server)).toEqual([
      { agentId: null, overwrite: null, body: file },
      { agentId: AGENT_ID, overwrite: "1", body: file },
    ]);
  });

  it("refuses a file larger than an import takes in place, and sends nothing", async () => {
    const server = agentServer(undefined, PORTING);
    await openImport();
    await pickArchive("huge-20261104.zip", 100 * 1024 * 1024 + 1);
    expect(topDialog().textContent).toContain(en.agent.importTooLarge(LIMIT));
    expect(buttonIn(topDialog(), en.agent.importAction).disabled).toBe(true);
    await click(buttonIn(topDialog(), en.agent.importAction));
    expect(server.writes(IMPORT)).toEqual([]);
  });

  it("needs an id for a .tar.gz whose name gives none, and sends it under the one typed", async () => {
    const server = agentServer(undefined, PORTING);
    await openImport();
    const file = await pickArchive("My Agent-v3.tar.gz");
    expect(buttonIn(topDialog(), en.agent.importAction).disabled).toBe(true);
    await type(fieldIn(topDialog(), en.agent.id), "my_agent");
    expect(buttonIn(topDialog(), en.agent.importAction).disabled).toBe(false);
    await click(buttonIn(topDialog(), en.agent.importAction));
    await waitFor(() => dialogs().length === 0);
    expect(imports(server)).toEqual([{ agentId: "my_agent", overwrite: null, body: file }]);
  });

  it("replaces from a .tar.gz whose name gives no id, under this Agent's", async () => {
    const server = agentServer();
    await mountAgentApp(h(AgentSettingsPage), { at: `/agents/${AGENT_ID}` });
    await waitFor(() => document.body.textContent?.includes(en.agent.replaceOpen) === true);
    await click(button(en.agent.replaceOpen));
    await waitFor(() => dialogs().length === 1);
    const file = await pickArchive("My Backup.tar.gz");
    expect(buttonIn(topDialog(), en.agent.replaceAction).disabled).toBe(false);
    await click(buttonIn(topDialog(), en.agent.replaceAction));
    await waitFor(() => dialogs().length === 2);
    await click(buttonIn(topDialog(), en.agent.replaceAction));
    await waitFor(() => dialogs().length === 0);
    expect(imports(server)).toEqual([{ agentId: AGENT_ID, overwrite: "1", body: file }]);
  });

  it("replaces the Agent State from the settings page after one confirmation, then reads the config again", async () => {
    const server = agentServer();
    await mountAgentApp(h(AgentSettingsPage), { at: `/agents/${AGENT_ID}` });
    await waitFor(() => document.body.textContent?.includes(en.agent.replaceOpen) === true);
    await click(button(en.agent.replaceOpen));
    await waitFor(() => dialogs().length === 1);
    expect(topDialog().querySelector('button[aria-haspopup="listbox"]')).toBeNull();
    const file = await pickArchive("backup.zip");

    await click(buttonIn(topDialog(), en.agent.replaceAction));
    await waitFor(() => dialogs().length === 2);
    await click(buttonIn(topDialog(), en.common.cancel));
    await waitFor(() => dialogs().length === 1);
    expect(imports(server)).toEqual([]);

    const configReads = () =>
      server.fetch.requests.filter((r) => r.path === `${AGENTS}/${AGENT_ID}/config`).length;
    const before = configReads();
    await click(buttonIn(topDialog(), en.agent.replaceAction));
    await waitFor(() => dialogs().length === 2);
    expect(topDialog().textContent).toContain(en.agent.overwriteBody(AGENT_ID, file.name));
    await click(buttonIn(topDialog(), en.agent.replaceAction));
    await waitFor(() => dialogs().length === 0);
    expect(imports(server)).toEqual([{ agentId: AGENT_ID, overwrite: "1", body: file }]);
    expect(toasts("success")).toHaveLength(1);
    await waitFor(() => configReads() > before);
  });
});
