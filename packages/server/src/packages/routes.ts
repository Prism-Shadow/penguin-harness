/**
 * Agent package routes — sharing an Agent's definition through a GitHub gist:
 *
 *   GET  /api/projects/:p/agents/:a/package          what would be published (manifest + sizes)
 *   POST /api/projects/:p/agents/:a/package/publish  publish or update a gist (owner; needs a token)
 *   POST /api/agent-packages/preview  { gist }       read a gist and validate it, writing nothing
 *   POST /api/agent-packages/install { gist, projectId, agentId }   install it as a new Agent (owner)
 *
 * The preview/install pair is Project-scoped through its body rather than its path: the
 * dialog that uses it reads a gist BEFORE the user has chosen where it lands.
 */
import { Hono } from "hono";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { AppEnv } from "../auth/middleware.js";
import { HttpError } from "../http/errors.js";
import { readJson, requireString, requireValidId } from "../http/validate.js";
import type { AgentPackages } from "../mechanisms/packages.js";
import type { Access } from "../mechanisms/projects.js";

export interface PackageRouteDeps {
  access: Access;
  packages: AgentPackages;
}

/** The Agent-scoped half (mounted under an Agent). */
export function agentPackageRoutes(deps: PackageRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    const pkg = await deps.packages.pack(projectId, agentId);
    return c.json({
      manifest: pkg.manifest,
      bytes: pkg.bytes,
      canPublish: deps.packages.canPublish(),
    });
  });

  app.post("/publish", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    const body = await readJson(c);
    const gistId =
      body.gistId === undefined
        ? undefined
        : requireString(body, "gistId", { minLen: 1, maxLen: 200 });
    const isPublic = body.public !== false;
    return c.json(await deps.packages.publish(projectId, agentId, { gistId, public: isPublic }));
  });

  return app;
}

/** The Project-agnostic half: read a gist, then install it where the caller says. */
export function packageRoutes(deps: PackageRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/preview", async (c) => {
    const body = await readJson(c);
    const gist = requireString(body, "gist", { minLen: 1, maxLen: 500 });
    return c.json(await deps.packages.preview(gist));
  });

  app.post("/install", async (c) => {
    const body = await readJson(c);
    const gist = requireString(body, "gist", { minLen: 1, maxLen: 500 });
    const projectId = requireString(body, "projectId", { minLen: 1, maxLen: 64 });
    const agentId = requireString(body, "agentId", { minLen: 1, maxLen: 64 });
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    const installed = await deps.packages.install(projectId, gist, agentId);
    return c.json(installed, 201);
  });

  return app;
}

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "PackagesModule.agentRoutes",
        prefix: "/api/projects/:projectId/agents/:agentId/package",
        auth: "user",
        order: 20,
      },
      {
        id: "PackagesModule.routes",
        prefix: "/api/agent-packages",
        auth: "user",
        order: 20,
      },
    ],
  },
})
export class PackageRoutes {
  @Use() private readonly access!: Access;
  @Use() private readonly packages!: AgentPackages;
  @Bind("PackagesModule.agentRoutes") agentRoutes!: Hono<AppEnv>;
  @Bind("PackagesModule.routes") routes!: Hono<AppEnv>;
  setup() {
    const deps = { access: this.access, packages: this.packages };
    this.agentRoutes = agentPackageRoutes(deps);
    this.routes = packageRoutes(deps);
  }
}
