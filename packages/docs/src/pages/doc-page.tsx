/**
 * Doc page: the Markdown body in the shared site prose (`SiteMarkdown`, the `doc` variant) with
 * the sticky "on this page" column on wide screens, a per-page Copy Markdown button, and
 * prev/next pagination following the sidebar order. The page picks the docs' Markdown dialect
 * (`SITE_DOC_REMARK_PLUGINS`: GFM, tabbed code groups and boxed notes) and supplies its link
 * adapter: internal links written as "/<slug>" navigate client-side, external ones open a new
 * tab.
 */
import { useMemo } from "react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import {
  ArrowRightIcon,
  extractToc,
  highlightSiteCode,
  SITE_DOC_REMARK_PLUGINS,
  SiteCopyButton,
  SiteMarkdown,
  SiteToc,
  useActiveTocEntry,
  useSiteLocale,
} from "@prismshadow/penguin-ui/site";
import type { SiteMarkdownComponents } from "@prismshadow/penguin-ui/site";
import { S } from "../lib/strings";
import { docMarkdown, docTitle, getDoc } from "../lib/docs";
import { HOME_SLUG, pagerFor, sectionOf } from "../lib/nav";

function Pager({ slug }: { slug: string }) {
  const { locale } = useSiteLocale();
  const { prev, next } = pagerFor(slug);
  const card = (target: string, dir: "prev" | "next") => (
    <Link
      to={target === HOME_SLUG ? "/" : `/${target}`}
      className={`group flex flex-col gap-1 rounded-xl border border-gray-200 p-4 transition-colors hover:border-gray-300 dark:border-gray-800 dark:hover:border-gray-700 ${
        dir === "next" ? "items-end text-right sm:col-start-2" : ""
      }`}
    >
      <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
        {dir === "prev" && <ArrowRightIcon className="h-3 w-3 rotate-180" />}
        {dir === "prev" ? S.doc.prev : S.doc.next}
        {dir === "next" && <ArrowRightIcon className="h-3 w-3" />}
      </span>
      <span className="text-sm font-medium group-hover:text-brand-700 dark:group-hover:text-brand-300">
        {docTitle(target, locale)}
      </span>
    </Link>
  );
  return (
    <div className="mt-10 grid gap-3 border-t border-gray-200 pt-6 sm:grid-cols-2 dark:border-gray-800">
      {prev && card(prev, "prev")}
      {next && card(next, "next")}
    </div>
  );
}

/** Internal "/<slug>" links -> client-side navigation; external links -> new tab. */
function MdLink({ href = "", children }: { href?: string; children?: ReactNode }) {
  if (href.startsWith("/")) {
    return <Link to={href}>{children}</Link>;
  }
  if (/^https?:\/\//.test(href)) {
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  }
  return <a href={href}>{children}</a>;
}

/** Module-level, so react-markdown keeps one element type across renders. */
const MD_COMPONENTS: SiteMarkdownComponents = {
  a: ({ href, children }) => <MdLink href={href}>{children}</MdLink>,
};

export function DocPage() {
  const { slug = HOME_SLUG } = useParams();
  const { locale } = useSiteLocale();
  const doc = getDoc(slug, locale);
  const section = sectionOf(slug);
  const toc = useMemo(() => (doc ? extractToc(doc.body) : []), [doc]);
  const { activeId, pinTo } = useActiveTocEntry(toc);

  if (!doc) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-24 text-center sm:px-6">
        <p className="text-lg font-medium">{S.doc.notFound}</p>
        <Link
          to="/"
          className="mt-4 inline-flex items-center gap-1.5 text-sm text-brand-700 hover:underline dark:text-brand-300"
        >
          <ArrowRightIcon className="h-3.5 w-3.5 rotate-180" />
          {S.doc.backHome}
        </Link>
      </div>
    );
  }

  const showToc = toc.length >= 2;

  return (
    <div
      className={`anim-rise px-4 py-10 sm:px-6 lg:px-10 ${
        showToc ? "xl:grid xl:grid-cols-[minmax(0,1fr)_13rem] xl:gap-10" : ""
      }`}
    >
      <article className="mx-auto w-full max-w-3xl xl:mx-0">
        <header>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              {section && (
                <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase dark:text-brand-300">
                  {S.sections[section.id]}
                </p>
              )}
              <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-balance">
                {doc.title}
              </h1>
            </div>
            <div className="pt-1.5">
              <SiteCopyButton
                text={docMarkdown(doc)}
                label={S.doc.copyMarkdown}
                announcement={S.doc.copied}
                look="pill-md"
              />
            </div>
          </div>
          {doc.description && (
            <p className="mt-3 text-[15px] text-gray-600 dark:text-gray-400">{doc.description}</p>
          )}
        </header>
        <SiteMarkdown
          variant="doc"
          className="mt-6"
          remarkPlugins={SITE_DOC_REMARK_PLUGINS}
          components={MD_COMPONENTS}
          highlight={highlightSiteCode}
        >
          {doc.body}
        </SiteMarkdown>
        <Pager slug={slug} />
      </article>
      {showToc && (
        <SiteToc label={S.doc.toc} entries={toc} activeId={activeId} onNavigate={pinTo} />
      )}
    </div>
  );
}
