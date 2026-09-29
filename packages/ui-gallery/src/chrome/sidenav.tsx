/**
 * The surface list: a search box over the app's surfaces grouped as the index groups them
 * (src/app/surfaces.ts), then Foundations and Fonts, the current page marked. The left column of
 * a page holds it; at phone width the drawer does. The search matches a surface's title in either
 * language and its id, and Ctrl/⌘ K focuses it.
 */
import { useEffect, useRef, useState } from "react";
import { SURFACE_GROUPS } from "../app/surfaces";
import { BASE } from "../lib/location";
import { moduleHref, routeHref, surfaceHref } from "../lib/routes";
import { useText } from "../preview";
import { MODULES } from "../registry";
import { useGallery } from "../state";
import { zh } from "../strings";
import { en } from "../strings-en";
import { ChromeIcon } from "./icons";

/** One group of the list: the surfaces of a group, or Foundations and Fonts at the end. */
interface NavGroup {
  id: string;
  title: string;
  links: { id: string; title: string; href: string }[];
}

export function SurfaceNav({
  activeId,
  onNavigate,
}: {
  /** The surface or module page this is, for the current mark. */
  activeId: string | null;
  /** A link was followed: the drawer closes. */
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

  const more = [
    ...MODULES.list.flatMap(({ module }) => {
      const title = text.module(module).title;
      return matches(title, module.title, module.id)
        ? [{ id: module.id, title, href: moduleHref(BASE, state, module.id) }]
        : [];
    }),
    ...(matches(S.site.fonts, zh.site.fonts, en.site.fonts, "fonts")
      ? [{ id: "fonts", title: S.site.fonts, href: routeHref(BASE, state, "/fonts") }]
      : []),
  ];
  if (more.length > 0) groups.push({ id: "foundations", title: S.site.foundations, links: more });

  return (
    <nav className="g-nav" aria-label={S.site.nav}>
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
      {groups.map((group) => (
        <div key={group.id} className="g-nav-group">
          <span className="g-nav-eyebrow">{group.title}</span>
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
