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
import { endpointOf } from "../app.js";
import type { Desktop } from "../../hmr/capabilities.js";
import type { DesktopService } from "../../services/desktop-service.js";
import { membersRoutes } from "./members.js";
import type { ProjectLifecycle } from "@prismshadow/penguin-library-project";
import type { Machines } from "../../machines/service.js";

/** What this route group reaches — bound by its module (src/modules). */
export interface ProjectsRouteDeps {
  projectService: ProjectLifecycle;
  /** The machines this Project uses carry its name too (machines/service.ts). */
  machines: Pick<Machines, "syncConfigEverywhere">;
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
    // Not awaited: the person renaming is not the one who should wait for a set of ssh tunnels.
    void deps.machines.syncConfigEverywhere(projectId);
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
    "AgentAuthPermissionProvider.roles": [
      { id: "role.project.read", parents: ["readonly"] },
      { id: "role.project.maintain", children: ["project.read"] },
      { id: "role.project.all", children: ["project.maintain"], parents: ["admin"] },
    ],
    "HttpModule.routes": [
      {
        id: "project.list",
        method: "GET",
        prefix: "/api/projects",
        auth: "user",
        role: "project.read",
        order: 80,
      },
      {
        id: "project.create",
        method: "POST",
        prefix: "/api/projects",
        auth: "user",
        role: "project.maintain",
        order: 80,
      },
      {
        id: "project.update",
        method: "PATCH",
        prefix: "/api/projects/:projectId",
        auth: "user",
        role: "project.maintain",
        order: 80,
      },
      {
        id: "project.delete",
        method: "DELETE",
        prefix: "/api/projects/:projectId",
        auth: "user",
        role: "project.all",
        order: 80,
      },
      {
        id: "project.member.list",
        method: "GET",
        prefix: "/api/projects/:projectId/members",
        auth: "user",
        role: "project.read",
        order: 90,
      },
      {
        id: "project.member.add",
        method: "POST",
        prefix: "/api/projects/:projectId/members",
        auth: "user",
        role: "project.maintain",
        order: 90,
      },
      {
        id: "project.member.remove",
        method: "DELETE",
        prefix: "/api/projects/:projectId/members/:userId",
        auth: "user",
        role: "project.all",
        order: 90,
      },
    ],
  },
})
export class ProjectAdminRoutes {
  @Use() private readonly projectService!: ProjectLifecycle;
  @Use() private readonly desktop!: Desktop;
  @Use() private readonly machines!: Machines;
  @Bind("project.list") listRoute!: Hono<AppEnv>;
  @Bind("project.create") createRoute!: Hono<AppEnv>;
  @Bind("project.update") updateRoute!: Hono<AppEnv>;
  @Bind("project.delete") deleteRoute!: Hono<AppEnv>;
  @Bind("project.member.list") listMembersRoute!: Hono<AppEnv>;
  @Bind("project.member.add") addMemberRoute!: Hono<AppEnv>;
  @Bind("project.member.remove") removeMemberRoute!: Hono<AppEnv>;
  setup() {
    const pGroup = projectsRoutes({
      projectService: this.projectService,
      machines: this.machines,
    });
    this.listRoute = endpointOf(pGroup, "GET", "/");
    this.createRoute = endpointOf(pGroup, "POST", "/");
    this.updateRoute = endpointOf(pGroup, "PATCH", "/:projectId");
    this.deleteRoute = endpointOf(pGroup, "DELETE", "/:projectId");
    const mGroup = membersRoutes({
      projectService: this.projectService,
      desktop: this.desktop.current() as DesktopService | null,
    });
    this.listMembersRoute = endpointOf(mGroup, "GET", "/");
    this.addMemberRoute = endpointOf(mGroup, "POST", "/");
    this.removeMemberRoute = endpointOf(mGroup, "DELETE", "/:userId");
  }
}
