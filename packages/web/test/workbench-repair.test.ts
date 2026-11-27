/** @vitest-environment jsdom */
/**
 * A workbench whose files do not load: "Fix with AI" (features/ai-create/workbench-repair.tsx),
 * its report (features/workbenches/workbench-load-failure.ts) and the pane that offers them
 * beside Reload (workbench-page-status.tsx).
 *
 * - The chat a repair opens is the default Agent's, in the temporary Workspace, with a prompt that
 *   names the workbench, its Agent, its folder and the error verbatim, and says to change nothing
 *   when the platform is at fault; a machine's workbench is repaired on that machine; with no
 *   Agent to take it there is no chat.
 * - The report names the workbench and ends with the error, a home path in it masked.
 * - In the App Center's window, the pane of a workbench that failed shows the error with
 *   「[报告问题]」 after it, Reload, and "Fix with AI" beside it. The report carries the error.
 *   "Fix with AI" asks first, then opens a new chat holding the prompt, unsent; with no Agent to
 *   take it, the confirmation says so and opens nothing.
 * - The full page, outside the shell with no Project to open a chat in, offers Reload and the
 *   report.
 * - For a workbench on a machine whose Agents no page has read yet, the confirmation reads them
 *   (busy meanwhile) and opens the chat for that machine's default Agent; when the read fails, it
 *   says so with its report, never that there is no Agent.
 */
import { createElement as h } from "react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSummary, WorkbenchInfo } from "@prismshadow/penguin-server/api";
import {
  UNKNOWN_ENVIRONMENT,
  buildReport,
  closeReport,
  reportStore,
  toastStore,
  toldReport,
} from "@prismshadow/penguin-ui";
import { aiChatRouteState, buildAiDraft } from "../src/features/ai-create/ai-bridge";
import { workbenchRepairRequest } from "../src/features/ai-create/workbench-repair";
import { AgentSettingsPage } from "../src/features/agents/agent-settings-page";
import { AppCenterPage } from "@prismshadow/penguin-library-workbench/web/app-center/app-center-page";
import { draftKey, loadDraft } from "../src/features/chat/draft-cache";
import { WorkbenchAppPage } from "@prismshadow/penguin-library-workbench/web/workbenches/workbench-app-page";
import {
  workbenchLoadFailure,
  type FailedWorkbench,
} from "@prismshadow/penguin-library-workbench/web/workbenches/workbench-load-failure";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { PagesContext } from "../src/lib/web-app-pages";
import { AuthProvider } from "../src/state/auth";
import { LocaleProvider } from "../src/state/locale";
import { ThemeProvider } from "../src/state/theme";
import { ADMIN_ME } from "./helpers/admin-settings";
import {
  AGENT_ID,
  PROJECT_ID,
  agentServer,
  buttonIn,
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
  mount,
  unmountAll,
  waitFor,
} from "./helpers/dom";
import { SignedIn } from "./helpers/signed-in";
import { WorkspaceWindows } from "./helpers/workspace-windows";

const TS2688 = [
  "error TS2688: Cannot find type definition file for 'node'.",
  "  The file is in the program because:",
  "    Entry point of type library 'node' specified in compilerOptions",
].join("\n");

const agent = (agentId: string, over: Partial<AgentSummary> = {}) =>
  ({ agentId, ...over }) as AgentSummary;

const TARGET: FailedWorkbench = {
  workbenchId: "codex-taskboard-workbench",
  name: "Codex Taskboard",
  agentId: "builder",
  machineId: null,
  error: TS2688,
};

afterEach(() => setActiveStrings(zh));

describe("the chat a workbench repair opens", () => {
  it("is the default Agent's, in the temporary Workspace, naming the workbench, its folder and the error", () => {
    setActiveStrings(en);
    const request = workbenchRepairRequest(TARGET, [agent("other"), agent("default_agent")]);
    expect(request).toMatchObject({ agentId: "default_agent", workspace: "" });
    const text = request!.text;
    expect(text).toContain("`codex-taskboard-workbench`");
    expect(text).toContain('"Codex Taskboard"');
    expect(text).toContain("`builder`");
    expect(text).toContain(
      "`<app_data_dir>/agents/builder/agent_state/workbenches/codex-taskboard-workbench/`",
    );
    expect(text).toContain(TS2688);
    expect(text).toContain("`.build/status.json`");
    // A platform fault is said and left alone; anything else is proposed before it is changed.
    expect(text).toContain("change nothing");
    expect(text).toContain("before you change its files");
    // The Workspace is pinned on the route too, so a Project default does not override it.
    expect(aiChatRouteState(request!)).toEqual({ agentId: "default_agent", workspace: "" });
  });

  it("goes to the machine the workbench lives on, which the prompt names", () => {
    setActiveStrings(en);
    const request = workbenchRepairRequest(
      { ...TARGET, machineId: "gpu1" },
      [agent("default_agent")],
      "gpu-box",
    )!;
    expect(request.text).toContain('"gpu-box"');
    expect(aiChatRouteState(request)).toEqual({
      agentId: "default_agent",
      workspace: "",
      machineId: "gpu1",
    });
    const draft = buildAiDraft({ text: "typed earlier", workspace: "/srv/project" }, request);
    expect(draft).toMatchObject({ workspace: "", machineId: "gpu1", aiPrefill: true });
  });

  it("is written in the reader's language", () => {
    setActiveStrings(zh);
    const request = workbenchRepairRequest(TARGET, [agent("a")]);
    expect(request!.text).toContain("加载失败");
    expect(request!.text).toContain(TS2688);
  });

  it("is not opened when no Agent can take it", () => {
    expect(workbenchRepairRequest(TARGET, [])).toBeNull();
    expect(workbenchRepairRequest(TARGET, [agent("system_agent", { system: true })])).toBeNull();
  });
});

describe("the report of a workbench that failed to load", () => {
  it("names the workbench and ends with the error, a home path in it masked", () => {
    const report = toldReport(
      workbenchLoadFailure({
        workbenchId: "board",
        machineId: null,
        error: "/home/alice/notes/index.ts(1,1): error TS1005: ';' expected.",
      }),
    )();
    expect(report.facts).toContainEqual(["Workbench", "board"]);
    const { markdown } = buildReport(report, UNKNOWN_ENVIRONMENT);
    expect(markdown).toContain("/home/<user>/notes/index.ts(1,1): error TS1005: ';' expected.");
    expect(markdown).not.toContain("alice");
  });

  it("says when the workbench runs on a connected machine", () => {
    const local = toldReport(workbenchLoadFailure({ ...TARGET, machineId: null }))();
    const remote = toldReport(workbenchLoadFailure({ ...TARGET, machineId: "gpu1" }))();
    expect(local.facts.some(([name]) => name === "Runs on")).toBe(false);
    expect(remote.facts.find(([name]) => name === "Runs on")?.[1]).toContain("connected machine");
  });
});

const FAILED: WorkbenchInfo = {
  id: "board",
  name: "board",
  version: "1.0.0",
  revision: "abcdef012345",
  uiRev: null,
  loadedAt: "2026-11-26T00:00:00Z",
  error: TS2688,
  hints: [],
  tabs: [],
  appCenter: { show: true },
};

const draft = () => loadDraft(draftKey(ADMIN_ME.user.userId, PROJECT_ID));
const reportAction = () => document.querySelector<HTMLElement>("[data-report-issue]");
/** The pane's line that says why, the one that carries the error. */
const statusLine = () =>
  [...document.querySelectorAll('[role="status"]')].find((el) => el.textContent?.includes(TS2688));
/** Requests that would have started a conversation. */
const sessionWrites = (server: ReturnType<typeof agentServer>) =>
  server.writes().filter((request) => request.path.includes("/sessions"));

beforeEach(() => {
  localStorage.clear();
  toastStore.setState({ items: [] });
});
afterEach(async () => {
  await unmountAll();
  closeReport();
});

/** The failed board opened in the App Center's window, from its tile. */
async function openWindow(options: Parameters<typeof agentServer>[1] = {}) {
  setActiveStrings(en);
  const server = agentServer(undefined, { workbenches: [FAILED], ...options });
  const router = await mountAgentApp(h(ThemeProvider, null, h(AppCenterPage)), {
    route: "/apps",
    at: "/apps",
    layers: [h(ThemeProvider, null, h(WorkspaceWindows))],
  });
  const tile = () =>
    document.querySelector<HTMLButtonElement>(`li[data-app="${AGENT_ID}/board"] button`);
  await waitFor(() => tile() !== null);
  await click(tile()!);
  await waitFor(() => hasButton(en.plugins.repair) && !button(en.plugins.repair).disabled);
  return { server, router };
}

describe("the window of a workbench whose files do not load", () => {
  it("says why, with the report after the error, Reload, and Fix with AI beside it", async () => {
    await openWindow();
    expect(statusLine()?.contains(reportAction())).toBe(true);
    expect(hasButton(en.workbenches.reload)).toBe(true);

    await click(reportAction()!);
    const report = reportStore.getState().open;
    expect(report?.output?.text).toBe(TS2688);
    expect(report?.facts).toContainEqual(["Workbench", "board"]);
  });

  it("asks before opening a chat, and the chat holds the repair prompt, unsent", async () => {
    const { server, router } = await openWindow({ moreAgents: [{ agentId: "default_agent" }] });
    const before = whereIs(router);
    await click(button(en.plugins.repair));
    // Only the question: nothing has moved yet.
    expect(dialogs()).toHaveLength(1);
    expect(whereIs(router)).toBe(before);

    await click(button(en.plugins.repairOpen));
    await waitFor(() => whereIs(router) === "/chat/new");
    expect(draft()).toMatchObject({ agentId: "default_agent", workspace: "", aiPrefill: true });
    expect(draft().text).toContain(TS2688);
    expect(draft().text).toContain(
      `<app_data_dir>/agents/${AGENT_ID}/agent_state/workbenches/board/`,
    );
    expect(sessionWrites(server)).toEqual([]);
  });

  it("says so when no Agent can take the repair, and opens nothing", async () => {
    // The only Agent is the system Agent, which takes no prompt.
    const { router } = await openWindow({ moreAgents: [{ agentId: AGENT_ID, system: true }] });
    const before = whereIs(router);
    await click(button(en.plugins.repair));
    await click(button(en.plugins.repairOpen));
    expect(toastStore.getState().items.map((t) => t.text)).toContain(en.plugins.repairNoAgent);
    expect(whereIs(router)).toBe(before);
    expect(dialogs()).toEqual([]);
  });
});

/** A machine whose own Agents include a default Agent, which this server's list lacks. */
const GPU: FakeMachine = {
  machineId: "gpu1",
  alias: "gpu-box",
  agents: ["default_agent", AGENT_ID],
};

/** The machine's answers to "list your Agents". */
const machineAgentReads = (server: ReturnType<typeof agentServer>) =>
  server
    .requests()
    .filter(
      (r) =>
        r.machine === GPU.machineId &&
        r.method === "GET" &&
        r.path === `/api/projects/${PROJECT_ID}/agents`,
    );

/**
 * The failed board on the Workbenches sub-page of the Agent on the machine, "Fix with AI" asked,
 * with no list of the machine's Agents held: the page's own read of it failed.
 */
async function askOnMachine() {
  setActiveStrings(en);
  const server = agentServer(undefined, { workbenches: [FAILED], machines: [GPU] });
  server.failNext(GPU.machineId, /\/agents$/);
  const router = await mountAgentApp(h(AgentSettingsPage), {
    at: `/agents/${AGENT_ID}?tab=workbenches&machine=${GPU.machineId}`,
  });
  await waitFor(() => hasButton(`${en.workbenches.more} board`));
  await waitFor(() => machineAgentReads(server).length > 0);
  await click(button(`${en.workbenches.more} board`));
  await click(menuItem(en.plugins.repair));
  return { server, router };
}

describe("Fix with AI for a workbench on a machine", () => {
  it("reads the machine's Agents when no page has, then opens the chat for its default Agent", async () => {
    const { server, router } = await askOnMachine();
    const before = machineAgentReads(server).length;
    const held = server.holdNext(GPU.machineId, /\/agents$/);
    await click(buttonIn(topDialog(), en.plugins.repairOpen));
    // Busy while the machine answers: the question stays, its buttons wait.
    expect(buttonIn(topDialog(), en.plugins.repairOpen).disabled).toBe(true);
    expect(whereIs(router)).not.toBe("/chat/new");

    held.release();
    await waitFor(() => whereIs(router) === "/chat/new");
    expect(machineAgentReads(server).length).toBeGreaterThan(before);
    expect(draft()).toMatchObject({
      agentId: "default_agent",
      machineId: GPU.machineId,
      workspace: "",
      aiPrefill: true,
    });
    expect(draft().text).toContain(TS2688);
    expect(draft().text).toContain('"gpu-box"');
  });

  it("says the read failed, with its report, rather than that there is no Agent", async () => {
    const { server, router } = await askOnMachine();
    server.failNext(GPU.machineId, /\/agents$/);
    await click(buttonIn(topDialog(), en.plugins.repairOpen));
    await waitFor(() => toastStore.getState().items.length > 0);
    const toasts = toastStore.getState().items;
    expect(toasts.map((t) => t.text)).not.toContain(en.plugins.repairNoAgent);
    const failed = toasts.find((t) => t.kind === "error");
    expect(failed?.report).toBeDefined();
    expect(whereIs(router)).toBe(`/agents/${AGENT_ID}?tab=workbenches&machine=${GPU.machineId}`);
    expect(dialogs()).toEqual([]);
  });
});

/** An event stream that never delivers anything: jsdom has no `EventSource`. */
class SilentEventSource {
  readyState = 0;
  addEventListener(): void {}
  close(): void {}
}

describe("the full page of a workbench whose files do not load", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("offers Reload and the report, outside the shell", async () => {
    setActiveStrings(en);
    agentServer(undefined, { workbenches: [FAILED] });
    vi.stubGlobal("EventSource", SilentEventSource);
    vi.stubGlobal("matchMedia", (media: string) => ({
      matches: false,
      media,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }));
    // Mounted the way the app mounts it: signed in, with no shell or Project around it.
    const router = createMemoryRouter(
      [{ path: "/app/:projectId/:agentId/:workbenchId", element: h(WorkbenchAppPage) }],
      { initialEntries: [`/app/${PROJECT_ID}/${AGENT_ID}/board`] },
    );
    const table = { pages: [], pending: false, quickStarts: [], refresh: async () => null };
    await mount(
      h(
        LocaleProvider,
        null,
        h(
          AuthProvider,
          null,
          h(
            SignedIn,
            null,
            h(PagesContext.Provider, { value: table }, h(RouterProvider, { router })),
          ),
        ),
      ),
    );
    await waitFor(() => statusLine() !== undefined);
    expect(statusLine()?.contains(reportAction())).toBe(true);
    expect(hasButton(en.workbenches.reload)).toBe(true);
    expect(hasButton(en.plugins.repair)).toBe(false);
  });
});
