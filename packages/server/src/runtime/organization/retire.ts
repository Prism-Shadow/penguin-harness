/**
 * Deleting an organization: what runs between the decision and the directory moving to the
 * trash. Plugins hold resources per organization — a database connection opened on first use,
 * a refresh in flight with git children, deploy processes working in the shared workspace — and
 * sessions of its employees may be running. On Windows any of them keeps the directory from
 * moving; on every platform a connection kept past the move writes into the trashed file, and a
 * new organization under the same id would reuse it. So a delete, under the organization's lock:
 *
 * 1. marks the organization as being deleted — loadOrg answers null, so the gateway's view is
 *    null (plugin routes answer 404) and every host route and pass treats it as gone;
 * 2. awaits each plugin's retirement in turn (OrgGatewaySlots.retirements), at most 30 s each;
 *    one that times out or throws is recorded and the delete goes on;
 * 3. stops the organization's sessions — aborted, not awaited;
 * 4. moves the directory to the trash. When that fails the mark is lifted and the delete
 *    answers 409 `organization_busy` with the system's reason and path, never 500.
 *
 * Work in flight is aborted rather than refusing the delete: deleting is the organization's
 * decision, and one deploy or one session should not overrule it.
 */
import { HttpError } from "../../http/errors.js";
import type { OrgDeps, OrgRetirement } from "./deps.js";
import { orgLockKey } from "./locks.js";
import type { LoadedOrg } from "./model.js";

/** How long one retirement may take before the delete goes on without it. */
export const RETIREMENT_TIMEOUT_MS = 30_000;

/** What a delete needs besides the organization: the time, for the trash stamp. */
export interface RetireOptions {
  now: number;
}

/**
 * Runs the four steps for an organization that exists (`org`, loaded before the mark). The
 * caller holds the organization's lock. Returns where the directory went.
 */
export async function retireAndTrash(
  deps: OrgDeps & { deleting: Set<string> },
  org: LoadedOrg,
  opts: RetireOptions,
): Promise<string> {
  const { projectId, orgId } = org;
  const key = orgLockKey(projectId, orgId);
  deps.deleting.add(key);
  try {
    for (const retirement of deps.retirements ?? []) {
      await runRetirement(deps, retirement, { projectId, orgId });
    }
    stopSessions(deps, org);
    return await trashOrBusy(deps, projectId, orgId, opts.now);
  } finally {
    // Lifted on success too: the directory is gone by then, so loadOrg answers null anyway,
    // and a new organization created under the same id must not inherit the mark.
    deps.deleting.delete(key);
  }
}

/** One retirement, bounded; a timeout or a throw is recorded and swallowed. */
async function runRetirement(
  deps: OrgDeps,
  retirement: OrgRetirement,
  org: { projectId: string; orgId: string },
): Promise<void> {
  const timeoutMs = RETIREMENT_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  // Started in a try of its own: a contribution that throws synchronously is a throw like any other.
  let running: Promise<void>;
  try {
    running = Promise.resolve(retirement.retire({ ...org }));
  } catch (err) {
    running = Promise.reject(err);
  }
  // A retirement that outlives its bound keeps running; its late failure must not go unhandled.
  const settled = running.then(
    () => "done" as const,
    (err: unknown) => ({ err }),
  );
  try {
    const outcome = await Promise.race([settled, timedOut]);
    if (outcome === "done") return;
    const err =
      outcome === "timeout"
        ? new Error(`${retirement.id} did not finish within ${Math.round(timeoutMs / 1000)} s`)
        : outcome.err;
    deps.errors.record({
      source: "organization",
      err,
      code: outcome === "timeout" ? "org_retirement_timeout" : "org_retirement_failed",
      ctx: { projectId: org.projectId },
    });
    deps.log?.(
      `[organization] ${org.projectId}/${org.orgId}: retirement ${retirement.id} ${outcome === "timeout" ? "timed out" : "failed"}: ${err instanceof Error ? err.message : String(err)}; deleting anyway`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The organization's sessions: its desk and ticket sessions (the cache's rows), and every
 * organization session of its employees — the rooms, discussions and other sessions a plugin
 * opened through the gateway, which the cache does not list. Each is stopped without waiting.
 * An employee is one organization's (its Agent is hired into that organization's chart), so an
 * employee's organization sessions are this organization's.
 */
function stopSessions(deps: OrgDeps, org: LoadedOrg): void {
  const stop = deps.stopSession;
  if (stop === undefined) return;
  const ids = new Set<string>();
  for (const [sessionId, orgId] of deps.cache.orgIdsOfProject(org.projectId)) {
    if (orgId === org.orgId) ids.add(sessionId);
  }
  for (const employee of org.chart.employees) {
    for (const row of deps.sessions.listByAgent(org.projectId, employee.agentId)) {
      if (row.client === "org") ids.add(row.sessionId);
    }
  }
  for (const sessionId of ids) {
    try {
      stop(sessionId);
    } catch (err) {
      deps.errors.record({
        source: "organization",
        err,
        code: "org_session_stop_failed",
        ctx: { projectId: org.projectId, sessionId },
      });
    }
  }
}

/** The move into the trash; a failure (a file still open on Windows, say) is 409, not 500. */
async function trashOrBusy(
  deps: OrgDeps,
  projectId: string,
  orgId: string,
  now: number,
): Promise<string> {
  try {
    return await deps.store.trash(projectId, orgId, new Date(now).toISOString());
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    deps.log?.(`[organization] ${projectId}/${orgId}: not moved to the trash: ${reason}`);
    throw new HttpError(
      409,
      "organization_busy",
      `Organization ${orgId} could not be moved to the trash, something still holds its directory (${deps.store.dir(projectId, orgId)}): ${reason}`,
    );
  }
}
