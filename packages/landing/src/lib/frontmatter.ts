/**
 * Minimal frontmatter parser for blog posts: a leading `---` block of `key: value`
 * lines (values may contain colons; quotes optional). Kept dependency-free and pure
 * so it is unit-testable without Vite.
 */

export interface Frontmatter {
  meta: Record<string, string>;
  body: string;
}

export function parseFrontmatter(raw: string): Frontmatter {
  const normalized = raw.replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized);
  if (!match) return { meta: {}, body: normalized.trim() };
  const meta: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) meta[key] = value;
  }
  return { meta, body: normalized.slice(match[0].length).trim() };
}
