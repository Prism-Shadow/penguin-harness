/**
 * The router's side of the shell's link rows: the UI package draws a nav row or a rail entry, and
 * hands its link over through `renderLink`; the app draws that link as the router's `Link`, so a
 * click navigates in place, and says which link is the current page.
 */
import { Link, matchPath } from "react-router";
import type { NavRowLinkProps } from "@prismshadow/penguin-ui";

/** A package row's link as the router's own: the row's classes, state and content, navigating in place. */
export function renderRouterLink(link: NavRowLinkProps) {
  return (
    <Link
      to={link.href}
      className={link.className}
      aria-current={link["aria-current"]}
      aria-label={link["aria-label"]}
      data-tooltip={link["data-tooltip"]}
      onClick={link.onClick}
    >
      {link.children}
    </Link>
  );
}

/**
 * Whether `to` is the page the reader is on: the path itself or anything under it, the rule a
 * router `NavLink` applies by default (so `/agents` stays current on an Agent's own page).
 */
export function isCurrentPath(to: string, pathname: string): boolean {
  return matchPath({ path: to, end: false }, pathname) !== null;
}
