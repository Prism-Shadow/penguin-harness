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
