/**
 * 公开站点: what the landing page and the docs share from `@prismshadow/penguin-ui/site` — the
 * footer in both shapes, the code card and the copy button's looks, the category pills, an
 * article in the shared prose with its contents beside it, the docs sidebar, the search dialog
 * and the external-link confirmation. The site's own palette (site.css), not the theme under
 * test: a public page looks the same whatever the gallery previews.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import {
  extractToc,
  highlightSiteCode,
  SITE_DOC_REMARK_PLUGINS,
  SiteCodeCard,
  SiteCopyButton,
  SiteExternalLink,
  SiteExternalLinkScope,
  SiteFooter,
  SiteMarkdown,
  SitePill,
  SiteSearchButton,
  SiteSearchDialog,
  SiteSidebarNav,
  SiteToc,
  currentSearchShortcutLabel,
  useActiveTocEntry,
} from "@prismshadow/penguin-ui/site";
import type {
  SiteLinkProps,
  SitePillTone,
  SiteSearchRange,
  SiteSearchResult,
} from "@prismshadow/penguin-ui/site";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

const PILL_TONES: readonly SitePillTone[] = ["brand", "brand-outline", "teal", "neutral"];

/** Board links go nowhere: the board shows the link, the sites route it. */
function inertLink(props: SiteLinkProps) {
  return <a {...props} onClick={(event) => event.preventDefault()} />;
}

/** Every case-insensitive occurrence of the query, for the sample results' marks. */
function matches(text: string, query: string): SiteSearchRange[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const haystack = text.toLowerCase();
  const ranges: SiteSearchRange[] = [];
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    ranges.push({ start: at, end: at + needle.length });
    at = haystack.indexOf(needle, at + needle.length);
  }
  return ranges;
}

export function SiteBoard() {
  const { S } = useGallery();
  const t = S.library.site;
  const [searchOpen, setSearchOpen] = useState(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const toc = useMemo(() => extractToc(t.articleBody), [t.articleBody]);
  const { activeId, pinTo } = useActiveTocEntry(toc);
  const results = useMemo<SiteSearchResult[]>(
    () => t.searchResults.map((result, index) => ({ key: String(index), ...result })),
    [t.searchResults],
  );
  const search = useCallback(
    (query: string) =>
      query.trim()
        ? results.filter((result) =>
            [result.title, result.context, result.snippet].some(
              (text) => text !== undefined && matches(text, query).length > 0,
            ),
          )
        : [],
    [results],
  );
  const openSearch = (trigger: HTMLElement) => {
    returnFocusRef.current = trigger;
    setSearchOpen(true);
  };

  return (
    <div className="gf-board">
      <BoardGroup title={t.footer} aside={t.footerHint}>
        <div className="lib-stack lib-stack-wide">
          <SiteFooter
            brand={{
              name: "PenguinHarness",
              logo: `${import.meta.env.BASE_URL}penguin-logo.svg`,
              tagline: t.tagline,
            }}
            columns={t.columns.map((column) => ({
              title: column.title,
              links: column.links.map((label) => ({
                id: label,
                href: "#",
                label,
                render: inertLink,
              })),
            }))}
            copyright={t.copyright}
          />
          <SiteFooter
            copyright={t.copyright}
            links={t.lineLinks.map((label) => ({ id: label, href: "#", label, render: inertLink }))}
          />
        </div>
      </BoardGroup>

      <BoardGroup title={t.code} aside={t.codeHint}>
        <div className="lib-stack">
          <SiteCodeCard
            code={"# Linux / macOS\ncurl -fsSL https://penguin.ooo/install.sh | sh"}
            label="curl | sh"
            copy={{ label: t.copy, announcement: t.copiedAnnouncement }}
          />
          <div className="lib-row text-sm">
            <SiteCopyButton text="penguin web" label={t.copy} announcement={t.copiedAnnouncement} />
            <SiteCopyButton
              text="# PenguinHarness"
              label={t.copyMarkdown}
              announcement={t.copiedAnnouncement}
              look="pill-md"
            />
            <SiteCopyButton
              text={() => window.location.href}
              label={t.copyLink}
              announcement={t.copiedAnnouncement}
              look="text"
              glyph="link"
            />
          </div>
        </div>
      </BoardGroup>

      <BoardGroup title={t.pills} aside={t.pillsHint}>
        <div className="lib-row">
          {PILL_TONES.map((tone) => (
            <SitePill key={tone} tone={tone}>
              {t.pillTones[tone]}
            </SitePill>
          ))}
        </div>
      </BoardGroup>

      <BoardGroup title={t.article} aside={t.articleHint}>
        {/* One shrinkable column at phone width, so the article's wide table scrolls in its box. */}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-10 sm:grid-cols-[minmax(0,1fr)_13rem]">
          <SiteMarkdown
            variant="doc"
            remarkPlugins={SITE_DOC_REMARK_PLUGINS}
            highlight={highlightSiteCode}
          >
            {t.articleBody}
          </SiteMarkdown>
          <SiteToc
            label={t.toc}
            entries={toc}
            activeId={activeId}
            onNavigate={pinTo}
            className="hidden sm:block"
          />
        </div>
      </BoardGroup>

      <BoardGroup title={t.sidebar} aside={t.sidebarHint}>
        <div className="max-w-60">
          <SiteSidebarNav
            label={t.sidebar}
            renderLink={inertLink}
            search={{
              label: t.searchLabels.open,
              shortcut: currentSearchShortcutLabel(),
              onOpen: openSearch,
            }}
            sections={t.sidebarSections.map((section, sectionIndex) => ({
              id: section.title,
              title: section.title,
              items: section.pages.map((page, pageIndex) => ({
                id: page,
                href: "#",
                label: page,
                // The current page: the second sub-page under the first section's second page.
                children:
                  sectionIndex === 0 && pageIndex === 1
                    ? section.children.map((child, childIndex) => ({
                        id: child,
                        href: "#",
                        label: child,
                        active: childIndex === 1,
                      }))
                    : undefined,
              })),
            }))}
          />
        </div>
      </BoardGroup>

      <BoardGroup title={t.search} aside={t.searchHint}>
        <div className="max-w-60">
          <SiteSearchButton
            label={t.searchLabels.open}
            shortcut={currentSearchShortcutLabel()}
            onOpen={openSearch}
          />
        </div>
        <SiteSearchDialog
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          returnFocusRef={returnFocusRef}
          search={search}
          highlight={matches}
          onSelect={() => undefined}
          labels={t.searchLabels}
        />
      </BoardGroup>

      <BoardGroup title={t.leave} aside={t.leaveHint}>
        <SiteExternalLinkScope labels={t.leaveLabels}>
          <SiteExternalLink
            href="https://github.com/Prism-Shadow/penguin-harness"
            className="text-sm underline underline-offset-2"
          >
            {t.leaveLink}
          </SiteExternalLink>
        </SiteExternalLinkScope>
      </BoardGroup>
    </div>
  );
}
