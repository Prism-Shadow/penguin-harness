/**
 * The public sites' way back to a page's parent (a post to the blog, a plugin to the plugin
 * list): a muted arrow and the parent's name on one line of fixed height, above the page's
 * title, so the title sits at the same place whether the link has drawn yet or not. The host
 * routes it (`render`, its router's link); `aria-label` lets the link say "Back to …" while its
 * text stays the parent's name.
 */
import type { ReactNode } from "react";
import type { SiteLinkProps } from "./site-header";
import { ArrowRightIcon } from "./site-icons";

export function SiteBackLink({
  href,
  children,
  label,
  onClick,
  render,
}: {
  href: string;
  /** What the link shows: the parent's name, or a short phrase ("Back to the blog"). */
  children: ReactNode;
  /** The accessible name, when the text alone does not say it goes back. */
  label?: string;
  onClick?: SiteLinkProps["onClick"];
  render?: (props: SiteLinkProps) => ReactNode;
}) {
  const props: SiteLinkProps = {
    href,
    "aria-label": label,
    onClick,
    className: "site-back inline-flex h-5 items-center gap-1.5 text-sm",
    children: (
      <>
        <ArrowRightIcon aria-hidden className="h-3.5 w-3.5 shrink-0 rotate-180" />
        {children}
      </>
    ),
  };
  return render ? render(props) : <a {...props} />;
}
