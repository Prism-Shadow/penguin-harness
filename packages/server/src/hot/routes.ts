/**
 * /api/hot/*: the hot-platform demo surface (admin-only).
 *
 * The freeze middleware is the runtime half of the stop-the-world protocol:
 * while a swap is in flight every hot API answers 503 + Retry-After. The
 * routes themselves are runtime code — they only orchestrate through the
 * platform api and the keyed handles, so they survive impl swaps unchanged.
 */
import { Hono } from "hono";
import type { Json } from "@prismshadow/penguin-core/kernel";
import { ifaceData } from "@prismshadow/penguin-core/kernel";
import type { AppDeps } from "../app.js";
import type { AppEnv } from "../auth/middleware.js";
import { errorBody, HttpError } from "../http/errors.js";
import type { AgentSlotCtx } from "./agent-slot.js";
import type { TerminalApiV2 } from "./terminal.js";
import type { ShellProcResource } from "./resources.js";

export function hotRoutes(deps: AppDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const hot = deps.hot;

  routes.use("*", async (c, next) => {
    if (!c.get("user").isAdmin) {
      throw new HttpError(403, "forbidden", "Hot platform APIs are admin-only.");
    }
    if (hot.frozen && !c.req.path.endsWith("/platform/upgrade")) {
      return c.json(errorBody("platform_upgrading", "Platform upgrade in progress."), 503, {
        "Retry-After": "1",
      });
    }
    await next();
  });

  // -- Platform ------------------------------------------------------------

  routes.get("/platform", async (c) => {
    const inst = await hot.ensure();
    return c.json({
      impl: hot.currentImplId(),
      iface: ifaceData(inst.iface),
      info: inst.api.info(),
    });
  });

  /** Observability: the current parked document (what an upgrade would carry). */
  routes.get("/platform/park", async (c) => {
    const inst = await hot.ensure();
    return c.json(inst.park());
  });

  routes.post("/platform/upgrade", async (c) => {
    const body = await c.req.json<{ impl?: string; modulePath?: string }>();
    let outcome;
    try {
      outcome = await hot.upgradeTo(
        body.modulePath !== undefined ? { modulePath: body.modulePath } : (body.impl ?? "v2"),
      );
    } catch (err) {
      throw new HttpError(400, "bad_request", err instanceof Error ? err.message : String(err));
    }
    if (outcome.status === "busy") {
      return c.json(errorBody("platform_upgrading", "Another upgrade is in progress."), 503, {
        "Retry-After": "1",
      });
    }
    // Blocked is a first-class outcome, not an HTTP error: the body carries
    // status + the dropped/missing/invalid paths (input for the upper ladder
    // rungs), so clients keep one parsing path.
    return c.json(outcome);
  });

  // -- Terminals -----------------------------------------------------------

  routes.post("/terminals", async (c) => {
    const body = await c.req.json<{ command?: string; cwd?: string }>();
    const inst = await hot.ensure();
    const created = await inst.api.createTerminal(
      body.command ?? "cat",
      body.cwd ?? deps.config.root,
    );
    return c.json(created, 201);
  });

  routes.get("/terminals", async (c) => {
    const inst = await hot.ensure();
    const terminals = inst.api.terminals();
    return c.json({
      terminals: terminals.keys().map((id) => {
        const t = terminals.get(id)!;
        return {
          id,
          alive: t.alive(),
          lost: t.lost(),
          title: (t as Partial<TerminalApiV2>).title?.() ?? null,
        };
      }),
    });
  });

  routes.get("/terminals/:id", async (c) => {
    const inst = await hot.ensure();
    const t = inst.api.terminals().get(c.req.param("id"));
    if (t === undefined) throw new HttpError(404, "not_found", "No such terminal.");
    return c.json({
      output: t.read(),
      alive: t.alive(),
      lost: t.lost(),
      title: (t as Partial<TerminalApiV2>).title?.() ?? null,
    });
  });

  routes.post("/terminals/:id/input", async (c) => {
    const body = await c.req.json<{ data: string }>();
    const inst = await hot.ensure();
    const t = inst.api.terminals().get(c.req.param("id"));
    if (t === undefined) throw new HttpError(404, "not_found", "No such terminal.");
    t.write(body.data);
    return c.json({ ok: true });
  });

  routes.delete("/terminals/:id", async (c) => {
    const id = c.req.param("id");
    const inst = await hot.ensure();
    const terminals = inst.api.terminals();
    const t = terminals.get(id);
    if (t === undefined) throw new HttpError(404, "not_found", "No such terminal.");
    // Closing a terminal is user intent to end the process: kill and release
    // the runtime resource, then remove the node.
    const procId = (t.park() as { procId?: string }).procId;
    if (procId !== undefined) {
      hot.resources.claim<ShellProcResource>(procId)?.kill();
      hot.resources.release(procId);
    }
    terminals.remove(id);
    return c.json({ ok: true });
  });

  // -- Agents (runtime-loaded code + portable state) ------------------------

  routes.post("/agents", async (c) => {
    const body = await c.req.json<{ id: string; module: string }>();
    if (typeof body.id !== "string" || !/^[a-z0-9_-]+$/i.test(body.id)) {
      throw new HttpError(400, "bad_request", "Invalid agent id.");
    }
    const inst = await hot.ensure();
    let moduleUrl: string;
    try {
      moduleUrl = hot.resolveAgentModule(body.module);
    } catch (err) {
      throw new HttpError(400, "bad_request", err instanceof Error ? err.message : String(err));
    }
    const api = await inst.api.agents().add(body.id, { module: moduleUrl, rev: 1, state: null });
    return c.json({ id: body.id, agent: api.describe() }, 201);
  });

  routes.get("/agents", async (c) => {
    const inst = await hot.ensure();
    const agents = inst.api.agents();
    return c.json({
      agents: agents.keys().map((id) => ({ id, agent: agents.get(id)!.describe() })),
    });
  });

  routes.post("/agents/:id/run", async (c) => {
    const body = await c.req.json<{ input: Json }>();
    const inst = await hot.ensure();
    const agent = inst.api.agents().get(c.req.param("id"));
    if (agent === undefined) throw new HttpError(404, "not_found", "No such agent.");
    return c.json({ result: await agent.run(body.input ?? null) });
  });

  /**
   * Hot-swap agent code: park the slot, re-boot it with a bumped rev (and
   * optionally a different module). The state document rides across unchanged
   * — this is the "agent 一个 gist 就能分享，状态永远可以带走" loop in one endpoint.
   */
  routes.post("/agents/:id/reload", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ module?: string }>().catch(() => ({}) as { module?: string });
    const inst = await hot.ensure();
    const agents = inst.api.agents();
    const agent = agents.get(id);
    if (agent === undefined) throw new HttpError(404, "not_found", "No such agent.");
    const parked = agent.park() as AgentSlotCtx;
    const moduleUrl =
      body.module !== undefined ? hot.resolveAgentModule(body.module) : parked.module;
    agents.remove(id);
    const api = await agents.add(id, {
      module: moduleUrl,
      rev: parked.rev + 1,
      state: parked.state,
    });
    return c.json({ id, agent: api.describe() });
  });

  routes.delete("/agents/:id", async (c) => {
    const inst = await hot.ensure();
    inst.api.agents().remove(c.req.param("id"));
    return c.json({ ok: true });
  });

  // -- Demo UI panel (the web platform bundle in miniature) -----------------

  routes.get("/ui/manifest", (c) => c.json(hot.uiManifest()));

  routes.get("/ui/panel.js", (c) => {
    const { content, rev } = hot.readUiPanel();
    return c.body(content, 200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
      ETag: `"${rev}"`,
    });
  });

  routes.post("/ui/activate", async (c) => {
    const body = await c.req.json<{ version: string }>();
    try {
      return c.json(hot.activateUiPanel(body.version));
    } catch (err) {
      throw new HttpError(400, "bad_request", err instanceof Error ? err.message : String(err));
    }
  });

  return routes;
}
