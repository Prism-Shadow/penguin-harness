/**
 * The proposal routes, mounted by the harness's HTTP module at
 * `/api/projects/:projectId/organizations/:orgId/proposals` behind its cookie gate, so
 * `c.get("user")` is the signed-in user and `c.get("sessionVia")` says how they signed in.
 *
 *   GET    /                         the queue (each with the caller's unread count)
 *   POST   /                         start one: { author, brief, title? } (a person; an employee gets 403 roadmap_only —
 *                                   its new proposals come from approved roadmap items)
 *   GET    /test-groups              the test groups a proposal may use, in order: { groups: [{ id, description }] }
 *   GET    /graph                    the delivery repository's open PRs as a commit graph (pr-graph.ts), with the servers placed on it
 *   GET    /servers                  the server registry, `this` first (servers.ts)
 *   POST   /servers                  anybody in the organization registers one: { name, url }; a repeat is 409 server_registered
 *   GET    /deploy-scripts           the organization's deploy scripts (deploy-routes.ts)
 *   POST   /deploy-scripts           { id, command[], description? } register one (a person who is a server admin)
 *   DELETE /deploy-scripts/:id       remove one (a person who is a server admin)
 *   POST   /deploys                  { script, proposal | pr, head?, args?, dryRun? } run a script on a PR head (anybody in the organization)
 *   GET    /deploys/:id?from=        a run and its output from an offset
 *   POST   /adopt-impl               anybody in the organization: proposals without an impl PR take their latest delivery-repo `pr` material
 *   GET    /:number                  the proposal
 *   PUT    /:number/impl             { url } the impl PR (anybody in the organization; one per proposal)
 *   GET    /:number/revisions        every revision published: { revisions: [{ revision, by, at }] }
 *   GET    /:number/revisions/:rev   one revision as published (title, scope, sections)
 *   GET    /:number/file?path=       one file under the proposal's base, read-only (the page's file panel)
 *   PUT    /:number                  publish a revision: { markdown }
 *   PUT    /:number/brief            rewrite the brief: { brief } (the author or a person; the revisions stay)
 *   POST   /:number/ready | approve | reject { reason } | merged   (reject: a person or any employee;
 *                                   merged: a person, the implementer, or any employee once the impl PR is merged into its default branch)
 *   POST   /:number/implement        { agentId?, message?, workspace? } → an implementation session (default: the author's own)
 *   POST   /:number/discussions      a person opens a discussion with the owner (implementer, else author) → its session
 *   POST   /:number/discussions/:sessionId/conclude { text }  the conclusion, to the owner's desk (a person, or that session)
 *   POST   /:number/materials        { kind, url, label? }
 *   POST   /:number/feedback         { text, runtime? }
 *   GET    /:number/comments[?pending=1]  the comments (pending: batched, unresolved) with the text marked for an agent
 *   POST   /:number/comments         { sectionId, start, end, quote, text } (pending)
 *   POST   /:number/comments/request send the caller's pending comments as one batch
 *   PATCH  /:number/comments/:id     { text }   reword a pending comment (its writer only)
 *   DELETE /:number/comments/:id                withdraw a pending comment (its writer only)
 *   POST   /:number/comments/:id/resolve { text? }
 *   POST   /:number/read             { upTo }
 *
 * Every route answers 404 while company mode is off, as the organization routes do. A
 * write coming from inside a Session carries `sessionId` / `agentId`, which the service
 * attributes to the employee — under the same rule as the organization routes: the claim
 * is honoured only behind the local API token (see callerSessionId).
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { ProposalMaterialKind } from "@prismshadow/penguin-server/api";
import { MATERIAL_KINDS, ProposalError, type ProposalService } from "./service.js";
import type { DeployService } from "./deploy.js";
import { deployRoutes } from "./deploy-routes.js";
import {
  actorOf,
  actorOfQuery,
  jsonBody,
  numberParam,
  optionalString,
  param,
  requireString,
} from "./route-input.js";

/** The slot's contribution id, as the manifest names it. */
export const ROUTES_ID = "company-proposals.routes";

/** The address the caller reached this server by: how the registry reads `this` (servers.ts). */
function selfUrlOf(c: Context): string {
  return new URL(c.req.url).origin;
}

export function proposalRoutes(service: ProposalService, deploys: DeployService): Hono {
  const app = new Hono();
  app.onError((err, c) => {
    if (err instanceof ProposalError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status as 400);
    }
    console.error(`[company-proposals] ${err.stack ?? err.message}`);
    return c.json({ error: { code: "internal", message: "Internal server error." } }, 500);
  });

  app.get("/", async (c) =>
    c.json(await service.list(param(c, "projectId"), param(c, "orgId"), actorOfQuery(c))),
  );

  app.post("/", async (c) => {
    const body = await jsonBody(c);
    const created = await service.create(
      param(c, "projectId"),
      param(c, "orgId"),
      {
        ...(optionalString(body, "author", 64) !== undefined
          ? { author: optionalString(body, "author", 64) }
          : {}),
        brief: requireString(body, "brief"),
        ...(optionalString(body, "title", 200) !== undefined
          ? { title: optionalString(body, "title", 200) }
          : {}),
      },
      actorOf(c, body),
    );
    return c.json(created, 201);
  });

  app.get("/test-groups", async (c) =>
    c.json(await service.listTestGroups(param(c, "projectId"), param(c, "orgId"), actorOfQuery(c))),
  );

  app.get("/graph", async (c) =>
    c.json(
      await service.graph(param(c, "projectId"), param(c, "orgId"), selfUrlOf(c), actorOfQuery(c)),
    ),
  );

  app.get("/servers", async (c) =>
    c.json(
      await service.servers(
        param(c, "projectId"),
        param(c, "orgId"),
        selfUrlOf(c),
        actorOfQuery(c),
      ),
    ),
  );

  app.post("/servers", async (c) => {
    const body = await jsonBody(c);
    const req = { name: String(body.name ?? ""), url: String(body.url ?? "") };
    return c.json(
      await service.registerServer(
        param(c, "projectId"),
        param(c, "orgId"),
        req,
        selfUrlOf(c),
        actorOf(c, body),
      ),
    );
  });

  app.post("/adopt-impl", async (c) => {
    const body = await jsonBody(c).catch(() => ({}) as Record<string, unknown>);
    return c.json(
      await service.adoptImpl(param(c, "projectId"), param(c, "orgId"), actorOf(c, body)),
    );
  });

  // Before `/:number`, which would otherwise take `deploy-scripts` and `deploys` for a number.
  app.route("/", deployRoutes(deploys));

  app.get("/:number", async (c) =>
    c.json(
      await service.get(param(c, "projectId"), param(c, "orgId"), numberParam(c), actorOfQuery(c)),
    ),
  );

  app.put("/:number/impl", async (c) => {
    const body = await jsonBody(c);
    return c.json(
      await service.setImpl(
        param(c, "projectId"),
        param(c, "orgId"),
        numberParam(c),
        requireString(body, "url", 2000),
        actorOf(c, body),
      ),
    );
  });

  app.put("/:number", async (c) => {
    const body = await jsonBody(c);
    return c.json(
      await service.publish(
        param(c, "projectId"),
        param(c, "orgId"),
        numberParam(c),
        requireString(body, "markdown", 200_000),
        actorOf(c, body),
      ),
    );
  });

  app.put("/:number/brief", async (c) => {
    const body = await jsonBody(c);
    return c.json(
      await service.editBrief(
        param(c, "projectId"),
        param(c, "orgId"),
        numberParam(c),
        requireString(body, "brief"),
        actorOf(c, body),
      ),
    );
  });

  app.post("/:number/ready", async (c) => {
    const body = await jsonBody(c).catch(() => ({}) as Record<string, unknown>);
    return c.json(
      await service.ready(
        param(c, "projectId"),
        param(c, "orgId"),
        numberParam(c),
        actorOf(c, body),
      ),
    );
  });

  app.post("/:number/approve", async (c) => {
    const body = await jsonBody(c).catch(() => ({}) as Record<string, unknown>);
    return c.json(
      await service.approve(
        param(c, "projectId"),
        param(c, "orgId"),
        numberParam(c),
        actorOf(c, body),
      ),
    );
  });

  app.post("/:number/reject", async (c) => {
    const body = await jsonBody(c);
    return c.json(
      await service.reject(
        param(c, "projectId"),
        param(c, "orgId"),
        numberParam(c),
        requireString(body, "reason", 4000),
        actorOf(c, body),
      ),
    );
  });

  app.post("/:number/merged", async (c) => {
    const body = await jsonBody(c).catch(() => ({}) as Record<string, unknown>);
    return c.json(
      await service.merged(
        param(c, "projectId"),
        param(c, "orgId"),
        numberParam(c),
        actorOf(c, body),
      ),
    );
  });

  app.post("/:number/implement", async (c) => {
    const body = await jsonBody(c);
    const message = optionalString(body, "message");
    const workspace = optionalString(body, "workspace", 1000);
    return c.json(
      await service.implement(
        param(c, "projectId"),
        param(c, "orgId"),
        numberParam(c),
        {
          ...(optionalString(body, "agentId", 64) !== undefined
            ? { agentId: optionalString(body, "agentId", 64) }
            : {}),
          ...(message !== undefined ? { message } : {}),
          ...(workspace !== undefined ? { workspace } : {}),
        },
        // `agentId` names the implementer here; the caller's own claim travels as `callerAgentId`.
        actorOf(c, body, { agentIdField: "callerAgentId" }),
      ),
      201,
    );
  });

  app.post("/:number/discussions", async (c) => {
    const body = await jsonBody(c).catch(() => ({}) as Record<string, unknown>);
    return c.json(
      await service.discuss(
        param(c, "projectId"),
        param(c, "orgId"),
        numberParam(c),
        actorOf(c, body),
      ),
      201,
    );
  });

  app.post("/:number/discussions/:sessionId/conclude", async (c) => {
    const body = await jsonBody(c);
    const sessionId = c.req.param("sessionId");
    if (sessionId === undefined || sessionId === "") {
      throw new ProposalError(404, "discussion_not_found", "Missing discussion session id.");
    }
    return c.json(
      await service.conclude(
        param(c, "projectId"),
        param(c, "orgId"),
        numberParam(c),
        sessionId,
        requireString(body, "text", 20000),
        actorOf(c, body),
      ),
    );
  });

  app.post("/:number/materials", async (c) => {
    const body = await jsonBody(c);
    const kind = requireString(body, "kind", 16) as ProposalMaterialKind;
    if (!MATERIAL_KINDS.includes(kind)) {
      throw new ProposalError(
        400,
        "bad_request",
        `kind must be one of ${MATERIAL_KINDS.join(", ")}.`,
      );
    }
    const label = optionalString(body, "label", 200);
    return c.json(
      await service.addMaterial(
        param(c, "projectId"),
        param(c, "orgId"),
        numberParam(c),
        { kind, url: requireString(body, "url", 2000), ...(label !== undefined ? { label } : {}) },
        actorOf(c, body),
      ),
    );
  });

  app.post("/:number/feedback", async (c) => {
    const body = await jsonBody(c);
    const runtime = body.runtime;
    if (runtime !== undefined && typeof runtime !== "boolean") {
      throw new ProposalError(400, "bad_request", "runtime must be a boolean.");
    }
    return c.json(
      await service.feedback(
        param(c, "projectId"),
        param(c, "orgId"),
        numberParam(c),
        { text: requireString(body, "text"), ...(runtime !== undefined ? { runtime } : {}) },
        actorOf(c, body),
      ),
    );
  });

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

  app.post("/:number/comments", async (c) => {
    const body = await jsonBody(c);
    const offset = (key: "start" | "end"): number => {
      const value = body[key];
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        throw new ProposalError(400, "bad_request", `${key} must be a non-negative integer.`);
      }
      return value;
    };
    return c.json(
      await service.comment(
        param(c, "projectId"),
        param(c, "orgId"),
        numberParam(c),
        {
          sectionId: requireString(body, "sectionId", 64),
          start: offset("start"),
          end: offset("end"),
          quote: requireString(body, "quote"),
          text: requireString(body, "text"),
        },
        actorOf(c, body),
      ),
    );
  });

  app.post("/:number/comments/request", async (c) => {
    const body = await jsonBody(c).catch(() => ({}) as Record<string, unknown>);
    return c.json(
      await service.requestChanges(
        param(c, "projectId"),
        param(c, "orgId"),
        numberParam(c),
        actorOf(c, body),
      ),
    );
  });

  app.patch("/:number/comments/:id", async (c) => {
    const body = await jsonBody(c);
    const commentId = c.req.param("id");
    if (commentId === undefined || commentId === "") {
      throw new ProposalError(404, "comment_not_found", "Missing comment id.");
    }
    return c.json(
      await service.editComment(
        param(c, "projectId"),
        param(c, "orgId"),
        numberParam(c),
        commentId,
        requireString(body, "text"),
        actorOf(c, body),
      ),
    );
  });

  app.delete("/:number/comments/:id", async (c) => {
    const body = await jsonBody(c).catch(() => ({}) as Record<string, unknown>);
    const commentId = c.req.param("id");
    if (commentId === undefined || commentId === "") {
      throw new ProposalError(404, "comment_not_found", "Missing comment id.");
    }
    return c.json(
      await service.deleteComment(
        param(c, "projectId"),
        param(c, "orgId"),
        numberParam(c),
        commentId,
        actorOf(c, body),
      ),
    );
  });

  app.post("/:number/comments/:id/resolve", async (c) => {
    const body = await jsonBody(c).catch(() => ({}) as Record<string, unknown>);
    const commentId = c.req.param("id");
    if (commentId === undefined || commentId === "") {
      throw new ProposalError(404, "comment_not_found", "Missing comment id.");
    }
    return c.json(
      await service.resolve(
        param(c, "projectId"),
        param(c, "orgId"),
        numberParam(c),
        commentId,
        optionalString(body, "text"),
        actorOf(c, body),
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
