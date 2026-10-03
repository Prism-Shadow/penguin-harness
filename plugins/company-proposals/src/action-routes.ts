/**
 * The Action routes, mounted by the harness's HTTP module at
 * `/api/projects/:projectId/organizations/:orgId/actions` behind its cookie gate: every write to
 * the organization's proposals and roadmaps, and the Activity.
 *
 *   GET    /[?subject=]                     the Actions in force; with a subject, those acting
 *                                           on it, each with whether the caller may run it now
 *   GET    /contributions                   every contribution, built in or a company workflow's
 *   GET    /check                           the keys two contributions of one standing answer
 *   GET    /runs[?subject=&by=&key=&before=&limit=]  the Activity, newest first
 *   GET    /runs/:id[?from=]                one run, and its process output from an offset
 *   POST   /:key/runs                       { subject, params?, requestId?, via? } run the Action
 *                                           the key resolves to → { run, result } (200), or
 *                                           (202) while a process it started runs
 *   POST   /by-id/:contribution/runs        the same, naming the contribution exactly
 *
 * A refused or failed run answers `{ error: { code, message, runId } }` with the run's status;
 * an ambiguous key's adds `contributions`, each with its exact invocation. A run from inside a
 * Session carries `sessionId` / `agentId` in the body, honoured only behind the local API
 * token (route-input.ts).
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { ActionRefusal } from "./action-model.js";
import type { ActionRegistry, RunRequest } from "./action-registry.js";
import {
  checkConflicts,
  getRun,
  listActions,
  listContributions,
  listRuns,
} from "./action-views.js";
import { actorOf, actorOfQuery, jsonBody, param } from "./route-input.js";

/** The slot's contribution id, as the manifest names it. */
export const ACTION_ROUTES_ID = "company-proposals.action-routes";

/** A refusal answers its status, code and details; anything else is a 500. */
export function refusalHandler(err: Error, c: Context): Response {
  const e = err as Partial<ActionRefusal>;
  if (typeof e.status === "number" && typeof e.code === "string") {
    return c.json(
      { error: { code: e.code, message: err.message, ...(e.details ?? {}) } },
      e.status as 400,
    );
  }
  console.error(`[company-actions] ${err.stack ?? err.message}`);
  return c.json({ error: { code: "internal", message: "Internal server error." } }, 500);
}

export function actionRoutes(registry: ActionRegistry): Hono {
  const app = new Hono();
  app.onError(refusalHandler);

  app.get("/", async (c) =>
    c.json(
      await listActions(
        registry,
        param(c, "projectId"),
        param(c, "orgId"),
        actorOfQuery(c),
        c.req.query("subject") || undefined,
      ),
    ),
  );

  app.get("/contributions", async (c) =>
    c.json(
      await listContributions(registry, param(c, "projectId"), param(c, "orgId"), actorOfQuery(c)),
    ),
  );

  app.get("/check", async (c) =>
    c.json(
      await checkConflicts(registry, param(c, "projectId"), param(c, "orgId"), actorOfQuery(c)),
    ),
  );

  app.get("/runs", async (c) => {
    const q = (name: string) => c.req.query(name) || undefined;
    return c.json(
      await listRuns(registry, param(c, "projectId"), param(c, "orgId"), actorOfQuery(c), {
        ...(q("subject") ? { subject: q("subject") } : {}),
        ...(q("by") ? { by: q("by") } : {}),
        ...(q("key") ? { key: q("key") } : {}),
        ...(q("before") ? { before: q("before") } : {}),
        ...(q("limit") ? { limit: q("limit") } : {}),
      }),
    );
  });

  app.get("/runs/:id", async (c) => {
    const raw = c.req.query("from");
    const from = raw === undefined ? 0 : Number(raw);
    if (!Number.isInteger(from) || from < 0) {
      throw new ActionRefusal(400, "bad_request", "from must be a non-negative integer.");
    }
    return c.json(
      await getRun(
        registry,
        param(c, "projectId"),
        param(c, "orgId"),
        actorOfQuery(c),
        c.req.param("id"),
        from,
      ),
    );
  });

  const run = async (c: Context, target: Pick<RunRequest, "key" | "contribution">) => {
    const body = await jsonBody(c);
    const answer = await registry.run(param(c, "projectId"), param(c, "orgId"), actorOf(c, body), {
      ...target,
      subject: body.subject,
      params: body.params,
      requestId: body.requestId,
      via: body.via,
    });
    return c.json({ run: answer.run, result: answer.result }, answer.status);
  };

  app.post("/by-id/:contribution/runs", (c) =>
    run(c, { contribution: c.req.param("contribution") }),
  );
  app.post("/:key/runs", (c) => run(c, { key: c.req.param("key") }));

  return app;
}
