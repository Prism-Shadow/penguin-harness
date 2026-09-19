/**
 * The tab strip's view of an Agent's workflows.
 *
 * A tab is a CONTRIBUTION: a workflow's manifest puts an entry into `WebModule.sessionTabs`
 * for each page it wants beside the chat — several, or none for a handler-only workflow —
 * and the server hands them over with each page's URL resolved. `uiRev`, the content hash
 * of the workflow's `ui/` tree, is only the cache key an open tab compares to notice its
 * page changed under it (the iframe reloads on a new one). A tab whose renderer this build
 * does not carry is left out: there is nothing to draw it with.
 *
 * Chat is not one of these. It is always present and always reachable, so a workflow tab
 * disappearing (folder removed, Agent switched) falls back to Chat rather than leaving
 * the strip pointing at nothing.
 */
import type { WorkflowInfo } from "@prismshadow/penguin-server/api";
import { apiUrl } from "./server-context";

export interface WorkflowTab {
  /** `<workflowId>/<key>`: what the strip selects by. */
  tabId: string;
  workflowId: string;
  /** The contribution's key, unique within its workflow; the fourth segment of the full-page route. */
  key: string;
  title: string;
  titleZh?: string;
  /** Where the page is served from — through the machine's connection when the workflow lives on one. */
  src: string;
  /** The machine whose server holds the workflow (the Agent's Session runs there); null = this server. */
  machineId: string | null;
  /** The workflow's package name, for the frame's bar. */
  name: string;
  version: string | null;
  revision: string;
  /** The cache key of the page: the `ui/` revision (the folder's when there is no `ui/`). */
  uiRev: string;
  /** The load error of the CURRENT files; the tab still shows the last good UI. */
  error: string | null;
}

/**
 * Dispatched on `window` when the server says a workflow of some Agent was (re)loaded or
 * removed. The detail names the Agent only: the listener refetches the list, which is the
 * one shape that covers both.
 */
export const WORKFLOW_UPDATED_EVENT = "penguin:workflow-updated";

export interface WorkflowUpdatedDetail {
  projectId: string;
  agentId: string;
}

export function workflowsBase(projectId: string, agentId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/workflows`;
}

/** A tab's page, keyed on the UI revision so a changed page is a new URL. */
export function workflowUiUrl(tab: Pick<WorkflowTab, "src" | "uiRev">): string {
  return `${tab.src}${tab.src.includes("?") ? "&" : "?"}rev=${tab.uiRev}`;
}

/**
 * A workflow the reader would otherwise never hear about: it contributes no tab, so nothing
 * of it can appear in the strip, and yet the server has something to say about it — the load
 * failed, or it loaded and the harness noticed the pages go nowhere (`hints`). A workflow
 * that HAS tabs carries its error on them instead, on the tab itself.
 *
 * The author is an Agent and reads `.build/status.json`, but the person watching the chat
 * page has only this.
 */
export interface WorkflowNotice {
  workflowId: string;
  error: string | null;
  hints: readonly string[];
}

export function workflowNoticesOf(workflows: readonly WorkflowInfo[]): WorkflowNotice[] {
  return workflows
    .filter((w) => w.tabs.length === 0 && (w.error !== null || (w.hints ?? []).length > 0))
    .map((w) => ({ workflowId: w.id, error: w.error, hints: w.hints ?? [] }));
}

export function workflowTabsOf(
  workflows: readonly WorkflowInfo[],
  machineId: string | null = null,
): WorkflowTab[] {
  return workflows.flatMap((w) =>
    w.tabs.flatMap((tab) =>
      "iframe" in tab.renderer
        ? [
            {
              tabId: `${w.id}/${tab.key}`,
              workflowId: w.id,
              key: tab.key,
              title: tab.title,
              ...(tab.titleZh === undefined ? {} : { titleZh: tab.titleZh }),
              src: apiUrl(tab.renderer.iframe.src, machineId),
              machineId,
              name: w.name,
              version: w.version,
              revision: w.revision,
              uiRev: w.uiRev ?? w.revision,
              error: w.error,
            },
          ]
        : [],
    ),
  );
}

/** Which tab to show after the list changed: the active one if it still exists, else Chat. */
export function settleActiveTab(
  active: string | null,
  tabs: readonly WorkflowTab[],
): string | null {
  return active !== null && tabs.some((t) => t.tabId === active) ? active : null;
}

/**
 * The route that shows one workflow page as the whole app (no sidebar, no chat, no tab
 * strip): what `penguin web --app <project>/<agent>/<workflow>[/<tab>]` opens, and what a
 * tab's "fill the app" action navigates to. Without a tab key the workflow's first tab is
 * shown. The palette (Ctrl+P / Ctrl+Shift+P) is the way out.
 */
export function workflowAppPath(
  projectId: string,
  agentId: string,
  workflowId: string,
  tabKey?: string,
  machineId: string | null = null,
): string {
  const segments = [projectId, agentId, workflowId, ...(tabKey === undefined ? [] : [tabKey])];
  const path = `/app/${segments.map(encodeURIComponent).join("/")}`;
  // The machine is not part of the workflow's name, only of where to ask for it.
  return machineId === null ? path : `${path}?machine=${encodeURIComponent(machineId)}`;
}

/** The tab a full-page route names: that key, or the workflow's first tab when it names none. */
export function appPageTab(
  tabs: readonly WorkflowTab[],
  workflowId: string,
  tabKey: string | undefined,
): WorkflowTab | null {
  const own = tabs.filter((t) => t.workflowId === workflowId);
  return (tabKey === undefined ? own[0] : own.find((t) => t.key === tabKey)) ?? null;
}

/** A page's own request to fill the app, posted to its parent: `{ type: "penguin:fill-app" }`. */
export const FILL_APP_MESSAGE = "penguin:fill-app";
