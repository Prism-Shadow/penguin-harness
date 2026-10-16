/**
 * "On this page" for a public-site article: a sticky column of the page's ##/### headings on
 * wide screens, the one being read marked as the page scrolls.
 *
 * Tracking is scroll-position based (`activeTocEntry`), not an IntersectionObserver: with an
 * observer nothing intersects the narrow band between headings, so the highlight would stall
 * while scrolling. A TOC click (or an initial #hash) pins its entry as active: a short tail
 * section can never reach the reading line, so pure position tracking would mark a neighbour
 * instead of what the reader just chose. The pin releases on the first real scroll gesture
 * (wheel, touch, scroll keys) — smooth scrolling to the anchor fires only `scroll` events, so it
 * never unpins by itself.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { activeTocEntry, hashTargetId } from "./markdown-text";
import type { TocEntry } from "./markdown-text";

const SCROLL_KEYS = ["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "];

/** The id of the entry being read, and the pin a TOC click sets. Inert below two entries. */
export function useActiveTocEntry(entries: readonly TocEntry[]): {
  activeId: string;
  pinTo: (id: string) => void;
} {
  const [activeId, setActiveId] = useState("");
  const pinnedId = useRef<string | null>(null);
  const pinTo = useCallback((id: string) => {
    pinnedId.current = id;
    setActiveId(id);
  }, []);

  useEffect(() => {
    if (entries.length < 2) return;
    const ids = entries.map((entry) => entry.id);
    // Deep links carry the anchor percent-encoded (CJK headings); pin it if it is ours.
    const initialHash = hashTargetId(window.location.hash);
    pinnedId.current = ids.includes(initialHash) ? initialHash : null;
    let raf = 0;
    const update = () => {
      raf = 0;
      if (pinnedId.current !== null) {
        setActiveId(pinnedId.current);
        return;
      }
      const docEl = document.documentElement;
      setActiveId(
        activeTocEntry(
          ids,
          ids.map((id) => document.getElementById(id)?.getBoundingClientRect().top ?? null),
          {
            scrollY: window.scrollY,
            maxScroll: Math.max(0, docEl.scrollHeight - window.innerHeight),
            height: window.innerHeight,
          },
        ),
      );
    };
    const onScroll = () => {
      if (raf === 0) raf = requestAnimationFrame(update);
    };
    const unpin = () => {
      if (pinnedId.current === null) return;
      pinnedId.current = null;
      onScroll();
    };
    const onKey = (e: KeyboardEvent) => {
      if (SCROLL_KEYS.includes(e.key)) unpin();
    };
    // Same-page hash navigation (the address bar, an in-content anchor) re-runs no effect.
    const onHashChange = () => {
      const hash = hashTargetId(window.location.hash);
      if (ids.includes(hash)) pinTo(hash);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    window.addEventListener("wheel", unpin, { passive: true });
    window.addEventListener("touchmove", unpin, { passive: true });
    window.addEventListener("keydown", onKey);
    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("wheel", unpin);
      window.removeEventListener("touchmove", unpin);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("hashchange", onHashChange);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [entries, pinTo]);

  return { activeId, pinTo };
}

export function SiteToc({
  label,
  entries,
  activeId,
  onNavigate,
  className = "hidden xl:block",
}: {
  /** The column's heading and the nav's accessible name ("On this page"). */
  label: string;
  entries: readonly TocEntry[];
  activeId: string;
  onNavigate?: (id: string) => void;
  /** Where the column shows: by default only on wide screens, beside the article. */
  className?: string;
}) {
  return (
    <aside className={`site-toc ${className}`}>
      <nav className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto" aria-label={label}>
        <p className="site-eyebrow ui-eyebrow">{label}</p>
        <ul className="site-rail-list mt-3 space-y-1 text-sm">
          {entries.map((entry) => (
            <li key={entry.id}>
              <a
                href={`#${entry.id}`}
                onClick={() => onNavigate?.(entry.id)}
                aria-current={activeId === entry.id ? "location" : undefined}
                className={`site-rail-link py-0.5 ${entry.depth === 3 ? "pl-6" : "pl-3"}`}
              >
                {entry.text}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
