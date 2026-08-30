/**
 * Agent package routes — sharing an Agent's definition through a GitHub gist:
 *
 *   GET  /api/projects/:p/agents/:a/package          what would be published (manifest + sizes)
 *   POST /api/projects/:p/agents/:a/package/publish  publish or update a gist (owner; needs a token)
 *   POST /api/agent-packages/preview  { source, kind? }   read a source and validate it, writing nothing
 *   POST /api/agent-packages/install { source, kind?, projectId, agentId }   install it as a new Agent (owner)
 *
 * A source is a gist, `npm:<name>`, a GitHub repository or release, a git URL, or an http(s)
 * URL of a tarball (packages/sources.ts); `gist` is accepted as an alias of `source`.
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

const SOURCE_KINDS = new Set(["gist", "npm", "github-release", "github", "git", "url"]);

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

  const sourceOf = (
    body: Record<string, unknown>,
  ): { source: string; kind: string | undefined } => {
    if (body.source === undefined && body.gist !== undefined) body.source = body.gist;
    const source = requireString(body, "source", { minLen: 1, maxLen: 1000 });
    const kind =
      body.kind === undefined ? undefined : requireString(body, "kind", { minLen: 1, maxLen: 20 });
    if (kind !== undefined && !SOURCE_KINDS.has(kind)) {
      throw new HttpError(
        400,
        "bad_request",
        `kind must be one of ${[...SOURCE_KINDS].join(", ")}.`,
      );
    }
    return { source, kind };
  };

  app.post("/preview", async (c) => {
    const { source, kind } = sourceOf(await readJson(c));
    return c.json(await deps.packages.preview(source, kind));
  });

  app.post("/install", async (c) => {
    const body = await readJson(c);
    const { source, kind } = sourceOf(body);
    const projectId = requireString(body, "projectId", { minLen: 1, maxLen: 64 });
    const agentId = requireString(body, "agentId", { minLen: 1, maxLen: 64 });
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    const installed = await deps.packages.install(projectId, source, agentId, kind);
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
