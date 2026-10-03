/**
 * The proposal routes, mounted by the harness's HTTP module at
 * `/api/projects/:projectId/organizations/:orgId/proposals` behind its cookie gate, so
 * `c.get("user")` is the signed-in user and `c.get("sessionVia")` says how they signed in.
 * They are the reads; every write is an Action (`POST …/actions/:key/runs`, action-routes.ts).
 *
 *   GET    /                         the queue (each with the caller's unread count)
 *   GET    /test-groups              the test groups a proposal may use, in order: { groups: [{ id, description }] }
 *   GET    /graph[?refresh=1]        the delivery repository's open PRs as a commit graph (graph-refresh.ts), with the deployments placed on it; refresh=1 waits for a refresh
 *   GET    /deployments              the deployment registry: the deployments registered, none by default (deployments.ts)
 *   GET    /:number                  the proposal
 *   GET    /:number/impl/diff        the impl branch's patch: merge base of base and head, up to head (read from GitHub)
 *   GET    /:number/revisions        every revision published: { revisions: [{ revision, by, at }] }
 *   GET    /:number/revisions/:rev   one revision as published (title, scope, sections)
 *   GET    /:number/file?path=       one file under the proposal's base, read-only (the page's file panel)
 *   GET    /:number/comments[?pending=1]  the comments (pending: batched, unresolved) with the text marked for an agent
 *   POST   /:number/read             { upTo } the caller's read position (a person's or an employee's) — not an Action
 *
 * Every route answers 404 while company mode is off, as the organization routes do. A read
 * from inside a Session carries `sessionId` / `agentId` as query parameters, honoured only
 * behind the local API token (route-input.ts).
 */
import { Hono } from "hono";
import { ProposalError, type ProposalService } from "./service.js";
import { ImplBranchError } from "./impl-branch.js";
import { actorOf, actorOfQuery, jsonBody, numberParam, param } from "./route-input.js";

/** The slot's contribution id, as the manifest names it. */
export const ROUTES_ID = "company-proposals.routes";

export function proposalRoutes(service: ProposalService): Hono {
  const app = new Hono();
  app.onError((err, c) => {
    if (err instanceof ProposalError || err instanceof ImplBranchError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status as 400);
    }
    console.error(`[company-proposals] ${err.stack ?? err.message}`);
    return c.json({ error: { code: "internal", message: "Internal server error." } }, 500);
  });

  app.get("/", async (c) =>
    c.json(await service.list(param(c, "projectId"), param(c, "orgId"), actorOfQuery(c))),
  );

  app.get("/test-groups", async (c) =>
    c.json(await service.listTestGroups(param(c, "projectId"), param(c, "orgId"), actorOfQuery(c))),
  );

  app.get("/graph", async (c) =>
    c.json(
      await service.graph(param(c, "projectId"), param(c, "orgId"), actorOfQuery(c), {
        refresh: c.req.query("refresh") === "1",
      }),
    ),
  );

  app.get("/deployments", async (c) =>
    c.json(await service.deployments(param(c, "projectId"), param(c, "orgId"), actorOfQuery(c))),
  );

  app.get("/:number", async (c) =>
    c.json(
      await service.get(param(c, "projectId"), param(c, "orgId"), numberParam(c), actorOfQuery(c)),
    ),
  );

  app.get("/:number/impl/diff", async (c) =>
    c.json(
      await service.implDiff(
        param(c, "projectId"),
        param(c, "orgId"),
        numberParam(c),
        actorOfQuery(c),
      ),
    ),
  );

  app.get("/:number/revisions", async (c) =>
    c.json(
      await service.revisions(
        param(c, "projectId"),
        param(c, "orgId"),
        numberParam(c),
        actorOfQuery(c),
      ),
    ),
  );

  app.get("/:number/revisions/:rev", async (c) => {
    const raw = c.req.param("rev");
    const rev = /^[1-9]\d{0,8}$/.test(raw ?? "") ? Number(raw) : null;
    if (rev === null) {
      throw new ProposalError(404, "revision_not_found", `Not a revision number: ${raw}`);
    }
    return c.json(
      await service.revision(
        param(c, "projectId"),
        param(c, "orgId"),
        numberParam(c),
        rev,
        actorOfQuery(c),
      ),
    );
  });

  app.get("/:number/file", async (c) =>
    c.json(
      await service.file(
        param(c, "projectId"),
        param(c, "orgId"),
        numberParam(c),
        c.req.query("path") ?? "",
        actorOfQuery(c),
      ),
    ),
  );

  app.get("/:number/comments", async (c) => {
    const pending = c.req.query("pending");
    return c.json(
      await service.comments(
        param(c, "projectId"),
        param(c, "orgId"),
        numberParam(c),
        { pending: pending === "1" || pending === "true" },
        actorOfQuery(c),
      ),
    );
  });

  app.post("/:number/read", async (c) => {
    const body = await jsonBody(c);
    const upTo = body.upTo;
    if (typeof upTo !== "number" || !Number.isInteger(upTo) || upTo < 0) {
      throw new ProposalError(400, "bad_request", "upTo must be a non-negative integer.");
    }
    await service.read(
      param(c, "projectId"),
      param(c, "orgId"),
      numberParam(c),
      upTo,
      actorOf(c, body),
    );
    return c.json({ ok: true });
  });

  return app;
}
