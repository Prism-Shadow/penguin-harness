/**
 * Sticky top navigation: logo + the site's standalone pages (Home, Blog, Download, then Docs and
 * the gallery, which are sibling sites and never the current page here) + language/theme toggles
 * + GitHub. Desktop links share a sliding hover pill, while the current page keeps its own active
 * background. A disclosure menu covers small screens.
 *
 * The markup and class strings are duplicated verbatim in the docs nav
 * (packages/docs/src/components/nav.tsx) and the gallery's (packages/ui-gallery/src/site/nav.tsx)
 * — the sites share no package, as with site-prefs.ts; keep the three files aligned so the
 * navbars render identically.
 */
import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { Link, useLocation } from "react-router";
import { S } from "../lib/strings";
import { DOCS_URL, galleryUrl, REPO_API_URL, REPO_URL } from "../lib/links";
import { useLocale } from "../state/locale";
import { GitHubIcon, MenuIcon, XIcon } from "./icons";
import { ThemeToggle } from "./theme-toggle";
import { LangToggle } from "./lang-toggle";

/** The landing page's own pages, in nav order; Docs and the gallery follow as sibling sites. */
const PAGES = [
  { to: "/", item: "home" },
  { to: "/blog", item: "blog" },
  { to: "/download", item: "download" },
] as const;

type PageItem = (typeof PAGES)[number]["item"];

/** The page the route is on: a blog post counts as the blog. */
function currentPage(pathname: string): PageItem | null {
  if (pathname === "/") return "home";
  if (pathname === "/blog" || pathname.startsWith("/blog/")) return "blog";
  if (pathname === "/download") return "download";
  return null;
}

function GitHubStarsLink() {
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

export function Nav() {
  const { pathname } = useLocation();
  const current = currentPage(pathname);
  const [open, setOpen] = useState(false);
  const pillRef = useRef<HTMLSpanElement | null>(null);
  const pillVisible = useRef(false);
  const { locale } = useLocale();
  // The gallery opens in the language the reader has the site in.
  const gallery = galleryUrl(locale);
  const pageLabel: Record<PageItem, string> = {
    home: S.nav.home,
    blog: S.nav.blog,
    download: S.nav.download,
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
      {PAGES.map(({ to, item }) => (
        <Link
          key={item}
          to={to}
          className={deskLinkCls(current === item)}
          onMouseEnter={slideTo}
          aria-current={current === item ? "page" : undefined}
        >
          {pageLabel[item]}
        </Link>
      ))}
      {/* Docs (/docs/) and the gallery (/gallery/) are sibling SPAs: plain anchors, not Links. */}
      <a href={DOCS_URL} className={deskLinkCls(false)} onMouseEnter={slideTo}>
        {S.nav.docs}
      </a>
      <a href={gallery} className={deskLinkCls(false)} onMouseEnter={slideTo}>
        {S.nav.gallery}
      </a>
    </>
  );

  const mobileLinks = (
    <>
      {PAGES.map(({ to, item }) => (
        <Link
          key={item}
          to={to}
          className={mobileLinkCls(current === item)}
          onClick={() => setOpen(false)}
          aria-current={current === item ? "page" : undefined}
        >
          {pageLabel[item]}
        </Link>
      ))}
      <a href={DOCS_URL} className={mobileLinkCls(false)} onClick={() => setOpen(false)}>
        {S.nav.docs}
      </a>
      <a href={gallery} className={mobileLinkCls(false)} onClick={() => setOpen(false)}>
        {S.nav.gallery}
      </a>
    </>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/85 backdrop-blur dark:border-gray-800 dark:bg-gray-950/85">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:px-6">
        <Link to="/" className="flex shrink-0 items-center gap-2" onClick={() => setOpen(false)}>
          <img src={`${import.meta.env.BASE_URL}penguin-logo.svg`} alt="" className="h-7 w-7" />
          <span className="hidden text-[15px] font-semibold tracking-tight sm:inline">
            {S.siteName}
          </span>
        </Link>

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
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? S.nav.closeMenu : S.nav.openMenu}
            aria-expanded={open}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-gray-600 transition-colors hover:border-gray-200 hover:bg-gray-50 md:hidden dark:text-gray-400 dark:hover:border-gray-800 dark:hover:bg-gray-900"
          >
            {open ? <XIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && (
        <nav
          className="anim-fade border-t border-gray-200 bg-white px-4 py-2 md:hidden dark:border-gray-800 dark:bg-gray-950"
          aria-label="Mobile"
        >
          <div className="grid grid-cols-2 gap-1 py-1">{mobileLinks}</div>
        </nav>
      )}
    </header>
  );
}
