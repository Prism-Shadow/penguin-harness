/**
 * What makes a workflow an Agent's (./service.ts): the interfaces it is written against, the
 * modules published into its tree — `WorkflowHost` as `Host`, the Web slots the host opens —
 * and the tabs it contributes, turned into the URLs their pages are served from.
 */
import type { IfaceDecl, IfaceTable, Manifest } from "@prismshadow/penguin-core/kernel";
import { userText } from "@prismshadow/penguin-core";
import type { Log } from "../hmr/capabilities.js";
import type { AgentIndex } from "../mechanisms/projects.js";
import type { SessionIndex } from "../mechanisms/sessions.js";
import type { WorkflowInput, WorkflowTab } from "../mechanisms/workflows.js";
import type { ScheduleSessionCreator, ScheduleTaskRunner } from "../runtime/scheduler.js";
import { isSafeRelPath, readState, UI_DIR, writeState } from "./store.js";

const PKG = "@prismshadow/penguin-server";
export const HOST_MODULE = "Host";
export const HOST_IFACE = `${PKG}#WorkflowHost`;
export const MAIN_IFACE = `${PKG}#WorkflowMain`;
/** The platform module whose slots the host opens to workflows, and the slots it opens. */
export const WEB_MODULE = "WebModule";
export const WEB_IFACE = `${PKG}#WebShell`;
export const TABS_SLOT = "sessionTabs";
const OPEN_WEB_SLOTS = [TABS_SLOT] as const;
/**
 * A workflow that loads and shows nothing is the quietest way to get this wrong: the pages are
 * written, the load is green, and no tab appears, because a page is only a file until the
 * manifest contributes a tab for it. The author is usually an Agent with nothing but these
 * files and the load status, so the status says it, with the entry to add.
 */
export function loadHints(
  uiRev: string | null,
  tabs: readonly WorkflowTab[],
  error: string | null,
): string[] {
  if (error !== null || uiRev === null || tabs.length > 0) return [];
  const entry = {
    key: "main",
    title: "<tab title>",
    renderer: { iframe: { src: `${UI_DIR}/index.html` } },
  };
  return [
    `${UI_DIR}/ has pages but the manifest contributes no tab, so nothing shows beside the chat. ` +
      `In package.json, under penguin.modules[0] (the module named Workflow), set ` +
      `"contributes": ${JSON.stringify({ [`${WEB_MODULE}.${TABS_SLOT}`]: [entry] })} — ` +
      `one entry per tab, src a file under ${UI_DIR}/.`,
  ];
}

/**
 * The tabs the manifests contribute to `WebModule.sessionTabs`, with each page's path (in
 * the folder, under `ui/`) turned into the URL it is served from. The slot's shape was
 * checked with the tree; where a page may live is this host's rule.
 */
export function contributedTabs(manifests: readonly Manifest[], uiBase: string): WorkflowTab[] {
  const tabs: WorkflowTab[] = [];
  const keys = new Set<string>();
  for (const m of manifests) {
    for (const entry of m.contributes[`${WEB_MODULE}.${TABS_SLOT}`] ?? []) {
      const tab = entry as unknown as WorkflowTab;
      if (keys.has(tab.key)) {
        throw new Error(
          `contribution '${tab.id}': another tab of this workflow already has the key '${tab.key}'`,
        );
      }
      keys.add(tab.key);
      if (!("iframe" in tab.renderer)) {
        tabs.push(tab);
        continue;
      }
      const src = tab.renderer.iframe.src;
      if (!isSafeRelPath(src) || !src.startsWith(`${UI_DIR}/`)) {
        throw new Error(
          `contribution '${tab.id}': renderer.iframe.src must be a file under ${UI_DIR}/ (got '${src}')`,
        );
      }
      const rest = src
        .slice(UI_DIR.length + 1)
        .split("/")
        .map(encodeURIComponent)
        .join("/");
      tabs.push({ ...tab, renderer: { iframe: { src: `${uiBase}/${rest}` } } });
    }
  }
  return tabs;
}

/** Where a workflow's `ui/` is served from (./routes.ts). */
export function uiBase(projectId: string, agentId: string, workflowId: string): string {
  const [p, a, w] = [projectId, agentId, workflowId].map(encodeURIComponent);
  return `/api/projects/${p}/agents/${a}/workflows/${w}/${UI_DIR}`;
}

/**
 * The slots the host opens to a workflow tree, published under the platform module's own
 * name: the slot declarations come from the platform's table (so a workflow's contribution
 * has the shape a plugin's has), and only the opened ones are there — contributing to any
 * other is `no-such-slot`. No members: there is nothing to require from it.
 */
export function webSlotsDecl(table: IfaceTable): IfaceDecl {
  const decl = table.ifaces[WEB_IFACE];
  if (!decl) throw new Error(`${WEB_IFACE} is not in ifaces.json (regenerate it)`);
  const slots: IfaceDecl["slots"] = {};
  for (const name of OPEN_WEB_SLOTS) {
    const slot = decl.slots[name];
    if (!slot) throw new Error(`${WEB_IFACE} declares no slot '${name}' (regenerate ifaces.json)`);
    slots[name] = slot;
  }
  return { name: "WorkflowWebSlots", methods: {}, slots };
}

/** The published `WorkflowHost` declaration, straight from the platform's interface table. */
export function hostDecl(table: IfaceTable): IfaceDecl {
  const decl = table.ifaces[HOST_IFACE];
  if (!decl) throw new Error(`${HOST_IFACE} is not in ifaces.json (regenerate it)`);
  return decl;
}

/** What an Agent workflow's host reaches. */
export interface AgentHostDeps {
  agents: AgentIndex;
  sessions: ScheduleSessionCreator;
  runner: ScheduleTaskRunner;
  sessionIndex: SessionIndex;
  log: Log;
}

/** The `WorkflowHost` published into the tree of workflow `id` (folder `dir`) of an Agent. */
export function agentHost(
  deps: AgentHostDeps,
  projectId: string,
  agentId: string,
  dir: string,
  id: string,
) {
  /** A workflow reaches the Sessions of its own Project and no others. */
  const ownSession = (sessionId: string, call: string): void => {
    if (deps.sessionIndex.findById(sessionId)?.projectId !== projectId) {
      throw new Error(`${call}: this Project has no Session '${sessionId}'`);
    }
  };
  let state: unknown = null;
  let stateRead: Promise<void> | null = null;
  const ensureState = () => (stateRead ??= readState(dir).then((s) => void (state = s)));
  void ensureState();
  return {
    listAgents: () => deps.agents.list(projectId).map((row) => ({ agentId: row.agentId })),
    async createSession(opts?: { agentId?: string }) {
      const target = opts?.agentId ?? agentId;
      if (!deps.agents.exists(projectId, target)) {
        throw new Error(`createSession: this Project has no Agent '${target}'`);
      }
      // Unattended, like a scheduled run: allow-all, whatever the default preset asks.
      return deps.sessions.createSession({
        projectId,
        agentId: target,
        approvalMode: "allow-all",
      });
    },
    async run(sessionId: string, input: WorkflowInput[]) {
      ownSession(sessionId, "run");
      const texts = (Array.isArray(input) ? input : []).map((item) => item?.text);
      if (texts.length === 0 || texts.some((t) => typeof t !== "string" || t === "")) {
        throw new Error('run: input is a non-empty list of { text: "…" } items');
      }
      // Whatever the workflow stamped, the Agent hears the server, never a person.
      return deps.runner.startTask(
        sessionId,
        texts.map((text) => userText(text, "server")),
        { queueIfBusy: true },
      );
    },
    sessionStatus: (sessionId: string) => {
      ownSession(sessionId, "sessionStatus");
      return deps.runner.statusOf(sessionId);
    },
    getState: () => state,
    async setState(next: unknown) {
      await ensureState();
      state = next ?? null;
      await writeState(dir, state);
    },
    log: (message: string) => deps.log.line(`[workflow ${id}] ${message}`),
  };
}
