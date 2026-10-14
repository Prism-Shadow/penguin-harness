/**
 * The site's navbar, as the landing page and the docs render it: logo + site name, the same link
 * row (Home, Blog, Download, Docs, Gallery) with the same sliding hover pill, the language and
 * theme toggles, and GitHub. Home, Blog, Download and Docs are plain anchors into the sibling
 * sites (./links.ts); "Gallery" is this site's home and always the active link. The right cluster
 * ends with a menu button on narrow screens, as on the docs, where it opens the page's drawer
 * (chrome/site.tsx): the site's links below md — the landing page's mobile menu, `SiteMenu` here —
 * and, on a page with one, the section's list below the width where its column folds away.
 *
 * The markup and class strings are duplicated verbatim from the landing nav
 * (packages/landing/src/components/nav.tsx), as the docs nav is; keep the three aligned. The
 * classes are Tailwind's, which the theme under test re-points on this page: the `g-sitebar`
 * scope around the navbar (site.css) pins every value they read back to the landing page's.
 */
import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { BASE } from "../lib/location";
import { homeHref } from "../lib/routes";
import { useGallery } from "../state";
import { DOCS_URL, REPO_API_URL, REPO_URL, SITE_URL } from "./links";
import { GitHubIcon, MenuIcon, XIcon } from "./icons";
import { ThemeToggle } from "./theme-toggle";
import { LangToggle } from "./lang-toggle";

/** Below which width the menu button shows: the link row's (md), or the section list's column's. */
export type MenuWidth = "links" | "list";

const MENU_BUTTON_HIDDEN: Record<MenuWidth, string> = {
  links: "md:hidden",
  list: "min-[901px]:hidden",
};

const activeLinkCls =
  "bg-black text-white hover:bg-black hover:text-white dark:bg-black dark:text-white dark:ring-1 dark:ring-gray-600 dark:hover:bg-black dark:hover:text-white";
const inactiveLinkCls = "text-gray-600 dark:text-gray-400";

function GitHubStarsLink() {
  const S = useGallery().S.sitebar;
  const [stars, setStars] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(REPO_API_URL, {
      signal: controller.signal,
      headers: { Accept: "application/vnd.github+json" },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { stargazers_count?: unknown } | null) => {
        if (typeof data?.stargazers_count === "number") setStars(data.stargazers_count);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const count = stars?.toLocaleString("en-US");
  const label = count ? `${S.nav.github} · ${count} stars` : S.nav.github;
  return (
    <a
      href={REPO_URL}
      target="_blank"
      rel="noreferrer"
      title={label}
      aria-label={label}
      className="inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 hover:text-gray-950 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
    >
      <GitHubIcon className="h-[18px] w-[18px]" />
      <span className="hidden min-w-8 tabular-nums min-[360px]:inline">{count ?? "-"}</span>
    </a>
  );
}

export function SiteNav({
  menuOpen,
  onToggleMenu,
  menuWidth,
}: {
  menuOpen: boolean;
  onToggleMenu: () => void;
  menuWidth: MenuWidth;
}) {
  const { S: G, state } = useGallery();
  const S = G.sitebar;
  const pillRef = useRef<HTMLSpanElement | null>(null);
  const pillVisible = useRef(false);
  const gallery = homeHref(BASE, state);

  const deskInactiveLinkCls = `${inactiveLinkCls} hover:text-gray-900 dark:hover:text-gray-100`;
  // Same class recipe as the landing nav's desktop links; here only "Gallery" is ever active.
  const deskLinkCls = (active: boolean) =>
    `relative z-10 shrink-0 whitespace-nowrap rounded-md px-2 py-1.5 text-[13px] transition-colors ${active ? activeLinkCls : deskInactiveLinkCls}`;

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
      <a href={SITE_URL} className={deskLinkCls(false)} onMouseEnter={slideTo}>
        {S.nav.home}
      </a>
      <a href={`${SITE_URL}blog`} className={deskLinkCls(false)} onMouseEnter={slideTo}>
        {S.nav.blog}
      </a>
      <a href={`${SITE_URL}download`} className={deskLinkCls(false)} onMouseEnter={slideTo}>
        {S.nav.download}
      </a>
      <a href={DOCS_URL} className={deskLinkCls(false)} onMouseEnter={slideTo}>
        {S.nav.docs}
      </a>
      {/* The gallery's own home, carrying the view, and always the current page. */}
      <a href={gallery} className={deskLinkCls(true)} onMouseEnter={slideTo} aria-current="page">
        {S.nav.gallery}
      </a>
    </>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/85 backdrop-blur dark:border-gray-800 dark:bg-gray-950/85">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:px-6">
        <a href={SITE_URL} className="flex shrink-0 items-center gap-2">
          <img src={`${import.meta.env.BASE_URL}penguin-logo.svg`} alt="" className="h-7 w-7" />
          <span className="hidden text-[15px] font-semibold tracking-tight sm:inline">
            {S.siteName}
          </span>
        </a>

        <nav
          className="relative ml-4 hidden items-center gap-0.5 md:flex"
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
          <GitHubStarsLink />
          {/* Menu button: same slot and styling as the landing nav's, but it opens the page's
              drawer, and on a page with a section list it shows until that list's column does. */}
          <button
            type="button"
            onClick={onToggleMenu}
            aria-label={menuOpen ? S.nav.closeMenu : S.nav.openMenu}
            aria-expanded={menuOpen}
            className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-gray-600 transition-colors hover:border-gray-200 hover:bg-gray-50 ${MENU_BUTTON_HIDDEN[menuWidth]} dark:text-gray-400 dark:hover:border-gray-800 dark:hover:bg-gray-900`}
          >
            {menuOpen ? <XIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          </button>
        </div>
      </div>
    </header>
  );
}

/**
 * The landing nav's mobile menu: the five links in two columns, "Gallery" active. Shown at the top
 * of the drawer below md, where the link row hides; ruled off from the section list under it.
 */
export function SiteMenu({ onNavigate }: { onNavigate: () => void }) {
  const { S: G, state } = useGallery();
  const S = G.sitebar;
  const gallery = homeHref(BASE, state);
  const mobileInactiveLinkCls = `${inactiveLinkCls} hover:bg-gray-50 hover:text-gray-900 dark:hover:bg-gray-900 dark:hover:text-gray-100`;
  const mobileLinkCls = (active: boolean) =>
    `rounded-md px-2.5 py-1.5 text-sm transition-colors ${active ? activeLinkCls : mobileInactiveLinkCls}`;

  return (
    <nav
      className="anim-fade border-b border-gray-200 bg-white px-4 py-2 md:hidden dark:border-gray-800 dark:bg-gray-950"
      aria-label="Mobile"
    >
      <div className="grid grid-cols-2 gap-1 py-1">
        <a href={SITE_URL} className={mobileLinkCls(false)} onClick={onNavigate}>
          {S.nav.home}
        </a>
        <a href={`${SITE_URL}blog`} className={mobileLinkCls(false)} onClick={onNavigate}>
          {S.nav.blog}
        </a>
        <a href={`${SITE_URL}download`} className={mobileLinkCls(false)} onClick={onNavigate}>
          {S.nav.download}
        </a>
        <a href={DOCS_URL} className={mobileLinkCls(false)} onClick={onNavigate}>
          {S.nav.docs}
        </a>
        <a href={gallery} className={mobileLinkCls(true)} onClick={onNavigate} aria-current="page">
          {S.nav.gallery}
        </a>
      </div>
    </nav>
  );
}
