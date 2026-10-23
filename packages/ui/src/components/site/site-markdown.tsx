/**
 * A public-site article body: Markdown rendered in the sites' prose (site-prose.css), the same
 * for blog posts and doc pages. The renderer owns what both share — ## and ### headings carry
 * the ids `extractToc` lists, fenced blocks render as `SiteCodeBlock` (highlighted by the
 * `highlight` it is handed), a tab group from `remarkTabs` renders as `SiteCodeTabs`, and a run
 * of citations reads as one bracketed group (`rehypeCitations`, the last rehype plugin). The
 * host owns the rest: its plugin list (which Markdown it accepts, raw HTML included or not), its
 * link and image adapters (where a link opens, where an image is hosted), and its footnote
 * options (their ids and the list's label). Pass all of them as module-level constants:
 * react-markdown uses each component as an element type and re-runs its pipeline on a new plugin
 * list, so a fresh object per render remounts the body.
 *
 * Tables and citations are what the renderer adds to the host's rehype stage rather than leaving
 * to it: `rehypeMarkdownTables` runs after the host's own plugins (after the blog's `rehype-raw`,
 * so a table written as raw HTML is shaped too), boxing every table and classifying its cells for
 * markdown-table.css, exactly as a chat reply's are; `rehypeCitations` runs after it. The list is
 * rebuilt only when the host's own list changes, so a host's module-level constant keeps one
 * pipeline.
 *
 * `variant` picks the heading rhythm: `post` for a blog post's flowing text, `doc` for a
 * reference page's ruled sections.
 */
import { useMemo } from "react";
import type { ReactNode } from "react";
import Markdown from "react-markdown";
import type { Components, Options } from "react-markdown";
import { nodeText, parseTabLabels, readFencedCode, slugifyHeading } from "./markdown-text";
import type { HastElement } from "./markdown-text";
import type { CodeHighlighter } from "../content/code-block/highlight-options";
import { SITE_REHYPE_PLUGINS, SITE_REMARK_PLUGINS } from "../content/prose/markdown-plugins";
import { rehypeMarkdownTables } from "../content/prose/markdown-table";
import { rehypeCitations } from "./rehype-citations";
import { remarkCallout } from "./remark-callout";
import { remarkTabs } from "./remark-tabs";
import { SiteCodeBlock, SiteCodeHighlight, SiteCodeTabs } from "./site-code";

/**
 * A heading's id and classes. A heading written in Markdown arrives with neither and gets the id
 * `extractToc` lists; one the pipeline generated keeps its own, because something else names it:
 * the footnote list's label is the element every citation's `aria-describedby` points at.
 */
const headingProps = (
  id: string | undefined,
  className: string | undefined,
  children: ReactNode,
) => ({
  id: id ?? slugifyHeading(nodeText(children)),
  className: className ? `scroll-mt-20 ${className}` : "scroll-mt-20",
});

const BASE_COMPONENTS: Components = {
  h2: ({ id, className, children }) => (
    <h2 {...headingProps(id, className, children)}>{children}</h2>
  ),
  h3: ({ id, className, children }) => (
    <h3 {...headingProps(id, className, children)}>{children}</h3>
  ),
  pre: ({ node, children }) => {
    const { code, language } = readFencedCode(node as HastElement | undefined);
    // Not a fenced block (no text to show as code): leave it alone.
    if (!code) return <pre>{children}</pre>;
    return <SiteCodeBlock code={code} language={language} />;
  },
  div: ({ node, className, children, ...props }) => {
    if (className !== "md-tabs") {
      return (
        <div className={className} {...props}>
          {children}
        </div>
      );
    }
    const labels = parseTabLabels(
      (node as HastElement | undefined)?.properties?.["data-tab-labels"],
    );
    if (labels.length === 0) return <div className={className}>{children}</div>;
    return <SiteCodeTabs labels={labels}>{children}</SiteCodeTabs>;
  },
};

/** The docs' Markdown: GFM, plus tabbed code groups and boxed notes. */
export const SITE_DOC_REMARK_PLUGINS: NonNullable<Options["remarkPlugins"]> = [
  ...SITE_REMARK_PLUGINS,
  remarkTabs,
  remarkCallout,
];

/** A host's element adapters, react-markdown's `components` map. */
export type SiteMarkdownComponents = Components;
/** A host's plugin lists, as react-markdown takes them. */
export type SiteRemarkPlugins = Options["remarkPlugins"];
export type SiteRehypePlugins = Options["rehypePlugins"];
/** How Markdown becomes HTML: footnote ids, the footnote list's label and back-links. */
export type SiteRemarkRehypeOptions = NonNullable<Options["remarkRehypeOptions"]>;

export function SiteMarkdown({
  children,
  variant,
  remarkPlugins = SITE_REMARK_PLUGINS,
  rehypePlugins,
  remarkRehypeOptions,
  components,
  highlight,
  className = "",
}: {
  /** The Markdown body, frontmatter already removed. */
  children: string;
  variant: "post" | "doc";
  remarkPlugins?: Options["remarkPlugins"];
  /** The host's own rehype stage; the table and citation passes are appended after it. */
  rehypePlugins?: Options["rehypePlugins"];
  /** The Markdown-to-HTML step's options: a host that renders footnotes names and labels them. */
  remarkRehypeOptions?: SiteRemarkRehypeOptions;
  /** The host's element adapters (links, images), laid over the shared ones. */
  components?: Components;
  /** Highlights the fenced blocks (`highlightSiteCode` or any `CodeHighlighter`); none: plain. */
  highlight?: CodeHighlighter;
  /** Spacing from the host's layout. */
  className?: string;
}) {
  const merged = useMemo(() => ({ ...BASE_COMPONENTS, ...components }), [components]);
  const rehype = useMemo(
    () => [
      ...(rehypePlugins === undefined || rehypePlugins === null
        ? SITE_REHYPE_PLUGINS
        : [...rehypePlugins, rehypeMarkdownTables]),
      rehypeCitations,
    ],
    [rehypePlugins],
  );
  return (
    <div className={`site-prose ${className}`} data-variant={variant}>
      <SiteCodeHighlight.Provider value={highlight ?? null}>
        <Markdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehype}
          remarkRehypeOptions={remarkRehypeOptions}
          components={merged}
        >
          {children}
        </Markdown>
      </SiteCodeHighlight.Provider>
    </div>
  );
}
