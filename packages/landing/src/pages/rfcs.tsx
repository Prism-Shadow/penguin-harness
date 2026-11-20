/**
 * The RFC index page: the repository's design RFCs (PRFCs) as one docs-style section — the left
 * rail lists the index and every RFC, the body is the table of all RFCs (number, title, status),
 * the surface's conventions, and the directory's files. Each row's title links the document's
 * in-site page; the documents are read at build time and the page keeps no copy of them.
 */
import { useMemo } from "react";
import {
  extractToc,
  highlightSiteCode,
  SITE_DOC_REMARK_PLUGINS,
  SiteCopyButton,
  SiteMarkdown,
  SiteToc,
  useActiveTocEntry,
  useSiteLocale,
} from "@prismshadow/penguin-ui/site";
import type { ReactNode } from "react";
import type { SiteMarkdownComponents } from "@prismshadow/penguin-ui/site";
import { RfcSidebar } from "../components/rfc-sidebar";
import { useDocumentMeta } from "../lib/document-meta";
import { rfcEntries } from "../lib/rfcs";
import type { RfcEntry, RfcStatus } from "../lib/rfcs";
import { Link } from "react-router";
import { S } from "../lib/strings";

const statusLabel = (status: RfcStatus): string =>
  status === "landed"
    ? S.rfcs.statusLanded
    : status === "open"
      ? S.rfcs.statusOpen
      : S.rfcs.statusDrafting;

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

/** The index page's body as Markdown: the table of all RFCs, then the notes and the sections. */
function rfcIndexMarkdown(locale: string): string {
  const row = (entry: RfcEntry): string => {
    const doc = locale === "zh" ? (entry.zh ?? entry.en) : (entry.en ?? entry.zh);
    const title = locale === "zh" ? (entry.titleZh ?? entry.title) : entry.title;
    const titleCell = doc ? `[${title}](${doc.href})` : title;
    const revision = entry.openRevision
      ? `（[${S.rfcs.openRevision}](${entry.openRevision.href})）`
      : "";
    return `| ${entry.number} | ${titleCell} | ${statusLabel(entry.status)}${revision} |`;
  };
  const lines = [
    `## ${S.rfcs.sectionAll}`,
    "",
    `| ${S.rfcs.colRfc} | ${S.rfcs.colTitle} | ${S.rfcs.colStatus} |`,
    "| --- | --- | --- |",
    ...rfcEntries.map(row),
    "",
    ...S.rfcs.notes.map((note) => `- ${note}`),
    "",
    `## ${S.rfcs.sectionConventions}`,
    "",
    ...S.rfcs.conventions.map((line) => `- ${line}`),
    "",
    `## ${S.rfcs.sectionFiles}`,
    "",
    `| ${S.rfcs.colFile} | ${S.rfcs.colContent} |`,
    "| --- | --- |",
    ...S.rfcs.files.map((f) => `| ${f.file} | ${f.content} |`),
    "",
  ];
  return lines.join("\n");
}

export function RfcsPage() {
  const { locale } = useSiteLocale();
  useDocumentMeta(`${S.rfcs.title} | ${S.siteName}`, S.rfcs.description);
  const body = rfcIndexMarkdown(locale);
  const toc = useMemo(() => extractToc(body), [body]);
  const { activeId, pinTo } = useActiveTocEntry(toc);

  return (
    <div className="anim-rise px-4 py-10 sm:px-6 lg:px-10 xl:grid xl:grid-cols-[13rem_minmax(0,1fr)_13rem] xl:gap-8">
      <RfcSidebar />
      <article className="mx-auto w-full max-w-3xl xl:mx-0">
        <header>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="text-3xl font-semibold tracking-tight text-balance">{S.rfcs.title}</h1>
            <div className="pt-1.5">
              <SiteCopyButton
                text={body}
                label={S.rfcs.copyMarkdown}
                announcement={S.rfcs.copied}
                look="pill-md"
              />
            </div>
          </div>
          <p className="mt-3 text-sm leading-6 text-gray-600 dark:text-gray-400">
            {S.rfcs.description}
          </p>
        </header>
        <SiteMarkdown
          variant="doc"
          className="mt-6"
          remarkPlugins={SITE_DOC_REMARK_PLUGINS}
          components={MD_COMPONENTS}
          highlight={highlightSiteCode}
        >
          {body}
        </SiteMarkdown>
      </article>
      {toc.length >= 2 && (
        <SiteToc label={S.rfcs.toc} entries={toc} activeId={activeId} onNavigate={pinTo} />
      )}
    </div>
  );
}
