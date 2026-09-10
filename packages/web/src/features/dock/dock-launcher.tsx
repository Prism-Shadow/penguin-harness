/**
 * The floating launcher for the docks — an AssistiveTouch-style ball riding the chat body's
 * right edge while no dock surface is up, so the dock's panels stay discoverable for a user
 * who never notices the toolbar's toggle. The ball carries a short caption, and a click fans
 * out one round button per panel kind (plus the terminal) onto an arc centred on it and
 * opening leftward, each entry showing its name beside it — a bare glyph does not say what
 * it opens. Picking one opens its panel: in the right dock on a wide window, in the merged
 * bottom surface on a narrow one, which makes that surface visible and unmounts the
 * launcher. The arc's last entry puts the launcher away for good, remembered as a global
 * preference and turned back on from Appearance settings. The ball drags along the edge —
 * another global preference, a ratio of the body's height — and springs back onto it when
 * let go; Esc, a press elsewhere or a scroll folds the fan.
 *
 * Mounted inside the chat body, the region between the toolbar and the composer: clamping
 * to its own container is what keeps it off both, and its right edge is the chat column's
 * (the dock row's, while the dock is hidden). The position is written to the node directly
 * — a transform driven by two spring drivers — rather than through React state, because a
 * drag moves it every frame. The decisions live in dock-launcher-state.ts.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  CSSProperties,
  FocusEvent as ReactFocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
} from "react";
import { S } from "../../lib/strings";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { CloseIcon, NAV_ICONS, PANEL_RIGHT_ICON } from "../../components/ui/icons";
import { toastInfo } from "../../components/ui/toast";
import { usePrefersReducedMotion } from "../../components/ui/use-reduced-motion";
import { ICON_SIZE } from "../../lib/icon-scale";
import { toneDot, toneInk } from "../../lib/tone";
import { scrollMovesAnchor } from "../../lib/context-menu";
import { SPRING_DEFAULT, SPRING_MOMENTUM, createSpringDriver } from "../../lib/spring";
import type { SpringDriver } from "../../lib/spring";
import { subscribeTerminals, terminalApiSupported } from "../terminal/terminal-list";
import { openTerminalInDock } from "./dock-terminal";
import { panelGlyph, panelLabel } from "./panel-meta";
import {
  PANEL_KINDS,
  dockVersion,
  isDockVisible,
  isNarrow,
  openPanel,
  subscribeDock,
} from "./dock-state";
import { usePointerDrag } from "./use-pointer-drag";
import {
  FAN_ENTRY_SIZE,
  LAUNCHER_CAPTION_HEIGHT,
  LAUNCHER_SIZE,
  clampLauncherTop,
  dragPosition,
  fanLayout,
  launcherHiddenVersion,
  launcherRatioFromTop,
  launcherTopFromRatio,
  readLauncherHidden,
  readLauncherRatio,
  shouldShowLauncher,
  subscribeLauncherHidden,
  writeLauncherHidden,
  writeLauncherRatio,
  type FanLabelSide,
} from "./dock-launcher-state";

/** The ball's inset from the body's right edge (px). */
const EDGE_INSET = 14;
/** Movement that turns a press into a drag (px); under it the press is a click. */
const DRAG_THRESHOLD = 4;
/** The fan's exit animation, after which its entries unmount (`.launcher-fan-out` in styles.css). */
const FAN_EXIT_MS = 140;
/** Delay between one entry's entrance and the next, the topmost entry first (ms). */
const FAN_STAGGER_MS = 28;
/** Gap between the ball and its caption (px); the pill takes the rest of LAUNCHER_CAPTION_HEIGHT. */
const CAPTION_GAP = 4;

export interface DockLauncherProps {
  /** A pending approval inside a subagent: the amber dot rides the ball and the agents entry. */
  agentsPending: boolean;
}

/** Renders the ball while no dock surface holds its room and the user has not put it away. */
export function DockLauncher({ agentsPending }: DockLauncherProps) {
  useSyncExternalStore(subscribeDock, dockVersion);
  useSyncExternalStore(subscribeLauncherHidden, launcherHiddenVersion);
  const terminalSupported = useSyncExternalStore(subscribeTerminals, terminalApiSupported);
  const narrow = isNarrow();
  const visible = shouldShowLauncher({
    rightDockVisible: isDockVisible("right"),
    bottomDockVisible: isDockVisible("bottom"),
    narrow,
    hidden: readLauncherHidden(),
  });
  if (!visible) return null;
  return (
    <LauncherBall
      agentsPending={agentsPending}
      terminalSupported={terminalSupported}
      narrow={narrow}
    />
  );
}

interface FanState {
  /** "closing" keeps the entries mounted through their exit animation. */
  phase: "open" | "closing";
  /** The geometry the arc was laid out for, frozen at the moment it opened. */
  top: number;
  bodyHeight: number;
}

interface FanEntry {
  key: string;
  label: string;
  glyph: ReactNode;
  badge: boolean;
  testId: string;
  choose: () => void;
}

// Every entry's box sits on the ball's centre; --fan-x / --fan-y carry it out to its place
// on the arc, as both the resting transform and the entrance animation's end state.
const ENTRY_CLASS =
  "absolute flex items-center justify-center rounded-full border border-gray-200/80 bg-white/90 text-gray-600 shadow-[0_2px_8px_rgba(0,0,0,0.10)] backdrop-blur-md transition-colors duration-150 hover:bg-white hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-bg)] dark:border-white/10 dark:bg-gray-900/90 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100";

/**
 * The always-visible name under the ball and beside each entry: the same small pill on the
 * same glass, and no colour of its own, so it follows its button's resting-to-hover ink.
 */
const CAPTION_CLASS =
  "pointer-events-none absolute whitespace-nowrap rounded-md border border-gray-200/80 bg-white/85 px-1.5 py-0.5 text-[11px] font-medium leading-4 shadow-[0_1px_4px_rgba(0,0,0,0.08)] backdrop-blur-md transition-colors duration-150 dark:border-white/10 dark:bg-gray-900/85";

/** Where an entry's name sits, by the side the arc's angle put it on. */
const ENTRY_LABEL_SIDE: Record<FanLabelSide, string> = {
  left: "right-full top-1/2 mr-2 -translate-y-1/2",
  above: "bottom-full left-1/2 mb-1.5 -translate-x-1/2",
  below: "top-full left-1/2 mt-1.5 -translate-x-1/2",
};

const BALL_CLASS =
  "anim-pop relative flex touch-none select-none items-center justify-center rounded-full border border-gray-200/80 text-gray-500 shadow-[0_2px_10px_rgba(0,0,0,0.10)] backdrop-blur-md transition-[background-color,color,opacity,box-shadow] duration-150 hover:bg-white/95 hover:text-gray-800 hover:opacity-100 hover:shadow-[0_4px_16px_rgba(0,0,0,0.14)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-bg)] dark:border-white/10 dark:text-gray-400 dark:hover:bg-gray-800/95 dark:hover:text-gray-100";

function LauncherBall({
  agentsPending,
  terminalSupported,
  narrow,
}: {
  agentsPending: boolean;
  terminalSupported: boolean;
  /** Below the breakpoint the docks merge, so an entry names no dock and lets the store pick. */
  narrow: boolean;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const ballRef = useRef<HTMLButtonElement | null>(null);
  const fanRef = useRef<HTMLDivElement | null>(null);
  /** The resting position — the stored preference — as a ratio of the body's height. */
  const ratioRef = useRef(readLauncherRatio());
  const bodyHeightRef = useRef(0);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  /** Set by a completed drag so the click the browser fires on release does not toggle the fan. */
  const suppressClick = useRef(false);

  // ---------------------------------------------------------------------------- position
  // Two spring drivers write the wrapper's transform directly: x is the pull off the edge
  // (0 at rest, negative into the conversation), y the top offset within the body.
  const drivers = useRef<{ x: SpringDriver; y: SpringDriver } | null>(null);
  if (drivers.current === null) {
    const apply = () => {
      const root = rootRef.current;
      const d = drivers.current;
      if (root && d) root.style.transform = `translate(${d.x.value}px, ${d.y.value}px)`;
    };
    drivers.current = { x: createSpringDriver(0, apply), y: createSpringDriver(0, apply) };
  }
  useEffect(
    () => () => {
      drivers.current?.x.dispose();
      drivers.current?.y.dispose();
    },
    [],
  );

  // --------------------------------------------------------------------------------- fan
  const [fan, setFanState] = useState<FanState | null>(null);
  // Mirrored in a ref so event handlers that fire before the next render read the latest.
  const fanNow = useRef<FanState | null>(null);
  const exitTimer = useRef(0);
  const setFan = useCallback((next: FanState | null) => {
    fanNow.current = next;
    setFanState(next);
  }, []);
  useEffect(() => () => window.clearTimeout(exitTimer.current), []);

  const openFan = useCallback(() => {
    window.clearTimeout(exitTimer.current);
    setFan({
      phase: "open",
      top: drivers.current?.y.value ?? 0,
      bodyHeight: bodyHeightRef.current,
    });
  }, [setFan]);

  /** Folds the fan; `refocus` returns focus to the ball (Esc) so a keyboard user is not stranded. */
  const closeFan = useCallback(
    (refocus: boolean) => {
      const current = fanNow.current;
      if (current !== null && current.phase === "open") {
        if (reducedMotionRef.current) {
          setFan(null);
        } else {
          setFan({ ...current, phase: "closing" });
          window.clearTimeout(exitTimer.current);
          exitTimer.current = window.setTimeout(() => setFan(null), FAN_EXIT_MS);
        }
      }
      if (refocus) ballRef.current?.focus();
    },
    [setFan],
  );

  const fanOpen = fan?.phase === "open";

  // Dismissal while open: a press elsewhere; Esc (capture, stopped — a dialog underneath
  // must not close with it); the user scrolling anywhere (wheel / touch, which a stream
  // auto-following a reply never fires); a scroll that moved the launcher itself.
  useEffect(() => {
    if (!fanOpen) return;
    const root = rootRef.current;
    const inside = (target: EventTarget | null): boolean =>
      target instanceof Node && root?.contains(target) === true;
    const onPointerDown = (event: MouseEvent) => {
      if (!inside(event.target)) closeFan(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      closeFan(true);
    };
    const onUserScroll = (event: Event) => {
      if (!inside(event.target)) closeFan(false);
    };
    const onScroll = (event: Event) => {
      if (scrollMovesAnchor(event.target as Node | null, root)) closeFan(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("wheel", onUserScroll, { capture: true, passive: true });
    window.addEventListener("touchmove", onUserScroll, { capture: true, passive: true });
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("wheel", onUserScroll, { capture: true });
      window.removeEventListener("touchmove", onUserScroll, { capture: true });
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [fanOpen, closeFan]);

  // The body's height bounds the travel: measured on mount and on every resize, and the
  // ball re-placed from its stored ratio (unless a drag is holding it) — a taller or
  // shorter body moves the resting point, and a fan opened for the old geometry folds.
  useLayoutEffect(() => {
    const body = rootRef.current?.parentElement;
    const d = drivers.current;
    if (!body || !d) return;
    let lastHeight = -1;
    const place = () => {
      const height = body.clientHeight;
      if (height === lastHeight) return;
      lastHeight = height;
      bodyHeightRef.current = height;
      if (!draggingRef.current) d.y.set(launcherTopFromRatio(ratioRef.current, height));
      closeFan(false);
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(body);
    return () => observer.disconnect();
  }, [closeFan]);

  // -------------------------------------------------------------------------------- drag

  /**
   * Lets go of the ball: back onto the edge and inside the body. A completed drag stores
   * where it landed; an abandoned gesture (pointercancel) returns to the stored spot.
   */
  const settle = useCallback((persist: boolean) => {
    draggingRef.current = false;
    setDragging(false);
    const d = drivers.current;
    if (!d) return;
    const bodyHeight = bodyHeightRef.current;
    let top: number;
    if (persist) {
      top = clampLauncherTop(d.y.value, bodyHeight);
      ratioRef.current = launcherRatioFromTop(top, bodyHeight);
      writeLauncherRatio(ratioRef.current);
    } else {
      top = launcherTopFromRatio(ratioRef.current, bodyHeight);
    }
    if (reducedMotionRef.current) {
      d.y.set(top);
      d.x.set(0);
      return;
    }
    d.y.animateTo(top, SPRING_DEFAULT);
    d.x.animateTo(0, SPRING_MOMENTUM);
  }, []);

  const dragProps = usePointerDrag<{ startTop: number; clientX: number; clientY: number }>({
    threshold: DRAG_THRESHOLD,
    begin: (event) => {
      const d = drivers.current;
      if (!d) return null;
      // Gesture takeover: an in-flight snap-back stops where it is and the press continues from there.
      const [top] = d.y.stop();
      d.x.stop();
      return { startTop: top, clientX: event.clientX, clientY: event.clientY };
    },
    onMove: (event, payload) => {
      const d = drivers.current;
      if (!d) return;
      if (!draggingRef.current) {
        draggingRef.current = true;
        setDragging(true);
        closeFan(false);
      }
      const { x, top } = dragPosition(
        payload.startTop,
        event.clientX - payload.clientX,
        event.clientY - payload.clientY,
        bodyHeightRef.current,
      );
      d.x.set(x);
      d.y.set(top);
    },
    onEnd: (_payload, dragged) => {
      if (!dragged) {
        // A press without movement: the click handler toggles the fan; a snap-back the
        // press interrupted resumes.
        settle(false);
        return;
      }
      suppressClick.current = true;
      settle(true);
    },
    onCancel: () => settle(false),
  });

  const onBallClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (fanNow.current?.phase === "open") closeFan(false);
    else openFan();
  };

  // ---------------------------------------------------------------------------- keyboard

  // Arrow keys walk the arc from top to bottom — the entries are in that order in the DOM —
  // with the ball at the head of the sequence and wrap-around; Home/End jump to its ends.
  const onRootKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const current = fanNow.current;
    if (current?.phase !== "open") return;
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const ball = ballRef.current;
    const entries = [...(fanRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    if (!ball || entries.length === 0) return;
    const column = [ball, ...entries];
    const index = column.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = column.length - 1;
    else if (index === -1) next = event.key === "ArrowDown" ? 0 : column.length - 1;
    else next = (index + (event.key === "ArrowDown" ? 1 : -1) + column.length) % column.length;
    event.preventDefault();
    column[next]?.focus();
  };

  // Tabbing out of the launcher folds the fan. Only a move to another element counts: a
  // null relatedTarget is the window losing focus, or a browser that does not focus
  // buttons on click — folding there would unmount an entry under its own click.
  const onRootBlur = (event: ReactFocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && !rootRef.current?.contains(next)) closeFan(false);
  };

  // ------------------------------------------------------------------------------ render

  // Wide: the launcher stands in for the right dock, so it names that dock. Narrow: the two
  // render as one merged surface, so it names none and the store lands the tab where the
  // toolbar's own panel buttons land it.
  const target = narrow ? undefined : "right";
  const entries: FanEntry[] = PANEL_KINDS.map((kind) => ({
    key: kind,
    label: panelLabel(kind),
    glyph: panelGlyph(kind, ICON_SIZE.iconButton),
    badge: kind === "agents" && agentsPending,
    testId: `dock-launcher-open-${kind}`,
    // The dock becomes visible with the tab, and the launcher unmounts with it.
    choose: () => openPanel(kind, target),
  }));
  if (terminalSupported) {
    entries.push({
      key: "terminal",
      label: S.terminal.title,
      glyph: <GlyphIcon d={NAV_ICONS.terminal} size={ICON_SIZE.iconButton} />,
      badge: false,
      testId: "dock-launcher-open-terminal",
      // The dock picker's terminal action: adopt a live shell no conversation holds, or
      // start one. Async, so the fan folds first.
      choose: () => {
        closeFan(false);
        void openTerminalInDock(target);
      },
    });
  }
  entries.push({
    key: "hide",
    label: S.dock.launcherHide,
    // The close cross at its own 14px grid — a two-stroke mark aliases when scaled off it —
    // in the muted ink, so it reads as a lesser thing than the panels above it.
    glyph: <CloseIcon className={toneInk.muted} />,
    badge: false,
    testId: "dock-launcher-hide",
    // Writing the preference unmounts the launcher under its own click, so the toast is
    // what is left on screen: it says where the ball comes back from.
    choose: () => {
      closeFan(false);
      writeLauncherHidden(true);
      toastInfo(S.dock.launcherHiddenToast);
    },
  });

  const label = agentsPending ? `${S.dock.launcher} · ${S.dock.launcherPending}` : S.dock.launcher;
  // Where each entry sits on the arc, for the geometry the fan opened with. The count is
  // the one being rendered, so a terminal appearing or leaving mid-fan re-spreads the arc.
  const slots = fan === null ? [] : fanLayout(fan.top, fan.bodyHeight, entries.length);

  return (
    <div
      ref={rootRef}
      data-testid="dock-launcher"
      data-fan={fan?.phase ?? "closed"}
      onKeyDown={onRootKeyDown}
      onBlur={onRootBlur}
      className="absolute top-0 z-30"
      style={{ right: EDGE_INSET, width: LAUNCHER_SIZE, height: LAUNCHER_SIZE }}
    >
      {fan !== null && (
        // A zero-size anchor on the ball's centre: the entries are placed by their own
        // transforms, so nothing here may size or clip the arc.
        <div
          ref={fanRef}
          role="group"
          aria-label={S.dock.launcherPanels}
          data-testid="dock-launcher-fan"
          className="absolute left-1/2 top-1/2 h-0 w-0"
        >
          {entries.map((entry, index) => {
            // One slot per entry by construction; the guard is only the index type's.
            const slot = slots[index];
            if (slot === undefined) return null;
            return (
              <button
                key={entry.key}
                type="button"
                data-testid={entry.testId}
                onClick={entry.choose}
                className={`${ENTRY_CLASS} ${
                  fan.phase === "closing" ? "launcher-fan-out" : "launcher-fan-in"
                }`}
                style={
                  {
                    width: FAN_ENTRY_SIZE,
                    height: FAN_ENTRY_SIZE,
                    left: -FAN_ENTRY_SIZE / 2,
                    top: -FAN_ENTRY_SIZE / 2,
                    transform: "translate(var(--fan-x), var(--fan-y))",
                    // Entrance runs down the arc from the top; the exit runs all at once.
                    animationDelay: fan.phase === "closing" ? "0ms" : `${index * FAN_STAGGER_MS}ms`,
                    "--fan-x": `${slot.x.toFixed(1)}px`,
                    "--fan-y": `${slot.y.toFixed(1)}px`,
                  } as CSSProperties
                }
              >
                {/* First in the button, so its accessible name is the name on screen. */}
                <span className={`${CAPTION_CLASS} ${ENTRY_LABEL_SIDE[slot.labelSide]}`}>
                  {entry.label}
                </span>
                {entry.glyph}
                {entry.badge && (
                  <span
                    aria-hidden
                    className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-white dark:ring-gray-950 ${toneDot.attention}`}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
      <button
        ref={ballRef}
        type="button"
        {...dragProps}
        onClick={onBallClick}
        aria-label={label}
        aria-expanded={fanOpen}
        title={S.dock.launcherHint}
        data-testid="dock-launcher-ball"
        style={{ width: LAUNCHER_SIZE, height: LAUNCHER_SIZE }}
        className={`${BALL_CLASS} ${
          fanOpen || dragging
            ? "bg-white/95 text-gray-800 opacity-100 dark:bg-gray-800/95 dark:text-gray-100"
            : "bg-white/75 opacity-80 dark:bg-gray-900/75"
        } ${dragging ? "cursor-grabbing" : "cursor-pointer"}`}
      >
        <GlyphIcon d={PANEL_RIGHT_ICON} size={ICON_SIZE.sectionMark} />
        {/* The caption hangs below the ball's circle; the accessible name above opens with
            the same word, so the visible text is a prefix of it. Its height is spelled from
            the constant the vertical clamp reserves, so the two cannot drift apart. */}
        <span
          className={`${CAPTION_CLASS} left-1/2 -translate-x-1/2`}
          style={{
            top: LAUNCHER_SIZE + CAPTION_GAP,
            height: LAUNCHER_CAPTION_HEIGHT - CAPTION_GAP,
          }}
        >
          {S.dock.launcherCaption}
        </span>
        {agentsPending && (
          <span
            aria-hidden
            className={`absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-gray-950 ${toneDot.attention}`}
          />
        )}
      </button>
    </div>
  );
}
