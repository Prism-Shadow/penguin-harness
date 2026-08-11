/**
 * Conversation minimap, in two shapes sharing one data model (outline-model.ts):
 *
 * - `ConversationOutline` — a tick rail overlaying the left gutter of the message stream:
 *   one tick per exchange, the reading position emphasized; hovering (or focusing) a tick
 *   pops a floating preview card (question bold over a truncated reply preview), clicking
 *   jumps. It costs the conversation no width, and the preview card mounts only for the
 *   hovered tick — at rest the rail duplicates no message text into the DOM (which would
 *   pollute text lookup for assistive tech and tests alike). The overlay is
 *   hit-transparent (pointer events only on the ticks), so wheel scrolling anywhere in
 *   the gutter keeps scrolling the stream. Rendered into MessageStream's relative wrapper
 *   via its `outline` slot, so the rail spans exactly the stream area — never the composer.
 *   Long conversations don't stack every turn: the rail renders a sliding window of ticks
 *   around the reading position (`windowOutline`, its width sized to the measured rail
 *   height so the stack can never spill over the toolbar or composer), tiny edge dots
 *   standing in for the turns hidden past it, and labels keep their global turn numbers.
 *
 * - `OutlineMenuButton` — the fallback for when the rail cannot show: a toolbar icon
 *   button (top right) opening a dropdown index of the same entries, tap to jump. Phones
 *   are the primary case (no hover pointer, no gutter), but it also covers a desktop
 *   window whose gutter a docked panel has eaten — navigation stays reachable either way.
 *   The dropdown list scrolls, so it stays complete — no windowing here.
 *
 * Which shape shows is the owner's call via `useOutlineRailFit`: the rail needs a
 * hover-capable pointer and a live-measured gutter (ResizeObserver — window resizes and
 * panel drags both count), and the menu button renders exactly when the rail cannot.
 * Below OUTLINE_MIN_TURNS turns neither shape renders at all — that short a conversation
 * needs no index.
 *
 * Jump targets are the [data-outline-anchor] wrappers MessageItems stamps at the top
 * level only, queried scoped to the stream's scroll container (item ids repeat across
 * nested subagent models, so document-wide lookups would be ambiguous). The active-entry
 * computation considers only anchors that ARE entries: banner-only messages, merged image
 * fragments and later goal rounds carry anchors too, and crossing one of those must
 * highlight the entry that covers it rather than nothing.
 */
import { useEffect, useRef, useState } from "react";
import type { FocusEvent, MouseEvent, RefObject } from "react";
import { S } from "../../lib/strings";
import { Dropdown } from "../../components/ui/dropdown";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import type { OutlineEntry } from "./outline-model";
import {
  globalTurnNumber,
  outlineVisible,
  previewText,
  railTickPitch,
  railWindowHalf,
  windowOutline,
} from "./outline-model";

/** Panel-with-list glyph (24×24 line path) for the toolbar menu button. */
const OUTLINE_ICON =
  "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm4 0v16M12 9h5m-5 4h5";

/** Distance of the scrollspy "reading line" below the scrollport top: the entry whose anchor last crossed it counts as active. */
const READING_LINE_PX = 96;

/** Flash animation length on the landed-on message; must outlast the CSS animation (900ms). */
const FLASH_MS = 1000;

/**
 * Minimum free gutter (stream-container width minus the max-w-3xl column, halved) for the
 * rail to show: below this the ticks would sit on top of assistant text instead of blank
 * margin.
 */
const GUTTER_MIN_PX = 56;

/** The stream column cap the gutter derives from (Tailwind max-w-3xl = 48rem). */
const COLUMN_MAX_REM = 48;

/** The rail's hover-preview interaction needs a pointer that can hover. */
const HOVER_QUERY = "(hover: hover) and (pointer: fine)";

export interface OutlineRailFit {
  /** Whether the rail can show: hover-capable pointer AND a wide-enough measured gutter. */
  shown: boolean;
  /** Stream container height (the tick pitch divides it; the preview card clamps against it). */
  height: number;
}

/**
 * Live rail-fit measurement, owned by the page so the toolbar fallback can render exactly
 * when the rail cannot. Keyed on `version` besides the ref: the scroll container remounts
 * on a session switch (keyed subtree) without the page remounting, and the observer must
 * re-attach to the new element.
 */
export function useOutlineRailFit(
  scrollRef: RefObject<HTMLDivElement | null>,
  version: number,
): OutlineRailFit {
  const [pointerFine, setPointerFine] = useState(() => window.matchMedia(HOVER_QUERY).matches);
  const [fit, setFit] = useState<{ gutterOk: boolean; height: number }>({
    gutterOk: false,
    height: 0,
  });

  useEffect(() => {
    const mq = window.matchMedia(HOVER_QUERY);
    const onChange = (e: MediaQueryListEvent) => setPointerFine(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      // The column cap is rem-based: resolve it against the live root font size, so
      // browser font scaling (which widens the real column without touching the
      // container) can't leave the rail sitting on top of the prose.
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const gutter = (el.clientWidth - COLUMN_MAX_REM * rem) / 2;
      setFit({ gutterOk: gutter >= GUTTER_MIN_PX, height: el.clientHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // The element is read from the ref per run; `version` is the remount signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRef, version]);

  return { shown: pointerFine && fit.gutterOk, height: fit.height };
}

/**
 * The entry whose exchange the reading position is inside: the last ENTRY anchor above the
 * reading line — anchors that aren't entries (banner-only messages, image fragments merged
 * into their entry, goal rounds past 1) resolve to the entry covering them by simply being
 * skipped. At (or near) the bottom the newest entry wins outright: a short last turn never
 * crosses the reading line on its own.
 */
function computeActiveAnchor(container: HTMLElement, entryIds: ReadonlySet<number>): number | null {
  const anchors = container.querySelectorAll<HTMLElement>("[data-outline-anchor]");
  if (anchors.length === 0) return null;
  let last: number | null = null;
  let active: number | null = null;
  const line = container.scrollTop + READING_LINE_PX;
  for (const anchor of anchors) {
    const id = Number(anchor.dataset["outlineAnchor"]);
    if (!entryIds.has(id)) continue;
    last = id;
    if (anchor.offsetTop <= line) active = id;
  }
  const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 2;
  return atBottom ? last : active;
}

/** Flash bookkeeping for jumps: one wash at a time; a timer firing on a detached node is a no-op, so no unmount cleanup is needed. */
let flashedAnchor: HTMLElement | null = null;
let flashTimer: number | undefined;

/** Scrolls the stream to an entry's anchor and flashes the landed-on message. */
function jumpToAnchor(container: HTMLElement | null, id: number): void {
  const anchor = container?.querySelector<HTMLElement>(`[data-outline-anchor="${id}"]`);
  if (!container || !anchor) return;
  // Instant jump (the glide is for returning to the live bottom, not for navigation);
  // the resulting scroll event lets stream-follow exit/resume by its own rules.
  container.scrollTo({ top: Math.max(0, anchor.offsetTop - 8) });
  // Landing feedback: a brief background wash on the message. Applied via classList — the
  // anchor wrapper renders without className, so React re-renders during streaming won't
  // strip the class mid-animation.
  window.clearTimeout(flashTimer);
  flashedAnchor?.classList.remove("outline-flash");
  flashedAnchor = anchor;
  anchor.classList.remove("outline-flash");
  void anchor.offsetWidth; // restart the animation when re-jumping to the same entry
  anchor.classList.add("outline-flash");
  flashTimer = window.setTimeout(() => anchor.classList.remove("outline-flash"), FLASH_MS);
}

/**
 * Edge hint for the rail's sliding window: a tiny vertical ellipsis of dots where turns
 * are hidden past the window. Purely decorative and non-interactive — it never re-enables
 * pointer events inside the hit-transparent overlay, and it hides from assistive tech
 * (the ticks' global turn numbers already tell that story).
 */
function RailOverflowMark({ edge }: { edge: "above" | "below" }) {
  return (
    <div
      data-outline-overflow={edge}
      aria-hidden
      className={`flex w-10 flex-col items-start gap-[3px] pl-4 ${edge === "above" ? "pb-1.5" : "pt-1.5"}`}
    >
      {[0, 1, 2].map((i) => (
        <span key={i} className="h-[2px] w-[2px] rounded-full bg-gray-300 dark:bg-gray-700" />
      ))}
    </div>
  );
}

/** The turn's reply preview for a card/menu row: text, an "answering" pulse for the newest running turn, or "". */
function answerPreview(
  entry: OutlineEntry,
  entries: readonly OutlineEntry[],
  running: boolean,
  max: number,
): string {
  if (entry.answer) return previewText(entry.answer, max);
  return running && entry === entries[entries.length - 1] ? S.chat.outlineAnswering : "";
}

export function ConversationOutline({
  entries,
  turnOffset = 0,
  version,
  scrollRef,
  running,
  fit,
}: {
  entries: OutlineEntry[];
  /**
   * Turns that exist BEFORE the loaded history window (windowed loading): added to every
   * tick's global turn number, counted toward the visibility gate, and >0 keeps the
   * "more above" edge dots on — numbering never lies about unloaded turns, and the rail
   * signals that scrolling up will reveal them.
   */
  turnOffset?: number;
  /** Stream repaint signal: re-runs the scrollspy as content grows or the stream remounts. */
  version: number;
  /** MessageStream's scroll container (null while the stream isn't mounted, e.g. the empty greeting). */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Whether a Task is running: the newest entry's card then previews "answering" while its reply text hasn't started. */
  running: boolean;
  /** The page-owned rail-fit measurement (shared with the toolbar fallback's visibility). */
  fit: OutlineRailFit;
}) {
  const [activeId, setActiveId] = useState<number | null>(null);
  /** Hovered/focused tick: which entry to preview, and the tick's center Y within the overlay (the card anchors there). */
  const [hover, setHover] = useState<{ id: number; top: number } | null>(null);
  const navRef = useRef<HTMLElement>(null);

  // Scrollspy: recomputed on scroll (rAF-throttled) and on every version bump — streaming
  // growth moves anchors without firing a scroll event. Listener re-attachment per bump is
  // cheap, and keying on version also re-binds after the stream remounts on a session switch.
  useEffect(() => {
    const el = scrollRef.current;
    if (!fit.shown || !el || !outlineVisible(turnOffset, entries.length)) return;
    const ids = new Set(entries.map((entry) => entry.anchorId));
    let raf: number | null = null;
    const compute = () => {
      raf = null;
      const container = scrollRef.current;
      if (container) setActiveId(computeActiveAnchor(container, ids));
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
    // `entries` is rebuilt per version; length + version cover it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit.shown, scrollRef, entries.length, turnOffset, version]);

  // The gate counts the WHOLE conversation (loaded + unloaded turns): a long session
  // whose tail window happens to hold few entries still deserves its index.
  if (!fit.shown || !outlineVisible(turnOffset, entries.length)) return null;

  /** Tick center Y relative to the rail overlay (the preview card anchors to it, clamped in render). */
  const tickTop = (e: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return rect.top + rect.height / 2 - (navRef.current?.getBoundingClientRect().top ?? 0);
  };

  // The rail renders a sliding window around the reading position, not every turn: an
  // unbounded stack would outgrow the rail (and creep over the toolbar and composer) no
  // matter how hard the pitch compresses. The half-width adapts to the measured rail
  // height so the stack always fits; `start` is the windowed ticks' global offset —
  // labels and active tracking stay in global turn numbers.
  const half = railWindowHalf(fit.height);
  const { start, end } = windowOutline(
    entries.length,
    entries.findIndex((en) => en.anchorId === activeId),
    half,
    half,
  );
  const visible = entries.slice(start, end);

  // Pitch compresses toward MIN as the window outgrows the rail; railWindowHalf already
  // sized the window so the stack (plus edge dots) fits fit.height at minimum pitch.
  const pitch = railTickPitch(fit.height, visible.length);
  // Looked up in the windowed slice: a tick the window slid away from mid-hover unmounts
  // without a mouseleave, and its card must not linger.
  const hovered = hover === null ? null : (visible.find((en) => en.anchorId === hover.id) ?? null);
  const cardAnswer = hovered === null ? "" : answerPreview(hovered, entries, running, 160);

  return (
    // Hit-transparent overlay (pointer events only on the tick buttons): the wheel keeps
    // scrolling the stream everywhere in the gutter. z level with the back-to-bottom
    // overlay (z-10), below dropdowns (z-40).
    <nav
      ref={navRef}
      aria-label={S.chat.outlineTitle}
      className="pointer-events-none absolute inset-y-0 left-0 z-10 flex flex-col items-start justify-center"
    >
      {/* max-h + clip is a safety net only: the height-adaptive window keeps the stack
          inside the rail by construction, and this guarantees a mismeasure still can't
          push ticks (which take pointer events) out over the toolbar or composer. */}
      <div className="max-h-full overflow-hidden">
        {/* "More above" also covers turns not yet LOADED (turnOffset > 0): the dots tell
            the same story either way — earlier turns exist beyond the rendered ticks. */}
        {(start > 0 || turnOffset > 0) && <RailOverflowMark edge="above" />}
        {visible.map((entry, i) => {
          const active = entry.anchorId === activeId;
          return (
            <button
              key={entry.anchorId}
              type="button"
              data-outline-tick={entry.anchorId}
              aria-current={active || undefined}
              // Global turn number (turnOffset + start + i): neither the sliding window
              // nor a partially-loaded history changes how a turn is numbered.
              aria-label={S.chat.outlineTickLabel(
                globalTurnNumber(turnOffset, start + i),
                entry.question || S.chat.outlineNoText,
              )}
              style={{ height: pitch }}
              onMouseEnter={(e) => setHover({ id: entry.anchorId, top: tickTop(e) })}
              onMouseLeave={() => setHover(null)}
              onFocus={(e) => setHover({ id: entry.anchorId, top: tickTop(e) })}
              onBlur={() => setHover(null)}
              onClick={() => {
                jumpToAnchor(scrollRef.current, entry.anchorId);
                setActiveId(entry.anchorId);
              }}
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
        {end < entries.length && <RailOverflowMark edge="below" />}
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

/**
 * Toolbar fallback (rendered by the page exactly when the rail cannot show): an icon
 * button opening a dropdown index of the exchanges — question bold, truncated reply
 * preview under it, the exchange at the reading position highlighted (computed once per
 * open; the list isn't live while a dropdown covers the stream) — tap to jump and close.
 */
export function OutlineMenuButton({
  entries,
  turnOffset = 0,
  scrollRef,
  running,
}: {
  entries: OutlineEntry[];
  /** Turns before the loaded window (windowed loading): gates visibility on the WHOLE conversation; the list itself shows loaded turns only. */
  turnOffset?: number;
  scrollRef: RefObject<HTMLDivElement | null>;
  running: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(null);
  // Same gate as the rail: with this few turns neither shape earns its place.
  if (!outlineVisible(turnOffset, entries.length)) return null;

  const setOpenComputing = (next: boolean) => {
    if (next && scrollRef.current) {
      setActiveId(
        computeActiveAnchor(scrollRef.current, new Set(entries.map((entry) => entry.anchorId))),
      );
    }
    setOpen(next);
  };

  return (
    <Dropdown
      open={open}
      setOpen={setOpenComputing}
      menuClass="right-0 top-full mt-1 w-72 max-w-[calc(100vw-1.5rem)] origin-top-right"
      button={
        <button
          type="button"
          title={S.chat.outlineTitle}
          aria-label={S.chat.outlineTitle}
          onClick={() => setOpenComputing(!open)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
        >
          <GlyphIcon d={OUTLINE_ICON} size={15} />
        </button>
      }
    >
      <div className="max-h-[60vh] overflow-y-auto py-1">
        {entries.map((entry) => {
          const answer = answerPreview(entry, entries, running, 80);
          const active = entry.anchorId === activeId;
          return (
            <button
              key={entry.anchorId}
              type="button"
              data-outline-menu-entry={entry.anchorId}
              aria-current={active || undefined}
              onClick={() => {
                jumpToAnchor(scrollRef.current, entry.anchorId);
                setOpen(false);
              }}
              className={`block w-full px-3 py-1.5 text-left transition-colors duration-150 ${
                active
                  ? "bg-gray-100 dark:bg-gray-800"
                  : "hover:bg-gray-50 dark:hover:bg-gray-800/60"
              }`}
            >
              <span
                className={`block truncate text-sm ${
                  entry.question === ""
                    ? "italic text-gray-500 dark:text-gray-400"
                    : "font-medium text-gray-800 dark:text-gray-200"
                }`}
              >
                {entry.question || S.chat.outlineNoText}
              </span>
              {answer !== "" && (
                <span
                  className={`mt-0.5 block truncate text-xs text-gray-500 dark:text-gray-400 ${
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
    </Dropdown>
  );
}
