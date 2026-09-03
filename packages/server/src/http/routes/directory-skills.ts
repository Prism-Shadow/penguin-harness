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
 * realpath before anything is read (`requireProjectDir`, shared with that route and with the
 * create route's `skillsDirectory`). A directory carrying no Skills answers with an empty list
 * rather than an error — pointing at one is a normal thing to do.
 */
import { Hono } from "hono";
import type { DirectorySkillsResponse } from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import { requireProjectDir, requireValidId } from "../validate.js";
import type { ProjectAccess } from "../../services/project-access.js";

/** What this route group reaches — bound by its module (src/modules). */
export interface DirectorySkillsRouteDeps {
  access: ProjectAccess;
}
import { discoverDirectorySkills } from "../../services/directory-skills.js";
import { toSkillItem } from "../../services/plugin-library.js";

export function directorySkillsRoutes(deps: DirectorySkillsRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);

    const real = await requireProjectDir(c.req.query("path"));

    const skills = await discoverDirectorySkills(real);
    return c.json({
      path: real,
      // The picker needs a description, not a payload: the body and the resolved server-side
      // path are projected away by the shared allowlist, and creation re-reads the Skill from
      // disk, so a megabyte of SKILL bodies never crosses the wire and the install can never be
      // driven by a body the client made up.
      skills: skills.map((skill) => ({ ...toSkillItem(skill), source: skill.source })),
    } satisfies DirectorySkillsResponse);
  });

  return app;
}
