/**
 * Sticky top bar, landing-parity: logo + site name + "Docs" badge, then the SAME
 * link row as the landing page's nav (section anchors on the landing home, blog,
 * docs) with the same sliding hover pill — so the two sites link into each other
 * seamlessly. Section/blog links are plain anchors into the landing SPA one level
 * up; "Docs" routes to this site's own root. The right side keeps the language
 * and theme toggles, GitHub, and — on small screens — the sidebar toggle.
 */
import { useRef } from "react";
import type { MouseEvent } from "react";
import { Link } from "react-router";
import { S } from "../lib/strings";
import { REPO_URL, SITE_URL } from "../lib/links";
import { GitHubIcon, MenuIcon, XIcon } from "./icons";
import { ThemeToggle } from "./theme-toggle";
import { LangToggle } from "./lang-toggle";

const SECTION_IDS = ["highlights", "quickstart", "benchmark", "contract", "features"] as const;

export function Nav({ menuOpen, onToggleMenu }: { menuOpen: boolean; onToggleMenu: () => void }) {
  const pillRef = useRef<HTMLSpanElement | null>(null);
  const pillVisible = useRef(false);

  const sectionLabel: Record<(typeof SECTION_IDS)[number], string> = {
    highlights: S.nav.highlights,
    quickstart: S.nav.quickstart,
    benchmark: S.nav.benchmark,
    contract: S.nav.contract,
    features: S.nav.features,
  };

  const linkCls =
    "relative z-10 rounded-md px-2.5 py-1.5 text-sm text-gray-600 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100";
  // Landing-parity active style: on the docs site, the "Docs" link is the current page.
  const activeLinkCls =
    "relative z-10 rounded-md px-2.5 py-1.5 text-sm transition-colors bg-black text-white hover:bg-black hover:text-white dark:bg-black dark:text-white dark:ring-1 dark:ring-gray-600 dark:hover:bg-black dark:hover:text-white";

  /**
   * The hover pill appears IN PLACE under the first link it lands on (position
   * jumps with only the fade animating), slides while moving between links, and
   * fades out where it is on leave — never sweeping in from the nav's edge.
   */
  const slideTo = (e: MouseEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const pill = pillRef.current;
    if (!pill) return;
    if (!pillVisible.current) {
      pill.style.transitionProperty = "opacity";
      pill.style.left = `${el.offsetLeft}px`;
      pill.style.width = `${el.offsetWidth}px`;
      void pill.offsetWidth; // flush the jump before restoring the full transition
      pill.style.transitionProperty = "";
      pillVisible.current = true;
    } else {
      pill.style.left = `${el.offsetLeft}px`;
      pill.style.width = `${el.offsetWidth}px`;
    }
    pill.style.opacity = "1";
  };

  const hidePill = () => {
    const pill = pillRef.current;
    if (pill) pill.style.opacity = "0";
    pillVisible.current = false;
  };

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

        <a href={SITE_URL} className="flex items-center gap-2">
          <img src={`${import.meta.env.BASE_URL}penguin-logo.svg`} alt="" className="h-7 w-7" />
          <span className="text-[15px] font-semibold tracking-tight">{S.siteName}</span>
          <span className="rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 dark:border-brand-900 dark:bg-brand-950 dark:text-brand-300">
            {S.docsBadge}
          </span>
        </a>

        <nav
          className="relative ml-4 hidden items-center gap-0.5 md:flex"
          aria-label="Primary"
          onMouseLeave={hidePill}
        >
          {/* Sliding hover pill: appears in place, slides between links, fades out in place. */}
          <span
            ref={pillRef}
            aria-hidden="true"
            className="absolute top-1/2 h-8 -translate-y-1/2 rounded-md bg-gray-100 transition-[left,width,opacity] duration-200 ease-out dark:bg-gray-800"
            style={{ left: 0, width: 0, opacity: 0 }}
          />
          {SECTION_IDS.map((id) => (
            <a key={id} href={`${SITE_URL}#${id}`} className={linkCls} onMouseEnter={slideTo}>
              {sectionLabel[id]}
            </a>
          ))}
          <a href={`${SITE_URL}blog`} className={linkCls} onMouseEnter={slideTo}>
            {S.nav.blog}
          </a>
          <Link to="/" className={activeLinkCls} onMouseEnter={slideTo} aria-current="page">
            {S.nav.docs}
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-1">
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
