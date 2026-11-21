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
  slugifyHeading,
  useActiveTocEntry,
  useSiteLocale,
} from "@prismshadow/penguin-ui/site";
import { RFC_MD_COMPONENTS, RfcShell, RfcTreeView } from "../components/rfc-sidebar";
import { useDocumentMeta } from "../lib/document-meta";
import {
  repositoryHref,
  rfcDocForLocale,
  rfcEntryShortTitle,
  rfcReadmeParts,
  rfcTree,
} from "../lib/rfcs";
import type { RfcTreeNode } from "../lib/rfcs";
import { S } from "../lib/strings";

function formatTreeMarkdown(nodes: readonly RfcTreeNode[], locale: string, depth = 0): string[] {
  const indent = "  ".repeat(depth);
  const lines: string[] = [];
  for (const node of nodes) {
    if (!node.entry) {
      lines.push(`${indent}- **${node.label}**`);
    } else {
      const entry = node.entry;
      const doc = rfcDocForLocale(entry, locale);
      const shortTitle = rfcEntryShortTitle(entry, locale);
      const rfcLink =
        entry.status === "merged" && doc
          ? `[${entry.number}](/rfcs/${entry.id})`
          : entry.prHref
            ? `[${entry.number}](${entry.prHref})`
            : entry.number;
      const prBadge =
        entry.prNumber && entry.prHref ? ` ([#${entry.prNumber}](${entry.prHref}))` : "";
      lines.push(`${indent}- ${rfcLink} ${shortTitle}${prBadge}`);
    }
    if (node.children?.length) {
      lines.push(...formatTreeMarkdown(node.children, locale, depth + 1));
    }
  }
  return lines;
}

/** The index page's body as Markdown: README intro, the RFC tree, and the README sections. */
export function rfcIndexMarkdown(locale: string): string {
  const { intro, tail } = rfcReadmeParts(locale);
  const lines = [
    ...(intro ? [intro, ""] : []),
    `## ${S.rfcs.sectionAll}`,
    "",
    ...formatTreeMarkdown(rfcTree, locale),
    "",
    ...S.rfcs.notes.map((note) => `- ${note}`),
    ...(tail ? ["", tail] : []),
    "",
  ];
  return lines.join("\n");
}

export function RfcsPage() {
  const { locale } = useSiteLocale();
  useDocumentMeta(`${S.rfcs.title} | ${S.siteName}`, S.rfcs.description);
  const { intro, tail } = useMemo(() => rfcReadmeParts(locale), [locale]);
  const body = useMemo(() => rfcIndexMarkdown(locale), [locale]);
  const postTreeMarkdown = useMemo(
    () => [...S.rfcs.notes.map((note) => `- ${note}`), ...(tail ? ["", tail] : [])].join("\n"),
    [tail],
  );
  const copyText = `# ${S.rfcs.title}\n\n${S.rfcs.description}\n\n${body}`;
  const toc = useMemo(() => extractToc(body), [body]);
  const { activeId, pinTo } = useActiveTocEntry(toc);
  const readmeFile = locale === "zh" ? "README.zh.md" : "README.md";
  const allSectionId = slugifyHeading(S.rfcs.sectionAll);

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
      {intro && (
        <SiteMarkdown
          variant="doc"
          className="mt-6"
          remarkPlugins={SITE_DOC_REMARK_PLUGINS}
          components={RFC_MD_COMPONENTS}
          highlight={highlightSiteCode}
        >
          {intro}
        </SiteMarkdown>
      )}
      <section className="mt-8">
        <h2
          id={allSectionId}
          className="scroll-mt-24 text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100"
        >
          {S.rfcs.sectionAll}
        </h2>
        <RfcTreeView locale={locale} />
      </section>
      <SiteMarkdown
        variant="doc"
        className="mt-4"
        remarkPlugins={SITE_DOC_REMARK_PLUGINS}
        components={RFC_MD_COMPONENTS}
        highlight={highlightSiteCode}
      >
        {postTreeMarkdown}
      </SiteMarkdown>
    </RfcShell>
  );
}
