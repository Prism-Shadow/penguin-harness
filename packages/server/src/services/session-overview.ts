/**
 * The dashboard's answer: per Workspace, how many of a Project's Sessions run right now and
 * how many wait on a person — and nothing else. Pure over the facts the service reads off
 * each row, so the counting is checked without a manager behind it.
 */
import type { SessionStatus, WorkspaceActivity } from "../api/types.js";

/** What one row contributes: where it is, whether it is working, whether it waits on someone. */
export interface SessionActivityFact {
  workspace: string;
  status: SessionStatus;
  pendingApprovalCount: number;
  archived: boolean;
}

/**
 * Groups by the Workspace path as the row carries it. A Session counts as running when its
 * status is anything but idle — compacting is the model working too — and as pending review
 * when an approval waits on a person; one Session can be both. Archived rows are out: they
 * are settled by definition. Only Workspaces with something to show come back, in no
 * particular order; the page sorts.
 */
export function workspaceActivityOf(facts: readonly SessionActivityFact[]): WorkspaceActivity[] {
  const byWorkspace = new Map<string, WorkspaceActivity>();
  for (const fact of facts) {
    if (fact.archived) continue;
    const running = fact.status !== "idle" ? 1 : 0;
    const pendingReview = fact.pendingApprovalCount > 0 ? 1 : 0;
    if (running === 0 && pendingReview === 0) continue;
    const cur = byWorkspace.get(fact.workspace) ?? {
      workspace: fact.workspace,
      running: 0,
      pendingReview: 0,
    };
    byWorkspace.set(fact.workspace, {
      workspace: fact.workspace,
      running: cur.running + running,
      pendingReview: cur.pendingReview + pendingReview,
    });
  }
  return [...byWorkspace.values()];
}
