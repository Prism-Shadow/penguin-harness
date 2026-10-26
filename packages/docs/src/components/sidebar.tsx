/**
 * The docs' sections and pages (DOCS_NAV) in the shared site sidebar, page titles from the
 * active locale's frontmatter, sub-pages under their parent. On desktop it is a sticky column;
 * on mobile the layout shows it in a panel under the top bar, which `onNavigate` closes.
 */
import { Link, useLocation } from "react-router";
import {
  currentSearchShortcutLabel,
  SiteSidebarNav,
  useSiteLocale,
} from "@prismshadow/penguin-ui/site";
import type { SiteLinkProps, SiteSidebarItem } from "@prismshadow/penguin-ui/site";
import { S } from "../lib/strings";
import { DOCS_NAV, HOME_SLUG } from "../lib/nav";
import { docTitle } from "../lib/docs";

function routeLink({ href, ...props }: SiteLinkProps) {
  return <Link to={href} {...props} />;
}

export function Sidebar({
  onNavigate,
  onOpenSearch,
}: {
  onNavigate?: () => void;
  onOpenSearch: (trigger: HTMLButtonElement) => void;
}) {
  const { locale } = useSiteLocale();
  const { pathname } = useLocation();
  const activeSlug = pathname.replace(/^\/|\/$/g, "") || HOME_SLUG;
  const item = (slug: string): SiteSidebarItem => ({
    id: slug,
    href: slug === HOME_SLUG ? "/" : `/${slug}`,
    label: docTitle(slug, locale),
    active: slug === activeSlug,
  });

  return (
    <SiteSidebarNav
      label="Docs"
      sections={DOCS_NAV.map((section) => ({
        id: section.id,
        title: S.sections[section.id] ?? section.id,
        items: section.pages.map((page) => ({
          ...item(page.slug),
          children: page.children?.map((child) => item(child)),
        })),
      }))}
      renderLink={routeLink}
      onNavigate={onNavigate}
      search={{
        label: S.search.open,
        shortcut: currentSearchShortcutLabel(),
        onOpen: onOpenSearch,
      }}
    />
  );
}
