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
import { HttpError } from "../errors.js";
import { requireValidId } from "../validate.js";
import type { AppDeps } from "../../app.js";

export function dirsRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);

    // Default starting point: home directory; an explicit path must be absolute (the frontend always sends back the realpath result).
    const raw = c.req.query("path");
    const target = raw && raw.trim() ? raw.trim() : os.homedir();
    if (!path.isAbsolute(target)) {
      throw new HttpError(400, "dir_not_absolute", "Directory must be an absolute path.");
    }

    let real: string;
    try {
      real = await fs.realpath(target);
    } catch {
      throw new HttpError(
        404,
        "dir_not_found",
        `Directory does not exist or is inaccessible: ${target}.`,
      );
    }
    const stat = await fs.stat(real);
    if (!stat.isDirectory()) {
      throw new HttpError(400, "not_a_dir", "Not a directory.");
    }

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
