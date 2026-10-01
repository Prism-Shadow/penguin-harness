/**
 * A Markdown document's leading frontmatter block, which a reader shows as metadata of its own
 * (a memory's fields, a Skill's card) rather than as text.
 */

/** The body without its frontmatter block: callers render the metadata fields themselves, so rendering the raw YAML too would only repeat them. */
export function bodyWithoutFrontmatter(content: string): string {
  return content.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}
