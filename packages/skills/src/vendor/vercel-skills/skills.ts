// Vendored from https://github.com/vercel-labs/skills, file src/skills.ts (parseSkillMd only),
// at commit 18f96ea131dab3b0fcc9b27cf7c6f6cbb6174680.
// MIT, Copyright (c) 2026 Vercel, Inc. (see ./LICENSE).
// Local changes: this header; formatted with this repository's prettier; parseSkillMd returns
// the reason string instead of printing it via warnSkippedSkill and returning null; dropped the
// internal-skill filter (shouldInstallInternalSkills / includeInternal), the display sanitizing
// (sanitizeMetadata, stripTerminalEscapes), the returned path and rawContent, and the rest of
// the file (discovery, plugin manifests, lock files); imports frontmatter.js instead of .ts.

import { readFile } from "fs/promises";
import { parseFrontmatter } from "./frontmatter.js";

export interface ParsedSkill {
  name: string;
  description: string;
  metadata?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The parsed skill, or the reason upstream would have skipped it with. */
export async function parseSkillMd(skillMdPath: string): Promise<ParsedSkill | string> {
  let content: string;
  try {
    content = await readFile(skillMdPath, "utf-8");
  } catch (err) {
    return `failed to read file: ${(err as Error).message}`;
  }

  let data: Record<string, unknown>;
  try {
    ({ data } = parseFrontmatter(content));
  } catch (err) {
    return `YAML parse error: ${(err as Error).message}`;
  }

  if (!data.name || !data.description) {
    const missing: string[] = [];
    if (!data.name) missing.push("name");
    if (!data.description) missing.push("description");
    return `missing required frontmatter field(s): ${missing.join(", ")}`;
  }

  // Ensure name and description are strings (YAML can parse numbers, booleans, etc.)
  if (typeof data.name !== "string" || typeof data.description !== "string") {
    return `frontmatter "name" and "description" must be strings (got ${typeof data.name} and ${typeof data.description})`;
  }

  const metadata = isRecord(data.metadata) ? data.metadata : undefined;

  return {
    name: data.name,
    description: data.description,
    metadata,
  };
}
