/**
 * Skills read from a directory the user picked, rather than from the built-in library.
 *
 * A coding agent writes its Skills into one of two places in a checkout — `.agents/skills/` or
 * `.claude/skills/` — so both are read. `.claude` is very often a symlink to `.agents` (it is in
 * this repository), which would otherwise offer every Skill twice: the two roots are resolved
 * through `realpath` and a shared target is read once. Where both exist as real directories and
 * carry the same Skill name, `.agents` wins — it is the canonical location and `.claude` is the
 * compatibility alias.
 *
 * A directory the user points at is untrusted input in exactly the way an uploaded archive is, so
 * this reuses the archive import's caps (skill-import-limits.ts) and its walk discipline: symlinks
 * and other non-regular entries are skipped, so nothing outside the Skill directory can be pulled
 * in through one. A directory without a parseable `SKILL.md` is not a Skill and is passed over
 * rather than reported — these trees hold plenty that was never meant to be installed.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parseSkillFrontmatter, SKILL_NAME_PATTERN } from "@prismshadow/penguin-skills";
import type { SkillMetadata } from "@prismshadow/penguin-skills";
import { HttpError } from "../http/errors.js";
import {
  MAX_ARCHIVE_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  skillTooLarge,
} from "./skill-import-limits.js";

/** The two layouts a coding agent writes, in precedence order: `.agents` wins a name collision. */
export const SKILL_SOURCE_DIRS = [".agents/skills", ".claude/skills"] as const;

export type SkillSourceDir = (typeof SKILL_SOURCE_DIRS)[number];

/** A Skill found on disk: library-shaped, so `installSkill` takes it unchanged. */
export interface DirectorySkill extends SkillMetadata {
  content: string;
  icon?: string;
  files?: Record<string, string>;
  /** Which of the two layouts it came from — shown in the picker so the origin is visible. */
  source: SkillSourceDir;
}

/**
 * The distinct Skill roots under `dir`, in precedence order. A missing or unreadable root is
 * skipped; two roots resolving to the same real directory (the `.claude` → `.agents` symlink)
 * collapse to one, so its Skills are offered once.
 */
async function resolveSkillRoots(
  dir: string,
): Promise<Array<{ abs: string; source: SkillSourceDir }>> {
  const roots: Array<{ abs: string; source: SkillSourceDir }> = [];
  const seen = new Set<string>();
  for (const source of SKILL_SOURCE_DIRS) {
    let abs: string;
    try {
      abs = await fs.realpath(path.join(dir, source));
      if (!(await fs.stat(abs)).isDirectory()) continue;
    } catch {
      continue;
    }
    if (seen.has(abs)) continue;
    seen.add(abs);
    roots.push({ abs, source });
  }
  return roots;
}

/**
 * Auxiliary files a SKILL.md ships alongside it (`reference/API.md` and the like), with the
 * archive caps applied across the whole Skill. `SKILL.md` and `icon.svg` are handled by the
 * caller and excluded here so they are not written twice.
 */
async function readAuxiliaryFiles(dir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  let count = 0;
  let total = 0;
  const walk = async (abs: string, rel: string): Promise<void> => {
    for (const entry of await fs.readdir(abs, { withFileTypes: true })) {
      const relChild = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(abs, entry.name), relChild);
        continue;
      }
      // Non-regular entries are skipped, symlinks included: a link is how a file outside the
      // Skill directory would otherwise be read.
      if (!entry.isFile()) continue;
      if (relChild === "SKILL.md" || relChild === "icon.svg") continue;
      const data = await fs.readFile(path.join(abs, entry.name), "utf8");
      count += 1;
      total += Buffer.byteLength(data);
      if (count > MAX_ARCHIVE_FILES || Buffer.byteLength(data) > MAX_FILE_BYTES) {
        throw skillTooLarge();
      }
      if (total > MAX_TOTAL_BYTES) throw skillTooLarge();
      files[relChild] = data;
    }
  };
  await walk(dir, "");
  return files;
}

/** One candidate directory, or null when it is not an installable Skill. */
async function readSkillDir(
  abs: string,
  name: string,
  source: SkillSourceDir,
): Promise<DirectorySkill | null> {
  let content: string;
  try {
    content = await fs.readFile(path.join(abs, "SKILL.md"), "utf8");
  } catch {
    return null;
  }
  const metadata = parseSkillFrontmatter(content);
  if (!metadata) return null;
  const icon = await fs.readFile(path.join(abs, "icon.svg"), "utf8").catch(() => undefined);
  const files = await readAuxiliaryFiles(abs);
  return {
    ...metadata,
    // The directory name is authoritative: it is what the Skill installs as, and frontmatter
    // that disagrees with its own directory would install under a name the user did not pick.
    name,
    content,
    ...(icon !== undefined ? { icon } : {}),
    ...(Object.keys(files).length > 0 ? { files } : {}),
    source,
  };
}

/**
 * Every installable Skill under `dir`, name-sorted. An absent or empty `.agents/skills` and
 * `.claude/skills` is a quiet empty list, not an error — pointing at a directory that simply has
 * no Skills is a normal thing to do.
 */
export async function discoverDirectorySkills(dir: string): Promise<DirectorySkill[]> {
  const byName = new Map<string, DirectorySkill>();
  for (const root of await resolveSkillRoots(dir)) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(root.abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      // A symlinked Skill directory is not a directory to Dirent, so it is skipped here too.
      if (!entry.isDirectory() || !SKILL_NAME_PATTERN.test(entry.name)) continue;
      if (byName.has(entry.name)) continue; // earlier root wins: .agents over .claude
      const skill = await readSkillDir(path.join(root.abs, entry.name), entry.name, root.source);
      if (skill) byName.set(entry.name, skill);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Resolves picked names against a directory, in the order given — the same
 * everything-before-anything-is-written contract as `resolveLibrarySkills`, so a name that is no
 * longer there fails before the Agent exists rather than leaving it half-seeded.
 */
export async function resolveDirectorySkills(
  dir: string,
  names: readonly string[],
): Promise<DirectorySkill[]> {
  if (names.length === 0) return [];
  const found = new Map((await discoverDirectorySkills(dir)).map((s) => [s.name, s]));
  return names.map((name) => {
    const skill = found.get(name);
    if (!skill) {
      throw new HttpError(404, "unknown_skill", `Skill is not in ${dir}: ${name}`);
    }
    return skill;
  });
}
