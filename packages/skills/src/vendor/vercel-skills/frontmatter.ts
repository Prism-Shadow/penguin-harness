// Vendored from https://github.com/vercel-labs/skills, file src/frontmatter.ts,
// at commit 18f96ea131dab3b0fcc9b27cf7c6f6cbb6174680.
// MIT, Copyright (c) 2026 Vercel, Inc. (see ./LICENSE).
// Local changes: this header; formatted with this repository's prettier.

import { parse as parseYaml } from "yaml";

/**
 * Minimal frontmatter parser. Only supports YAML (the `---` delimiter).
 * Does NOT support `---js` / `---javascript` to avoid eval()-based RCE
 * that exists in gray-matter's built-in JS engine.
 */
export function parseFrontmatter(raw: string): {
  data: Record<string, unknown>;
  content: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, content: raw };
  const data = (parseYaml(match[1]!) as Record<string, unknown>) ?? {};
  return { data, content: match[2] ?? "" };
}
