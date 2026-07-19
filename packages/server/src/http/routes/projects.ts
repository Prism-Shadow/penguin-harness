/**
 * Project routes: GET|POST /api/projects, DELETE /api/projects/:p.
 */
import { Hono } from "hono";
import type { ProjectCreateResponse, ProjectsResponse } from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import { optionalString, readJson, requireString, requireValidId } from "../validate.js";
import type { AppDeps } from "../../app.js";

export function projectsRoutes(deps: AppDeps): Hono<AppEnv> {
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

  app.delete("/:projectId", async (c) => {
    // Defensive id validation (FD-4): deleteProject constructs the project directory path and recursively deletes it.
    await deps.projectService.deleteProject(c.var.user.userId, requireValidId(c, "projectId"));
    return c.body(null, 204);
  });

  return app;
}
