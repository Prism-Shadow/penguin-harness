/**
 * Skill library & Agent-installed-Skills routes:
 *   GET /api/skills                                       # library groups & metadata (any logged-in user)
 *   GET|POST /api/projects/:p/agents/:a/skills            # installed list / install from library (any member)
 *   DELETE   /api/projects/:p/agents/:a/skills/:name      # uninstall (any member)
 * Installing writes the library's SKILL.md verbatim to agent_state/skills/<name>/;
 * reinstalling overwrites with the library content (i.e. an update). The scope is small
 * enough to skip a service layer — routes call core's disk-writing functions directly.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import {
  installSkill,
  listInstalledSkills,
  removeSkill,
  skillsDir,
} from "@prismshadow/penguin-core";
import { librarySkill, loadSkillGroups } from "@prismshadow/penguin-skills";
import type { LibrarySkill, SkillMetadata } from "@prismshadow/penguin-skills";
import type {
  AgentSkillsResponse,
  SkillLibraryResponse,
  SkillMetadataItem,
} from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { AppDeps } from "../../app.js";
import { HttpError } from "../errors.js";
import { badRequest, readJson, requireValidId } from "../validate.js";

/**
 * Strips the content off a LibrarySkill: the API only sends metadata; the full body is
 * written to disk on install and read by the model on demand. The optional short
 * description (shortDescription(Zh)) and custom icon (icon.svg source) are conditionally
 * passed through — both the library side (LibrarySkill) and the installed side (core
 * InstalledSkill) carry these fields.
 */
function toMetadataItem(skill: SkillMetadata & { icon?: string }): SkillMetadataItem {
  return {
    name: skill.name,
    description: skill.description,
    ...(skill.shortDescription !== undefined ? { shortDescription: skill.shortDescription } : {}),
    ...(skill.shortDescriptionZh !== undefined
      ? { shortDescriptionZh: skill.shortDescriptionZh }
      : {}),
    ...(skill.icon !== undefined ? { icon: skill.icon } : {}),
    version: skill.version,
    updated: skill.updated,
  };
}

/** Library listing response: the files are the source of truth — read and parse the library directory fresh on every request (files are small, requests infrequent, no caching needed). */
function libraryResponse(): SkillLibraryResponse {
  return {
    groups: loadSkillGroups().map((group) => ({
      id: group.id,
      title: group.title,
      ...(group.titleZh !== undefined ? { titleZh: group.titleZh } : {}),
      skills: group.skills.map(toMetadataItem),
    })),
  };
}

/** Validate the POST request body: names must be a non-empty array of strings. */
function parseInstallNames(body: Record<string, unknown>): string[] {
  if (!Array.isArray(body.names) || body.names.length === 0) {
    throw badRequest("names must be a non-empty array.");
  }
  return body.names.map((v, i) => {
    if (typeof v !== "string" || v.length === 0) {
      throw badRequest(`names[${i}] must be a non-empty string.`);
    }
    return v;
  });
}

/** GET /api/skills: Skill library groups & metadata (any logged-in user; no Project check). */
export function skillLibraryRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get("/", (c) => c.json(libraryResponse()));
  return app;
}

/** /api/projects/:p/agents/:a/skills: read, install, and uninstall are all Project-member operations. */
export function agentSkillsRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const listResponse = async (
    projectId: string,
    agentId: string,
  ): Promise<AgentSkillsResponse> => ({
    skills: (await listInstalledSkills(deps.config.root, projectId, agentId)).map(toMetadataItem),
  });

  app.get("/", async (c) => {
    // Defensive id validation happens before any path construction (FD-4: prevents path traversal for cross-Project privilege escalation).
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    return c.json(await listResponse(projectId, agentId));
  });

  app.post("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    const names = parseInstallNames(await readJson(c));
    // Verify all names up front before writing anything: if any name isn't in the library, reject the whole request rather than leaving a half-installed state.
    const skills: LibrarySkill[] = names.map((name) => {
      const skill = librarySkill(name);
      if (!skill) throw new HttpError(404, "unknown_skill", `Skill is not in the library: ${name}`);
      return skill;
    });
    for (const skill of skills) {
      await installSkill(deps.config.root, projectId, agentId, skill);
    }
    return c.json(await listResponse(projectId, agentId), 201);
  });

  app.delete("/:name", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const name = requireValidId(c, "name");
    // Installed-check uses the same criterion as listInstalledSkills: skills/<name>/SKILL.md exists.
    const file = path.join(skillsDir(deps.config.root, projectId, agentId), name, "SKILL.md");
    try {
      await fs.access(file);
    } catch {
      throw new HttpError(404, "not_found", `Skill is not installed: ${name}`);
    }
    await removeSkill(deps.config.root, projectId, agentId, name);
    return c.body(null, 204);
  });

  return app;
}
