/**
 * A section's left column: the links of the section the page is in, grouped, the current page
 * marked. Three sections have one — 界面 lists the app's surfaces under a search box (Ctrl/⌘ K
 * focuses it; it matches a title in either language and the id), 基础 lists the component
 * library's topics by group, 字体 lists the fonts pages. At phone width the drawer holds the same
 * list.
 */
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { SURFACE_GROUPS } from "../app/surfaces";
import { TOPIC_GROUPS } from "../library/topics";
import { BASE } from "../lib/location";
import { FONTS_PAGE_IDS, fontsHref, surfaceHref, topicHref } from "../lib/routes";
import type { FontsPageId } from "../lib/routes";
import { useGallery } from "../state";
import { zh } from "../strings";
import { en } from "../strings-en";
import { useText } from "../text";
import { ChromeIcon } from "./icons";

export interface NavLink {
  id: string;
  title: string;
  href: string;
}

/** One group of a list; a group without a title is the list's only one. */
export interface NavGroup {
  id: string;
  title?: string;
  links: NavLink[];
}

/** A section's navigation list, as every section renders it. */
export function SectionNav({
  label,
  groups,
  activeId,
  onNavigate,
  children,
}: {
  label: string;
  groups: readonly NavGroup[];
  /** The page this is, for the current mark. */
  activeId: string | null;
  /** A link was followed: the drawer closes. */
  onNavigate?: () => void;
  /** What sits above the groups: the surface list's search box, or what a search left empty. */
  children?: ReactNode;
}) {
  return (
    <nav className="g-nav" aria-label={label}>
      {children}
      {groups.map((group) => (
        <div key={group.id} className="g-nav-group">
          {group.title !== undefined && <span className="g-nav-eyebrow">{group.title}</span>}
          <ul>
            {group.links.map((link) => (
              <li key={link.id}>
                <a
                  className="g-nav-link"
                  href={link.href}
                  aria-current={link.id === activeId ? "page" : undefined}
                  onClick={onNavigate}
                >
                  {link.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function SurfaceNav({
  activeId,
  onNavigate,
}: {
  activeId: string | null;
  onNavigate?: () => void;
}) {
  const { S, state } = useGallery();
  const text = useText();
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const needle = query.trim().toLowerCase();
  const matches = (...names: string[]) =>
    needle === "" || names.some((name) => name.toLowerCase().includes(needle));
  const groups: NavGroup[] = SURFACE_GROUPS.map((group) => ({
    id: group.id,
    title: text.surfaceGroup(group.id),
    links: group.surfaces.flatMap((surface) => {
      const title = text.surface(surface.id).title;
      return matches(
        title,
        zh.surfaces[surface.id].title,
        en.surfaces[surface.id].title,
        surface.id,
      )
        ? [{ id: surface.id, title, href: surfaceHref(BASE, state, surface.id) }]
        : [];
    }),
  })).filter((group) => group.links.length > 0);

  return (
    <SectionNav
      label={S.site.nav}
      groups={groups}
      activeId={activeId}
      {...(onNavigate ? { onNavigate } : {})}
    >
      <label className="g-search">
        <ChromeIcon name="search" size={14} />
        <input
          ref={input}
          type="search"
          placeholder={S.site.search}
          aria-label={S.site.search}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <kbd>{S.site.searchShortcut}</kbd>
      </label>
      {groups.length === 0 && <p className="g-muted g-nav-empty">{S.site.noMatches}</p>}
    </SectionNav>
  );
}

export function TopicNav({
  activeId,
  onNavigate,
}: {
  activeId: string | null;
  onNavigate?: () => void;
}) {
  const { S, state } = useGallery();
  const text = useText();
  const groups: NavGroup[] = TOPIC_GROUPS.map((group) => ({
    id: group.id,
    title: text.topicGroup(group.id),
    links: group.topics.map((topic) => ({
      id: topic.id,
      title: text.topic(topic.id).title,
      href: topicHref(BASE, state, topic.id),
    })),
  }));
  return (
    <SectionNav
      label={S.library.title}
      groups={groups}
      activeId={activeId}
      {...(onNavigate ? { onNavigate } : {})}
    />
  );
}

export function FontsNav({
  activeId,
  onNavigate,
}: {
  activeId: FontsPageId;
  onNavigate?: () => void;
}) {
  const { S, state } = useGallery();
  const groups: NavGroup[] = [
    {
      id: "fonts",
      links: FONTS_PAGE_IDS.map((page) => ({
        id: page,
        title: S.fonts.pages[page],
        href: fontsHref(BASE, state, page),
      })),
    },
  ];
  return (
    <SectionNav
      label={S.site.fonts}
      groups={groups}
      activeId={activeId}
      {...(onNavigate ? { onNavigate } : {})}
    />
  );
}
