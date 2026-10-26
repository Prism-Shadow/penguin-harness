/**
 * The public sites' navigation: one page list, so the landing page, the docs and the gallery show
 * the same pages in the same order. Each host binds it to its own router, words and preferences.
 */
import type { ReactNode, Ref } from "react";
import { useEscLayer } from "../overlays/esc-layers/esc-layers";
import { SiteGitHubLink, SiteLanguageMenu, SiteThemeToggle } from "./site-controls";
import type { SiteLangPref, SiteThemeMode } from "./site-controls";
import { SiteHeader } from "./site-header";
import type { SiteLink, SiteLinkProps } from "./site-header";

/** The pages every site's bar links to, in the order it shows them. */
export const SITE_PAGES = ["home", "blog", "download", "amsp", "docs", "gallery"] as const;
export type SitePage = (typeof SITE_PAGES)[number];

/** A host's words for the bar: one per page, plus the GitHub link's and the menu button's. */
export type SiteNavLabels = Record<SitePage | "github" | "openMenu" | "closeMenu", string>;

/**
 * Where each page sits under the site root. The landing page's own pages carry no trailing slash,
 * the form the sibling sites have always linked them by; the docs and the gallery are directories.
 */
const PAGE_PATHS: Record<SitePage, string> = {
  home: "",
  blog: "blog",
  download: "download",
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
  if (path === "/amsp") return "amsp";
  return null;
}

/** A host's own form of one page's link: a route its router renders, or an href it computes. */
export interface SiteLinkOverride {
  href?: string;
  render?: (props: SiteLinkProps) => ReactNode;
}

/** The bar's links, in page order, with `current` marked as the page being read. */
export function siteNavLinks({
  siteRoot,
  labels,
  current,
  overrides = {},
}: {
  /** The site's root, with its trailing slash: plain links lead to `<siteRoot><page path>`. */
  siteRoot: string;
  labels: SiteNavLabels;
  current: SitePage | null;
  overrides?: Partial<Record<SitePage, SiteLinkOverride>>;
}): SiteLink[] {
  return SITE_PAGES.map((id) => ({
    id,
    href: `${siteRoot}${PAGE_PATHS[id]}`,
    label: labels[id],
    active: id === current,
    ...overrides[id],
  }));
}

/** Escape closes an open site menu, unless a menu opened above it (the language menu) is on top. */
export function useEscapeToClose(open: boolean, close: () => void): void {
  useEscLayer(open, close);
}

/** The bar with the sites' standard actions: language, theme and the repository's stars. */
export function SiteNav({
  name,
  logo,
  labels,
  links,
  home,
  language,
  theme,
  repo,
  menu,
  children,
}: {
  name: string;
  logo: string;
  labels: SiteNavLabels;
  links: readonly SiteLink[];
  /** The logo's link; the home page's link unless the host needs its own (one that closes a menu). */
  home?: SiteLink;
  language: {
    value: SiteLangPref;
    onChange: (value: SiteLangPref) => void;
    labels: Record<SiteLangPref | "label", string>;
  };
  theme: {
    mode: SiteThemeMode;
    onChange: (mode: SiteThemeMode) => void;
    labels: Record<SiteThemeMode | "label", string>;
  };
  repo: { href: string; apiUrl: string };
  menu: {
    open: boolean;
    onToggle: () => void;
    /** The breakpoint class that hides the menu button where the bar shows its links. */
    hiddenClass: string;
    buttonRef?: Ref<HTMLButtonElement>;
  };
  /** What the menu opens inside the header, when the host folds it there. */
  children?: ReactNode;
}) {
  return (
    <SiteHeader
      name={name}
      logo={logo}
      home={home ?? links.find((link) => link.id === "home")!}
      links={links}
      actions={
        <>
          <SiteLanguageMenu
            value={language.value}
            onChange={language.onChange}
            labels={language.labels}
          />
          <SiteThemeToggle mode={theme.mode} onChange={theme.onChange} labels={theme.labels} />
          <SiteGitHubLink href={repo.href} apiUrl={repo.apiUrl} label={labels.github} />
        </>
      }
      menu={{ ...menu, label: menu.open ? labels.closeMenu : labels.openMenu }}
    >
      {children}
    </SiteHeader>
  );
}
