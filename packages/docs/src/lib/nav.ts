/**
 * Docs navigation: the single source of truth for sidebar sections, page order and
 * prev/next pagination. Section labels live in the strings dictionaries (S.sections);
 * page titles come from each Markdown file's frontmatter. Kept pure (no import.meta)
 * so the content-integrity test can import it under plain node.
 *
 * A page may carry sub-pages, rendered indented under it in the sidebar: Quickstart is
 * an overview that branches into one page per installation route. Nesting is one level
 * deep on purpose — the sidebar shows every entry at once, and a deeper tree would need
 * collapsing to stay readable.
 */

export interface DocsPageDef {
  /** Page slug; content files are content/<slug>.<zh|en>.md. */
  slug: string;
  /** Sub-page slugs, in display order — indented under the parent, paginated after it. */
  children?: string[];
}

export interface DocsSectionDef {
  /** Section id — also the key into S.sections for the localized label. */
  id: "start" | "guides" | "advanced" | "design" | "reference";
  /** Pages in display order. */
  pages: DocsPageDef[];
}

/** Shorthand for the common case: a run of pages that have no sub-pages. */
function pages(...slugs: string[]): DocsPageDef[] {
  return slugs.map((slug) => ({ slug }));
}

export const DOCS_NAV: DocsSectionDef[] = [
  {
    id: "start",
    pages: [
      { slug: "introduction" },
      {
        slug: "quickstart",
        children: ["quickstart-desktop", "quickstart-cli", "quickstart-docker", "quickstart-sdk"],
      },
      { slug: "concepts" },
      { slug: "updates" },
    ],
  },
  {
    id: "guides",
    pages: pages(
      "web-app",
      "chat",
      "files",
      "schedules",
      "remote-control",
      "agents",
      "skills",
      "models",
      "usage",
      "settings",
    ),
  },
  {
    id: "advanced",
    pages: pages("evaluation-center", "self-improvement", "goal-mode", "company-mode"),
  },
  {
    id: "design",
    pages: pages(
      "architecture",
      "server-boot",
      "omni-message",
      "agent-loop",
      "message-flow",
      "interfaces",
      "tools",
      "sessions-and-traces",
    ),
  },
  { id: "reference", pages: pages("cli", "server-api", "configuration", "security") },
];

/** All slugs in display order — each parent immediately followed by its children. */
export const DOC_SLUGS: string[] = DOCS_NAV.flatMap((section) =>
  section.pages.flatMap((page) => [page.slug, ...(page.children ?? [])]),
);

/** The docs landing page ("/" renders this slug). */
export const HOME_SLUG = DOC_SLUGS[0]!;

export function sectionOf(slug: string): DocsSectionDef | undefined {
  return DOCS_NAV.find((section) =>
    section.pages.some((page) => page.slug === slug || page.children?.includes(slug)),
  );
}

/** Pager targets for a page: its neighbours in sidebar order. */
export function pagerFor(slug: string): { prev: string | null; next: string | null } {
  const index = DOC_SLUGS.indexOf(slug);
  if (index === -1) return { prev: null, next: null };
  return {
    prev: index > 0 ? DOC_SLUGS[index - 1]! : null,
    next: index < DOC_SLUGS.length - 1 ? DOC_SLUGS[index + 1]! : null,
  };
}
