/**
 * The module list: a search box over the modules grouped as the index groups them
 * (lib/groups.ts), the current page marked. The left column of a module page holds it; at phone
 * width the drawer does. The search matches a module's title in either language and its id, and
 * Ctrl/⌘ K focuses it.
 */
import { useEffect, useRef, useState } from "react";
import { MODULE_GROUPS } from "../lib/groups";
import { BASE } from "../lib/location";
import { moduleHref } from "../lib/routes";
import { useText } from "../preview";
import { MODULES } from "../registry";
import { useGallery } from "../state";
import { ChromeIcon } from "./icons";

export function ModuleNav({
  activeId,
  onNavigate,
}: {
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
  const groups = MODULE_GROUPS.map((group) => ({
    id: group.id,
    modules: group.modules.flatMap((id) => {
      const entry = MODULES.byId.get(id);
      if (!entry) return [];
      const title = text.module(entry.module).title;
      const haystack = [title, entry.module.title, id].map((s) => s.toLowerCase());
      return needle === "" || haystack.some((s) => s.includes(needle)) ? [{ id, title }] : [];
    }),
  })).filter((group) => group.modules.length > 0);

  return (
    <nav className="g-nav" aria-label={S.site.modules}>
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
          <span className="g-nav-eyebrow">{text.group(group.id)}</span>
          <ul>
            {group.modules.map((module) => (
              <li key={module.id}>
                <a
                  className="g-nav-link"
                  href={moduleHref(BASE, state, module.id)}
                  aria-current={module.id === activeId ? "page" : undefined}
                  onClick={onNavigate}
                >
                  {module.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
