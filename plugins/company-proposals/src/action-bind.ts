/**
 * `action.bind`: the one Action the registry runs itself. It writes an organization's binding
 * of one contribution — on or off, a hook's position, the contribution's config — and the
 * binding's history is these runs. It is no contribution, so nothing replaces its guard, hooks
 * it or unbinds it: an organization cannot lock itself out of its own bindings. Its guard
 * allows any member of the organization.
 */
import { randomBytes } from "node:crypto";
import type { ActionRunVia } from "@prismshadow/penguin-server/api";
import { ActionRefusal, parseSubject } from "./action-model.js";
import { compileParams } from "./action-params.js";
import { hookCovers } from "./action-index.js";
import type { RunStart } from "./action-store.js";
import type { ActionRegistry, OrgScope, RunAnswer, RunRequest } from "./action-registry.js";
import { viewOf } from "./action-views.js";

export const BIND_KEY = "action.bind";
export const BIND_ID = "company-proposals.action.bind";

/** The parameters `action.bind` takes, declared like any Action's. */
export const BIND_PARAMS: Record<string, string> = {
  contribution: "string",
  enabled: "boolean",
  "position?": "number.integer",
  "config?": "object",
};

const bindParams = compileParams(BIND_PARAMS);

export function runBind(
  registry: ActionRegistry,
  scope: OrgScope,
  req: RunRequest,
  via: ActionRunVia,
  now: string,
): RunAnswer {
  const start: RunStart = {
    id: randomBytes(8).toString("hex"),
    key: BIND_KEY,
    contribution: BIND_ID,
    subjectKind: "organization",
    subject: typeof req.subject === "string" ? req.subject.slice(0, 400) : "",
    commit: null,
    params:
      typeof req.params === "object" && req.params !== null
        ? (req.params as Record<string, unknown>)
        : {},
    by: scope.caller.principal,
    via,
    sessionId: scope.caller.sessionId ?? null,
    requestId: null,
    startedAt: now,
  };
  const refuse = (err: ActionRefusal): never => {
    scope.store.end(start, {
      outcome: "refused",
      status: err.status,
      code: err.code,
      message: err.message,
      result: null,
      hookErrors: [],
      endedAt: now,
      output: null,
    });
    throw new ActionRefusal(err.status, err.code, err.message, { runId: start.id });
  };
  let params: Record<string, unknown>;
  try {
    const subject = parseSubject(req.subject ?? "organization");
    if (subject.kind !== "organization") {
      throw new ActionRefusal(400, "bad_subject", `${BIND_KEY} acts on the organization.`);
    }
    start.subject = subject.text;
    params = bindParams(req.params);
  } catch (err) {
    return refuse(err as ActionRefusal);
  }
  start.params = params;
  const id = params.contribution as string;
  const entry = registry.index.byId(id);
  if (entry === undefined) {
    return refuse(
      new ActionRefusal(
        404,
        "contribution_not_found",
        `No contribution ${id}: \`penguin org action ls --all\` lists them.`,
      ),
    );
  }
  if (entry.kind !== "subject" && hookCovers(entry.key, BIND_KEY)) {
    return refuse(
      new ActionRefusal(409, "bind_protected", `${BIND_KEY} is not replaced, hooked or unbound.`),
    );
  }
  const binding = {
    contribution: id,
    enabled: params.enabled as boolean,
    position: typeof params.position === "number" ? params.position : 0,
    config: (params.config as Record<string, unknown> | undefined) ?? {},
    by: scope.caller.principal,
  };
  const result = {
    contribution: id,
    enabled: binding.enabled,
    position: binding.position,
    config: binding.config,
  };
  scope.store.bind(binding, start, {
    outcome: "succeeded",
    status: 200,
    code: null,
    message: null,
    result,
    hookErrors: [],
    output: null,
  });
  const stored = scope.store.get(start.id);
  return { status: 200, run: viewOf(stored ?? { ...start, end: null }), result };
}
