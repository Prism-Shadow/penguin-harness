/**
 * The tab strip's view of an Agent's workflows.
 *
 * A workflow appears as a tab only when it ships a UI: `uiRev` is the content hash of its
 * `ui/` tree, null for a handler-only workflow, and it doubles as the cache key an open
 * tab compares to notice the UI changed under it (the iframe reloads on a new one).
 *
 * Chat is not one of these. It is always present and always reachable, so a workflow tab
 * disappearing (folder removed, Agent switched) falls back to Chat rather than leaving
 * the strip pointing at nothing.
 */
import type { WorkflowInfo } from "@prismshadow/penguin-server/api";

export interface WorkflowTab {
  workflowId: string;
  name: string;
  version: string | null;
  revision: string;
  uiRev: string;
  /** The load error of the CURRENT files; the tab still shows the last good UI. */
  error: string | null;
}

/** Dispatched on `window` when the server says a workflow of some Agent was (re)loaded. */
export const WORKFLOW_UPDATED_EVENT = "penguin:workflow-updated";

export interface WorkflowUpdatedDetail {
  projectId: string;
  agentId: string;
  workflow: WorkflowInfo;
}

export function workflowsBase(projectId: string, agentId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/workflows`;
}

/** Where a workflow tab's own page is served from (the server's workflows/routes.ts). */
export function workflowUiUrl(
  projectId: string,
  agentId: string,
  tab: Pick<WorkflowTab, "workflowId" | "uiRev">,
): string {
  return `${workflowsBase(projectId, agentId)}/${encodeURIComponent(tab.workflowId)}/ui/?rev=${tab.uiRev}`;
}

export function workflowTabsOf(workflows: readonly WorkflowInfo[]): WorkflowTab[] {
  return workflows.flatMap((w) =>
    w.uiRev === null
      ? []
      : [
          {
            workflowId: w.id,
            name: w.name,
            version: w.version,
            revision: w.revision,
            uiRev: w.uiRev,
            error: w.error,
          },
        ],
  );
}

/** Which tab to show after the list changed: the active one if it still exists, else Chat. */
export function settleActiveTab(
  active: string | null,
  tabs: readonly WorkflowTab[],
): string | null {
  return active !== null && tabs.some((t) => t.workflowId === active) ? active : null;
}
