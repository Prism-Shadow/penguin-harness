/**
 * /api/hot/*: the hot-platform demo surface (admin-only).
 *
 * The gate middleware is the runtime half of the stop-the-world protocol:
 * requests arriving during a swap are ENQUEUED on the host's operation queue
 * (awaiting waitIdle), never rejected — a client only ever observes latency,
 * not the freeze. The routes themselves are runtime code — they only
 * orchestrate through the platform api and the keyed handles, so they survive
 * impl swaps unchanged.
 */
import { Hono } from "hono";
import type { Json } from "@prismshadow/penguin-core/kernel";
import { ifaceData } from "@prismshadow/penguin-core/kernel";
import type { AppDeps } from "../app.js";
import { authMiddleware } from "../auth/middleware.js";
import type { AppEnv } from "../auth/middleware.js";
import { HttpError } from "../http/errors.js";
import type { AgentSlotCtx } from "./agent-slot.js";
import { ScriptContractError, validateSkillScript } from "./script.js";
import type { SkillSlotCtx } from "./skill-slot.js";
import type { TerminalApiV2 } from "./terminal.js";
import type { ShellProcResource } from "./resources.js";

/** Bind addresses considered safe by default; anything else needs HTTPS or the explicit override. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

/** Maps script/contract failures to 400 (the arktype-validation contract). */
function asBadRequest(err: unknown): never {
  if (err instanceof ScriptContractError) throw new HttpError(400, "bad_request", err.message);
  throw new HttpError(400, "bad_request", err instanceof Error ? err.message : String(err));
}

export function hotRoutes(deps: AppDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  const hot = deps.hot;
  // Mounted BEFORE the global cookie-auth middleware (see app.ts): this gate
  // does its own two-credential auth so local agents can call in with the
  // file-permission-gated Bearer token instead of a browser session.
  const cookieAuth = authMiddleware(deps.authService);

  routes.use("*", async (c, next) => {
    // Dangerous-network default-off: hot APIs load and run code, so on a
    // non-loopback bind (e.g. 0.0.0.0) without HTTPS they answer 403 unless
    // explicitly overridden (PENGUIN_HOT_API_UNSAFE=1).
    if (!LOOPBACK_HOSTS.has(deps.config.host.toLowerCase())) {
      const proto =
        c.req.header("x-forwarded-proto") ?? new URL(c.req.url).protocol.replace(":", "");
      if (proto !== "https" && process.env.PENGUIN_HOT_API_UNSAFE !== "1") {
        throw new HttpError(
          403,
          "hot_api_disabled",
          "Hot platform APIs are disabled on a non-loopback bind without HTTPS. " +
            "Serve over HTTPS or set PENGUIN_HOT_API_UNSAFE=1 to override.",
        );
      }
    }
    const gated = async (): Promise<void> => {
      // The upgrade endpoint enqueues internally; everything else waits out
      // any in-flight swap here (unobservable freeze: latency, not errors).
      if (!c.req.path.endsWith("/platform/upgrade")) await hot.waitIdle();
      await next();
    };
    // Local-agent credential: the per-boot token from $PENGUIN_HOME/hot/api.json.
    if (c.req.header("authorization") === `Bearer ${hot.apiToken}`) {
      return gated();
    }
    // Browser credential: the standard cookie session, admins only.
    return cookieAuth(c, async () => {
      if (!c.get("user").isAdmin) {
        throw new HttpError(403, "forbidden", "Hot platform APIs are admin-only.");
      }
      await gated();
    });
  });

  // -- Platform ------------------------------------------------------------

  routes.get("/platform", async (c) => {
    const inst = await hot.ensure();
    return c.json({
      impl: hot.currentImplId(),
      iface: ifaceData(inst.iface),
      info: inst.api.info(),
      // Optional system capabilities: without `compiler` only prebuilt
      // single-file bundles (bundlePath) can be loaded; without `git` source
      // upgrades degrade to unverified working trees.
      capabilities: hot.capabilities(),
    });
  });

  /** Observability: the current parked document (what an upgrade would carry). */
  routes.get("/platform/park", async (c) => {
    const inst = await hot.ensure();
    return c.json(inst.park());
  });

  /**
   * The upgrade descriptor, in capability order (strictly request-driven —
   * nothing auto-triggers a reload):
   * - { bundlePath, source? } — layer (a), the fundamental interface: a
   *   prebuilt single-file JS bundle plus an optional git specifier recorded
   *   as provenance. Needs no git and no compiler.
   * - { repo, revision } — layer (b): checkout + subprocess compile (TS/JS),
   *   which internally ends in layer (a). Needs a compiler; degrades without
   *   git (working tree + warning).
   * - { impl: "v2" } — built-in demo bundle.
   */
  routes.post("/platform/upgrade", async (c) => {
    const body = await c.req.json<{
      impl?: string;
      bundlePath?: string;
      source?: { repo: string; revision: string };
      repo?: string;
      revision?: string;
    }>();
    let target;
    if (body.bundlePath !== undefined) {
      target = { bundlePath: body.bundlePath, ...(body.source ? { source: body.source } : {}) };
    } else if (body.repo !== undefined) {
      if (body.revision === undefined) {
        throw new HttpError(400, "bad_request", "A git upgrade needs both repo and revision.");
      }
      target = { repo: body.repo, revision: body.revision };
    } else {
      target = { impl: body.impl ?? "v2" };
    }
    let outcome;
    try {
      outcome = await hot.upgradeTo(target);
    } catch (err) {
      throw new HttpError(400, "bad_request", err instanceof Error ? err.message : String(err));
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

  // -- Skills (eval + context → arktype-validated object → tools) -----------

  routes.post("/skills", async (c) => {
    const body = await c.req.json<{ id: string; script: string }>();
    if (typeof body.id !== "string" || !/^[a-z0-9_-]+$/i.test(body.id)) {
      throw new HttpError(400, "bad_request", "Invalid skill id.");
    }
    if (typeof body.script !== "string") {
      throw new HttpError(400, "bad_request", "Missing script.");
    }
    const inst = await hot.ensure();
    const skills = inst.api.skills();
    if (skills.get(body.id) !== undefined) {
      throw new HttpError(400, "bad_request", `Skill '${body.id}' already exists.`);
    }
    // Contract check BEFORE any state is touched (eval + arktype, setup not run).
    try {
      validateSkillScript(body.script);
    } catch (err) {
      asBadRequest(err);
    }
    try {
      const api = await skills.add(body.id, { script: body.script, rev: 1, state: null });
      api.setup(body.id, inst.api.tools());
      return c.json(
        {
          id: body.id,
          skill: api.describe(),
          tools: inst.api
            .tools()
            .list()
            .filter((t) => t.owner === body.id),
        },
        201,
      );
    } catch (err) {
      // Setup failed (e.g. duplicate tool name): unload the half-installed
      // slot — its effects deregister whatever did get registered.
      skills.remove(body.id);
      asBadRequest(err);
    }
  });

  routes.get("/skills", async (c) => {
    const inst = await hot.ensure();
    const skills = inst.api.skills();
    return c.json({
      skills: skills.keys().map((id) => ({ id, skill: skills.get(id)!.describe() })),
    });
  });

  /** Hot-swap skill code; the parked state document rides across. */
  routes.post("/skills/:id/reload", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ script?: string }>().catch(() => ({}) as { script?: string });
    const inst = await hot.ensure();
    const skills = inst.api.skills();
    const skill = skills.get(id);
    if (skill === undefined) throw new HttpError(404, "not_found", "No such skill.");
    const parked = skill.park() as SkillSlotCtx;
    const script = body.script ?? parked.script;
    // Validate the NEW script against the carried state before removing the
    // old instance: a bad reload leaves the running skill untouched.
    try {
      validateSkillScript(script, parked.state);
    } catch (err) {
      asBadRequest(err);
    }
    skills.remove(id); // effects drain: the old tools deregister here
    try {
      const api = await skills.add(id, { script, rev: parked.rev + 1, state: parked.state });
      api.setup(id, inst.api.tools());
      return c.json({ id, skill: api.describe() });
    } catch (err) {
      skills.remove(id);
      asBadRequest(err);
    }
  });

  routes.delete("/skills/:id", async (c) => {
    const inst = await hot.ensure();
    inst.api.skills().remove(c.req.param("id"));
    return c.json({ ok: true });
  });

  // -- Tools (contributed by skills) ----------------------------------------

  routes.get("/tools", async (c) => {
    const inst = await hot.ensure();
    return c.json({ tools: inst.api.tools().list() });
  });

  routes.post("/tools/:name/invoke", async (c) => {
    const body = await c.req.json<{ input?: Json }>().catch(() => ({}) as { input?: Json });
    const inst = await hot.ensure();
    const registry = inst.api.tools();
    const name = c.req.param("name");
    if (!registry.has(name)) throw new HttpError(404, "not_found", "No such tool.");
    try {
      return c.json({ result: (await registry.invoke(name, body.input ?? null)) ?? null });
    } catch (err) {
      throw new HttpError(
        400,
        "bad_request",
        `tool '${name}' failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  return routes;
}
