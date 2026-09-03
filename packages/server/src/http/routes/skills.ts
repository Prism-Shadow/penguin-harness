/**
 * An Agent's installed Skills:
 *   GET      /api/projects/:p/agents/:a/skills            # installed list (any member)
 *   POST     /api/projects/:p/agents/:a/skills/template-placeholder  # insert/migrate the {{SKILLS}} placeholder (any member)
 *   POST     /api/projects/:p/agents/:a/skills/archive    # install one skill from an uploaded zip (any member)
 *   GET      /api/projects/:p/agents/:a/skills/:name/archive  # export one installed skill as a zip (any member)
 *   DELETE   /api/projects/:p/agents/:a/skills/:name      # uninstall (any member)
 * Installing from the library goes through the plugin routes (plugins.ts), which write each
 * of a plugin's skills to agent_state/skills/<name>/. The archive routes are symmetric: POST
 * writes every zip file under skills/<name>/ (replace semantics with `overwrite`), GET packs
 * the whole directory back under a single top-level <name>/ so the download round-trips
 * through the POST unchanged. The scope is small enough to skip a service layer — routes
 * call core's disk-writing functions directly.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { unzipSync, strFromU8, zipSync } from "fflate";
import { Hono } from "hono";
import {
  listInstalledSkills,
  removeSkill,
  replaceSkillDirectory,
  skillsDir,
  parseSkillFrontmatter,
  PLUGIN_NAME_PATTERN,
} from "@prismshadow/penguin-core";
import type { AgentSkillsResponse } from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { ServerConfig } from "../../config.js";
import type { AgentConfigService } from "../../services/agent-config-service.js";
import type { ProjectAccess } from "../../services/project-access.js";

/** What this route group reaches — bound by its module (src/modules). */
export interface SkillsRouteDeps {
  agentConfigService: AgentConfigService;
  config: ServerConfig;
  access: ProjectAccess;
}
import { HttpError } from "../errors.js";
import { badRequest, readJson, requireString, requireValidId } from "../validate.js";
import { toSkillItem } from "../../services/plugin-library.js";
import {
  MAX_ARCHIVE_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  skillTooLarge,
} from "../../services/skill-import-limits.js";
import { Bind, Component } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";

/** Decoded zip cap: aligned with the Agent snapshot import (stays within the 20MB body limit after base64). */
const MAX_ARCHIVE_BYTES = 14 * 1024 * 1024;

/**
 * Validates one zip entry path (zip-slip guard): rejects absolute paths (leading "/" or a
 * drive letter), backslashes and any ".." segment — a malicious archive must never write
 * outside the target Skill directory.
 */
function assertSafeEntryPath(name: string): void {
  if (name.includes("\\")) throw badRequest(`Invalid zip entry path (backslash): ${name}`);
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) {
    throw badRequest(`Invalid zip entry path (absolute): ${name}`);
  }
  if (name.split("/").some((segment) => segment === "..")) {
    throw badRequest(`Invalid zip entry path (traversal): ${name}`);
  }
}

/** A skill decoded from an uploaded zip: name + file bytes keyed by path relative to the skill directory. */
interface ArchiveSkill {
  name: string;
  files: Map<string, Uint8Array>;
}

/**
 * Decodes and validates an uploaded skill zip. Accepted layouts: SKILL.md at the zip root
 * (name comes from frontmatter), or exactly one top-level directory containing SKILL.md
 * (the directory name is the Skill name, consistent with listInstalledSkills where the
 * directory name always wins). Directory entries are ignored (paths recreate them); every
 * file path is zip-slip-checked and the count/size limits enforced before anything is
 * returned. Frontmatter must parse to a non-null name, and the resolved Skill name must
 * match PLUGIN_NAME_PATTERN.
 */
function parseSkillArchive(archive: Buffer): ArchiveSkill {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(archive));
  } catch {
    throw badRequest("dataBase64 is not a valid zip archive.");
  }
  const files = Object.entries(entries).filter(([name]) => !name.endsWith("/"));
  if (files.length === 0) throw badRequest("The zip archive contains no files.");
  if (files.length > MAX_ARCHIVE_FILES) {
    throw badRequest(`The zip archive exceeds the ${MAX_ARCHIVE_FILES}-file limit.`);
  }
  let total = 0;
  for (const [name, data] of files) {
    assertSafeEntryPath(name);
    if (data.byteLength > MAX_FILE_BYTES) {
      throw badRequest(`Zip entry exceeds the 5MB uncompressed limit: ${name}`);
    }
    total += data.byteLength;
    if (total > MAX_TOTAL_BYTES) {
      throw badRequest("The zip archive exceeds the 20MB uncompressed limit.");
    }
  }
  const names = files.map(([name]) => name);
  let prefix = "";
  let dirName: string | undefined;
  if (!names.includes("SKILL.md")) {
    const topLevels = new Set(names.map((name) => name.split("/", 1)[0]!));
    dirName = topLevels.size === 1 ? [...topLevels][0] : undefined;
    if (dirName === undefined || !names.includes(`${dirName}/SKILL.md`)) {
      throw badRequest(
        "The zip must contain SKILL.md at its root, or exactly one top-level directory containing SKILL.md.",
      );
    }
    prefix = `${dirName}/`;
  }
  const meta = parseSkillFrontmatter(strFromU8(entries[`${prefix}SKILL.md`]!));
  if (meta === null) {
    throw badRequest("SKILL.md must start with a frontmatter block that sets `name`.");
  }
  const name = dirName ?? meta.name;
  if (!PLUGIN_NAME_PATTERN.test(name)) {
    throw badRequest(
      `Invalid skill name ${JSON.stringify(name)}: only letters, digits, "_" and "-" are allowed.`,
    );
  }
  return { name, files: new Map(files.map(([n, data]) => [n.slice(prefix.length), data])) };
}

/**
 * Recursively collects an installed skill directory as zip entries under a single
 * top-level `<name>/` directory (subpaths preserved, "/" separators), so the export
 * round-trips through the POST archive route unchanged. Symlinks and other non-regular
 * entries are skipped (nothing outside the directory can leak). The import caps apply
 * on the way out too — a directory exceeding them couldn't be re-imported anyway.
 */
async function collectSkillArchive(dir: string, name: string): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {};
  let count = 0;
  let total = 0;
  const walk = async (abs: string, rel: string): Promise<void> => {
    for (const entry of await fs.readdir(abs, { withFileTypes: true })) {
      const absChild = path.join(abs, entry.name);
      const relChild = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(absChild, relChild);
        continue;
      }
      if (!entry.isFile()) continue;
      count += 1;
      const data = new Uint8Array(await fs.readFile(absChild));
      total += data.byteLength;
      if (
        count > MAX_ARCHIVE_FILES ||
        data.byteLength > MAX_FILE_BYTES ||
        total > MAX_TOTAL_BYTES
      ) {
        throw skillTooLarge();
      }
      out[relChild] = data;
    }
  };
  await walk(dir, name);
  return out;
}

/**
 * Version for the export filename: only a frontmatter `version:` that is a real
 * `YYYY-MM-DD.N` yields a `-v<version>` filename suffix — a missing or malformed field (the
 * parser reads either as "") must not be baked into a filename as if declared.
 */
function explicitSkillVersion(skillMd: string): string | null {
  return parseSkillFrontmatter(skillMd)?.version || null;
}

/** /api/projects/:p/agents/:a/skills: read, import/export and uninstall are all Project-member operations. */
export function agentSkillsRoutes(deps: SkillsRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const listResponse = async (
    projectId: string,
    agentId: string,
  ): Promise<AgentSkillsResponse> => ({
    skills: (await listInstalledSkills(deps.config.root, projectId, agentId)).map(toSkillItem),
  });

  app.get("/", async (c) => {
    // Defensive id validation happens before any path construction: prevents path traversal for cross-Project privilege escalation.
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    return c.json(await listResponse(projectId, agentId));
  });

  // Insert (or migrate a legacy hardcoded # Skills section to) the {{SKILLS}} placeholder —
  // the explicit adoption path mirroring memory's endpoint; idempotent config write,
  // member-level like every other mutation on this router.
  app.post("/template-placeholder", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    const view = await deps.agentConfigService.insertTemplatePlaceholder(
      projectId,
      agentId,
      "skills",
    );
    return c.json(view.config.skills);
  });

  // Install one skill from an uploaded zip. Like a library install this touches only the
  // files (no runtime invalidation): skills are read from disk on demand, so the next
  // prompt assembly already sees the new content.
  app.post("/archive", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    const body = await readJson(c);
    const dataBase64 = requireString(body, "dataBase64", { minLen: 1, maxLen: 20 * 1024 * 1024 });
    const overwrite = body.overwrite === true;
    let archive: Buffer;
    try {
      archive = Buffer.from(dataBase64, "base64");
    } catch {
      throw badRequest("dataBase64 is not valid base64.");
    }
    if (archive.byteLength === 0) throw badRequest("The zip archive is empty.");
    if (archive.byteLength > MAX_ARCHIVE_BYTES) {
      throw badRequest("The zip archive exceeds the 14MB limit.");
    }
    const skill = parseSkillArchive(archive);
    const dir = path.join(skillsDir(deps.config.root, projectId, agentId), skill.name);
    // Installed-check uses the same criterion as listInstalledSkills: skills/<name>/SKILL.md exists.
    if (!overwrite) {
      const installed = await fs.access(path.join(dir, "SKILL.md")).then(
        () => true,
        () => false,
      );
      if (installed) {
        throw new HttpError(409, "skill_exists", `Skill is already installed: ${skill.name}`);
      }
    }
    // Replace semantics (same as reinstalling from the library): the archive's files are
    // staged and swapped in, so no stale file survives and an interrupted import leaves no
    // half-written Skill behind (subdirectories kept).
    await replaceSkillDirectory(dir, skill.files);
    return c.json(await listResponse(projectId, agentId), 201);
  });

  // Export one installed skill as a zip: served verbatim as an attachment (same shape as
  // the snapshot export / trace download — a direct binary body, not a JSON envelope), so
  // what's downloaded can be re-imported byte-compatibly via the POST archive route.
  app.get("/:name/archive", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    const name = requireValidId(c, "name");
    const dir = path.join(skillsDir(deps.config.root, projectId, agentId), name);
    // Installed-check uses the same criterion as listInstalledSkills: skills/<name>/SKILL.md exists.
    try {
      await fs.access(path.join(dir, "SKILL.md"));
    } catch {
      throw new HttpError(404, "not_found", `Skill is not installed: ${name}`);
    }
    const archiveFiles = await collectSkillArchive(dir, name);
    // A -v<version> suffix only when the frontmatter declares one explicitly (the header
    // is the authority on the filename — the web tab reads it from Content-Disposition).
    const version = explicitSkillVersion(strFromU8(archiveFiles[`${name}/SKILL.md`]!));
    const fileName = version === null ? `${name}.zip` : `${name}-v${version}.zip`;
    const zip = zipSync(archiveFiles);
    return new Response(new Uint8Array(zip), {
      headers: {
        "Content-Type": "application/zip",
        // The name is id-validated ([A-Za-z0-9_-]+), so the encoded filename is itself.
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });

  app.delete("/:name", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
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
