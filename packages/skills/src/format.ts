/**
 * Writes a SKILL.md frontmatter block. Not vendored: vercel-labs/skills only reads SKILL.md,
 * so this is the writing half that pairs with its `parseFrontmatter`
 * (./vendor/vercel-skills/frontmatter.ts) — a block written here reads back to the same values
 * through that parser and through any other YAML reader.
 */
import { stringify as stringifyYaml } from "yaml";

/** The fields of a block: an object, or `[key, value]` entries when the order is spelled out. */
export type FrontmatterFields = Record<string, unknown> | ReadonlyArray<readonly [string, unknown]>;

/**
 * A frontmatter block, `---\n<yaml>---`, holding `fields` in their order (an object's
 * insertion order, or the order of `[key, value]` entries); a field whose value is undefined
 * is left out. Values are quoted only where YAML needs it (a `: `, a leading `-` or quote, a
 * value that would read as a number or boolean), and `lineWidth: 0` keeps each value on one
 * line instead of folding long descriptions.
 */
export function formatFrontmatter(fields: FrontmatterFields): string {
  const entries: ReadonlyArray<readonly [string, unknown]> = Array.isArray(fields)
    ? (fields as ReadonlyArray<readonly [string, unknown]>)
    : Object.entries(fields as Record<string, unknown>);
  const present = Object.fromEntries(entries.filter(([, value]) => value !== undefined));
  return `---\n${stringifyYaml(present, { lineWidth: 0 })}---`;
}
