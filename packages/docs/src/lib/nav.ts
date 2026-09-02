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
  id: "start" | "design" | "guides" | "reference";
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
        children: ["quickstart-desktop", "quickstart-cli", "quickstart-sdk"],
      },
    ],
  },
  { id: "guides", pages: pages("web-app", "goal-mode", "self-improvement") },
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
      "skills",
      "models",
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

/**
 * Pages whose successor is not the slug that follows them in the sidebar.
 *
 * The SDK route is the last of Quickstart's three, so linear order hands its reader the
 * Web App guide — a tour of the browser UI, for someone who just embedded the engine in
 * their own program. It continues into the interface contracts instead, which is also
 * where the page's own "next steps" point. Note this redirects only the forward link:
 * Core Interfaces keeps the predecessor its own position gives it.
 */
const NEXT_OVERRIDE: Record<string, string> = {
  "quickstart-sdk": "interfaces",
};

/** Pager targets for a page: sidebar order, unless it overrides its successor. */
export function pagerFor(slug: string): { prev: string | null; next: string | null } {
  const index = DOC_SLUGS.indexOf(slug);
  if (index === -1) return { prev: null, next: null };
  const linearNext = index < DOC_SLUGS.length - 1 ? DOC_SLUGS[index + 1]! : null;
  return {
    prev: index > 0 ? DOC_SLUGS[index - 1]! : null,
    next: NEXT_OVERRIDE[slug] ?? linearNext,
  };
}
