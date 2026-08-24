/**
 * Server directory browsing:
 * GET /api/projects/:p/dirs?path=<absolute>.
 *
 * Lets the user interactively pick a Workspace directory when creating a Session via
 * advanced mode. Defaults to the home directory of the account running the service, and
 * can be browsed all the way up to the root `/` — reachability is governed by OS file
 * permissions; the server no longer restricts browsing to within the Project directory
 * tree (same convention as workspace-guard). Lists subdirectories only, not files.
 *
 * `projectId` remains the authorization anchor: the caller must have access to that Project.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import type { DirListResponse } from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import { requireProjectDir, requireValidId } from "../validate.js";
import type { AppDeps } from "../../app.js";

export function dirsRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);

    // Default starting point: home directory; an explicit path must be absolute (the frontend always sends back the realpath result).
    const raw = c.req.query("path");
    const real = await requireProjectDir(raw && raw.trim() ? raw.trim() : os.homedir());

    let dirents: import("node:fs").Dirent[] = [];
    try {
      dirents = await fs.readdir(real, { withFileTypes: true });
    } catch {
      // No read permission: return an empty list instead of an error, so the user can still navigate back up.
      dirents = [];
    }
    const entries = dirents
      .filter((d) => d.isDirectory())
      .map((d) => ({ name: d.name, path: path.join(real, d.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const parent = path.dirname(real);
    return c.json({
      path: real,
      parent: parent === real ? null : parent,
      entries,
    } satisfies DirListResponse);
  });

  return app;
}
