/**
 * The public sites' navigation: one page list and one shared navbar component, so the landing
 * page, the docs and the gallery render the same navigation bar and "More" menu without per-app
 * navbar wrappers.
 */
import { useEffect, useState, type ReactNode, type Ref } from "react";
import { Fold } from "../layout/fold/fold";
import { useEscLayer } from "../overlays/esc-layers/esc-layers";
import { SiteGitHubLink, SiteLanguageMenu, SiteThemeToggle } from "./site-controls";
import type { SiteLangPref, SiteThemeMode } from "./site-controls";
import { SiteHeader, SiteNavLinks } from "./site-header";
import { isSiteLinkGroup } from "./site-link";
import type { SiteLink, SiteLinkProps, SiteNavItem } from "./site-link";
import { useOptionalSiteLocale, type SiteLocale } from "./site-locale";
import { useOptionalSiteTheme } from "./site-theme";

/** The pages every site's bar links to, in the order it shows them. */
export const SITE_PAGES = [
  "home",
  "blog",
  "download",
  "plugins",
  "benchmarks",
  "leaderboards",
  "docs",
  "rfcs",
  "amsp",
  "gallery",
] as const;
export type SitePage = (typeof SITE_PAGES)[number];

/** The pages the bar gathers under one "More" entry, which ends its row. */
const MORE_PAGES: readonly SitePage[] = ["rfcs", "amsp", "gallery"];

/** Pages served by the landing router itself. */
const LANDING_ROUTER_PAGES: readonly SitePage[] = [
  "home",
  "blog",
  "download",
  "plugins",
  "benchmarks",
  "leaderboards",
  "rfcs",
  "amsp",
];

/**
 * A host's words for the bar: one per page, the "More" entry's, and the GitHub link's and the
 * menu button's.
 */
export type SiteNavLabels = Record<SitePage | "more" | "github" | "openMenu" | "closeMenu", string>;

export const SITE_REPO = {
  href: "https://github.com/Prism-Shadow/penguin-harness",
  apiUrl: "https://api.github.com/repos/Prism-Shadow/penguin-harness",
} as const;

export const SITE_NAV_COPY: Record<
  SiteLocale,
  {
    siteName: string;
    nav: SiteNavLabels;
    theme: Record<SiteThemeMode | "label", string>;
    lang: Record<SiteLangPref | "label", string>;
  }
> = {
  zh: {
    siteName: "PenguinHarness",
    nav: {
      home: "主页",
      blog: "博客",
      download: "下载",
      plugins: "插件",
      benchmarks: "评估集",
      leaderboards: "榜单",
      docs: "文档",
      rfcs: "RFCs",
      amsp: "AMSP",
      gallery: "主题包",
      more: "更多",
      github: "GitHub",
      openMenu: "打开菜单",
      closeMenu: "关闭菜单",
    },
    theme: {
      label: "主题",
      light: "浅色",
      dark: "深色",
      system: "跟随系统",
    },
    lang: {
      label: "语言",
      zh: "中文",
      en: "English",
      system: "跟随系统",
    },
  },
  en: {
    siteName: "PenguinHarness",
    nav: {
      home: "Home",
      blog: "Blog",
      download: "Download",
      plugins: "Plugins",
      benchmarks: "Benchmarks",
      leaderboards: "Leaderboards",
      docs: "Docs",
      rfcs: "RFCs",
      amsp: "AMSP",
      gallery: "Theme Packs",
      more: "More",
      github: "GitHub",
      openMenu: "Open menu",
      closeMenu: "Close menu",
    },
    theme: {
      label: "Theme",
      light: "Light",
      dark: "Dark",
      system: "System",
    },
    lang: {
      label: "Language",
      zh: "中文",
      en: "English",
      system: "System",
    },
  },
};

/**
 * Where each page sits under the site root. The landing page's own pages carry no trailing slash,
 * the form the sibling sites have always linked them by; the docs and the gallery are directories.
 */
const PAGE_PATHS: Record<SitePage, string> = {
  home: "",
  blog: "blog",
  download: "download",
  plugins: "plugins",
  benchmarks: "benchmarks",
  leaderboards: "leaderboards",
  rfcs: "rfcs",
  amsp: "amsp",
  docs: "docs/",
  gallery: "gallery/",
};

/**
 * The landing page's page at a router pathname. A trailing slash names the same page: the static
 * host answers `/download` with `/download/`, and the sitemap lists the slash form.
 */
export function landingPageAt(pathname: string): SitePage | null {
  const path = pathname.replace(/(.)\/+$/, "$1");
  if (path === "/") return "home";
  if (path === "/blog" || path.startsWith("/blog/")) return "blog";
  if (path === "/download") return "download";
  for (const page of ["plugins", "benchmarks", "leaderboards", "rfcs"] as const) {
    if (path === `/${page}` || path.startsWith(`/${page}/`)) return page;
  }
  if (path === "/amsp") return "amsp";
  return null;
}

/** A host's own form of one page's link: a route its router renders, or an href it computes. */
export interface SiteLinkOverride {
  href?: string;
  render?: (props: SiteLinkProps) => ReactNode;
}

/**
 * The bar's entries, in page order, with `current` marked as the page being read: each page of
 * the row, then the "More" group holding the rest.
 */
export function siteNavLinks({
  siteRoot = "/",
  labels,
  locale,
  current,
  pathname,
  renderLink,
  overrides = {},
}: {
  /** The site's root, with its trailing slash: plain links lead to `<siteRoot><page path>`. */
  siteRoot?: string;
  labels?: SiteNavLabels;
  locale?: SiteLocale;
  current?: SitePage | null;
  pathname?: string;
  renderLink?: (props: SiteLinkProps) => ReactNode;
  overrides?: Partial<Record<SitePage, SiteLinkOverride>>;
}): SiteNavItem[] {
  const activePage =
    current !== undefined ? current : pathname !== undefined ? landingPageAt(pathname) : null;
  const navLabels = labels ?? SITE_NAV_COPY[locale ?? "zh"].nav;
  const hostOverrides: Partial<Record<SitePage, SiteLinkOverride>> = {};
  if (renderLink && pathname !== undefined) {
    for (const id of LANDING_ROUTER_PAGES) {
      hostOverrides[id] = { href: `/${PAGE_PATHS[id]}`, render: renderLink };
    }
  } else if (renderLink && activePage === "docs") {
    hostOverrides.docs = { href: "/", render: renderLink };
  }
  if (locale && activePage !== "gallery") {
    hostOverrides.gallery = { href: `${siteRoot}gallery/?lang=${locale}` };
  }
  const mergedOverrides = { ...hostOverrides, ...overrides };
  const link = (id: SitePage): SiteLink => ({
    id,
    href: `${siteRoot}${PAGE_PATHS[id]}`,
    label: navLabels[id],
    active: id === activePage,
    ...mergedOverrides[id],
  });
  return [
    ...SITE_PAGES.filter((id) => !MORE_PAGES.includes(id)).map(link),
    { id: "more", label: navLabels.more, links: MORE_PAGES.map(link) },
  ];
}

/** Escape closes an open site menu, unless a menu opened above it (the language menu) is on top. */
export function useEscapeToClose(open: boolean, close: () => void): void {
  useEscLayer(open, close);
}

/** The site's links in a mobile drawer (used by the docs and the gallery). */
export function SiteMobileNav({
  siteRoot = "/",
  current,
  pathname,
  renderLink,
  overrides,
  labels,
  locale: explicitLocale,
  onNavigate,
}: {
  siteRoot?: string;
  current?: SitePage | null;
  pathname?: string;
  renderLink?: (props: SiteLinkProps) => ReactNode;
  overrides?: Partial<Record<SitePage, SiteLinkOverride>>;
  labels?: SiteNavLabels;
  locale?: SiteLocale;
  onNavigate?: () => void;
}) {
  const siteLocale = useOptionalSiteLocale();
  const locale = explicitLocale ?? siteLocale?.locale ?? "zh";
  const links = siteNavLinks({
    siteRoot,
    labels,
    locale,
    current,
    pathname,
    renderLink,
    overrides,
  });
  return <SiteNavLinks links={links} mobile onNavigate={onNavigate} />;
}

/** The bar with the sites' standard actions: language, theme and the repository's stars. */
export function SiteNav({
  siteRoot = "/",
  current,
  pathname,
  renderLink,
  overrides,
  name,
  logo = `${siteRoot}penguin-logo.svg`,
  labels: explicitLabels,
  links: explicitLinks,
  home,
  language: explicitLanguage,
  theme: explicitTheme,
  repo = SITE_REPO,
  menu: externalMenu,
  children,
}: {
  siteRoot?: string;
  current?: SitePage | null;
  pathname?: string;
  renderLink?: (props: SiteLinkProps) => ReactNode;
  overrides?: Partial<Record<SitePage, SiteLinkOverride>>;
  name?: string;
  logo?: string;
  labels?: SiteNavLabels;
  links?: readonly SiteNavItem[];
  /** The logo's link; the home page's link unless the host needs its own (one that closes a menu). */
  home?: SiteLink;
  language?: {
    value: SiteLangPref;
    locale?: SiteLocale;
    onChange: (value: SiteLangPref) => void;
    labels?: Record<SiteLangPref | "label", string>;
  };
  theme?: {
    mode: SiteThemeMode;
    onChange: (mode: SiteThemeMode) => void;
    labels?: Record<SiteThemeMode | "label", string>;
  };
  repo?: { href: string; apiUrl: string };
  menu?: {
    open: boolean;
    onToggle: () => void;
    /** The breakpoint class that hides the menu button where the bar shows its links. */
    hiddenClass?: string;
    buttonRef?: Ref<HTMLButtonElement>;
  };
  /** What the menu opens inside the header, when the host folds it there. */
  children?: ReactNode;
}) {
  const siteLocale = useOptionalSiteLocale();
  const siteTheme = useOptionalSiteTheme();
  const locale: SiteLocale = explicitLanguage?.locale ?? siteLocale?.locale ?? "zh";
  const copy = SITE_NAV_COPY[locale];
  const labels = explicitLabels ?? copy.nav;

  const [foldOpen, setFoldOpen] = useState(false);
  const closeFold = () => setFoldOpen(false);
  useEscapeToClose(!externalMenu && foldOpen, closeFold);
  useEffect(() => {
    setFoldOpen(false);
  }, [pathname]);

  const links =
    explicitLinks ??
    siteNavLinks({
      siteRoot,
      labels,
      locale,
      current,
      pathname,
      renderLink,
      overrides,
    });

  const defaultHome = links.find(
    (link): link is SiteLink => !isSiteLinkGroup(link) && link.id === "home",
  )!;
  const resolvedHome: SiteLink =
    home ??
    (!externalMenu && renderLink
      ? {
          ...defaultHome,
          render: (props) => renderLink({ ...props, onClick: closeFold }),
        }
      : defaultHome);

  const langValue = explicitLanguage?.value ?? siteLocale?.lang ?? "system";
  const langOnChange = explicitLanguage?.onChange ?? siteLocale?.setLang ?? (() => undefined);
  const langLabels = explicitLanguage?.labels ?? copy.lang;

  const themeMode = explicitTheme?.mode ?? siteTheme?.mode ?? "system";
  const themeOnChange = explicitTheme?.onChange ?? siteTheme?.setMode ?? (() => undefined);
  const themeLabels = explicitTheme?.labels ?? copy.theme;

  const menuOpen = externalMenu ? externalMenu.open : foldOpen;
  const menuToggle = externalMenu ? externalMenu.onToggle : () => setFoldOpen((v) => !v);
  const menuHiddenClass = externalMenu?.hiddenClass ?? "lg:hidden";

  return (
    <SiteHeader
      name={name ?? copy.siteName}
      logo={logo}
      home={resolvedHome}
      links={links}
      actions={
        <>
          <SiteLanguageMenu value={langValue} onChange={langOnChange} labels={langLabels} />
          <SiteThemeToggle mode={themeMode} onChange={themeOnChange} labels={themeLabels} />
          <SiteGitHubLink href={repo.href} apiUrl={repo.apiUrl} label={labels.github} />
        </>
      }
      menu={{
        open: menuOpen,
        onToggle: menuToggle,
        hiddenClass: menuHiddenClass,
        buttonRef: externalMenu?.buttonRef,
        label: menuOpen ? labels.closeMenu : labels.openMenu,
      }}
    >
      {children ??
        (!externalMenu ? (
          <Fold open={foldOpen} className="site-ui-fold lg:hidden">
            <SiteNavLinks links={links} mobile onNavigate={closeFold} />
          </Fold>
        ) : undefined)}
    </SiteHeader>
  );
}
