/**
 * Skill discovery in a picked directory:
 * GET /api/projects/:p/dir-skills?path=<absolute>.
 *
 * Answers "what would importing this directory install", so Agent creation can offer the Skills a
 * checkout carries next to the built-in library ones. Reads `<path>/.agents/skills` and
 * `<path>/.claude/skills` only — it never lists or descends anything else, so it is strictly
 * narrower than the directory browsing this sits beside.
 *
 * Authorization and path handling are the `dirs` route's, deliberately: `projectId` is the anchor
 * and the caller must have access to it, the path must be absolute, and it is resolved through
 * realpath before anything is read. A directory carrying no Skills answers with an empty list
 * rather than an error — pointing at one is a normal thing to do.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import type { DirectorySkillsResponse } from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import { HttpError } from "../errors.js";
import { requireValidId } from "../validate.js";
import type { AppDeps } from "../../app.js";
import { discoverDirectorySkills } from "../../services/directory-skills.js";

export function directorySkillsRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);

    const raw = c.req.query("path");
    const target = raw?.trim();
    if (!target || !path.isAbsolute(target)) {
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
    if (!(await fs.stat(real)).isDirectory()) {
      throw new HttpError(400, "not_a_dir", "Not a directory.");
    }

    const skills = await discoverDirectorySkills(real);
    return c.json({
      path: real,
      // Content and auxiliary files are deliberately not returned: the picker needs to describe a
      // Skill, and creation re-reads it from disk, so a megabyte of SKILL bodies never crosses the
      // wire and the install can never be driven by a body the client made up.
      skills: skills.map(({ content: _content, files: _files, ...item }) => item),
    } satisfies DirectorySkillsResponse);
  });

  return app;
}
