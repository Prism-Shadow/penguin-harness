/**
 * The registry's reads: the Actions bound in an organization (with the guard's answer for the
 * caller on a subject), every contribution with its binding, the conflicts, and the Activity —
 * the ActionRuns, newest first, one page at a time.
 */
import type { OrgActor } from "@prismshadow/penguin-server/plugin";
import type {
  ActionCheckResponse,
  ActionContributionsResponse,
  ActionRunResponse,
  ActionRunView,
  ActionRunsResponse,
  ActionView,
  ActionsResponse,
} from "@prismshadow/penguin-server/api";
import { ActionRefusal, parseSubject } from "./action-model.js";
import type { StoredRun } from "./action-store.js";
import { liveRuns, outputFrom, runningCount } from "./action-live.js";
import type { ActionRegistry } from "./action-registry.js";

export function viewOf(r: StoredRun): ActionRunView {
  return {
    id: r.id,
    key: r.key,
    contribution: r.contribution,
    subjectKind: r.subjectKind,
    subject: r.subject,
    commit: r.commit,
    params: r.params,
    by: r.by,
    via: r.via,
    sessionId: r.sessionId,
    requestId: r.requestId,
    startedAt: r.startedAt,
    outcome: r.end?.outcome ?? null,
    status: r.end?.status ?? null,
    code: r.end?.code ?? null,
    message: r.end?.message ?? null,
    result: r.end?.result ?? null,
    hookErrors: r.end?.hookErrors ?? [],
    endedAt: r.end?.endedAt ?? null,
  };
}

/**
 * The bound Actions; with a subject, those acting on its kind, each with the guard's answer for
 * the caller as the subject stands now (no parameters: a guard that reads one only checks it
 * when it is given). This is what a page shows a button for — it does not repeat the rules.
 */
export async function listActions(
  registry: ActionRegistry,
  projectId: string,
  orgId: string,
  actor: OrgActor,
  subjectText: string | undefined,
): Promise<ActionsResponse> {
  const scope = await registry.scope(projectId, orgId, actor);
  const bindings = registry.bindingsOf(scope.store);
  const subject = subjectText === undefined ? null : parseSubject(subjectText);
  const actions = registry.index
    .actions(bindings)
    .filter((a) => subject === null || a.subjects.includes(subject.kind));
  let state: unknown = null;
  if (subject !== null) {
    const resolver = registry.index.subjectOf(subject.kind, bindings);
    if (resolver !== undefined) {
      state = await resolver.code.state({ org: scope.org, caller: scope.caller }, subject);
    }
  }
  const out: ActionView[] = [];
  for (const a of actions) {
    const view: ActionView = {
      key: a.key,
      contribution: a.id,
      subjects: a.subjects,
      params: a.paramsDecl,
      description: a.description,
      builtin: a.builtin,
    };
    if (subject !== null) {
      try {
        registry.index.guardOf(
          a,
          bindings,
        )({
          caller: scope.caller,
          subject,
          state,
          params: {},
          config: bindings(a).config,
          running: runningCount(scope.orgKey, a.key),
        });
        view.allowed = true;
      } catch (err) {
        const e = err as { status?: unknown; code?: unknown; message?: unknown };
        view.allowed = false;
        view.refusal = {
          status: typeof e.status === "number" ? e.status : 500,
          code: typeof e.code === "string" ? e.code : "internal",
          message: typeof e.message === "string" ? e.message : "",
        };
      }
    }
    out.push(view);
  }
  return { actions: out.sort((x, y) => x.key.localeCompare(y.key)) };
}

export async function listContributions(
  registry: ActionRegistry,
  projectId: string,
  orgId: string,
  actor: OrgActor,
): Promise<ActionContributionsResponse> {
  const scope = await registry.scope(projectId, orgId, actor);
  const bindings = registry.bindingsOf(scope.store);
  return {
    contributions: registry.index.entries.map((e) => {
      const b = bindings(e);
      return {
        id: e.id,
        kind: e.kind,
        key: e.kind === "subject" ? null : e.key,
        from: e.from,
        builtin: e.builtin,
        enabled: b.enabled,
        position: b.position,
        config: b.config,
        subjects: e.kind === "action" || e.kind === "subject" ? e.subjects : [],
        when: e.kind === "hook" ? e.when : null,
        description: e.kind === "action" ? e.description : "",
      };
    }),
    skipped: [...registry.index.skipped],
  };
}

export async function checkConflicts(
  registry: ActionRegistry,
  projectId: string,
  orgId: string,
  actor: OrgActor,
): Promise<ActionCheckResponse> {
  const scope = await registry.scope(projectId, orgId, actor);
  return {
    conflicts: registry.index.conflicts(registry.bindingsOf(scope.store)),
    skipped: [...registry.index.skipped],
  };
}

const MAX_PAGE = 200;

/** One page of the Activity. */
export async function listRuns(
  registry: ActionRegistry,
  projectId: string,
  orgId: string,
  actor: OrgActor,
  q: { subject?: string; by?: string; key?: string; before?: string; limit?: string },
): Promise<ActionRunsResponse> {
  const scope = await registry.scope(projectId, orgId, actor);
  const raw = q.limit === undefined ? 50 : Number(q.limit);
  if (!Number.isInteger(raw) || raw < 1 || raw > MAX_PAGE) {
    throw new ActionRefusal(400, "bad_request", `limit must be 1–${MAX_PAGE}.`);
  }
  const runs = scope.store.list({
    ...(q.subject ? { subject: q.subject } : {}),
    ...(q.by ? { by: q.by } : {}),
    ...(q.key ? { key: q.key } : {}),
    ...(q.before ? { before: q.before } : {}),
    limit: raw,
  });
  const last = runs.at(-1);
  return {
    runs: runs.map(viewOf),
    next: runs.length === raw && last !== undefined ? `${last.startedAt}|${last.id}` : null,
  };
}

/** One run, and its output from `from`: a live run's from memory, an ended one's from its end row. */
export async function getRun(
  registry: ActionRegistry,
  projectId: string,
  orgId: string,
  actor: OrgActor,
  id: string,
  from: number,
): Promise<ActionRunResponse> {
  const scope = await registry.scope(projectId, orgId, actor);
  const stored = scope.store.get(id);
  const live = liveRuns().get(id);
  if (stored === null && (live === undefined || live.orgKey !== scope.orgKey)) {
    throw new ActionRefusal(404, "run_not_found", `No run ${id} in this organization.`);
  }
  const run = stored ?? { ...live!.start, end: null };
  if (run.end === null && live !== undefined) {
    return { run: viewOf(run), ...outputFrom(live, from) };
  }
  return { run: viewOf(run), ...outputFrom({ output: run.end?.output ?? "", dropped: 0 }, from) };
}
