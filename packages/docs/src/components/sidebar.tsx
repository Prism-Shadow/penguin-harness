/**
 * Docs sidebar: sections + page links from DOCS_NAV, titles resolved from the active
 * locale's frontmatter. Sub-pages (a page's children) render indented under their
 * parent. Desktop: sticky column. Mobile: the layout renders it as an overlay panel
 * under the top bar; onNavigate closes that panel.
 */
import { Link, useLocation } from "react-router";
import { S } from "../lib/strings";
import { useLocale } from "../state/locale";
import type { Locale } from "../state/locale";
import { DOCS_NAV, HOME_SLUG } from "../lib/nav";
import { docTitle } from "../lib/docs";
import { currentSearchShortcutLabel } from "../lib/shortcut";
import { SearchIcon } from "./icons";

export function Sidebar({
  onNavigate,
  onOpenSearch,
}: {
  onNavigate?: () => void;
  onOpenSearch: (trigger: HTMLButtonElement) => void;
}) {
  const { locale } = useLocale();
  const { pathname } = useLocation();
  const activeSlug = pathname.replace(/^\/|\/$/g, "") || HOME_SLUG;

  return (
    <nav aria-label="Docs" className="text-sm">
      <button
        type="button"
        onClick={(event) => onOpenSearch(event.currentTarget)}
        className="mb-6 flex min-h-11 w-full items-center gap-2 rounded-lg border border-gray-200 px-3 text-left text-gray-500 transition-colors hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900 dark:border-gray-800 dark:text-gray-400 dark:hover:border-gray-700 dark:hover:bg-gray-900 dark:hover:text-gray-100"
      >
        <SearchIcon className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{S.search.open}</span>
        <kbd className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] leading-none text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
          {currentSearchShortcutLabel()}
        </kbd>
      </button>
      {DOCS_NAV.map((section) => (
        <div key={section.id} className="mb-6">
          <p className="mb-2 text-xs font-semibold tracking-wide text-gray-400 uppercase dark:text-gray-500">
            {S.sections[section.id]}
          </p>
          <ul className="space-y-0.5 border-l border-gray-200 dark:border-gray-800">
            {section.pages.map((page) => (
              <li key={page.slug}>
                <PageLink
                  slug={page.slug}
                  activeSlug={activeSlug}
                  locale={locale}
                  onNavigate={onNavigate}
                />
                {page.children && (
                  <ul className="space-y-0.5">
                    {page.children.map((child) => (
                      <li key={child}>
                        <PageLink
                          slug={child}
                          activeSlug={activeSlug}
                          locale={locale}
                          onNavigate={onNavigate}
                          nested
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function PageLink({
  slug,
  activeSlug,
  locale,
  onNavigate,
  nested = false,
}: {
  slug: string;
  activeSlug: string;
  locale: Locale;
  onNavigate?: () => void;
  nested?: boolean;
}) {
  const active = slug === activeSlug;
  return (
    <Link
      to={slug === HOME_SLUG ? "/" : `/${slug}`}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`-ml-px block border-l py-1 transition-colors ${nested ? "pl-6 text-[13px]" : "pl-3"} ${
        active
          ? "border-brand-600 font-medium text-brand-700 dark:border-brand-400 dark:text-brand-300"
          : "border-transparent text-gray-600 hover:border-gray-300 hover:text-gray-900 dark:text-gray-400 dark:hover:border-gray-700 dark:hover:text-gray-100"
      }`}
    >
      {docTitle(slug, locale)}
    </Link>
  );
}
