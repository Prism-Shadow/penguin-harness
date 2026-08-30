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
 * this reuses the archive import's caps (skill-import-limits.ts) and its walk discipline: **every**
 * file is read only after an `lstat`/`Dirent` says it is a regular file within the cap, so a
 * symlink cannot pull in a file outside the Skill directory, a FIFO or device node cannot block
 * the read forever, and an oversized file is refused before it is in memory rather than after.
 * A directory without a parseable `SKILL.md` is not a Skill and is passed over rather than
 * reported — these trees hold plenty that was never meant to be installed — and so is a Skill
 * whose files cannot be read or exceed the caps: one bad Skill must not hide the rest.
 *
 * Discovery is metadata-only. Auxiliary files are the installable payload, so they are read for
 * the names actually picked (`resolveDirectorySkills`) and never for a listing.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parseSkillFrontmatter, SKILL_NAME_PATTERN } from "@prismshadow/penguin-plugins";
import type { SkillMetadata } from "@prismshadow/penguin-plugins";
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
 * What discovery returns: everything a picker needs, plus the resolved directory so an install
 * can go back for the payload. Never serialized — the route projects through `toMetadataItem`.
 */
export interface DirectorySkillEntry extends Omit<DirectorySkill, "files"> {
  /** Absolute path of the Skill's own directory. */
  abs: string;
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
 * Mirrors core's `assertSafeSkillFile`, so a path the writer would reject is passed over here
 * rather than becoming a bare `Error` — a 500 — inside `installSkill`, after the Agent directory
 * already exists. A backslash in a filename is legal on Linux and common in trees copied from
 * Windows, so this is reachable without anything hostile.
 */
function isSafeSkillFilePath(rel: string): boolean {
  return (
    rel.length > 0 &&
    !path.isAbsolute(rel) &&
    !rel.includes("\\") &&
    !rel.split("/").some((segment) => segment === "..")
  );
}

/**
 * Reads one of a Skill's two named files (`SKILL.md`, `icon.svg`), or undefined when it is not
 * there. `lstat` first, and only a regular file within the per-file cap is read: a symlink named
 * `icon.svg` is how a file outside the Skill directory would otherwise be handed back verbatim in
 * a listing, a FIFO would block the read (and its libuv threadpool thread) forever, and a size
 * taken from the stat refuses an oversized file before it is in memory rather than after.
 */
async function readSkillFile(file: string): Promise<string | undefined> {
  let stat;
  try {
    stat = await fs.lstat(file);
  } catch {
    return undefined;
  }
  if (!stat.isFile()) return undefined;
  if (stat.size > MAX_FILE_BYTES) throw skillTooLarge();
  return fs.readFile(file, "utf8");
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
      if (!isSafeSkillFilePath(relChild)) continue;
      const child = path.join(abs, entry.name);
      // The caps come off the stat, so an oversized file never reaches the heap.
      const size = (await fs.stat(child)).size;
      count += 1;
      total += size;
      if (count > MAX_ARCHIVE_FILES || size > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES) {
        throw skillTooLarge();
      }
      files[relChild] = await fs.readFile(child, "utf8");
    }
  };
  await walk(dir, "");
  return files;
}

/** One candidate directory's metadata, or null when it is not an installable Skill. */
async function readSkillEntry(
  abs: string,
  name: string,
  source: SkillSourceDir,
): Promise<DirectorySkillEntry | null> {
  const content = await readSkillFile(path.join(abs, "SKILL.md"));
  if (content === undefined) return null;
  const metadata = parseSkillFrontmatter(content);
  if (!metadata) return null;
  const icon = await readSkillFile(path.join(abs, "icon.svg"));
  return {
    ...metadata,
    // The directory name is authoritative: it is what the Skill installs as, and frontmatter
    // that disagrees with its own directory would install under a name the user did not pick.
    name,
    content,
    ...(icon !== undefined ? { icon } : {}),
    source,
    abs,
  };
}

/**
 * Every installable Skill under `dir`, name-sorted. An absent or empty `.agents/skills` and
 * `.claude/skills` is a quiet empty list, not an error — pointing at a directory that simply has
 * no Skills is a normal thing to do.
 */
export async function discoverDirectorySkills(dir: string): Promise<DirectorySkillEntry[]> {
  const byName = new Map<string, DirectorySkillEntry>();
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
      // One Skill that cannot be read — an unreadable file, an oversized SKILL.md — is passed
      // over like any other non-installable directory, rather than failing the whole listing.
      const skill = await readSkillEntry(
        path.join(root.abs, entry.name),
        entry.name,
        root.source,
      ).catch(() => null);
      if (skill) byName.set(entry.name, skill);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Resolves picked names against a directory, in the order given — the same
 * everything-before-anything-is-written contract as `resolveLibrarySkills`, so a name that is no
 * longer there fails before the Agent exists rather than leaving it half-seeded. The auxiliary
 * files are read here and only here: they are the installable payload, and a listing must not
 * cost the payload of every Skill in the checkout.
 */
export async function resolveDirectorySkills(
  dir: string,
  names: readonly string[],
): Promise<DirectorySkill[]> {
  if (names.length === 0) return [];
  const found = new Map((await discoverDirectorySkills(dir)).map((s) => [s.name, s]));
  const picked = names.map((name) => {
    const skill = found.get(name);
    if (!skill) {
      throw new HttpError(404, "unknown_skill", `Skill is not in ${dir}: ${name}`);
    }
    return skill;
  });
  return Promise.all(
    picked.map(async ({ abs, ...skill }) => {
      const files = await readAuxiliaryFiles(abs);
      return { ...skill, ...(Object.keys(files).length > 0 ? { files } : {}) };
    }),
  );
}
