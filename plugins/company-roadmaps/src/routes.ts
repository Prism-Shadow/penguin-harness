/**
 * The roadmap routes, mounted by the harness's HTTP module at
 * `/api/projects/:projectId/organizations/:orgId/roadmaps` behind its cookie gate.
 *
 *   GET    /[?channel=&status=]      the roadmaps (a room's, for the channel page's side panel)
 *   POST   /                         open one (a person): { name, channelId, employees, brief?, parent? }
 *   GET    /:number                  one roadmap: record, body, items, delegations, room sessions, events
 *   PATCH  /:number                  { name } rename (a person or the moderator)
 *   PUT    /:number/draft            { record?, body?, items? } (a person or the moderator; while discussing)
 *   POST   /:number/establish        archive it and delegate every item (a person or the moderator)
 *   POST   /:number/items/:key/link  { proposal } the owner links the proposal it created
 *   POST   /:number/reopen           { reason } an owner, an employee of the room, or a person
 *   POST   /:number/room             { channelId } bind the room of a derived roadmap
 *   POST   /:number/archive | /unarchive
 *
 * Every route answers 404 while company mode is off. A write from inside a Session carries
 * `sessionId` / `agentId`, honoured only behind the local API token — the rule the
 * organization routes and company-proposals follow.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { OrgActor } from "@prismshadow/penguin-server/plugin";
import { RoadmapError, type RoadmapService } from "./service.js";

/** The slot's contribution id, as the manifest names it. */
export const ROUTES_ID = "company-roadmaps.routes";

/** Who performs this request: the person, plus the Session's claims when the local API token backs them. */
function actorOf(c: Context, claims: Record<string, unknown>): OrgActor {
  const user = c.get("user" as never) as { userId: string };
  const token = (c.get("sessionVia" as never) as string) === "token";
  const sessionId = claims.sessionId;
  const agentId = claims.agentId;
  return {
    userId: user.userId,
    ...(token && typeof sessionId === "string" && sessionId !== "" ? { sessionId } : {}),
    ...(token && typeof agentId === "string" && agentId !== "" ? { agentId } : {}),
  };
}

function actorOfQuery(c: Context): OrgActor {
  return actorOf(c, { sessionId: c.req.query("sessionId"), agentId: c.req.query("agentId") });
}

async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new RoadmapError(400, "bad_request", "Body must be a JSON object.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new RoadmapError(400, "bad_request", "Body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

function numberParam(c: Context): number {
  const raw = c.req.param("number") ?? "";
  if (!/^\d+$/.test(raw) || Number(raw) < 1) {
    throw new RoadmapError(404, "roadmap_not_found", `No roadmap ${raw}.`);
  }
  return Number(raw);
}

function orgOf(c: Context): [string, string] {
  const projectId = c.req.param("projectId");
  const orgId = c.req.param("orgId");
  if (!projectId || !orgId) throw new RoadmapError(404, "org_not_found", "Missing organization.");
  return [projectId, orgId];
}

export function roadmapRoutes(service: RoadmapService): Hono {
  const app = new Hono();
  app.onError((err, c) => {
    if (err instanceof RoadmapError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status as 400);
    }
    console.error(`[company-roadmaps] ${err.stack ?? err.message}`);
    return c.json({ error: { code: "internal", message: "Internal error." } }, 500);
  });

  app.get("/", async (c) => {
    const [p, o] = orgOf(c);
    const channel = c.req.query("channel");
    const status = c.req.query("status");
    return c.json(
      await service.list(p, o, actorOfQuery(c), {
        ...(channel ? { channel } : {}),
        ...(status ? { status } : {}),
      }),
    );
  });

  app.post("/", async (c) => {
    const [p, o] = orgOf(c);
    const body = await jsonBody(c);
    const parent = body.parent;
    if (parent !== undefined && (typeof parent !== "number" || !Number.isInteger(parent))) {
      throw new RoadmapError(400, "bad_request", "parent must be a roadmap number.");
    }
    if (body.brief !== undefined && typeof body.brief !== "string") {
      throw new RoadmapError(400, "bad_request", "brief must be a string.");
    }
    return c.json(
      await service.create(
        p,
        o,
        {
          name: body.name as string,
          channelId: body.channelId as string,
          employees: body.employees as string[],
          ...(typeof body.brief === "string" ? { brief: body.brief } : {}),
          ...(parent !== undefined ? { parent: parent as number } : {}),
        },
        actorOf(c, body),
      ),
      201,
    );
  });

  app.get("/:number", async (c) => {
    const [p, o] = orgOf(c);
    return c.json(await service.get(p, o, numberParam(c), actorOfQuery(c)));
  });

  app.patch("/:number", async (c) => {
    const [p, o] = orgOf(c);
    const body = await jsonBody(c);
    return c.json(await service.rename(p, o, numberParam(c), body.name, actorOf(c, body)));
  });

  app.put("/:number/draft", async (c) => {
    const [p, o] = orgOf(c);
    const body = await jsonBody(c);
    return c.json(
      await service.draft(
        p,
        o,
        numberParam(c),
        {
          ...(body.record !== undefined ? { record: body.record as string } : {}),
          ...(body.body !== undefined ? { body: body.body as string } : {}),
          ...(body.items !== undefined ? { items: body.items } : {}),
        },
        actorOf(c, body),
      ),
    );
  });

  app.post("/:number/establish", async (c) => {
    const [p, o] = orgOf(c);
    const body = await jsonBody(c);
    return c.json(await service.establish(p, o, numberParam(c), actorOf(c, body)));
  });

  app.post("/:number/items/:key/link", async (c) => {
    const [p, o] = orgOf(c);
    const body = await jsonBody(c);
    const key = c.req.param("key") ?? "";
    return c.json(await service.link(p, o, numberParam(c), key, body.proposal, actorOf(c, body)));
  });

  app.post("/:number/reopen", async (c) => {
    const [p, o] = orgOf(c);
    const body = await jsonBody(c);
    return c.json(await service.reopen(p, o, numberParam(c), body.reason, actorOf(c, body)));
  });

  app.post("/:number/room", async (c) => {
    const [p, o] = orgOf(c);
    const body = await jsonBody(c);
    return c.json(await service.bindRoom(p, o, numberParam(c), body.channelId, actorOf(c, body)));
  });

  app.post("/:number/archive", async (c) => {
    const [p, o] = orgOf(c);
    const body = await jsonBody(c);
    return c.json(await service.setArchived(p, o, numberParam(c), true, actorOf(c, body)));
  });

  app.post("/:number/unarchive", async (c) => {
    const [p, o] = orgOf(c);
    const body = await jsonBody(c);
    return c.json(await service.setArchived(p, o, numberParam(c), false, actorOf(c, body)));
  });

  return app;
}
