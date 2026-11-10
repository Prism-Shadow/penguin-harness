/**
 * A Skill's metadata, read from the frontmatter at the head of its SKILL.md — the library's copy
 * and an installed copy alike (files are the runtime truth on both sides).
 */
import { parseFrontmatter } from "@prismshadow/skills";
import { readLegacyFrontmatter } from "./legacy-skill-frontmatter.js";
import { parsePluginVersion } from "./versions.js";

/** A skill's metadata. A library SKILL.md's frontmatter carries `name`, `description` and the skill's own `version`; the short descriptions are stamped from the plugin's card by the loader (installed copies then carry the full generated frontmatter, which is what the installed-side readers parse). */
export interface SkillMetadata {
  /** Skill name (matches its containing directory name). */
  name: string;
  /** One-line description; injected into the model prompt via `{{SKILL_METADATA}}`. */
  description: string;
  /** UI short description (frontmatter `short_description`, optional): preferred in compact spots like cards, falls back to the full description if missing; not injected into the prompt. */
  shortDescription?: string;
  /** Chinese short description (frontmatter `short_description_zh`, optional). */
  shortDescriptionZh?: string;
  /** The skill's own version, `YYYY.MM.DD.N` (an installed copy may still carry the legacy `YYYY-MM-DD.N`); an absent or malformed frontmatter version reads as "" (older than any real version). A library skill always carries a real one. */
  version: string;
}

/**
 * Parses the frontmatter at the start of SKILL.md with the repository's one SKILL.md parser,
 * `parseFrontmatter` from @prismshadow/skills (vendored from vercel-labs/skills, YAML), and maps
 * its data to SkillMetadata. A non-string scalar (a bare number or boolean) is read through
 * String(); a list or mapping value is ignored. An older installed copy whose block is not
 * valid YAML — an unquoted `: ` inside a value, which the earlier line-based writer produced —
 * is still read line by line (see ./legacy-skill-frontmatter.ts).
 * Error tolerance: returns null if the `---` block or name is missing, or the block is not a
 * mapping; a version in neither the current `YYYY.MM.DD.N` nor the legacy `YYYY-MM-DD.N`
 * spelling reads as "".
 */
export function parseSkillFrontmatter(content: string): SkillMetadata | null {
  // Strip a possible UTF-8 BOM (may be introduced by editors when manually editing an installed SKILL.md).
  const text = content.replace(/^﻿/, "");
  let fields: Record<string, string> | null;
  try {
    fields = scalarFields(parseFrontmatter(text).data);
  } catch {
    fields = readLegacyFrontmatter(text);
  }
  if (!fields) return null;
  const name = fields["name"];
  if (!name) return null;
  const version = fields["version"] ?? "";
  const shortDescription = fields["short_description"];
  const shortDescriptionZh = fields["short_description_zh"];
  return {
    name,
    description: fields["description"] ?? "",
    // short_description(_zh) is optional: omitted when absent (undefined keys aren't set).
    ...(shortDescription !== undefined ? { shortDescription } : {}),
    ...(shortDescriptionZh !== undefined ? { shortDescriptionZh } : {}),
    // An installed copy may carry either spelling; both are real versions (see parsePluginVersion).
    version: parsePluginVersion(version) !== null ? version : "",
  };
}

/** The scalar fields of parsed frontmatter as strings; null when the data is not a mapping. A null value counts as absent. */
function scalarFields(data: unknown): Record<string, string> | null {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") fields[key] = value;
    else if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint")
      fields[key] = String(value);
  }
  return fields;
}
