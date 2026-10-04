/**
 * The half of a run before it runs (action-registry.ts): the subject and the parameters checked,
 * the subject's state and commit read, the guard in force asked, the before hooks run — every
 * step that may refuse — and how the registry reads an error a run or a check threw.
 */
import type { ActionRunVia } from "@prismshadow/penguin-server/api";
import {
  ActionRefusal,
  parseSubject,
  type ActionCaller,
  type Guard,
  type HookEvent,
  type Subject,
  type SubjectCommit,
} from "./action-model.js";
import type { ActionIndex, IndexedAction } from "./action-index.js";
import type { RunStart } from "./action-store.js";
import { runningCount } from "./action-live.js";
import type { OrgScope, RunRequest } from "./action-registry.js";

/** What prepare hands the run. */
export interface Prepared {
  subject: Subject;
  params: Record<string, unknown>;
  guard: Guard;
  commit: SubjectCommit | null;
}

/** The registry's view of an error a run or a check threw. */
export interface Classified {
  outcome: "refused" | "failed";
  status: number;
  code: string;
  message: string;
}

export function hasStatus(err: unknown): err is { status: number; code: string; message: string } {
  const e = err as { status?: unknown; code?: unknown } | null;
  return (
    typeof e === "object" &&
    e !== null &&
    typeof e.status === "number" &&
    typeof e.code === "string"
  );
}

/**
 * How an error ends a run. One with a 4xx status and a code — a guard's or a hook's refusal, a
 * use case's domain error (`impl_pr_missing`, `proposal_body_links_files`), a check of the
 * registry — is a refusal, answered with its status and code. Anything else is a failure: one
 * with a 5xx status and a code (502 `branch_unreadable`, the forge not answering) is answered
 * with them, the rest 500. A `failed` run in the Activity means something broke, never that a
 * rule said no.
 */
export function classify(err: unknown): Classified {
  if (hasStatus(err)) {
    const refused = err.status >= 400 && err.status < 500;
    const own = refused || (err.status >= 500 && err.status < 600);
    return {
      outcome: refused ? "refused" : "failed",
      status: own ? err.status : 500,
      code: err.code,
      message: err.message,
    };
  }
  return { outcome: "failed", status: 500, code: "internal", message: "Internal error." };
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function viaOf(raw: unknown, caller: ActionCaller): ActionRunVia {
  if (caller.sessionId !== undefined) return "session";
  return raw === "web" || raw === "cli" ? raw : "api";
}

export function requestIdOf(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string" || raw === "" || raw.length > 128) {
    throw new ActionRefusal(400, "bad_request", "requestId must be a string of 1–128 characters.");
  }
  return raw;
}

/** What a hook is told about a run. */
export function eventOf(
  when: "before" | "after",
  action: IndexedAction,
  scope: OrgScope,
  start: RunStart,
  p: Pick<Prepared, "subject" | "params" | "commit">,
): HookEvent {
  return {
    when,
    key: action.key,
    contribution: action.id,
    runId: start.id,
    org: scope.org,
    caller: scope.caller,
    subject: p.subject,
    params: p.params,
    commit: p.commit,
  };
}

/** Steps 2–5 of a run, under the guard step 1 chose: everything that may refuse before it runs. */
export async function prepare(
  scope: OrgScope,
  index: ActionIndex,
  action: IndexedAction,
  guard: Guard,
  req: RunRequest,
  start: RunStart,
): Promise<Prepared> {
  const subject = parseSubject(req.subject);
  start.subjectKind = subject.kind;
  start.subject = subject.text;
  if (!action.subjects.includes(subject.kind)) {
    throw new ActionRefusal(
      400,
      "bad_subject",
      `${action.key} acts on ${action.subjects.join(", ") || "nothing"}, not ${subject.kind}.`,
    );
  }
  const params = action.params(req.params);
  start.params = params;
  const resolver = index.subjectOf(subject.kind);
  const subjectScope = { org: scope.org, caller: scope.caller };
  const state = resolver === undefined ? null : await resolver.code.state(subjectScope, subject);
  let commit: SubjectCommit | null = null;
  if (action.commit) {
    commit = (await resolver?.code.commit?.(subjectScope, subject)) ?? null;
    if (commit === null) {
      throw new ActionRefusal(409, "no_commit", `${subject.text} has no commit to run on.`);
    }
    start.commit = commit.sha;
    const expected = params.expectedHead;
    if (typeof expected === "string" && !commit.sha.startsWith(expected.toLowerCase())) {
      throw new ActionRefusal(
        409,
        "head_moved",
        `${subject.text} is at ${commit.sha.slice(0, 12)} now, not ${expected.slice(0, 12)}: look again before running ${action.key}.`,
      );
    }
  }
  const running = runningCount(scope.orgKey, action.key);
  guard({ caller: scope.caller, subject, state, params, running });
  for (const hook of index.hooksOf(action.key, "before")) {
    try {
      await hook.code(eventOf("before", action, scope, start, { subject, params, commit }));
    } catch (err) {
      if (hasStatus(err)) throw err;
      throw new ActionRefusal(
        409,
        "hook_refused",
        `${hook.id} refused: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return { subject, params, guard, commit };
}
