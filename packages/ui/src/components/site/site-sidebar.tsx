/**
 * A documentation sidebar: an optional search trigger, then labelled sections of page links on
 * one rule, a page's sub-pages indented under it, the current page marked. The host supplies
 * the sections, the router link (`renderLink`) and, for a mobile drawer, `onNavigate` to close it.
 */
import type { ReactNode } from "react";
import type { SiteLinkProps } from "./site-header";
import { SiteSearchButton } from "./site-search";

export interface SiteSidebarItem {
  id: string;
  href: string;
  label: string;
  active?: boolean;
  /** Sub-pages, one level deep, indented under this page. */
  children?: readonly SiteSidebarItem[];
}

export interface SiteSidebarSection {
  id: string;
  title: string;
  items: readonly SiteSidebarItem[];
}

function ItemLink({
  item,
  nested,
  renderLink,
  onNavigate,
}: {
  item: SiteSidebarItem;
  nested: boolean;
  renderLink: (props: SiteLinkProps) => ReactNode;
  onNavigate?: () => void;
}) {
  return renderLink({
    href: item.href,
    onClick: onNavigate,
    "aria-current": item.active ? "page" : undefined,
    "data-nested": nested || undefined,
    className: `site-rail-link py-1 ${nested ? "pl-6" : "pl-3"}`,
    children: item.label,
  } as SiteLinkProps);
}

export function SiteSidebarNav({
  label,
  sections,
  renderLink,
  onNavigate,
  search,
}: {
  /** The nav's accessible name. */
  label: string;
  sections: readonly SiteSidebarSection[];
  renderLink: (props: SiteLinkProps) => ReactNode;
  onNavigate?: () => void;
  search?: { label: string; shortcut: string; onOpen: (trigger: HTMLButtonElement) => void };
}) {
  return (
    <nav aria-label={label} className="site-sidebar text-sm">
      {search && (
        <SiteSearchButton label={search.label} shortcut={search.shortcut} onOpen={search.onOpen} />
      )}
      {sections.map((section) => (
        <div key={section.id} className="mb-6">
          <p className="site-eyebrow ui-eyebrow mb-2">{section.title}</p>
          <ul className="site-rail-list site-rail-tight">
            {section.items.map((item) => (
              <li key={item.id}>
                <ItemLink
                  item={item}
                  nested={false}
                  renderLink={renderLink}
                  onNavigate={onNavigate}
                />
                {item.children && (
                  <ul className="site-rail-tight">
                    {item.children.map((child) => (
                      <li key={child.id}>
                        <ItemLink
                          item={child}
                          nested
                          renderLink={renderLink}
                          onNavigate={onNavigate}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
