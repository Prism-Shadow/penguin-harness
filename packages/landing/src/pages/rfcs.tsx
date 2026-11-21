/**
 * The RFC index page: the repository's design RFCs (PRFCs) as one docs-style section — the left
 * rail lists the search trigger, the index and every RFC with its 4-digit number; the body is the
 * surface's README intro, the table of all RFCs (number linked to the document page, short title,
 * status), the file table, and the README's conventions, document shape and numbering sections.
 */
import { useMemo } from "react";
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
import { REPO_URL } from "../lib/links";
import {
  repositoryHref,
  rfcDocForLocale,
  rfcEntries,
  rfcEntryShortTitle,
  rfcReadmeParts,
} from "../lib/rfcs";
import type { RfcEntry, RfcStatus } from "../lib/rfcs";
import { S } from "../lib/strings";

const statusLabel = (status: RfcStatus): string =>
  status === "merged"
    ? S.rfcs.statusMerged
    : status === "open"
      ? S.rfcs.statusOpen
      : status === "draft"
        ? S.rfcs.statusDraft
        : S.rfcs.statusClosed;

/** The index page's body as Markdown: README intro, the RFC table, the file table, and the README sections. */
export function rfcIndexMarkdown(locale: string): string {
  const { intro, tail } = rfcReadmeParts(locale);
  const row = (entry: RfcEntry): string => {
    const doc = rfcDocForLocale(entry, locale);
    const shortTitle = rfcEntryShortTitle(entry, locale);
    const rfcCell =
      entry.status === "merged" && doc
        ? `[${entry.number}](/rfcs/${entry.id})`
        : entry.prHref
          ? `[${entry.number}](${entry.prHref})`
          : doc
            ? `[${entry.number}](${doc.href})`
            : entry.number;
    const prCell =
      entry.prNumber && entry.prTitle && entry.prHref
        ? `[#${entry.prNumber} ${entry.prTitle.replace(/\|/g, "\\|")}](${entry.prHref})`
        : entry.prHref
          ? `[${entry.prHref}](${entry.prHref})`
          : statusLabel(entry.status);
    return `| ${rfcCell} | ${shortTitle} | ${prCell} |`;
  };
  const lines = [
    ...(intro ? [intro, ""] : []),
    `## ${S.rfcs.sectionAll}`,
    "",
    `| ${S.rfcs.colRfc} | ${S.rfcs.colTitle} | ${S.rfcs.colStatus} |`,
    "| --- | --- | --- |",
    ...rfcEntries.map(row),
    "",
    ...S.rfcs.notes.map((note) => `- ${note}`),
    "",
    `| ${S.rfcs.colFile} | ${S.rfcs.colContent} |`,
    "| --- | --- |",
    ...S.rfcs.files.map((f) => `| [\`${f.file}\`](${REPO_URL}/${f.path}) | ${f.content} |`),
    "",
    `- ${S.rfcs.bilingualNote}`,
    ...(tail ? ["", tail] : []),
    "",
  ];
  return lines.join("\n");
}

export function RfcsPage() {
  const { locale } = useSiteLocale();
  useDocumentMeta(`${S.rfcs.title} | ${S.siteName}`, S.rfcs.description);
  const body = useMemo(() => rfcIndexMarkdown(locale), [locale]);
  const copyText = `# ${S.rfcs.title}\n\n${S.rfcs.description}\n\n${body}`;
  const toc = useMemo(() => extractToc(body), [body]);
  const { activeId, pinTo } = useActiveTocEntry(toc);
  const readmeFile = locale === "zh" ? "README.zh.md" : "README.md";

  return (
    <RfcShell
      activeId="index"
      mobileLabel={S.rfcs.indexLabel}
      editHref={repositoryHref(readmeFile)}
      indexSearchBody={body}
      toc={toc}
      activeTocId={activeId}
      onPinToc={pinTo}
    >
      <header>
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <h1 className="text-3xl font-semibold tracking-tight text-balance">{S.rfcs.title}</h1>
          <div className="pt-1.5">
            <SiteCopyButton
              text={copyText}
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
        className="mt-6 [--md-table-prose-min:14rem]"
        remarkPlugins={SITE_DOC_REMARK_PLUGINS}
        components={RFC_MD_COMPONENTS}
        highlight={highlightSiteCode}
      >
        {body}
      </SiteMarkdown>
    </RfcShell>
  );
}
