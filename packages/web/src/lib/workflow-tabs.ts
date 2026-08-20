/**
 * The tab strip's view of installed workflows.
 *
 * A workflow appears as a tab only when it ships a UI: `uiRev` is the content hash of its
 * UI tree, absent for a script-only workflow, and it doubles as the cache key an open tab
 * compares to notice the UI changed under it.
 *
 * Chat is not one of these. It is always present and always reachable, so a workflow tab
 * disappearing (uninstalled, or its agent went idle) falls back to Chat rather than
 * leaving the strip pointing at nothing.
 */
export interface WorkflowTab {
  id: string;
  projectId: string;
  agentId: string;
  workflowId: string;
  name: string;
  uiRev: string;
}

/** Dispatched when a push or a reinstall changed a workflow's UI under an open tab. */
export const WORKFLOW_UI_UPDATED_EVENT = "penguin:workflow-ui-updated";

/** Where a workflow tab's own UI is served from (see the server's workflows/routes.ts). */
export function workflowUiUrl(tab: WorkflowTab, file = ""): string {
  const base = `/api/workflows/${encodeURIComponent(tab.projectId)}/${encodeURIComponent(
    tab.agentId,
  )}/${encodeURIComponent(tab.workflowId)}/ui/`;
  return file === "" ? base : base + file;
}

export function workflowTabsFromResponse(value: unknown): WorkflowTab[] {
  if (typeof value !== "object" || value === null || !("workflows" in value)) return [];
  const workflows = (value as { workflows?: unknown }).workflows;
  if (!Array.isArray(workflows)) return [];
  return workflows.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const row = item as {
      id?: unknown;
      projectId?: unknown;
      agentId?: unknown;
      workflowId?: unknown;
      name?: unknown;
      uiRev?: unknown;
    };
    return typeof row.id === "string" &&
      typeof row.projectId === "string" &&
      typeof row.agentId === "string" &&
      typeof row.workflowId === "string" &&
      typeof row.name === "string" &&
      typeof row.uiRev === "string" &&
      row.uiRev.length > 0
      ? [
          {
            id: row.id,
            projectId: row.projectId,
            agentId: row.agentId,
            workflowId: row.workflowId,
            name: row.name,
            uiRev: row.uiRev,
          },
        ]
      : [];
  });
}

export function retainedTab(active: string, workflows: readonly WorkflowTab[]): string {
  if (active === "chat") return "chat";
  return workflows.some((workflow) => workflow.id === active) ? active : "chat";
}
