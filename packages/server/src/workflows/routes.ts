/**
 * Agent-scoped workflow routes, mounted at /api/projects/:projectId/agents/:agentId/workflows:
 *
 *   GET    /                       the Agent's workflows (loads any that changed on disk)
 *   POST   /:id/reload             re-import the folder now (the watcher does this on change too)
 *   GET    /:id/history            recorded versions, newest first
 *   POST   /:id/rollback {revision} restore that version's files and reload
 *   DELETE /:id                    remove the folder and its recorded versions
 *   GET    /:id/ui/*               the workflow's static UI (index.html when the path is empty)
 *   *      /:id/api/*              JSON, handed to the workflow's WorkflowMain.handle
 *
 * Every route requires access to the Project; the UI and api routes are what the
 * workflow's own page (an iframe in the Web App, same-origin cookie auth) talks to.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { AppEnv } from "../auth/middleware.js";
import { HttpError } from "../http/errors.js";
import { requireValidId } from "../http/validate.js";
import type { Access } from "../mechanisms/projects.js";
import type { WorkflowRequest, Workflows } from "../mechanisms/workflows.js";
import { WorkflowNotFound } from "./service.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export interface WorkflowRouteDeps {
  access: Access;
  workflows: Workflows;
}

export function workflowRoutes(deps: WorkflowRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const scope = (c: {
    req: { param(name: string): string | undefined };
    var: AppEnv["Variables"];
  }) => {
    const projectId = requireValidId(c as never, "projectId");
    const agentId = requireValidId(c as never, "agentId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    return { projectId, agentId };
  };
  const notFound = (err: unknown): never => {
    if (err instanceof WorkflowNotFound) throw new HttpError(404, "not_found", err.message);
    throw err;
  };

  app.get("/", async (c) => {
    const { projectId, agentId } = scope(c);
    return c.json({ workflows: await deps.workflows.list(projectId, agentId) });
  });

  app.post("/:id/reload", async (c) => {
    const { projectId, agentId } = scope(c);
    const workflow = await deps.workflows
      .reload(projectId, agentId, c.req.param("id"))
      .catch(notFound);
    return c.json({ workflow });
  });

  app.get("/:id/history", async (c) => {
    const { projectId, agentId } = scope(c);
    return c.json({
      versions: await deps.workflows.history(projectId, agentId, c.req.param("id")),
    });
  });

  app.post("/:id/rollback", async (c) => {
    const { projectId, agentId } = scope(c);
    const body = (await c.req.json().catch(() => ({}))) as { revision?: unknown };
    if (typeof body.revision !== "string")
      throw new HttpError(400, "bad_request", "revision is required");
    const workflow = await deps.workflows
      .rollback(projectId, agentId, c.req.param("id"), body.revision)
      .catch(notFound);
    return c.json({ workflow });
  });

  app.delete("/:id", async (c) => {
    const { projectId, agentId } = scope(c);
    await deps.workflows.remove(projectId, agentId, c.req.param("id")).catch(notFound);
    return c.body(null, 204);
  });

  app.get("/:id/ui/*", async (c) => {
    const { projectId, agentId } = scope(c);
    const id = c.req.param("id");
    const rel = c.req.path.split(`/workflows/${id}/ui/`)[1] ?? "";
    const file = await deps.workflows.uiFile(projectId, agentId, id, decodeURIComponent(rel));
    if (file === null) throw new HttpError(404, "not_found", "No such file in the workflow's ui/.");
    const body = await fs.readFile(file);
    return c.body(body, 200, {
      "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "cache-control": "no-cache",
    });
  });

  app.all("/:id/api/*", async (c) => {
    const { projectId, agentId } = scope(c);
    const id = c.req.param("id");
    const sub = c.req.path.split(`/workflows/${id}/api`)[1] ?? "/";
    const request: WorkflowRequest = {
      method: c.req.method,
      path: sub === "" ? "/" : sub,
      query: c.req.query(),
      body:
        c.req.method === "GET" || c.req.method === "HEAD"
          ? null
          : await c.req.json().catch(() => null),
    };
    const response = await deps.workflows.dispatch(projectId, agentId, id, request).catch(notFound);
    return c.json(response.body ?? null, (response.status ?? 200) as 200);
  });

  return app;
}

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "WorkflowsModule.routes",
        prefix: "/api/projects/:projectId/agents/:agentId/workflows",
        auth: "user",
        order: 20,
      },
    ],
  },
})
export class WorkflowRoutes {
  @Use() private readonly access!: Access;
  @Use() private readonly workflows!: Workflows;
  @Bind("WorkflowsModule.routes") routes!: Hono<AppEnv>;
  setup() {
    this.routes = workflowRoutes({ access: this.access, workflows: this.workflows });
  }
}

/**
 * Tells every Agent how to give itself a workflow. Its own component, with no
 * dependencies: HostAssembly collects prompt sections before the session runtime exists,
 * and the routes above need that runtime — on one class the two would be a cycle.
 */
@Component({
  contributes: {
    "HostAssembly.promptSections": [
      {
        id: "WorkflowsModule.prompt",
        title: "Workflows",
        text: 'You can give yourself a page beside the chat and code that runs on the server: a *workflow*.\nA workflow is a folder `workflows/<id>/` inside your Agent directory (next to system_config.yaml), organised like a server extension:\n- `package.json` with `"penguin": { "modules": [ { "name": "Workflow", "requires": { "host": { "iface": "@prismshadow/penguin-server#WorkflowHost", "from": "Host" } }, "provides": { "main": "@prismshadow/penguin-server#WorkflowMain" }, "contributes": {}, "children": [] } ] }`\n- `index.mjs` whose default export is `{ modules: { Workflow: { create({ use }) { return { api: { main: { async handle(req) { … return { status: 200, body: … }; } } } }; } } } }` — `req` is `{ method, path, query, body }`; `use.host` offers `runAgent({ text, sessionId? })`, `sessionStatus(id)`, `getState()`, `setState(doc)`, `log(text)`.\n- `ui/index.html` (plus any assets): served as your tab in the Web App; call your own handler with `fetch("../api/<path>")` (relative to the page, which is served under `ui/`; same-origin).\nYour page is themed by the app: the Web App stamps `light`/`dark` on its root and injects `/workflow-ui.css`, which styles plain HTML (headings, lists, forms, tables, code) to match the app and exposes `--wf-bg`, `--wf-fg`, `--wf-muted`, `--wf-border`, `--wf-surface`, `--wf-accent`, `--wf-accent-fg` (plus the classes `wf-primary` on a button, `wf-card`, `wf-rows`, `wf-row`, `wf-muted`). Write plain markup and take every colour and font from those variables — a hardcoded colour or font will clash with the user\'s theme, light or dark.\nThe server checks the manifests against its interface table and reloads the folder whenever a file changes; every successful load is recorded as a version, and any version can be restored (`POST …/workflows/<id>/rollback`); `DELETE …/workflows/<id>` removes the workflow and its versions. Broken edits keep the previous version serving and report the error in the workflow list.\n',
      },
    ],
  },
})
export class WorkflowPrompt {}
