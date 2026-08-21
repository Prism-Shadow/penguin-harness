/**
 * Message stream container: renders the ChatItem list; auto-sticks to the
 * bottom while streaming — an upward swipe immediately pauses follow, and scrolling back near
 * the bottom resumes it (see stream-follow.ts for the exact rule).
 * StreamRenderContext threads the pending-approval map and approval callback down to tool
 * cards at any nesting depth.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { S } from "../../lib/strings";
import type { ChatItem } from "../../lib/omni/stream-model";
import type { MemoryChangeRow } from "../../lib/omni/memory-changes";
import type { TaskStats } from "../../lib/omni/task-stats";
import type { PendingApproval } from "./use-session-stream";
import { EmptyState } from "../../components/ui/empty-state";
import { MessageItem } from "./message-item";
import { WorkGroup, isWorkItem } from "./work-group";
import { createStreamFollow, stickToBottom } from "./stream-follow";
import type { StreamFollow } from "./stream-follow";
import type { ForkTarget } from "./task-stats-line";

/** Context passed down to nested rendering (pending approvals + approval submit callback + current origin chain). */
export interface StreamRenderContext {
  /** approvalKey(origin, toolCallId) → pending approval (disambiguates by origin when parent/child session tool_call_ids collide). */
  pendingApprovals: ReadonlyMap<string, PendingApproval>;
  onApprove: (toolCallId: string, decision: "allow" | "deny", origin: string[]) => Promise<void>;
  /** Origin chain at the current render level (empty array for the main session; subagent cards append one level each). */
  origin: string[];
  /**
   * Whether the Task at this level is still running (taskState for the main session, its own
   * running state for a subagent card). The "Reasoning & Tools" group uses this to decide: as
   * long as the model might still call another tool, the trailing group always shows "Running".
   */
  taskRunning: boolean;
  /** Converts this turn's stats into cost (USD) using the current Model pricing; returns null when no price is configured (cost is hidden). */
  taskCost?: (stats: TaskStats) => number | null;
  /**
   * "Retry now" on the live reconnect countdown: skips the remaining backoff wait
   * server-side (POST /retry-now); the line flips to "retrying" when the request_begin
   * arrives. Only honored on main-session items — a subagent's backoff belongs to the
   * child session, which the route does not target.
   */
  onRetryNow?: () => void;
  /** "Give up" on the live reconnect countdown: the ordinary session abort (same call as the Stop button). */
  onGiveUp?: () => void;
  /** Opens the Files panel and navigates to this file (triggered by clicking the file-summary card at the end of a message; takes a Workspace-relative path); the card doesn't render if this isn't wired up. */
  onOpenFile?: (path: string) => void;
  /** Opens the subagents panel focused on this child session (subagent chip click); `origin` is the ctx.origin at the chip's render level — the child's ancestor chain, excluding its own id. */
  onOpenSubagent?: (sessionId: string, origin: string[]) => void;
  /** Opens the side panel's Memory view (memory-changes card header); the button doesn't render if this isn't wired up. */
  onOpenMemory?: () => void;
  /** Opens the Memory view located at this row's diffs (memory-changes card row click); rows render inert if this isn't wired up. */
  onLocateMemoryChange?: (row: MemoryChangeRow) => void;
  /** Absolute Workspace path of the current Session (used by the file-summary card to normalize body paths). */
  workspace?: string | null;
  /** Batch file-existence check (with session-level caching); the card doesn't render if this isn't wired up. */
  statFiles?: (paths: string[]) => Promise<ReadonlySet<string>>;
  /** Creates a new root Session through the selected completed assistant turn. */
  onFork?: (target: ForkTarget) => Promise<void>;
}

/** Pure list rendering (reused recursively inside subagent cards): consecutive thinking + tool-call items are aggregated into one "Reasoning & Tools" group. */
export function MessageItems({ items, ctx }: { items: ChatItem[]; ctx: StreamRenderContext }) {
  // Split into segments first — group (consecutive thinking + tool calls) or single (everything
  // else) — then render. WorkGroup needs to know whether it's the last segment (current turn
  // still in progress) to decide its default expanded/collapsed state.
  type Seg = { type: "group"; items: ChatItem[] } | { type: "single"; item: ChatItem };
  const segs: Seg[] = [];
  let run: ChatItem[] = [];
  const flushRun = () => {
    if (run.length > 0) {
      segs.push({ type: "group", items: run });
      run = [];
    }
  };
  for (const item of items) {
    if (isWorkItem(item)) run.push(item);
    else {
      flushRun();
      segs.push({ type: "single", item });
    }
  }
  flushRun();

  const renderSeg = (seg: Seg, i: number): ReactNode =>
    seg.type === "group" ? (
      <WorkGroup
        key={`wg-${seg.items[0]!.id}`}
        items={seg.items}
        ctx={ctx}
        isLast={i === segs.length - 1}
      />
    ) : (
      <MessageItem key={seg.item.id} item={seg.item} ctx={ctx} />
    );

  /**
   * Each turn's AI-side content (reply, reasoning-and-tools group, compaction banner, ...) plus
   * its trailing stats row shares a single group container. The stats row is that turn's footer
   * (timestamp and copy button live there, and the whole row is transparent by default), so
   * hovering **any** content within the turn must be able to reveal it.
   *
   * The stats row can't simply be paired with the adjacent assistant reply — if compaction
   * happens mid-turn, the compaction banner gets inserted between them (items:
   * assistant_text → compaction → task_stats), breaking the pairing instantly. The stats row
   * would then become a strip that's both invisible and unhoverable (the element's own `group`
   * class doesn't apply to itself: group-hover is a descendant selector).
   *
   * The container is created as soon as the turn's **first** segment appears, keyed by that
   * segment's id, and the key never changes afterward. If we waited for the stats row to arrive
   * before moving already-rendered groups into a new container, React would treat it as a
   * position change — unmount and remount — and the WorkGroup and tool-card expanded states
   * (each backed by its own internal useState) would reset instantly: any tool details the user
   * had manually expanded would collapse the moment the reply finishes.
   *
   * User messages never enter this container: they have their own footer, and including them
   * would make hovering a user message also light up the AI's stats row.
   */
  const nodes: ReactNode[] = [];
  let turn: { seg: Seg; i: number }[] = [];
  const flushTurn = () => {
    if (turn.length === 0) return;
    const first = turn[0]!.seg;
    const key = first.type === "group" ? first.items[0]!.id : first.item.id;
    const body = turn;
    turn = [];
    nodes.push(
      <div key={`turn-${key}`} className="group">
        {body.map((t) => renderSeg(t.seg, t.i))}
      </div>,
    );
  };

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!;
    const isUserMsg =
      seg.type === "single" && (seg.item.kind === "user_text" || seg.item.kind === "user_image");
    if (isUserMsg) {
      flushTurn();
      // Outline jump anchor, top level only (ctx.origin is empty just for the main
      // conversation): item ids restart per model, so stamping nested renders — subagent
      // conversations in the panel — would duplicate anchor values; the outline queries
      // them scoped to the main stream's scroll container. The wrapper stays classless:
      // margins collapse straight through it, and the outline's transient flash class
      // lives outside React's managed props (className would wipe it on re-render).
      nodes.push(
        ctx.origin.length === 0 ? (
          <div key={`anchor-${seg.item.id}`} data-outline-anchor={seg.item.id}>
            {renderSeg(seg, i)}
          </div>
        ) : (
          renderSeg(seg, i)
        ),
      );
      continue;
    }
    turn.push({ seg, i });
    // Stats row = end of this turn; seal the container here. Anything after belongs to the next turn.
    if (seg.type === "single" && seg.item.kind === "task_stats") flushTurn();
  }
  flushTurn(); // Turn not yet finished (stats row hasn't arrived): container already exists, subsequent content is appended directly

  return <>{nodes}</>;
}

/** Scroll-up backfill wiring (windowed history): state + trigger for the top-of-stream affordance. */
export interface OlderHistoryControls {
  /** Older windows exist beyond the loaded history (scrolling near the top triggers onLoad). */
  hasMore: boolean;
  /** A backfill request is in flight (spinner row). */
  loading: boolean;
  /** The last backfill failed (retry row); null = fine. */
  error: string | null;
  /** Number of windows already prepended: the prepend signal for scroll anchoring, and >0 gates the beginning-of-history marker (a session that fit one window shows no extra chrome). */
  prependedCount: number;
  onLoad: () => void;
}

/** Distance from the top (px) at which scrolling starts fetching the previous history window. */
const OLDER_TRIGGER_PX = 300;

export function MessageStream({
  items,
  version,
  ctx,
  scrollElRef,
  outline,
  older,
}: {
  items: ChatItem[];
  /** View-model version number (a repaint signal for in-place updates that also drives auto-scroll). */
  version: number;
  ctx: StreamRenderContext;
  /** Mirrors the scroll container element out to the owner (the conversation outline's jump/scrollspy target). */
  scrollElRef?: RefObject<HTMLDivElement | null>;
  /**
   * Overlay slot rendered inside the stream's positioning wrapper (the conversation
   * outline's tick rail): the rail must span exactly the stream area — not the composer —
   * and anchor its absolute positioning to this wrapper, which only this component owns.
   */
  outline?: ReactNode;
  /** Scroll-up backfill of older history windows; omitted = the whole transcript is loaded (no top affordance). */
  older?: OlderHistoryControls;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // An upward-swipe intent immediately exits auto-follow; scrolling back near the bottom resumes it — see stream-follow.ts (#75) for the exact rule.
  const followRef = useRef<StreamFollow | null>(null);
  const follow = (followRef.current ??= createStreamFollow());
  // Back-to-bottom button visibility (React state — the follow object mutates outside React):
  // shown only when follow is off AND there is actually content below the fold. The second
  // condition matters: a wheel-up flick over a list that already fits the viewport exits follow
  // (stream-follow.ts keeps that rule deliberately) but must not surface a "jump to latest"
  // button with nothing to jump to. Synced after every event that can change either input
  // (wheel-up at the very top fires no scroll event, so syncing on scroll alone is not enough)
  // and in the version effect (content growing while unstuck fires no scroll event either).
  const [showJump, setShowJump] = useState(false);
  /**
   * Animated-return phase (back-to-bottom clicked, glide in flight). The glide is a
   * self-driven rAF loop rather than native scrollTo({behavior:"smooth"}) for two
   * live-tested reasons: (1) re-aiming a native smooth scroll on every stream commit resets
   * its easing, capping descent below a fast stream's growth rate — the return then never
   * arrives; (2) an in-flight native smooth scroll cannot be interrupted, so a wheel-up
   * cancel would keep dragging the user downward for hundreds of ms. The rAF loop chases the
   * LIVE bottom each frame with a velocity floor above any realistic growth rate, and
   * cancelling it stops the descent within a frame. While returning, the button stays hidden
   * and the stick snap must not fire (an instant snap on the next commit would kill the glide).
   */
  const returningRef = useRef(false);
  const returnRafRef = useRef<number | null>(null);
  const cancelReturn = () => {
    if (returnRafRef.current !== null) {
      cancelAnimationFrame(returnRafRef.current);
      returnRafRef.current = null;
    }
    returningRef.current = false;
  };
  useEffect(() => () => cancelReturn(), []);
  /** Local previous scrollTop, only for detecting the user fighting the return animation upward (the follow object keeps its own). */
  const lastTopRef = useRef<number | null>(null);
  const syncJump = () => {
    const el = scrollRef.current;
    setShowJump(
      !returningRef.current &&
        !follow.stick &&
        el !== null &&
        el.scrollHeight - el.scrollTop - el.clientHeight > 1,
    );
  };

  /** Held refs for prepend scroll anchoring (see the layout effect below). */
  const olderRef = useRef(older);
  olderRef.current = older;
  const lastPrependedRef = useRef(older?.prependedCount ?? 0);
  const lastHeightRef = useRef(0);

  /** Near the top of loaded history: fetch the previous window (loading/error states gate re-triggering; the retry row is click-driven). */
  const maybeLoadOlder = (el: HTMLDivElement) => {
    const o = olderRef.current;
    if (!o || !o.hasMore || o.loading || o.error !== null) return;
    if (el.scrollTop < OLDER_TRIGGER_PX) o.onLoad();
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const prevTop = lastTopRef.current;
    lastTopRef.current = el.scrollTop;
    // Scrollbar-drag / keyboard scroll upward during the return cancels it (wheel/touch cancel in their own handlers).
    if (returningRef.current && prevTop !== null && el.scrollTop < prevTop - 1) {
      cancelReturn();
    }
    follow.scrolled({
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    });
    maybeLoadOlder(el);
    syncJump();
  };

  // Layout effect (not useEffect): the stick-to-bottom snap must land before paint, otherwise
  // fast streams show the bottom edge "catching up" by the growth of each commit. Suppressed
  // during the animated return — the glide owns the scroll position until it arrives.
  // Every snap goes through stickToBottom, which reports the landed position to the follow
  // model synchronously — the snap's async scroll event otherwise races late content growth
  // and could misinitialize follow as "parked above the bottom" right after entering a
  // conversation (see stream-follow.ts).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    // Prepend scroll anchoring: when older windows land ABOVE the viewport, keep the
    // message the user was reading exactly where it was by offsetting scrollTop by the
    // content growth (same pre-paint timing as the stick snap, so nothing flashes).
    // Keyed on the prepend count — ordinary streaming growth at the bottom must not
    // shift the view. lastHeightRef is refreshed every commit, so at the prepend commit
    // it still holds the pre-prepend height. Skipped while sticking (the snap below
    // owns the position; a prepend while stuck at the bottom cannot move the tail).
    const prepended = older?.prependedCount ?? 0;
    if (el && prepended > lastPrependedRef.current && !follow.stick && !returningRef.current) {
      el.scrollTop += el.scrollHeight - lastHeightRef.current;
    }
    lastPrependedRef.current = prepended;
    if (el) lastHeightRef.current = el.scrollHeight;
    if (el && follow.stick && !returningRef.current) stickToBottom(el, follow);
    syncJump();
    // syncJump is recreated per render; the effect intentionally keys on stream growth only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, follow, older?.prependedCount]);

  // The container and the content can also resize OUTSIDE stream commits: the app shell's
  // notice banner (initial-password reminder) mounting after /api/me resolves shrinks the
  // scroll viewport, and a late-loading image grows the transcript. Neither fires a scroll
  // event nor bumps `version`, so while following, the view silently ended up a banner's
  // height above the bottom right after opening a conversation. Re-snap on any such resize
  // under the same guards as the commit snap; lastHeightRef stays in sync so a later
  // prepend's anchor offset isn't inflated by off-commit growth the anchor already saw.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      lastHeightRef.current = el.scrollHeight;
      if (follow.stick && !returningRef.current) stickToBottom(el, follow);
      syncJump();
    });
    ro.observe(el);
    // The content wrapper is the scroll container's only child and stays mounted for this
    // component's whole lifetime, so observing it once covers all content growth.
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
    // syncJump is recreated per render; the observer only needs the stable follow object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow]);

  /** Back-to-bottom: glide down to the live bottom (reduced motion gets an instant jump); follow re-engages on arrival. */
  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      follow.resume();
      stickToBottom(el, follow);
      syncJump();
      return;
    }
    cancelReturn();
    returningRef.current = true;
    // Far away: teleport to three viewports above the bottom first, then glide the rest —
    // bounds the animation to well under a second regardless of how far the user scrolled.
    const far = el.scrollHeight - el.clientHeight - el.scrollTop;
    if (far > 3 * el.clientHeight) el.scrollTop = el.scrollHeight - 4 * el.clientHeight;
    let last = performance.now();
    const stepFrame = (now: number) => {
      returnRafRef.current = null;
      const live = scrollRef.current;
      if (!live || !returningRef.current) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      const remaining = live.scrollHeight - live.clientHeight - live.scrollTop;
      if (remaining <= 1) {
        returningRef.current = false;
        follow.resume();
        stickToBottom(live, follow);
        syncJump();
        return;
      }
      // Proportional ease-out toward the LIVE bottom, with a time-based velocity floor
      // (3200px/s) that outruns any realistic streaming growth so the glide always lands.
      const step = Math.max(remaining * Math.min(1, dt * 10), 3200 * dt);
      live.scrollTop += Math.min(step, remaining);
      returnRafRef.current = requestAnimationFrame(stepFrame);
    };
    returnRafRef.current = requestAnimationFrame(stepFrame);
    syncJump();
  };

  return (
    <div className="relative h-full min-h-0">
      <div
        ref={(el) => {
          scrollRef.current = el;
          if (scrollElRef) scrollElRef.current = el;
        }}
        onScroll={onScroll}
        onWheel={(e) => {
          follow.wheel(e.deltaY);
          if (e.deltaY < 0) cancelReturn(); // user takes over: the glide stops within a frame
          syncJump();
        }}
        onTouchStart={(e) => {
          const t = e.touches[0];
          if (t) follow.touchStart(t.clientY);
        }}
        onTouchMove={(e) => {
          const t = e.touches[0];
          if (t) follow.touchMove(t.clientY);
          if (returningRef.current) cancelReturn(); // touching the list mid-return = taking control
          syncJump();
        }}
        onTouchEnd={() => follow.touchEnd()}
        className="anim-fade h-full overflow-y-auto px-4 py-4 md:px-6"
      >
        <div className="mx-auto max-w-3xl">
          {/* Top-of-history affordance: spinner while the previous window loads, a click-to-retry
              row after a failure, and — once at least one window was backfilled — a quiet
              beginning-of-conversation marker when there is nothing older. Idle-with-more shows
              nothing: scrolling near the top triggers the fetch by itself. */}
          {older && items.length > 0 && (
            <div className="flex justify-center pb-2">
              {older.loading ? (
                <span className="flex items-center gap-2 py-1 text-xs text-gray-400 dark:text-gray-500">
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
                  {S.chat.loadingEarlier}
                </span>
              ) : older.error !== null ? (
                <button
                  type="button"
                  onClick={older.onLoad}
                  className="py-1 text-xs text-red-600 transition-colors duration-150 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                >
                  {S.chat.loadEarlierRetry}
                </button>
              ) : !older.hasMore && older.prependedCount > 0 ? (
                <span className="py-1 text-xs text-gray-400 dark:text-gray-500">
                  {S.chat.historyBeginning}
                </span>
              ) : null}
            </div>
          )}
          {items.length === 0 ? (
            <EmptyState title={S.chat.emptyStream} />
          ) : (
            <MessageItems items={items} ctx={ctx} />
          )}
        </div>
      </div>
      {outline}
      {/* Back-to-bottom (shows once the user scrolls away from content below the fold): floats
          just above the composer; clicking returns to the bottom and re-enters follow, so the
          view keeps tracking the live stream. */}
      {showJump && (
        <button
          type="button"
          aria-label={S.chat.jumpToLatest}
          title={S.chat.jumpToLatest}
          onClick={jumpToLatest}
          className="anim-pop absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-gray-300 bg-white p-1.5 text-gray-500 shadow-sm transition-colors duration-150 hover:bg-gray-50 hover:text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            aria-hidden
          >
            <path
              d="M12 5v14M6 13l6 6 6-6"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
