/**
 * Project routes: GET|POST /api/projects, PATCH|DELETE /api/projects/:p.
 */
import { Hono } from "hono";
import type {
  ProjectCreateResponse,
  ProjectUpdateResponse,
  ProjectsResponse,
} from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import {
  badRequest,
  optionalString,
  readJson,
  requireString,
  requireValidId,
} from "../validate.js";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Desktop } from "../../hmr/capabilities.js";
import type { DesktopService } from "../../services/desktop-service.js";
import { membersRoutes } from "./members.js";
import type { ProjectLifecycle } from "../../mechanisms/projects.js";

/** What this route group reaches — bound by its module (src/modules). */
export interface ProjectsRouteDeps {
  projectService: ProjectLifecycle;
}

export function projectsRoutes(deps: ProjectsRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const projects = await deps.projectService.listProjects(c.var.user.userId);
    return c.json({ projects } satisfies ProjectsResponse);
  });

  app.post("/", async (c) => {
    const body = await readJson(c);
    const projectId = requireString(body, "projectId", { label: "projectId" });
    const name = optionalString(body, "name", { minLen: 1, maxLen: 100, label: "name" });
    const project = await deps.projectService.createProject(c.var.user, projectId, name);
    return c.json({ project } satisfies ProjectCreateResponse, 201);
  });

  /** Rename (owner): the display name only — the id names the directory and is immutable. */
  app.patch("/:projectId", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const body = await readJson(c);
    // Trimmed before the length check, so "   " is rejected rather than stored as a blank
    // display name (minLen alone counts the spaces). The web client trims too; this makes a
    // direct API call behave the same.
    const name = requireString(body, "name", { maxLen: 100, label: "name" }).trim();
    if (name === "") throw badRequest("name must be at least 1 characters.");
    const project = await deps.projectService.renameProject(c.var.user.userId, projectId, name);
    return c.json({ project } satisfies ProjectUpdateResponse);
  });

  app.delete("/:projectId", async (c) => {
    // Defensive id validation: deleteProject constructs the project directory path and recursively deletes it.
    await deps.projectService.deleteProject(c.var.user.userId, requireValidId(c, "projectId"));
    return c.body(null, 204);
  });

  return app;
}

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "project-admin.projects",
        prefix: "/api/projects",
        auth: "user",
        order: 80,
      },
      {
        id: "project-admin.members",
        prefix: "/api/projects/:projectId/members",
        auth: "user",
        order: 90,
      },
    ],
  },
})
export class ProjectAdminRoutes {
  @Use() private readonly projectService!: ProjectLifecycle;
  @Use() private readonly desktop!: Desktop;
  @Bind("project-admin.projects") projectsRoutes!: Hono<AppEnv>;
  @Bind("project-admin.members") membersRoutes!: Hono<AppEnv>;
  setup() {
    this.projectsRoutes = projectsRoutes({ projectService: this.projectService });
    this.membersRoutes = membersRoutes({
      projectService: this.projectService,
      desktop: this.desktop.current() as DesktopService | null,
    });
  }
}
