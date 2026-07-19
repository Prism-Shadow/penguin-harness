/**
 * Sticky top bar: logo + site name + "Docs" badge, then (right) a link back to the
 * main site, GitHub, language/theme toggles and — on small screens — the sidebar
 * toggle. The sidebar itself lives in the layout (router.tsx); this bar only flips
 * its open state.
 */
import { Link } from "react-router";
import { S } from "../lib/strings";
import { REPO_URL, SITE_URL } from "../lib/links";
import { GitHubIcon, MenuIcon, XIcon } from "./icons";
import { ThemeToggle } from "./theme-toggle";
import { LangToggle } from "./lang-toggle";

export function Nav({ menuOpen, onToggleMenu }: { menuOpen: boolean; onToggleMenu: () => void }) {
  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/85 backdrop-blur dark:border-gray-800 dark:bg-gray-950/85">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:px-6">
        <button
          type="button"
          onClick={onToggleMenu}
          aria-label={menuOpen ? S.nav.closeMenu : S.nav.openMenu}
          aria-expanded={menuOpen}
          className="mr-1 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-gray-600 transition-colors hover:border-gray-200 hover:bg-gray-50 lg:hidden dark:text-gray-400 dark:hover:border-gray-800 dark:hover:bg-gray-900"
        >
          {menuOpen ? <XIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
        </button>

        <Link to="/" className="flex items-center gap-2">
          <img src={`${import.meta.env.BASE_URL}penguin-logo.svg`} alt="" className="h-7 w-7" />
          <span className="text-[15px] font-semibold tracking-tight">{S.siteName}</span>
          <span className="rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 dark:border-brand-900 dark:bg-brand-950 dark:text-brand-300">
            {S.docsBadge}
          </span>
        </Link>

        <div className="ml-auto flex items-center gap-1">
          <a
            href={SITE_URL}
            className="hidden rounded-md px-2.5 py-1.5 text-sm text-gray-600 transition-colors hover:text-gray-900 sm:inline-block dark:text-gray-400 dark:hover:text-gray-100"
          >
            {S.nav.home}
          </a>
          <LangToggle />
          <ThemeToggle />
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            title={S.nav.github}
            aria-label={S.nav.github}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-gray-600 transition-colors hover:border-gray-200 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:border-gray-800 dark:hover:bg-gray-900 dark:hover:text-gray-100"
          >
            <GitHubIcon className="h-[18px] w-[18px]" />
          </a>
        </div>
      </div>
    </header>
  );
}
