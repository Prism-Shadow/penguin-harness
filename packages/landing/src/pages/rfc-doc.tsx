/**
 * One RFC document's page: the raw Markdown (title, provenance marker, body) rendered through
 * the shared site prose's doc variant, with the section's left rail beside it. The route picks
 * the language — `/rfcs/<id>` for the English document, `/rfcs/<id>.zh` for the Chinese one —
 * and the document's own top links switch between them. Links written against the directory's
 * files (a pair's `.zh.md` / `.md`) map onto the in-site routes; everything else opens outside.
 */
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import {
  extractToc,
  highlightSiteCode,
  SITE_DOC_REMARK_PLUGINS,
  SiteCopyButton,
  SiteMarkdown,
  SiteToc,
  useActiveTocEntry,
} from "@prismshadow/penguin-ui/site";
import type { ReactNode } from "react";
import type { SiteMarkdownComponents } from "@prismshadow/penguin-ui/site";
import { RfcSidebar } from "../components/rfc-sidebar";
import { useDocumentMeta } from "../lib/document-meta";
import { repositoryHref, rfcDocumentOf } from "../lib/rfcs";
import { S } from "../lib/strings";

function RfcLink({ href = "", children }: { href?: string; children?: ReactNode }) {
  // A document's own links into the directory's files become the pair's in-site routes.
  if (!href.startsWith("http") && /^[A-Za-z0-9._-]+\.md$/.test(href)) {
    const id = href.replace(/\.md$/, "");
    return <Link to={`/rfcs/${id}`}>{children}</Link>;
  }
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
  a: ({ href, children }) => <RfcLink href={href}>{children}</RfcLink>,
};

export function RfcDocPage() {
  const { id = "" } = useParams();
  const found = rfcDocumentOf(id);
  const doc = found?.doc;
  const raw = found?.raw ?? "";
  useDocumentMeta(
    doc ? `${doc.title} | ${S.siteName}` : `${S.rfcs.title} | ${S.siteName}`,
    S.rfcs.description,
  );
  const toc = useMemo(() => extractToc(raw), [raw]);
  const { activeId, pinTo } = useActiveTocEntry(toc);

  if (!doc) {
    return (
      <div className="anim-rise px-4 py-10 sm:px-6 lg:px-10">
        <p className="mx-auto max-w-3xl text-lg font-medium">{S.rfcs.notFound}</p>
        <Link
          to="/rfcs"
          className="mx-auto mt-3 block max-w-3xl text-sm text-brand-700 hover:underline dark:text-brand-300"
        >
          {S.rfcs.backToIndex}
        </Link>
      </div>
    );
  }

  const pair = doc.zh ? rfcDocumentOf(doc.id) : rfcDocumentOf(`${doc.id}.zh`);
  const pairHref = pair ? inSite(pair.doc) : undefined;

  return (
    <div className="anim-rise px-4 py-10 sm:px-6 lg:px-10 xl:grid xl:grid-cols-[13rem_minmax(0,1fr)_13rem] xl:gap-8">
      <RfcSidebar />
      <article className="mx-auto w-full max-w-3xl xl:mx-0">
        <header>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link
              to="/rfcs"
              className="text-sm text-brand-700 hover:underline dark:text-brand-300"
            >
              {S.rfcs.backToIndex}
            </Link>
            <div className="flex items-center gap-2">
              {pairHref && (
                <Link
                  to={pairHref}
                  className="text-sm text-gray-500 hover:underline dark:text-gray-400"
                >
                  {doc.zh ? "English" : "中文"}
                </Link>
              )}
              <a
                href={repositoryHref(doc.file)}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-gray-500 hover:underline dark:text-gray-400"
              >
                {S.rfcs.github}
              </a>
              <SiteCopyButton
                text={raw}
                label={S.rfcs.copyMarkdown}
                announcement={S.rfcs.copied}
                look="pill-md"
              />
            </div>
          </div>
        </header>
        <SiteMarkdown
          variant="doc"
          className="mt-4"
          remarkPlugins={SITE_DOC_REMARK_PLUGINS}
          components={MD_COMPONENTS}
          highlight={highlightSiteCode}
        >
          {raw}
        </SiteMarkdown>
      </article>
      {toc.length >= 2 && (
        <SiteToc label={S.rfcs.toc} entries={toc} activeId={activeId} onNavigate={pinTo} />
      )}
    </div>
  );
}

function inSite(doc: { id: string; zh: boolean }): string {
  return doc.zh ? `/rfcs/${doc.id}.zh` : `/rfcs/${doc.id}`;
}
