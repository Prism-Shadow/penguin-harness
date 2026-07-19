/**
 * Docs sidebar: sections + page links from DOCS_NAV, titles resolved from the active
 * locale's frontmatter. Desktop: sticky column. Mobile: the layout renders it as an
 * overlay panel under the top bar; onNavigate closes that panel.
 */
import { Link, useLocation } from "react-router";
import { S } from "../lib/strings";
import { useLocale } from "../state/locale";
import { DOCS_NAV, HOME_SLUG } from "../lib/nav";
import { docTitle } from "../lib/docs";

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { locale } = useLocale();
  const { pathname } = useLocation();
  const activeSlug = pathname.replace(/^\/|\/$/g, "") || HOME_SLUG;

  return (
    <nav aria-label="Docs" className="text-sm">
      {DOCS_NAV.map((section) => (
        <div key={section.id} className="mb-6">
          <p className="mb-2 text-xs font-semibold tracking-wide text-gray-400 uppercase dark:text-gray-500">
            {S.sections[section.id]}
          </p>
          <ul className="space-y-0.5 border-l border-gray-200 dark:border-gray-800">
            {section.slugs.map((slug) => {
              const active = slug === activeSlug;
              return (
                <li key={slug}>
                  <Link
                    to={slug === HOME_SLUG ? "/" : `/${slug}`}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={`-ml-px block border-l py-1 pl-3 transition-colors ${
                      active
                        ? "border-brand-600 font-medium text-brand-700 dark:border-brand-400 dark:text-brand-300"
                        : "border-transparent text-gray-600 hover:border-gray-300 hover:text-gray-900 dark:text-gray-400 dark:hover:border-gray-700 dark:hover:text-gray-100"
                    }`}
                  >
                    {docTitle(slug, locale)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
