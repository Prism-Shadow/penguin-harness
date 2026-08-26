/**
 * Sticky top bar, landing-parity: logo + site name, then the SAME link row as the
 * landing page's nav (section anchors on the landing home, blog, docs) with the same
 * sliding hover pill — so the two sites render an identical navbar. Section/blog links
 * are plain anchors into the landing SPA one level up; "Docs" routes to this site's
 * own root and is always the active link. The right cluster also matches the landing
 * nav (language + theme toggles, GitHub) and ends with the sidebar toggle on <lg
 * screens — the same slot where the landing nav keeps its mobile-menu button on <md.
 *
 * The markup and class strings are duplicated verbatim from the landing nav
 * (packages/landing/src/components/nav.tsx — the two sites share no package, as with
 * site-prefs.ts); keep the two files aligned so the navbars render identically.
 */
import { useEffect, useRef, useState } from "react";
import type { MouseEvent, RefObject } from "react";
import { Link } from "react-router";
import { S } from "../lib/strings";
import { REPO_API_URL, REPO_URL, SITE_URL } from "../lib/links";
import { GitHubIcon, MenuIcon, XIcon } from "./icons";
import { ThemeToggle } from "./theme-toggle";
import { LangToggle } from "./lang-toggle";

const SECTION_IDS = [
  "cases",
  "highlights",
  "self-improvement",
  "quickstart",
  "scenarios",
  "benchmark",
  "contract",
  "features",
] as const;

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
      <span className="min-w-8 tabular-nums">{count ?? "★"}</span>
    </a>
  );
}

export function Nav({
  menuOpen,
  onToggleMenu,
  menuButtonRef,
}: {
  menuOpen: boolean;
  onToggleMenu: () => void;
  menuButtonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const pillRef = useRef<HTMLSpanElement | null>(null);
  const pillVisible = useRef(false);

  const sectionLabel: Record<(typeof SECTION_IDS)[number], string> = {
    highlights: S.nav.highlights,
    "self-improvement": S.nav.selfImprove,
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
  const deskInactiveLinkCls = `${inactiveLinkCls} hover:text-gray-900 dark:hover:text-gray-100`;
  // Same class recipe as the landing nav's desktop links; here only "Docs" is ever active.
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
      {SECTION_IDS.map((id) => (
        <a
          key={id}
          href={`${SITE_URL}#${id}`}
          className={deskLinkCls(false)}
          onMouseEnter={slideTo}
        >
          {sectionLabel[id]}
        </a>
      ))}
      <a href={`${SITE_URL}blog`} className={deskLinkCls(false)} onMouseEnter={slideTo}>
        {S.nav.blog}
      </a>
      <a href={`${SITE_URL}download`} className={deskLinkCls(false)} onMouseEnter={slideTo}>
        {S.nav.download}
      </a>
      {/* "Docs" is this SPA's own root — a router Link, and always the current page. */}
      <Link to="/" className={deskLinkCls(true)} onMouseEnter={slideTo} aria-current="page">
        {S.nav.docs}
      </Link>
    </>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/85 backdrop-blur dark:border-gray-800 dark:bg-gray-950/85">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:px-6">
        <a href={SITE_URL} className="flex items-center gap-2">
          <img src={`${import.meta.env.BASE_URL}penguin-logo.svg`} alt="" className="h-7 w-7" />
          <span className="hidden text-[15px] font-semibold tracking-tight sm:inline">
            {S.siteName}
          </span>
        </a>

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
          <GitHubStarsLink />
          {/* Sidebar toggle: same slot and styling as the landing nav's menu button, but it
              opens the docs sidebar and hides at lg (the sidebar's own breakpoint). */}
          <button
            ref={menuButtonRef}
            type="button"
            onClick={onToggleMenu}
            aria-label={menuOpen ? S.nav.closeMenu : S.nav.openMenu}
            aria-expanded={menuOpen}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-gray-600 transition-colors hover:border-gray-200 hover:bg-gray-50 lg:hidden dark:text-gray-400 dark:hover:border-gray-800 dark:hover:bg-gray-900"
          >
            {menuOpen ? <XIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
          </button>
        </div>
      </div>
    </header>
  );
}
