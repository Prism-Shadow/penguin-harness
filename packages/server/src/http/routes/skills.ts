/**
 * Skill library & Agent-installed-Skills routes:
 *   GET /api/skills                                       # library groups & metadata (any logged-in user)
 *   GET|POST /api/projects/:p/agents/:a/skills            # installed list / install from library (any member)
 *   POST     /api/projects/:p/agents/:a/skills/template-placeholder  # insert/migrate the {{SKILLS}} placeholder (any member)
 *   POST     /api/projects/:p/agents/:a/skills/archive    # install one skill from an uploaded zip (any member)
 *   GET      /api/projects/:p/agents/:a/skills/:name/archive  # export one installed skill as a zip (any member)
 *   DELETE   /api/projects/:p/agents/:a/skills/:name      # uninstall (any member)
 * Installing writes the library's SKILL.md verbatim to agent_state/skills/<name>/;
 * reinstalling overwrites with the library content (i.e. an update). The archive routes
 * are symmetric: POST writes every zip file under skills/<name>/ (replace semantics with
 * `overwrite`), GET packs the whole directory back under a single top-level <name>/ so
 * the download round-trips through the POST unchanged. The scope is small enough to skip
 * a service layer — routes call core's disk-writing functions directly.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { unzipSync, strFromU8, zipSync } from "fflate";
import { Hono } from "hono";
import {
  installSkill,
  listInstalledSkills,
  removeSkill,
  skillsDir,
} from "@prismshadow/penguin-core";
import {
  loadSkillGroups,
  parseSkillFrontmatter,
  SKILL_NAME_PATTERN,
} from "@prismshadow/penguin-skills";
import type { SkillMetadata } from "@prismshadow/penguin-skills";
import type {
  AgentSkillsResponse,
  SkillLibraryResponse,
  SkillMetadataItem,
} from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { AppDeps } from "../../app.js";
import { HttpError } from "../errors.js";
import {
  badRequest,
  optionalStringArray,
  readJson,
  requireString,
  requireValidId,
} from "../validate.js";
import { resolveLibrarySkills } from "../../services/skill-library.js";
import {
  MAX_ARCHIVE_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  skillTooLarge,
} from "../../services/skill-import-limits.js";

/** Decoded zip cap: aligned with the Agent snapshot import (stays within the 20MB body limit after base64). */
const MAX_ARCHIVE_BYTES = 14 * 1024 * 1024;
/** Uncompressed limits (guard against zip bombs): entry count / per-file / total. */

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
 * match SKILL_NAME_PATTERN.
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
  if (!SKILL_NAME_PATTERN.test(name)) {
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
 * Version for the export filename: only an explicit frontmatter `version:` field that
 * parses as a natural number yields a `-v<version>` filename suffix — parseSkillFrontmatter
 * defaults a missing field to 1, which must not be baked into a filename as if declared.
 * Mirrors the parser's frontmatter rules (first `---` block, `key: value` split on the
 * first colon, BOM/CRLF tolerated).
 */
function explicitSkillVersion(skillMd: string): number | null {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skillMd.replace(/^\uFEFF/, ""))?.[1];
  if (block === undefined) return null;
  for (const line of block.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0 || line.slice(0, idx).trim() !== "version") continue;
    const version = Number.parseInt(line.slice(idx + 1).trim(), 10);
    return Number.isInteger(version) && version >= 1 ? version : null;
  }
  return null;
}

/** Validate the POST request body: names must be a non-empty array of strings. */
function parseInstallNames(body: Record<string, unknown>): string[] {
  // Install requires at least one name (unlike the optional field on Agent creation), so the
  // array shape is checked here and the per-entry check is left to the shared validator.
  if (!Array.isArray(body.names) || body.names.length === 0) {
    throw badRequest("names must be a non-empty array.");
  }
  return optionalStringArray(body, "names") ?? [];
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

  // Insert (or migrate a legacy hardcoded # Skills section to) the {{SKILLS}} placeholder —
  // the explicit adoption path mirroring memory's endpoint; idempotent config write,
  // member-level like every other mutation on this router.
  app.post("/template-placeholder", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    const view = await deps.agentConfigService.insertTemplatePlaceholder(
      projectId,
      agentId,
      "skills",
    );
    return c.json(view.config.skills);
  });

  app.post("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    const names = parseInstallNames(await readJson(c));
    // Verify all names up front before writing anything: if any name isn't in the library, reject the whole request rather than leaving a half-installed state.
    const skills = resolveLibrarySkills(names);
    for (const skill of skills) {
      await installSkill(deps.config.root, projectId, agentId, skill);
    }
    return c.json(await listResponse(projectId, agentId), 201);
  });

  // Install one skill from an uploaded zip. Like the library POST this touches only the
  // files (no runtime invalidation): skills are read from disk on demand, so the next
  // prompt assembly already sees the new content.
  app.post("/archive", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
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
    // Replace semantics (same as reinstalling from the library): drop the old directory
    // first so no stale file survives, then write every archive file (subdirectories kept).
    await fs.rm(dir, { recursive: true, force: true });
    for (const [rel, data] of skill.files) {
      const file = path.join(dir, rel);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, data);
    }
    return c.json(await listResponse(projectId, agentId), 201);
  });

  // Export one installed skill as a zip: served verbatim as an attachment (same shape as
  // the snapshot export / trace download — a direct binary body, not a JSON envelope), so
  // what's downloaded can be re-imported byte-compatibly via the POST archive route.
  app.get("/:name/archive", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.projectService.requireProjectAccess(c.var.user.userId, projectId);
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
