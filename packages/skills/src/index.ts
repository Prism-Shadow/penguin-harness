/**
 * PenguinHarness Skill library: built-in SKILL.md docs and skill group manifest.
 *
 * The runtime source of truth for library content is the package's `skills/<skill_name>/SKILL.md`
 * files: frontmatter is parsed on read (same rules as installed Skills), so editing a file takes
 * effect immediately with no caching (files are small, calls are infrequent). Only the skill group
 * manifest (id, title, and member names) is hardcoded in code; install / uninstall / scan still live
 * in core's state layer.
 *
 * Docs: packages/docs/content/skills.{zh,en}.md (site path /docs/skills) documents the Skill
 * format and the built-in library.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Skill's frontmatter metadata (four fields: name / description / version / updated; description itself is English-only, may also carry description_zh and short_description(_zh)). */
export interface SkillMetadata {
  /** Skill name (matches its containing directory name). */
  name: string;
  /** One-line description; injected into the model prompt via `{{SKILL_METADATA}}`. */
  description: string;
  /** UI short description (frontmatter `short_description`, optional): preferred in compact spots like cards, falls back to the full description if missing; not injected into the prompt. */
  shortDescription?: string;
  /** Chinese short description (frontmatter `short_description_zh`, optional). */
  shortDescriptionZh?: string;
  /** Version number (natural number); falls back to 1 on parse failure. */
  version: number;
  /** Update date (YYYY-MM-DD); defaults to "". */
  updated: string;
}

/** A Skill in the library: metadata + full SKILL.md content (including frontmatter, written as-is on install). */
export interface LibrarySkill extends SkillMetadata {
  content: string;
  /** Optional raw `icon.svg` content in the directory (custom icon, the file is the sole source, copied alongside SKILL.md on install); absent means none (frontend falls back to the default book icon). */
  icon?: string;
}

/** Skill group manifest entry: group id, title (optionally with a Chinese title, displayed per UI language), and member Skill names. */
export interface SkillGroupInfo {
  id: string;
  title: string;
  /** Chinese group title (optional, displayed per UI language). */
  titleZh?: string;
  /** Member Skill names (i.e., directory names under `skills/`). */
  skills: string[];
}

/** Grouping result: group metadata + member Skills read from library files. */
export interface ResolvedSkillGroup extends Omit<SkillGroupInfo, "skills"> {
  skills: LibrarySkill[];
}

/**
 * Parses the frontmatter at the start of SKILL.md: only recognizes `key: value` lines inside the
 * first `---` block (split on the first colon, value trimmed, values may themselves contain colons);
 * all fields are scalars, no YAML dependency needed.
 * Error tolerance: returns null if the `---` block or name is missing; version falls back to 1 if
 * it isn't a natural number; updated defaults to "".
 */
export function parseSkillFrontmatter(content: string): SkillMetadata | null {
  // Strip a possible UTF-8 BOM (may be introduced by editors when manually editing an installed SKILL.md); CRLF is handled by \r?\n.
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content.replace(/^\uFEFF/, ""));
  if (!match) return null;
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    if (key) fields[key] = line.slice(idx + 1).trim();
  }
  const name = fields["name"];
  if (!name) return null;
  const version = Number.parseInt(fields["version"] ?? "", 10);
  const shortDescription = fields["short_description"];
  const shortDescriptionZh = fields["short_description_zh"];
  return {
    name,
    description: fields["description"] ?? "",
    // short_description(_zh) is optional: omitted when absent (undefined keys aren't set).
    ...(shortDescription !== undefined ? { shortDescription } : {}),
    ...(shortDescriptionZh !== undefined ? { shortDescriptionZh } : {}),
    version: Number.isInteger(version) && version >= 1 ? version : 1,
    updated: fields["updated"] ?? "",
  };
}

/** Root directory of library files: the package's `skills/` (both dist/ and src/ sit one level below the package root, so one level up reaches it). */
const SKILLS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "skills");

/** Character rule for Skill names (directory names): prevents path traversal. */
const SKILL_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Reads a single library directory to construct a LibrarySkill; returns undefined if SKILL.md
 * doesn't exist. name is taken from the directory name (overriding frontmatter); falls back to
 * empty metadata if frontmatter parsing fails.
 * The optional icon.svg in the directory is read alongside it (as a raw string); the icon field
 * is omitted if missing.
 */
function readSkillDir(name: string): LibrarySkill | undefined {
  const dir = path.join(SKILLS_ROOT, name);
  let content: string;
  try {
    content = fs.readFileSync(path.join(dir, "SKILL.md"), "utf8");
  } catch {
    return undefined;
  }
  let icon: string | undefined;
  try {
    icon = fs.readFileSync(path.join(dir, "icon.svg"), "utf8");
  } catch {
    // icon.svg is optional: no custom icon if missing.
  }
  const meta = parseSkillFrontmatter(content) ?? {
    name,
    description: "",
    version: 1,
    updated: "",
  };
  return { ...meta, name, content, ...(icon !== undefined ? { icon } : {}) };
}

/** Reads all Skills in the library (one per subdirectory under `skills/`), sorted by name. */
export function loadLibrarySkills(): LibrarySkill[] {
  const skills: LibrarySkill[] = [];
  for (const entry of fs.readdirSync(SKILLS_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skill = readSkillDir(entry.name);
    if (skill) skills.push(skill);
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Skill group manifest; members are library directory names.
 * Docs: /docs/skills § "Built-in library".
 */
export const SKILL_GROUPS: SkillGroupInfo[] = [
  {
    id: "office-productivity",
    title: "Office Productivity",
    titleZh: "办公效率",
    skills: ["data-analysis", "firecrawl"],
  },
  {
    id: "software-development",
    title: "Software Development",
    titleZh: "软件开发",
    skills: ["web-design", "software-engineering"],
  },
  {
    id: "ai-app-development",
    title: "AI App Development",
    titleZh: "AI 应用开发",
    skills: ["penguin-sdk", "penguin-cli", "agenthub-models", "vllm", "ollama", "llamafactory"],
  },
  {
    id: "agent-tuning",
    title: "Agent Tuning",
    titleZh: "Agent 调优",
    skills: ["agent-creation", "benchmark-design", "agent-evaluation", "agent-optimization"],
  },
];

/**
 * Groups library Skills according to SKILL_GROUPS (a member name missing from `all` is skipped);
 * Skills not listed in any group are appended to an Other group (only appears if non-empty). A
 * pure function, the testable core of loadSkillGroups.
 */
export function groupSkills(all: LibrarySkill[]): ResolvedSkillGroup[] {
  const byName = new Map(all.map((skill) => [skill.name, skill]));
  const grouped = new Set<string>();
  const groups: ResolvedSkillGroup[] = SKILL_GROUPS.map((group) => {
    const members: LibrarySkill[] = [];
    for (const name of group.skills) {
      const skill = byName.get(name);
      if (!skill) continue;
      members.push(skill);
      grouped.add(name);
    }
    return { ...group, skills: members };
  });
  const others = all.filter((skill) => !grouped.has(skill.name));
  if (others.length > 0) {
    groups.push({
      id: "other",
      title: "Other",
      titleZh: "其他",
      skills: others,
    });
  }
  return groups;
}

/** Reads library files and groups them: SKILL_GROUPS order comes first, ungrouped Skills are appended to an Other group (only appears if non-empty). */
export function loadSkillGroups(): ResolvedSkillGroup[] {
  return groupSkills(loadLibrarySkills());
}

/** Reads a single library Skill by name; returns undefined if the name contains illegal characters (path traversal guard) or doesn't exist. */
export function librarySkill(name: string): LibrarySkill | undefined {
  if (!SKILL_NAME_PATTERN.test(name)) return undefined;
  return readSkillDir(name);
}
