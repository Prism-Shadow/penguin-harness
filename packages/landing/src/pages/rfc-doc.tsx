/**
 * One RFC document's page: the H1 title and Copy Markdown button in the header, then the raw
 * Markdown body (provenance marker, metadata bullets, numbered sections) rendered through the
 * shared site prose's `doc` variant inside the 3-column RFC layout shell, with previous/next
 * pagination and an "Edit this page on GitHub" link at the foot. The active site locale selects
 * the English or Chinese document pair automatically.
 */
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import {
  extractToc,
  highlightSiteCode,
  SITE_DOC_REMARK_PLUGINS,
  SiteCopyButton,
  SiteMarkdown,
  useActiveTocEntry,
  useSiteLocale,
} from "@prismshadow/penguin-ui/site";
import { RFC_MD_COMPONENTS, RfcShell } from "../components/rfc-sidebar";
import { useDocumentMeta } from "../lib/document-meta";
import {
  repositoryHref,
  rfcBodyMarkdown,
  rfcDocForLocale,
  rfcEntryOf,
  rfcEntryShortTitle,
  rfcEntryTitle,
  shortRfcNumber,
} from "../lib/rfcs";
import { S } from "../lib/strings";
import { rfcIndexMarkdown } from "./rfcs";

export function RfcDocPage() {
  const { id = "" } = useParams();
  const { locale } = useSiteLocale();
  const entry = rfcEntryOf(id);
  const doc = entry ? rfcDocForLocale(entry, locale) : undefined;
  const title = entry ? rfcEntryTitle(entry, locale) : S.rfcs.title;
  useDocumentMeta(`${title} | ${S.siteName}`, S.rfcs.description);
  const body = useMemo(() => (doc ? rfcBodyMarkdown(doc.raw) : ""), [doc]);
  const indexBody = useMemo(() => rfcIndexMarkdown(locale), [locale]);
  const toc = useMemo(() => extractToc(body), [body]);
  const { activeId, pinTo } = useActiveTocEntry(toc);

  if (!entry || !doc) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-24 text-center sm:px-6">
        <p className="text-lg font-medium">{S.rfcs.notFound}</p>
        <Link
          to="/rfcs"
          className="mt-4 inline-block text-sm text-brand-700 hover:underline dark:text-brand-300"
        >
          {S.rfcs.backToIndex}
        </Link>
      </div>
    );
  }

  const shortTitle = rfcEntryShortTitle(entry, locale);

  return (
    <RfcShell
      activeId={entry.id}
      mobileLabel={`${shortRfcNumber(entry.number)} ${shortTitle}`}
      editHref={repositoryHref(doc.file)}
      indexSearchBody={indexBody}
      toc={toc}
      activeTocId={activeId}
      onPinToc={pinTo}
    >
      <header>
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <h1 className="text-3xl font-semibold tracking-tight text-balance">{title}</h1>
          <div className="pt-1.5">
            <SiteCopyButton
              text={doc.raw}
              label={S.rfcs.copyMarkdown}
              announcement={S.rfcs.copied}
              look="pill-md"
            />
          </div>
        </div>
      </header>
      <SiteMarkdown
        variant="doc"
        className="mt-6"
        remarkPlugins={SITE_DOC_REMARK_PLUGINS}
        components={RFC_MD_COMPONENTS}
        highlight={highlightSiteCode}
      >
        {body}
      </SiteMarkdown>
    </RfcShell>
  );
}
