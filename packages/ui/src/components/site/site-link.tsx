/**
 * A public site's links, as its navigation and footer take them: a page, or a group of pages
 * under one entry. Hosts render their own routes through `render`; the rest are plain anchors.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";

export type SiteLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };
export interface SiteLink {
  id: string;
  href: string;
  label: string;
  active?: boolean;
  /** Render an internal route through the host's router, preserving ordinary anchor behavior. */
  render?: (props: SiteLinkProps) => ReactNode;
}

/**
 * Several pages under one entry: a menu in the bar's row, an indented group in the phone menu.
 * The entry reads as current while one of its pages is.
 */
export interface SiteLinkGroup {
  id: string;
  label: string;
  links: readonly SiteLink[];
}

/** One entry of the bar: a page, or a group of pages. */
export type SiteNavItem = SiteLink | SiteLinkGroup;

export function isSiteLinkGroup(item: SiteNavItem): item is SiteLinkGroup {
  return "links" in item;
}

/** A link as its host renders it: through the host's router, or as a plain anchor. */
export function renderSiteLink(link: SiteLink, props: SiteLinkProps) {
  return link.render ? link.render(props) : <a {...props} />;
}
