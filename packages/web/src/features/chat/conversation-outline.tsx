/**
 * Conversation outline: a collapsible quick-jump index docked left of the message stream.
 * One entry per exchange — the user's question as a miniature bubble with a truncated
 * plain-text preview of the reply under it (built by outline-model.ts) — because long
 * thinking/tool output makes locating a turn by scrolling painful. Clicking an entry jumps
 * the stream to that turn (with a brief flash on the landed-on message); a scrollspy tracks
 * which turn is at the reading line and highlights it, accordion-style: the active entry
 * expands to more preview lines while the others fold to one line each.
 *
 * The panel owns no data: chat-page passes the entries plus a ref to MessageStream's
 * scroll container, and all anchor queries ([data-outline-anchor], stamped by MessageItems
 * at the top level only) are scoped to that container — item ids repeat across nested
 * subagent models, so document-wide lookups would be ambiguous. Desktop-only (≥ xl): below
 * that the chat column needs the room, and touch scrolling has momentum to cover distance.
 * The open/collapsed preference persists like the panel width (a device preference, not
 * per-session state); the collapsed form is a slim rail so the way back stays visible.
 */
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { S } from "../../lib/strings";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import type { OutlineEntry } from "./outline-model";
import { previewText } from "./outline-model";

/** Panel-with-list glyph (24×24 line path) for the show/hide toggles. */
const OUTLINE_ICON =
  "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm4 0v16M12 9h5m-5 4h5";

/**
 * Desktop-only, mounted conditionally rather than CSS-hidden: below xl the chat column
 * needs the room (and touch scrolling covers distance anyway), and an invisible copy of
 * every message text would keep polluting text lookup — for assistive tech and tests alike
 * — while the scrollspy kept computing for nobody.
 */
const DOCK_QUERY = "(min-width: 1280px)";

/** Distance of the scrollspy "reading line" below the scrollport top: the entry whose anchor last crossed it counts as active. */
const READING_LINE_PX = 96;

/** Flash animation length on the landed-on message; must outlast the CSS animation (900ms). */
const FLASH_MS = 1000;

export function ConversationOutline({
  entries,
  version,
  scrollRef,
  running,
  open,
  setOpen,
}: {
  entries: OutlineEntry[];
  /** Stream repaint signal: re-runs the scrollspy as content grows (growth fires no scroll event). */
  version: number;
  /** MessageStream's scroll container (null while the stream isn't mounted, e.g. the empty greeting). */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Whether a Task is running: the last entry then previews "answering" while its reply text hasn't started. */
  running: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const [activeId, setActiveId] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const flashTimerRef = useRef<number | null>(null);
  const [docked, setDocked] = useState(() => window.matchMedia(DOCK_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(DOCK_QUERY);
    const onChange = (e: MediaQueryListEvent) => setDocked(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Scrollspy: the active turn is the last anchor above the reading line. Recomputed on
  // scroll (rAF-throttled) and on every version bump — streaming growth moves anchors
  // without firing a scroll event. Listener re-attachment per bump is cheap, and keying on
  // version also re-binds after the stream remounts on a session switch.
  useEffect(() => {
    const el = scrollRef.current;
    if (!docked || !el || entries.length === 0) return;
    let raf: number | null = null;
    const compute = () => {
      raf = null;
      const container = scrollRef.current;
      if (!container) return;
      const anchors = container.querySelectorAll<HTMLElement>("[data-outline-anchor]");
      if (anchors.length === 0) return;
      // At (or near) the bottom the user is reading the newest exchange, even though a short
      // last turn never crosses the reading line — without this the last entry could only
      // become active by having enough content below it.
      const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 2;
      let active: number | null = null;
      if (atBottom) {
        active = Number(anchors[anchors.length - 1]!.dataset["outlineAnchor"]);
      } else {
        const line = container.scrollTop + READING_LINE_PX;
        for (const anchor of anchors) {
          if (anchor.offsetTop > line) break;
          active = Number(anchor.dataset["outlineAnchor"]);
        }
      }
      setActiveId(active);
    };
    const onScroll = () => {
      raf ??= requestAnimationFrame(compute);
    };
    compute();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [docked, scrollRef, entries.length, version]);

  // Keep the active entry visible inside the outline's own list while reading/streaming.
  useEffect(() => {
    if (activeId === null) return;
    listRef.current
      ?.querySelector(`[data-outline-entry="${activeId}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  useEffect(
    () => () => {
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    },
    [],
  );

  if (!docked || entries.length === 0) return null;

  const jump = (id: number) => {
    const container = scrollRef.current;
    const anchor = container?.querySelector<HTMLElement>(`[data-outline-anchor="${id}"]`);
    if (!container || !anchor) return;
    // Instant jump (the glide is for returning to the live bottom, not for navigation);
    // the resulting scroll event lets stream-follow exit/resume by its own rules.
    container.scrollTo({ top: Math.max(0, anchor.offsetTop - 8) });
    setActiveId(id);
    // Landing feedback: a brief background wash on the message. Applied via classList —
    // the anchor wrapper renders without className, so React re-renders during streaming
    // won't strip the class mid-animation.
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    anchor.classList.remove("outline-flash");
    void anchor.offsetWidth; // restart the animation when re-clicking the same entry
    anchor.classList.add("outline-flash");
    flashTimerRef.current = window.setTimeout(
      () => anchor.classList.remove("outline-flash"),
      FLASH_MS,
    );
  };

  if (!open) {
    return (
      <div className="flex shrink-0 flex-col border-r border-gray-200 dark:border-gray-800">
        <button
          type="button"
          title={S.chat.outlineShow}
          aria-label={S.chat.outlineShow}
          aria-expanded={false}
          onClick={() => setOpen(true)}
          className="m-1.5 flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
        >
          <GlyphIcon d={OUTLINE_ICON} size={15} />
        </button>
      </div>
    );
  }

  const last = entries[entries.length - 1]!;
  return (
    <div className="flex w-60 shrink-0 flex-col border-r border-gray-200 dark:border-gray-800">
      <div className="flex shrink-0 items-center justify-between border-b border-gray-200 py-1.5 pr-1.5 pl-3 dark:border-gray-800">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
          {S.chat.outlineTitle}
        </span>
        <button
          type="button"
          title={S.chat.outlineHide}
          aria-label={S.chat.outlineHide}
          aria-expanded
          onClick={() => setOpen(false)}
          className="flex h-6 w-6 items-center justify-center rounded-md text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-300"
        >
          <GlyphIcon d={OUTLINE_ICON} size={14} />
        </button>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
        {entries.map((entry) => {
          const active = entry.anchorId === activeId;
          // Preview: the reply text, or a pulsing "answering" note while the newest turn
          // runs with nothing streamed yet; settled turns without text (e.g. aborted) show
          // the question alone.
          const answer = entry.answer
            ? previewText(entry.answer, active ? 160 : 80)
            : entry === last && running
              ? S.chat.outlineAnswering
              : "";
          return (
            <button
              key={entry.anchorId}
              type="button"
              data-outline-entry={entry.anchorId}
              aria-current={active || undefined}
              title={entry.question.slice(0, 400) || S.chat.outlineNoText}
              onClick={() => jump(entry.anchorId)}
              className={`block w-full rounded-md px-2 py-1.5 text-left transition-colors duration-150 ${
                active
                  ? "bg-gray-100 dark:bg-gray-800/70"
                  : "hover:bg-gray-50 dark:hover:bg-gray-900"
              }`}
            >
              {/* Miniature of the conversation: the question as a right-aligned user bubble… */}
              <span className="flex justify-end">
                <span
                  className={`${active ? "line-clamp-2" : "line-clamp-1"} max-w-[92%] rounded-md rounded-tr-sm bg-gray-200/60 px-2 py-1 text-xs leading-snug text-gray-800 dark:bg-gray-700/50 dark:text-gray-200 ${
                    entry.question === "" ? "italic text-gray-500 dark:text-gray-400" : ""
                  }`}
                >
                  {entry.question || S.chat.outlineNoText}
                </span>
              </span>
              {/* …and the reply preview under it, left-aligned like the assistant's column. */}
              {answer !== "" && (
                <span
                  className={`${active ? "line-clamp-3" : "line-clamp-1"} mt-1 block text-[11px] leading-snug text-gray-500 dark:text-gray-400 ${
                    entry.answer === "" ? "animate-pulse" : ""
                  }`}
                >
                  {answer}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
