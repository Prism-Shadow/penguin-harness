/**
 * Sticky top navigation: logo + section anchors + blog link + language/theme toggles +
 * GitHub. Desktop links share a sliding hover pill, while the selected section or route
 * keeps its own active background. On the home page the active section tracks the
 * LIVE scroll position (scroll-spy), so the highlight follows as you scroll; on other
 * routes it falls back to route state (e.g. Blog). Section links route through "/#id"
 * so the URL hash stays in sync on click. A disclosure menu covers small screens.
 *
 * The markup and class strings are duplicated verbatim in the docs nav
 * (packages/docs/src/components/nav.tsx — the two sites share no package, as with
 * site-prefs.ts); keep the two files aligned so the navbars render identically.
 */
import { useRef, useState } from "react";
import type { MouseEvent } from "react";
import { Link, useLocation } from "react-router";
import { S } from "../lib/strings";
import { DOCS_URL, REPO_URL } from "../lib/links";
import { getActiveNavItem, SECTION_IDS } from "../lib/nav-state";
import type { ActiveNavItem, SectionId } from "../lib/nav-state";
import { useScrollSpy } from "../lib/use-scroll-spy";
import { GitHubIcon, MenuIcon, XIcon } from "./icons";
import { ThemeToggle } from "./theme-toggle";
import { LangToggle } from "./lang-toggle";

/** Stable empty list: keeps the spy idle away from the home page. */
const NO_IDS: readonly string[] = [];

export function Nav() {
  const { pathname, hash } = useLocation();
  const onHome = pathname === "/";
  const spied = useScrollSpy(onHome ? SECTION_IDS : NO_IDS) as SectionId | null;
  const activeItem: ActiveNavItem = onHome ? spied : getActiveNavItem(pathname, hash);
  const [open, setOpen] = useState(false);
  const pillRef = useRef<HTMLSpanElement | null>(null);
  const pillVisible = useRef(false);

  const sectionLabel: Record<(typeof SECTION_IDS)[number], string> = {
    highlights: S.nav.highlights,
    quickstart: S.nav.quickstart,
    cases: S.nav.cases,
    scenarios: S.nav.scenarios,
    benchmark: S.nav.benchmark,
    contract: S.nav.contract,
    features: S.nav.features,
  };

  const activeLinkCls =
    "bg-black text-white hover:bg-black hover:text-white dark:bg-black dark:text-white dark:ring-1 dark:ring-gray-600 dark:hover:bg-black dark:hover:text-white";
  const inactiveLinkCls = "text-gray-600 dark:text-gray-400";
  const mobileInactiveLinkCls = `${inactiveLinkCls} hover:bg-gray-50 hover:text-gray-900 dark:hover:bg-gray-900 dark:hover:text-gray-100`;
  const deskInactiveLinkCls = `${inactiveLinkCls} hover:text-gray-900 dark:hover:text-gray-100`;
  // Mobile links keep their own backgrounds; desktop links also share a sliding hover pill.
  const mobileLinkCls = (active: boolean) =>
    `rounded-md px-2.5 py-1.5 text-sm transition-colors ${active ? activeLinkCls : mobileInactiveLinkCls}`;
  const deskLinkCls = (active: boolean) =>
    `relative z-10 rounded-md px-2.5 py-1.5 text-sm transition-colors ${active ? activeLinkCls : deskInactiveLinkCls}`;

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

  const desktopLinks = (
    <>
      {SECTION_IDS.map((id) => {
        const active = activeItem === id;
        return (
          <Link
            key={id}
            to={`/#${id}`}
            className={deskLinkCls(active)}
            onMouseEnter={slideTo}
            aria-current={active ? "location" : undefined}
          >
            {sectionLabel[id]}
          </Link>
        );
      })}
      <Link
        to="/blog"
        className={deskLinkCls(activeItem === "blog")}
        onMouseEnter={slideTo}
        aria-current={activeItem === "blog" ? "page" : undefined}
      >
        {S.nav.blog}
      </Link>
      {/* Docs is a sibling SPA under /docs/ — a plain anchor, not a router Link. */}
      <a href={DOCS_URL} className={deskLinkCls(false)} onMouseEnter={slideTo}>
        {S.nav.docs}
      </a>
    </>
  );

  const mobileLinks = (
    <>
      {SECTION_IDS.map((id) => {
        const active = activeItem === id;
        return (
          <Link
            key={id}
            to={`/#${id}`}
            className={mobileLinkCls(active)}
            onClick={() => setOpen(false)}
            aria-current={active ? "location" : undefined}
          >
            {sectionLabel[id]}
          </Link>
        );
      })}
      <Link
        to="/blog"
        className={mobileLinkCls(activeItem === "blog")}
        onClick={() => setOpen(false)}
        aria-current={activeItem === "blog" ? "page" : undefined}
      >
        {S.nav.blog}
      </Link>
      <a href={DOCS_URL} className={mobileLinkCls(false)} onClick={() => setOpen(false)}>
        {S.nav.docs}
      </a>
    </>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/85 backdrop-blur dark:border-gray-800 dark:bg-gray-950/85">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2" onClick={() => setOpen(false)}>
          <img src={`${import.meta.env.BASE_URL}penguin-logo.svg`} alt="" className="h-7 w-7" />
          <span className="text-[15px] font-semibold tracking-tight">{S.siteName}</span>
        </Link>

        <nav
          className="relative ml-4 hidden items-center gap-0.5 xl:flex"
          aria-label="Primary"
          onMouseLeave={hidePill}
        >
          {/* Sliding hover pill: appears in place, slides between links, fades out in place; active links retain their own background. */}
          <span
            ref={pillRef}
            aria-hidden="true"
            className="absolute top-1/2 h-8 -translate-y-1/2 rounded-md bg-gray-100 transition-[left,width,opacity] duration-200 ease-out dark:bg-gray-800"
            style={{ left: 0, width: 0, opacity: 0 }}
          />
          {desktopLinks}
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
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? S.nav.closeMenu : S.nav.openMenu}
            aria-expanded={open}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-gray-600 transition-colors hover:border-gray-200 hover:bg-gray-50 xl:hidden dark:text-gray-400 dark:hover:border-gray-800 dark:hover:bg-gray-900"
          >
            {open ? <XIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && (
        <nav
          className="anim-fade border-t border-gray-200 bg-white px-4 py-2 xl:hidden dark:border-gray-800 dark:bg-gray-950"
          aria-label="Mobile"
        >
          <div className="flex flex-col py-1">{mobileLinks}</div>
        </nav>
      )}
    </header>
  );
}
