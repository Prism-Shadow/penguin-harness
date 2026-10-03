/**
 * The roadmap routes, mounted by the harness's HTTP module at
 * `/api/projects/:projectId/organizations/:orgId/roadmaps` behind its cookie gate. They are the
 * reads; every write is a roadmap Action, run through company-proposals' Action registry
 * (`POST …/actions/:key/runs`, builtin-actions.ts).
 *
 *   GET    /[?channel=&status=]      the roadmaps (a room's, for the channel page's side panel)
 *   GET    /:number                  one roadmap: record, body, items, delegations, room sessions, events
 *
 * Every route answers 404 while company mode is off. A read from inside a Session carries
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

  app.get("/:number", async (c) => {
    const [p, o] = orgOf(c);
    return c.json(await service.get(p, o, numberParam(c), actorOfQuery(c)));
  });

  return app;
}
