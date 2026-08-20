/**
 * Workflow control plane: `/api/workflows`, one route group of the platform's Hono app.
 *
 * It lives here rather than in hmr/routes.ts because installing and calling a workflow is
 * business, and a business route table baked into the runtime costs a rebuild and a
 * redeploy of every installation to change (see ../hmr/README.md, "the route table is not
 * a runtime asset"). `/api/hmr/*` stays the runtime's own upgrade channel and is never
 * offered to the seam, so this group cannot and does not sit under it.
 *
 * Mounted by app.ts's createApp beside the other platform groups, so every platform route
 * swaps as one unit. Unknown paths and methods fall to the parent app's notFound, which
 * declines to the runtime. The identity gate is attached per-route, not as a prefix
 * middleware, so a request nothing here serves declines BEFORE authentication.
 *
 *   GET    /api/workflows                                     list what is installed
 *   GET    /api/workflows/tools                               the tools they contributed
 *   POST   /api/workflows                                     install or replace one
 *   DELETE /api/workflows/:projectId/:agentId/:workflowId     uninstall
 *   POST   /api/workflows/:name/run                           call a live one by its name
 *   GET    /api/workflows/:projectId/:agentId/:workflowId/ui/*   its own UI files
 *
 * An install writes to disk and registers into the running App's own workflow set (see
 * ./registry.ts), so it is callable on the next request - no push, and nothing asks the
 * runtime to rebuild anything. The refs ride the next swap as parked state, which is how
 * an installation survives a push without being re-sent.
 */
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { HttpError } from "../http/errors.js";
import type { IdentifiedUser, Identity } from "../terminal/identity.js";
import type { WorkflowRegistry } from "./registry.js";
import type { WorkflowLifecycle } from "./service.js";
import { WorkflowIdError } from "./store.js";
import type { WorkflowStore } from "./store.js";

type WorkflowEnv = { Variables: { user: IdentifiedUser } };

export interface WorkflowRoutesDeps {
  store: WorkflowStore;
  identity: Identity;
  /** The running App's live set: installing registers into it, so a call works at once. */
  registry: WorkflowRegistry;
  /** Decides whether an install is live now or waits for its agent's next activation. */
  lifecycle: WorkflowLifecycle;
}

interface InstallBody {
  projectId?: unknown;
  agentId?: unknown;
  workflowId?: unknown;
  script?: unknown;
  ui?: unknown;
  /** `POST /:name/run` only. */
  input?: unknown;
}

export function workflowRoutes(deps: WorkflowRoutesDeps): Hono<WorkflowEnv> {
  const app = new Hono<WorkflowEnv>();

  /**
   * Admin only, on every route including the reads. Installing a workflow makes the
   * harness run code it was not shipped with, under the server's own authority; an agent
   * that could do that to the harness it runs inside would be a privilege-escalation
   * hole. Integrating a workflow is therefore an operator action, and the listing that
   * would tell a caller what to invoke is gated with it.
   */
  const gate: MiddlewareHandler<WorkflowEnv> = async (c, next) => {
    const user = await deps.identity(c.req.raw);
    if (user === null) throw new HttpError(401, "unauthorized", "Sign in first.");
    if (!user.isAdmin) throw new HttpError(403, "admin_only", "Admin session required.");
    c.set("user", user);
    await next();
  };

  app.get("/api/workflows", gate, (c) => c.json({ workflows: deps.registry.list() }));

  // What an agent's tool list would draw on: a workflow reaches an agent by registering
  // tools in its `setup`, and this is that set, owner and all.
  app.get("/api/workflows/tools", gate, (c) => c.json({ tools: deps.registry.tools.list() }));

  app.post("/api/workflows", gate, async (c) => {
    const body = await readBody(c.req.raw);
    const projectId = str(body.projectId);
    const agentId = str(body.agentId);
    const workflowId = str(body.workflowId);
    const script = str(body.script);
    if (
      projectId === undefined ||
      agentId === undefined ||
      workflowId === undefined ||
      script === undefined
    ) {
      throw new HttpError(400, "bad_request", "provide projectId, agentId, workflowId and script");
    }
    const ref = { projectId, agentId, workflowId };
    try {
      await deps.store.install(ref, script, uiFiles(body.ui));
    } catch (err) {
      throw idError(err);
    }
    // Live now if the agent is active, stored and waiting otherwise - the same rule
    // activation follows, so an install never produces a registration that activation
    // would not have made. A script the contract refuses throws here, so it is reported
    // to the installer rather than surfacing at some later swap.
    let summary;
    try {
      summary = await deps.lifecycle.installed(ref);
    } catch (err) {
      await deps.store.remove(ref);
      throw new HttpError(400, "bad_request", detail(err));
    }
    return c.json(
      summary ?? { id: `${agentId}/${workflowId}`, installed: true, active: false },
      201,
    );
  });

  app.delete("/api/workflows/:projectId/:agentId/:workflowId", gate, async (c) => {
    const ref = {
      projectId: c.req.param("projectId"),
      agentId: c.req.param("agentId"),
      workflowId: c.req.param("workflowId"),
    };
    let removed: boolean;
    try {
      // Unregistered first so a workflow holding something open gets its turn before the
      // directory disappears. Nothing is parked: the installation is going away.
      await deps.lifecycle.removed(ref);
      removed = await deps.store.remove(ref);
    } catch (err) {
      throw idError(err);
    }
    if (!removed) throw new HttpError(404, "not_found", "No such workflow.");
    return c.json({ ok: true });
  });

  app.post("/api/workflows/:name/run", gate, async (c) => {
    const name = c.req.param("name");
    const body = await readBody(c.req.raw);
    const instances = deps.registry.instanceView();
    if (instances.get(name) === undefined) {
      throw new HttpError(404, "not_found", `No workflow named '${name}'.`);
    }
    // A workflow runs with this process's authority; a throw is the workflow's answer,
    // reported as such rather than collapsed into a 500 by the parent app's onError.
    try {
      return c.json({ result: toJson(instances.run(name, body.input ?? null)) });
    } catch (err) {
      throw new HttpError(400, "workflow_failed", detail(err));
    }
  });

  app.get("/api/workflows/:projectId/:agentId/:workflowId/ui/*", gate, async (c) => {
    const rel = c.req.path.split("/ui/").slice(1).join("/ui/");
    const ref = {
      projectId: c.req.param("projectId"),
      agentId: c.req.param("agentId"),
      workflowId: c.req.param("workflowId"),
    };
    let bytes: Buffer | null;
    try {
      bytes = await deps.store.uiFile(ref, rel === "" ? "index.html" : rel);
    } catch (err) {
      throw idError(err);
    }
    if (bytes === null) throw new HttpError(404, "not_found", "No such file.");
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: { "content-type": contentType(rel), "cache-control": "no-cache" },
    });
  });

  return app;
}

async function readBody(request: Request): Promise<InstallBody> {
  try {
    return (await request.json()) as InstallBody;
  } catch {
    return {};
  }
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

function uiFiles(value: unknown): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "bad_request", "`ui` must be an object of path -> base64");
  }
  const files = (value as { files?: unknown }).files ?? value;
  if (typeof files !== "object" || files === null || Array.isArray(files)) {
    throw new HttpError(400, "bad_request", "`ui.files` must be an object of path -> base64");
  }
  return files as Record<string, string>;
}

function idError(err: unknown): Error {
  if (err instanceof WorkflowIdError) return new HttpError(400, "bad_request", err.message);
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * JSON.stringify's own notion of "not representable" (a function, a symbol, a cycle)
 * surfaces as a thrown error. A void return is a successful call with no result and maps
 * to null: the side effect already happened.
 */
function toJson(value: unknown): unknown {
  if (value === undefined) return null;
  const text = JSON.stringify(value);
  if (text === undefined) throw new Error("result is not JSON-serializable");
  return JSON.parse(text) as unknown;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function contentType(rel: string): string {
  const dot = rel.lastIndexOf(".");
  return (dot === -1 ? undefined : TYPES[rel.slice(dot)]) ?? "application/octet-stream";
}

const detail = (err: unknown): string => (err instanceof Error ? err.message : String(err));
