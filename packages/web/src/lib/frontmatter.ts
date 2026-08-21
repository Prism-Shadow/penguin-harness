/**
 * Frontmatter helpers shared by the memory views (agents settings tab, chat side panel).
 */

/** The body without its frontmatter block: callers render the metadata fields themselves, so rendering the raw YAML too would only repeat them. */
export function bodyWithoutFrontmatter(content: string): string {
  return content.replace(/^\ufeff?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}
