/**
 * Admission of an Agent API run: a busy Session is refused 409 before anything starts, and an
 * Agent already running its limit of Sessions is refused 429 with `Retry-After`. The runs route,
 * the Try it route and the tasks route share one count per manager.
 */
import { HttpError } from "../http/errors.js";
import type { SessionManager } from "../runtime/session-manager.js";

/** What admission reads of the manager. */
export type AdmissionManager = Pick<SessionManager, "statusOf" | "activeCountForAgent">;

const tooManyRuns = (limit: number): HttpError =>
  new HttpError(
    429,
    "too_many_runs",
    `This Agent already has ${limit} conversations running or starting; try again shortly.`,
    2,
  );

/**
 * Admission includes starts awaiting workspace checks, Session creation or loading. The public
 * and Try-it routes share their manager, so simultaneous requests cannot spend the same slot.
 * Once a reserved Session is running, the manager counts it and the reservation adds nothing.
 */
interface PendingStart {
  sessionId: string | undefined;
}
const pendingStarts = new WeakMap<AdmissionManager, Map<string, Set<PendingStart>>>();

export function reserveStart(
  deps: { manager: AdmissionManager },
  projectId: string,
  agentId: string,
  sessionId: string | undefined,
  limit: number,
) {
  // Decide before awaiting startTask: a busy Session must not become idle during that await
  // and start a new Task without ever acquiring capacity.
  if (sessionId !== undefined) {
    const status = deps.manager.statusOf(sessionId);
    if (status === "running")
      throw new HttpError(409, "task_in_progress", "This Session already has a Task in progress.");
    if (status === "compacting")
      throw new HttpError(
        409,
        "compacting",
        "This Session is compacting its context; not accepting new input.",
      );
  }
  const agent = `${projectId}/${agentId}`;
  let agents = pendingStarts.get(deps.manager);
  if (!agents) {
    agents = new Map();
    pendingStarts.set(deps.manager, agents);
  }
  const pending = agents.get(agent) ?? new Set<PendingStart>();
  if (sessionId !== undefined && [...pending].some((p) => p.sessionId === sessionId)) {
    throw new HttpError(409, "task_in_progress", "This Session already has a Task in progress.");
  }
  const starting = [...pending].filter(
    (p) => p.sessionId === undefined || deps.manager.statusOf(p.sessionId) === "idle",
  ).length;
  if (deps.manager.activeCountForAgent(projectId, agentId) + starting >= limit)
    throw tooManyRuns(limit);
  const reservation: PendingStart = { sessionId };
  pending.add(reservation);
  agents.set(agent, pending);
  return {
    reservation,
    release() {
      pending.delete(reservation);
      if (pending.size === 0) agents.delete(agent);
    },
  };
}
