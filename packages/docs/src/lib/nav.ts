/**
 * Docs navigation: the single source of truth for sidebar sections, page order and
 * prev/next pagination. Section labels live in the strings dictionaries (S.sections);
 * page titles come from each Markdown file's frontmatter. Kept pure (no import.meta)
 * so the content-integrity test can import it under plain node.
 */

export interface DocsSectionDef {
  /** Section id — also the key into S.sections for the localized label. */
  id: "start" | "design" | "guides" | "reference";
  /** Page slugs in display order; content files are content/<slug>.<zh|en>.md. */
  slugs: string[];
}

export const DOCS_NAV: DocsSectionDef[] = [
  { id: "start", slugs: ["introduction", "installation", "quickstart"] },
  {
    id: "design",
    slugs: [
      "architecture",
      "omni-message",
      "agent-loop",
      "message-flow",
      "interfaces",
      "tools",
      "skills",
      "models",
      "sessions-and-traces",
    ],
  },
  { id: "guides", slugs: ["web-app", "self-improvement"] },
  { id: "reference", slugs: ["cli", "server-api", "configuration"] },
];

/** All slugs in display order (pagination order). */
export const DOC_SLUGS: string[] = DOCS_NAV.flatMap((section) => section.slugs);

/** The docs landing page ("/" renders this slug). */
export const HOME_SLUG = DOC_SLUGS[0]!;

export function sectionOf(slug: string): DocsSectionDef | undefined {
  return DOCS_NAV.find((section) => section.slugs.includes(slug));
}
