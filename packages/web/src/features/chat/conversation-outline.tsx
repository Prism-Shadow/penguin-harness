/**
 * Conversation minimap: a tick rail overlaying the left gutter of the message stream — one
 * tick per exchange, the one at the reading position emphasized; hovering (or focusing) a
 * tick pops a floating preview card (the user's question in bold over a truncated
 * plain-text reply preview), clicking jumps to that turn. It deliberately costs the
 * conversation no width: instead of a docked panel it lives in the slack the centered
 * column leaves free, appears only while that slack is actually wide enough (measured
 * live, so a side panel eating the room hides it) on hover-capable pointers, and the
 * preview card mounts only for the hovered tick — at rest the rail duplicates no message
 * text into the DOM (which would pollute text lookup for assistive tech and tests alike).
 *
 * The rail overlay is hit-transparent (pointer events only on the tick buttons), so wheel
 * scrolling anywhere in the gutter keeps scrolling the stream. Entries come from
 * outline-model.ts; jump targets are the [data-outline-anchor] wrappers MessageItems
 * stamps at the top level only, queried scoped to the stream's scroll container (item ids
 * repeat across nested subagent models, so document-wide lookups would be ambiguous).
 * Rendered into MessageStream's relative wrapper via its `outline` slot, so the rail spans
 * exactly the stream area — never the composer.
 */
import { useEffect, useRef, useState } from "react";
import type { FocusEvent, MouseEvent, RefObject } from "react";
import { S } from "../../lib/strings";
import type { OutlineEntry } from "./outline-model";
import { previewText } from "./outline-model";

/** Distance of the scrollspy "reading line" below the scrollport top: the entry whose anchor last crossed it counts as active. */
const READING_LINE_PX = 96;

/** Flash animation length on the landed-on message; must outlast the CSS animation (900ms). */
const FLASH_MS = 1000;

/**
 * Minimum free gutter (stream-container width minus the max-w-3xl column, halved) for the
 * rail to show: below this the ticks would sit on top of assistant text instead of blank
 * margin. Measured live via ResizeObserver — window resizes and panel drags both count.
 */
const GUTTER_MIN_PX = 56;

/** The stream column cap the gutter derives from (Tailwind max-w-3xl). */
const COLUMN_MAX_PX = 768;

/** Hover-preview interaction needs a pointer that can hover: on touch the rail never renders. */
const HOVER_QUERY = "(hover: hover) and (pointer: fine)";

/** Tick pitch bounds (px): compress toward MIN as turns outgrow the rail, never past hoverability. */
const TICK_PITCH_MAX = 12;
const TICK_PITCH_MIN = 5;

export function ConversationOutline({
  entries,
  version,
  scrollRef,
  running,
}: {
  entries: OutlineEntry[];
  /** Stream repaint signal: re-runs the scrollspy and measurements as content grows or the stream remounts. */
  version: number;
  /** MessageStream's scroll container (null while the stream isn't mounted, e.g. the empty greeting). */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Whether a Task is running: the newest entry's card then previews "answering" while its reply text hasn't started. */
  running: boolean;
}) {
  const [activeId, setActiveId] = useState<number | null>(null);
  /** Hovered/focused tick: which entry to preview, and the tick's center Y within the overlay (the card anchors there). */
  const [hover, setHover] = useState<{ id: number; top: number } | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const flashTimerRef = useRef<number | null>(null);
  const [pointerFine, setPointerFine] = useState(() => window.matchMedia(HOVER_QUERY).matches);
  /** Live stream-container metrics: whether the gutter has room, and the height the tick pitch divides. */
  const [fit, setFit] = useState<{ shown: boolean; height: number }>({ shown: false, height: 0 });

  useEffect(() => {
    const mq = window.matchMedia(HOVER_QUERY);
    const onChange = (e: MediaQueryListEvent) => setPointerFine(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Gutter measurement. Keyed on `version` besides the ref: the scroll container remounts
  // on a session switch (keyed subtree) without this component unmounting, and the
  // observer must re-attach to the new element.
  useEffect(() => {
    const el = scrollRef.current;
    if (!pointerFine || !el) return;
    const measure = () => {
      const gutter = (el.clientWidth - COLUMN_MAX_PX) / 2;
      setFit({ shown: gutter >= GUTTER_MIN_PX, height: el.clientHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // The element is read from the ref per run; `version` is the remount signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointerFine, scrollRef, version]);

  // Scrollspy: the active turn is the last anchor above the reading line. Recomputed on
  // scroll (rAF-throttled) and on every version bump — streaming growth moves anchors
  // without firing a scroll event. Listener re-attachment per bump is cheap, and keying on
  // version also re-binds after the stream remounts on a session switch.
  useEffect(() => {
    const el = scrollRef.current;
    if (!fit.shown || !el || entries.length === 0) return;
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
  }, [fit.shown, scrollRef, entries.length, version]);

  useEffect(
    () => () => {
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    },
    [],
  );

  if (!pointerFine || !fit.shown || entries.length === 0) return null;

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

  /** Tick center Y relative to the rail overlay (the preview card anchors to it, clamped in render). */
  const tickTop = (e: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return rect.top + rect.height / 2 - (navRef.current?.getBoundingClientRect().top ?? 0);
  };

  // Compress the pitch as turns outgrow the rail (~32px breathing room); past ~140 turns
  // at minimum pitch the stack simply clips — a conversation that long stopped being
  // scannable by any other means well before the map does.
  const pitch = Math.max(
    TICK_PITCH_MIN,
    Math.min(TICK_PITCH_MAX, Math.floor((fit.height - 32) / entries.length)),
  );
  const hovered = hover === null ? null : (entries.find((en) => en.anchorId === hover.id) ?? null);
  const last = entries[entries.length - 1]!;
  const cardAnswer =
    hovered === null
      ? ""
      : hovered.answer
        ? previewText(hovered.answer, 160)
        : hovered === last && running
          ? S.chat.outlineAnswering
          : "";

  return (
    // Hit-transparent overlay (pointer events only on the tick buttons): the wheel keeps
    // scrolling the stream everywhere in the gutter. z level with the back-to-bottom
    // overlay (z-10), below dropdowns (z-40).
    <nav
      ref={navRef}
      aria-label={S.chat.outlineTitle}
      className="pointer-events-none absolute inset-y-0 left-0 z-10 flex flex-col items-start justify-center"
    >
      <div>
        {entries.map((entry, i) => {
          const active = entry.anchorId === activeId;
          return (
            <button
              key={entry.anchorId}
              type="button"
              data-outline-tick={entry.anchorId}
              aria-current={active || undefined}
              aria-label={S.chat.outlineTickLabel(i + 1, entry.question || S.chat.outlineNoText)}
              style={{ height: pitch }}
              onMouseEnter={(e) => setHover({ id: entry.anchorId, top: tickTop(e) })}
              onMouseLeave={() => setHover(null)}
              onFocus={(e) => setHover({ id: entry.anchorId, top: tickTop(e) })}
              onBlur={() => setHover(null)}
              onClick={() => jump(entry.anchorId)}
              className="group/tick pointer-events-auto flex w-10 items-center pl-2.5"
            >
              {/* The visible tick: a short bar, longer and darker at the reading position
                  (the button is the real hit target — pitch-tall and wider than the bar). */}
              <span
                className={`h-[2px] rounded-full transition-all duration-150 ${
                  active
                    ? "w-5 bg-gray-800 dark:bg-gray-200"
                    : "w-3.5 bg-gray-300 group-hover/tick:bg-gray-500 dark:bg-gray-700 dark:group-hover/tick:bg-gray-400"
                }`}
              />
            </button>
          );
        })}
      </div>
      {/* Preview card for the hovered/focused tick only — never mounted at rest. Purely a
          tooltip: hit-transparent (moving the mouse toward it can't trap hover) and hidden
          from assistive tech (the tick's aria-label already names the turn). */}
      {hovered && (
        <div
          data-outline-card
          aria-hidden
          className="anim-pop pointer-events-none absolute left-10 w-80 -translate-y-1/2 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-lg dark:border-gray-700 dark:bg-gray-900"
          style={{ top: Math.min(Math.max(hover!.top, 56), Math.max(56, fit.height - 56)) }}
        >
          <p
            className={`truncate text-sm ${
              hovered.question === ""
                ? "italic text-gray-500 dark:text-gray-400"
                : "font-semibold text-gray-900 dark:text-gray-100"
            }`}
          >
            {hovered.question || S.chat.outlineNoText}
          </p>
          {cardAnswer !== "" && (
            <p
              className={`mt-1 line-clamp-3 text-sm leading-snug text-gray-500 dark:text-gray-400 ${
                hovered.answer === "" ? "animate-pulse" : ""
              }`}
            >
              {cardAnswer}
            </p>
          )}
        </div>
      )}
    </nav>
  );
}
