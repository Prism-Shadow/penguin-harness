/**
 * The proposal routes, mounted by the harness's HTTP module at
 * `/api/projects/:projectId/organizations/:orgId/proposals` behind its cookie gate, so
 * `c.get("user")` is the signed-in user and `c.get("sessionVia")` says how they signed in.
 *
 *   GET    /                         the queue (each with the caller's unread count)
 *   POST   /                         delegate: { author, brief, title? }
 *   GET    /:number                  the proposal
 *   PUT    /:number                  publish a revision: { markdown }
 *   POST   /:number/ready | approve | reject { reason } | merged
 *   POST   /:number/implement        { agentId, message?, workspace? } → an implementation session
 *   POST   /:number/materials        { kind, url, label? }
 *   POST   /:number/feedback         { text, runtime? }
 *   POST   /:number/comments         { paragraphId, text } (pending)
 *   POST   /:number/comments/request send the caller's pending comments as one batch
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
import type { OrgActor } from "@prismshadow/penguin-server/plugin";
import type { ProposalMaterialKind } from "@prismshadow/penguin-server/api";
import { MATERIAL_KINDS, ProposalError, type ProposalService } from "./service.js";

/** The slot's contribution id, as the manifest names it. */
export const ROUTES_ID = "company-proposals.routes";

type SessionVia = "password" | "desktop" | "setup" | "token" | string;

/**
 * The body's `sessionId` is an identity claim — "this write comes from inside that Session"
 * — and the only credential that backs it is the boot's local API token, which the control
 * environment hands a Session's subprocesses. A cookie proves a person, not a session, so a
 * cookie-authenticated claim is dropped and the write is attributed to that person.
 */
function callerSessionId(via: SessionVia, body: Record<string, unknown>): string | undefined {
  const sessionId = body.sessionId;
  return via === "token" && typeof sessionId === "string" && sessionId !== ""
    ? sessionId
    : undefined;
}

/** Who performs this write; `agentId` is the same kind of claim as `sessionId`, backed by the same credential. */
function actorOf(
  c: Context,
  body: Record<string, unknown>,
  opts: { agentIdField?: string } = {},
): OrgActor {
  const user = c.get("user" as never) as { userId: string };
  const via = c.get("sessionVia" as never) as SessionVia;
  const sessionId = callerSessionId(via, body);
  const field = opts.agentIdField ?? "agentId";
  const raw = body[field];
  const agentId = via === "token" && typeof raw === "string" && raw !== "" ? raw : undefined;
  return {
    userId: user.userId,
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(agentId !== undefined ? { agentId } : {}),
  };
}

/** The same claim on a read, where `?sessionId=` / `?agentId=` carry it. */
function actorOfQuery(c: Context): OrgActor {
  const user = c.get("user" as never) as { userId: string };
  const via = c.get("sessionVia" as never) as SessionVia;
  const sessionId = c.req.query("sessionId");
  const agentId = c.req.query("agentId");
  return {
    userId: user.userId,
    ...(via === "token" && sessionId ? { sessionId } : {}),
    ...(via === "token" && agentId ? { agentId } : {}),
  };
}

async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ProposalError(400, "bad_request", "Body must be a JSON object.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ProposalError(400, "bad_request", "Body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

function requireString(body: Record<string, unknown>, key: string, maxLen = 20_000): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ProposalError(400, "bad_request", `${key} must be a non-empty string.`);
  }
  if (value.length > maxLen) {
    throw new ProposalError(400, "bad_request", `${key} is too long (max ${maxLen} characters).`);
  }
  return value;
}

function optionalString(
  body: Record<string, unknown>,
  key: string,
  maxLen = 4000,
): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string")
    throw new ProposalError(400, "bad_request", `${key} must be a string.`);
  if (value.length > maxLen) {
    throw new ProposalError(400, "bad_request", `${key} is too long (max ${maxLen} characters).`);
  }
  return value;
}

function numberParam(c: Context): number {
  const raw = c.req.param("number");
  const n = Number(raw);
  if (!/^\d+$/.test(raw ?? "") || !Number.isInteger(n) || n < 1) {
    throw new ProposalError(404, "proposal_not_found", `Proposal does not exist: ${raw}`);
  }
  return n;
}

function param(c: Context, name: "projectId" | "orgId"): string {
  const value = c.req.param(name);
  if (value === undefined || value === "") {
    throw new ProposalError(404, "org_not_found", `Missing ${name}.`);
  }
  return value;
}

export function proposalRoutes(service: ProposalService): Hono {
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
        author: requireString(body, "author", 64),
        brief: requireString(body, "brief"),
        ...(optionalString(body, "title", 200) !== undefined
          ? { title: optionalString(body, "title", 200) }
          : {}),
      },
      actorOf(c, body),
    );
    return c.json(created, 201);
  });

  app.get("/:number", async (c) =>
    c.json(
      await service.get(param(c, "projectId"), param(c, "orgId"), numberParam(c), actorOfQuery(c)),
    ),
  );

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
          agentId: requireString(body, "agentId", 64),
          ...(message !== undefined ? { message } : {}),
          ...(workspace !== undefined ? { workspace } : {}),
        },
        // `agentId` names the implementer here; the caller's own claim travels as `callerAgentId`.
        actorOf(c, body, { agentIdField: "callerAgentId" }),
      ),
      201,
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

  app.post("/:number/comments", async (c) => {
    const body = await jsonBody(c);
    return c.json(
      await service.comment(
        param(c, "projectId"),
        param(c, "orgId"),
        numberParam(c),
        { paragraphId: requireString(body, "paragraphId", 64), text: requireString(body, "text") },
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
