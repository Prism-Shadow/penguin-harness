/**
 * The RFC surface's chrome: the left sidebar rail (Search trigger + "RFCs" section with 4-digit
 * monospace numbers and short titles), the mobile collapsible navigation bar, the previous/next
 * pager, the section-level search dialog, and the shared 3-column layout shell.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import {
  currentSearchShortcutLabel,
  SearchIcon,
  SiteSearchButton,
  SiteSearchDialog,
  SiteToc,
  useSearchHotkey,
  useSiteLocale,
} from "@prismshadow/penguin-ui/site";
import type {
  SiteMarkdownComponents,
  SiteSearchResult,
  TocEntry,
} from "@prismshadow/penguin-ui/site";
import {
  buildRfcSearchRecords,
  findRfcSearchMatchRanges,
  rfcDocForLocale,
  rfcEntries,
  rfcEntryOf,
  rfcEntryShortTitle,
  rfcPagerFor,
  searchRfcRecords,
  shortRfcNumber,
} from "../lib/rfcs";
import { S } from "../lib/strings";

export function RfcSidebar({
  onNavigate,
  onOpenSearch,
}: {
  onNavigate?: () => void;
  onOpenSearch?: (trigger: HTMLButtonElement) => void;
}) {
  const { pathname } = useLocation();
  const { locale } = useSiteLocale();
  const activeId = pathname
    .replace(/^\/rfcs\/?/, "")
    .replace(/\/$/, "")
    .replace(/\.zh$/, "");
  const isIndex = pathname === "/rfcs" || pathname === "/rfcs/";

  return (
    <nav aria-label={S.rfcs.indexLabel} className="site-sidebar text-sm">
      {onOpenSearch && (
        <SiteSearchButton
          label={S.rfcs.search.open}
          shortcut={currentSearchShortcutLabel()}
          onOpen={onOpenSearch}
        />
      )}
      <div className="mb-6">
        <p className="site-eyebrow mb-2">{S.rfcs.sidebarTitle}</p>
        <ul className="site-rail-list site-rail-tight">
          <li>
            <Link
              to="/rfcs"
              onClick={onNavigate}
              aria-current={isIndex ? "page" : undefined}
              className="site-rail-link py-1 pl-3"
            >
              {S.rfcs.indexLabel}
            </Link>
          </li>
          {rfcEntries
            .filter((entry) => entry.status === "merged" && rfcDocForLocale(entry, locale))
            .map((entry) => {
              const active = !isIndex && activeId === entry.id;
              return (
                <li key={entry.id}>
                  <Link
                    to={`/rfcs/${entry.id}`}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className="site-rail-link py-1 pl-3"
                  >
                    <span className="flex items-baseline gap-2">
                      <span className="shrink-0 font-mono text-xs text-gray-400 dark:text-gray-500">
                        {shortRfcNumber(entry.number)}
                      </span>
                      <span>{rfcEntryShortTitle(entry, locale)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
        </ul>
      </div>
    </nav>
  );
}

export function RfcPager({ activeId }: { activeId: string }) {
  const { locale } = useSiteLocale();
  const { prev, next } = rfcPagerFor(activeId, locale, S.rfcs.indexLabel);
  if (!prev && !next) return null;
  const stepClass =
    "group flex flex-col gap-1 rounded-lg border border-gray-200 p-4 transition-colors hover:border-gray-300 dark:border-gray-800 dark:hover:border-gray-700";

  return (
    <div className="mt-10 grid gap-3 border-t border-gray-200 pt-6 sm:grid-cols-2 dark:border-gray-800">
      {prev ? (
        <Link to={prev.href} className={stepClass}>
          <span className="text-xs text-gray-500 dark:text-gray-400">{S.rfcs.prev}</span>
          <span className="text-sm font-medium group-hover:text-brand-700 dark:group-hover:text-brand-300">
            {prev.title}
          </span>
        </Link>
      ) : (
        <span />
      )}
      {next && (
        <Link to={next.href} className={`${stepClass} sm:items-end sm:text-right`}>
          <span className="text-xs text-gray-500 dark:text-gray-400">{S.rfcs.next}</span>
          <span className="text-sm font-medium group-hover:text-brand-700 dark:group-hover:text-brand-300">
            {next.title}
          </span>
        </Link>
      )}
    </div>
  );
}

/** Markdown link adapter for both the RFC index and individual RFC pages. */
export function RfcMdLink({ href = "", children }: { href?: string; children?: ReactNode }) {
  if (href.startsWith("#")) {
    return <a href={href}>{children}</a>;
  }
  if (href.startsWith("/")) {
    return <Link to={href}>{children}</Link>;
  }
  if (/^(?:\.\/|\.\.\/)?README(?:\.zh)?\.md(#.*)?$/i.test(href)) {
    const hash = href.includes("#") ? href.slice(href.indexOf("#")) : "";
    return <Link to={`/rfcs${hash}`}>{children}</Link>;
  }
  const rfcMatch = /^(?:\.\/)?(PRFC-\d+-[A-Za-z0-9_-]+)(?:\.zh)?\.md(#.*)?$/.exec(href);
  if (rfcMatch) {
    const targetId = rfcMatch[1]!;
    const hash = rfcMatch[2] ?? "";
    const entry = rfcEntryOf(targetId);
    if (entry && entry.status !== "merged") {
      const externalHref = entry.prHref ?? entry.en?.href;
      if (externalHref) {
        return (
          <a href={externalHref} target="_blank" rel="noreferrer">
            {children}
          </a>
        );
      }
    }
    return <Link to={`/rfcs/${targetId}${hash}`}>{children}</Link>;
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
export const RFC_MD_COMPONENTS: SiteMarkdownComponents = {
  a: ({ href, children }) => <RfcMdLink href={href}>{children}</RfcMdLink>,
};

interface RfcDialogResult extends SiteSearchResult {
  target: string;
}

export function RfcShell({
  activeId,
  mobileLabel,
  editHref,
  indexSearchBody,
  toc,
  activeTocId,
  onPinToc,
  children,
}: {
  activeId: string;
  mobileLabel: string;
  editHref: string;
  indexSearchBody: string;
  toc: readonly TocEntry[];
  activeTocId: string;
  onPinToc: (id: string) => void;
  children: ReactNode;
}) {
  const { locale } = useSiteLocale();
  const { pathname, hash, key } = useLocation();
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const searchReturnFocusRef = useRef<HTMLElement | null>(null);
  const mobileDetailsRef = useRef<HTMLDetailsElement | null>(null);

  const openSearch = useCallback((trigger?: HTMLElement) => {
    const activeEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    searchReturnFocusRef.current = trigger ?? activeEl;
    if (mobileDetailsRef.current) mobileDetailsRef.current.open = false;
    setSearchOpen(true);
  }, []);

  const openSearchByKey = useCallback(() => openSearch(), [openSearch]);
  useSearchHotkey(searchOpen, openSearchByKey);

  useEffect(() => {
    if (mobileDetailsRef.current) mobileDetailsRef.current.open = false;
  }, [pathname, hash, key]);

  const records = useMemo(
    () => buildRfcSearchRecords(locale, { title: S.rfcs.indexLabel, body: indexSearchBody }),
    [locale, indexSearchBody],
  );

  const search = useCallback(
    (query: string): RfcDialogResult[] =>
      searchRfcRecords(records, query).map(({ record, snippet }, idx) => ({
        key: `${record.href}:${record.anchor || "page"}:${idx}`,
        title: record.heading || record.pageTitle,
        context: record.heading ? record.pageTitle : undefined,
        snippet: snippet || undefined,
        target: record.anchor ? `${record.href}#${record.anchor}` : record.href,
      })),
    [records],
  );

  const showToc = toc.length >= 2;

  return (
    <div className="mx-auto w-full max-w-7xl lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="hidden border-r border-gray-200 lg:block dark:border-gray-800">
        <div className="sticky top-14 max-h-[calc(100vh-3.5rem)] overflow-y-auto px-6 py-8">
          <RfcSidebar onOpenSearch={openSearch} />
        </div>
      </aside>
      <div className="min-w-0">
        <div
          className={`anim-rise px-4 py-10 sm:px-6 lg:px-10 ${
            showToc ? "xl:grid xl:grid-cols-[minmax(0,1fr)_14rem] xl:gap-10" : ""
          }`}
        >
          <div className="min-w-0">
            <div className="mb-6 flex items-start gap-2 lg:hidden">
              <details
                ref={mobileDetailsRef}
                className="min-w-0 flex-1 rounded-lg border border-gray-200 text-sm dark:border-gray-800"
              >
                <summary className="cursor-pointer px-3 py-1.5 font-medium">
                  {S.rfcs.sidebarTitle}: {mobileLabel}
                </summary>
                <div className="border-t border-gray-200 px-3 py-2 dark:border-gray-800">
                  <RfcSidebar
                    onNavigate={() => {
                      if (mobileDetailsRef.current) mobileDetailsRef.current.open = false;
                    }}
                  />
                </div>
              </details>
              <button
                type="button"
                onClick={(event) => openSearch(event.currentTarget)}
                aria-label={S.rfcs.search.open}
                className="site-search-trigger inline-flex h-9 w-9 shrink-0 items-center justify-center"
              >
                <SearchIcon className="h-4 w-4" />
              </button>
            </div>

            <article className="mx-auto w-full max-w-3xl xl:mx-0">
              {children}
              <RfcPager activeId={activeId} />
              <p className="mt-6 flex flex-wrap gap-x-4 text-xs text-gray-400 dark:text-gray-500">
                <a
                  href={editHref}
                  className="transition-colors hover:text-gray-700 dark:hover:text-gray-300"
                  target="_blank"
                  rel="noreferrer"
                >
                  {S.rfcs.editOnGithub}
                </a>
              </p>
            </article>
          </div>
          {showToc && (
            <SiteToc label={S.rfcs.toc} entries={toc} activeId={activeTocId} onNavigate={onPinToc} />
          )}
        </div>
      </div>
      <SiteSearchDialog
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        returnFocusRef={searchReturnFocusRef}
        search={search}
        highlight={findRfcSearchMatchRanges}
        onSelect={(result) => navigate(result.target)}
        labels={S.rfcs.search}
      />
    </div>
  );
}
