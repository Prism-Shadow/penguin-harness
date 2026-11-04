/**
 * The public sites' footer, in two shapes framed like the header (max-w-7xl): the landing page's
 * brand with link columns over the copyright, and the docs' single line of copyright and links.
 * Hosts supply the routes and the words; an internal route renders through the host's router
 * with `render`, as in the header.
 */
import type { ReactNode } from "react";
import type { SiteLink, SiteLinkProps } from "./site-header";

export type SiteFooterLink = Omit<SiteLink, "active"> & {
  /** Opens in a new tab: a page on another site (the repository, its releases). */
  external?: boolean;
};

export interface SiteFooterColumn {
  title: string;
  links: readonly SiteFooterLink[];
}

function FooterLink({ link, className }: { link: SiteFooterLink; className: string }) {
  const props: SiteLinkProps = {
    href: link.href,
    className,
    children: link.label,
    ...(link.external ? { target: "_blank", rel: "noreferrer" } : {}),
  };
  return link.render ? link.render(props) : <a {...props} />;
}

export function SiteFooter({
  copyright,
  brand,
  columns,
  links = [],
}: {
  copyright: string;
  /** The brand block of the full footer: logo, name and a one-line tagline. */
  brand?: { name: string; logo: string; tagline: string };
  /** The full footer's link columns; without brand or columns the footer is one line of `links`. */
  columns?: readonly SiteFooterColumn[];
  links?: readonly SiteFooterLink[];
}): ReactNode {
  if (brand === undefined && columns === undefined) {
    return (
      <footer className="site-footer">
        <div className="site-footer-line mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-6 text-xs sm:px-6">
          <p>{copyright}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {links.map((item) => (
              <FooterLink
                key={item.id}
                link={item}
                className="site-footer-link whitespace-nowrap"
              />
            ))}
          </div>
        </div>
      </footer>
    );
  }
  return (
    <footer className="site-footer">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <div className="flex flex-col gap-10 sm:flex-row sm:justify-between">
          {brand && (
            <div className="max-w-xs">
              <div className="flex items-center gap-2">
                <img src={brand.logo} alt="" className="h-7 w-7" />
                <span className="site-footer-name">{brand.name}</span>
              </div>
              <p className="site-footer-tagline mt-3 text-sm">{brand.tagline}</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-10 text-sm">
            {(columns ?? []).map((column) => (
              <div key={column.title}>
                <p className="mb-3 font-medium">{column.title}</p>
                <ul className="site-footer-links space-y-2">
                  {column.links.map((item) => (
                    <li key={item.id}>
                      <FooterLink link={item} className="site-footer-link" />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <p className="site-footer-copyright mt-10 pt-6 text-xs">{copyright}</p>
      </div>
    </footer>
  );
}
