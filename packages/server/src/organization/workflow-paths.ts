/**
 * Where an organization's workflows live on disk. Same doctrine as paths.ts: files are the
 * truth for company mode, nothing here touches SQLite. Layout under the org directory:
 *
 *   workflows/<wfId>/definition.yaml   # one versioned definition per directory
 *   instances/<instId>/state.jsonl      # append-only event stream (the truth)
 *   instances/<instId>/snapshot.json    # derived snapshot (deletable, rebuildable)
 *
 * Template seeds ship with the server (organization/templates/*.yaml) and are copied into
 * `workflows/` on first use, so a hand-deleted definition can be re-seeded without a deploy.
 */
import path from "node:path";

/**
 * Workflow definition ids: like semantic ids but hyphens allowed (`bidding-v1`), since
 * definitions are versioned names rather than Agent or channel identities. Still a safe
 * directory name under `workflows/`.
 */
export const WORKFLOW_ID_PATTERN = /^[a-z][a-z0-9_-]{1,63}$/;

export function isWorkflowId(value: string): boolean {
  return WORKFLOW_ID_PATTERN.test(value);
}

/** `workflows/`: one directory per definition id. */
export function workflowsDir(dir: string): string {
  return path.join(dir, "workflows");
}

/** `workflows/<wfId>/definition.yaml`. */
export function workflowDefinitionPath(dir: string, wfId: string): string {
  return path.join(workflowsDir(dir), wfId, "definition.yaml");
}

/** `instances/`: one directory per instance id (`<yyyy-mm-dd>-<slug>`). */
export function workflowInstancesDir(dir: string): string {
  return path.join(dir, "instances");
}

export const WORKFLOW_INSTANCE_ID_PATTERN = /^\d{4}-\d{2}-\d{2}-[a-z]+(?:-[a-z]+)*$/;

export function isWorkflowInstanceId(value: string): boolean {
  return WORKFLOW_INSTANCE_ID_PATTERN.test(value);
}

/** `instances/<instId>/state.jsonl`: the event stream. */
export function workflowInstanceEventsPath(dir: string, instId: string): string {
  return path.join(workflowInstancesDir(dir), instId, "state.jsonl");
}

/** `instances/<instId>/snapshot.json`: derived, rebuildable from the stream. */
export function workflowInstanceSnapshotPath(dir: string, instId: string): string {
  return path.join(workflowInstancesDir(dir), instId, "snapshot.json");
}
