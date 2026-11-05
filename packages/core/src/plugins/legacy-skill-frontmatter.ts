/**
 * The reading used before SKILL.md frontmatter was YAML, kept only as a compatibility layer
 * for installed copies the earlier line-based stamper wrote: every `key: value` line of the
 * first `---` block, split on the first colon, value trimmed and kept verbatim — so a value
 * may hold an unquoted `: `, which YAML rejects. parseSkillFrontmatter (./index.ts) calls it
 * only when the YAML parser throws; it is not a second parser for new content.
 *
 * TODO(skill-frontmatter-fallback): installed copies written before #964 may hold an unquoted
 * ": "; remove this module and its call once those are rewritten —
 * https://github.com/Prism-Shadow/penguin-harness/issues/963
 */
export function readLegacyFrontmatter(content: string): Record<string, string> | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) return null;
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    if (key) fields[key] = line.slice(idx + 1).trim();
  }
  return fields;
}
