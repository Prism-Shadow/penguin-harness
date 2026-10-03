/**
 * A dock surface's frame: the header (the tab strip, a spacer, the action cluster) above the
 * shown tab's body, in a box that opens from an edge of the page — the bottom (a full-width
 * band) or the right (a column beside the conversation).
 *
 * The frame never unmounts to hide: a closed dock stays in the tree at size 0 and inert, so the
 * bodies inside keep their scroll, their drill-down and their unsaved text, and `data-open` says
 * what is on screen. Its size is the caller's, in pixels: `size` is what the box shows (0 while
 * collapsed or before the entrance), `contentSize` the settled size its content lays out at, so
 * while the box animates past intermediate sizes nothing inside reflows — text does not squeeze
 * and a terminal does not refit its grid on every frame. The animation is the theme's layout
 * motion, off while a drag resizes or a flip must land at once.
 *
 * The border belongs to the open state only: with border-box sizing a collapsed dock would still
 * paint its 1px, leaving a hairline where nothing is. The resize handle is the caller's too, shown
 * only while open and seated by the frame: an overlay straddling the bottom dock's top edge (it
 * costs no height), and the one item of a spacer before the right dock (it must cost real width,
 * so the conversation measures the same under every surface).
 *
 * A surface can go FULLSCREEN — grown as far as its own edge goes, which is the element the
 * caller names: the right dock's row (the conversation beside it; the toolbar above and the
 * bottom dock below stay in view), the bottom dock's area up to the toolbar (the row and itself,
 * over the right dock). The box in the flow keeps its size as a placeholder — the conversation
 * beside or above it does not reflow, so nothing under the cover scrolls or refits — and only the
 * content box inside it lifts off (`fixed`, at `DOCK_FULLSCREEN_Z`); the bodies are the same
 * elements, so a terminal, a file preview or an editor draft carries over untouched. The resize
 * handle moves to the lifted box's LEADING edge (the right dock's left, the bottom dock's top),
 * where a pull back inward is the way out by drag, while the placeholder keeps the handle's
 * footprint without a second bar; the header's own toggle is the other way back.
 *
 * The flip is the theme's layout motion, in three phases the root announces as
 * `data-fullscreen` (absent in the flow): ENTERING lifts the box at its docked rect and sends it
 * to the cover's on the next frame, so the transition has two values to run between; FULL follows
 * the cover live — the navigation column folds, the window resizes, the bottom dock opens or
 * resizes under a fullscreen right dock and its row changes height — with no transition; EXITING
 * sends it back to the docked rect, which the root still holds, and the box rejoins the flow when
 * the transition ends. The inside never reflows on the way: a wrapper lays the header and body out
 * at the size the box is heading to, anchored to the box's top and to the edge both rects share
 * (the right dock's right, the bottom dock's left), so the header rides the box's top edge while
 * the box's `overflow: hidden` uncovers or covers the rest. A theme with no motion (or reduced
 * motion) fires no `transitionend`; a timer from the computed duration settles the phase instead.
 * Layers that lay content over the dock by coordinates follow the phases, not the caller's flag,
 * through `onFullscreenPhase`: the box is still lifted while it exits.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  ReactNode,
  Ref,
  RefObject,
} from "react";
import { RESIZE_HANDLE_PX } from "../../layout/resize-handle/resize-handle";

export type DockEdge = "right" | "bottom";

/**
 * The layer a fullscreen dock surface paints at: level with the in-flow menus (z-40, where the
 * dock wins by document order — it comes after the toolbar and the navigation column in the
 * tree), under the dialogs and drawers (z-50), the portaled menus and tooltips (z-[60]) and the
 * toasts (z-[100]), so the dock's own confirmations, its "+" menu and its tooltips still paint
 * over it. Content laid over the surface by coordinates (the built-in browser's page) takes the
 * step above (+1), and so does the resize handle seated on the surface's leading edge.
 */
export const DOCK_FULLSCREEN_Z = 40;

/** Where a lifted surface is on its way; the root carries it as `data-fullscreen`. */
export type DockFullscreenPhase = "entering" | "full" | "exiting";

/** A small square header button: the dock's add, detach, move, fullscreen and hide controls. */
export function DockHeaderButton({
  label,
  coarse = false,
  children,
  className = "",
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & {
  /** The accessible name and the tooltip. */
  label: string;
  /**
   * A finger is the pointer: a 24px box is a comfortable mouse target and a poor finger one, so
   * the box grows while the glyph inside keeps its size.
   */
  coarse?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-tooltip={label}
      aria-label={label}
      {...rest}
      className={`flex ${coarse ? "h-8 w-8" : "h-6 w-6"} shrink-0 items-center justify-center rounded-sm text-fg-subtle transition-colors duration-150 hover:bg-line-muted hover:text-fg ${className}`}
    >
      {children}
    </button>
  );
}

// ------------------------------------------------------------------------------ fullscreen

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface Size {
  width: number;
  height: number;
}

interface FullscreenState {
  phase: "docked" | DockFullscreenPhase;
  /** The lifted box's rect — its inline style; null while it sits in the flow. */
  box: Rect | null;
  /** The size the inside lays out at while lifted: the size the box is heading to. */
  inner: Size | null;
  /**
   * Entering, before launch: the box is lifted at its docked rect, waiting for the frame that
   * sends it to the host's. A box that mounts lifted at its target has no transition to run.
   */
  launch: boolean;
}

const DOCKED: FullscreenState = { phase: "docked", box: null, inner: null, launch: false };

/**
 * What the lifted box transitions; a `transitionend` for anything else (a child's colour) is not
 * the box arriving.
 */
const MOVED = new Set(["top", "left", "width", "height"]);

/** Grace past the theme's duration before the fallback settles a phase whose end never fired. */
const SETTLE_SLACK_MS = 100;

function sameRect(a: Rect | null, b: Rect): boolean {
  if (a === null) return false;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

function sizeOf(rect: Rect): Size {
  return { width: rect.width, height: rect.height };
}

/**
 * The rect a lifted surface covers: the element the caller names (the right dock's row, the
 * bottom dock's area), or the viewport without one.
 */
function hostRect(host: HTMLElement | null): Rect {
  if (host === null)
    return { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };
  const box = host.getBoundingClientRect();
  return { top: box.top, left: box.left, width: box.width, height: box.height };
}

/**
 * The content box's docked rect, read off the root rather than off the box: the root keeps its
 * place and its size through every phase (it is the placeholder once the box lifts), so the
 * reading is right both before the box leaves and while it is on its way back. The client box
 * leaves out the open state's border, which the content sits inside of.
 */
function dockedRect(root: HTMLElement): Rect {
  const box = root.getBoundingClientRect();
  return {
    top: box.top + root.clientTop,
    left: box.left + root.clientLeft,
    width: root.clientWidth,
    height: root.clientHeight,
  };
}

/**
 * The longest transition the box's computed style declares, in ms — 0 when the theme or reduced
 * motion turned it off (`transition: none` computes to a zero duration), in which case no
 * `transitionend` will ever come.
 */
function transitionMs(style: CSSStyleDeclaration): number {
  const longest = (list: string): number => {
    const values = list.split(",").map((part) => {
      const value = part.trim();
      const number = parseFloat(value);
      if (!Number.isFinite(number)) return 0;
      return value.endsWith("ms") ? number : number * 1000;
    });
    return Math.max(0, ...values);
  };
  return longest(style.transitionDuration) + longest(style.transitionDelay);
}

/**
 * The phase machine behind `fullscreen`: `want` is where the caller wants the surface, `jump`
 * whether a change lands at once (the layout motion is off, or the dock is closing — the × hid a
 * fullscreen dock, which also ended its fullscreen, and the collapse is the one animation to
 * play). The box's root is its parent, read at the moments that need it.
 */
function useFullscreenPhase(
  want: boolean,
  jump: boolean,
  boxRef: RefObject<HTMLDivElement | null>,
  fullscreenHost: (() => HTMLElement | null) | undefined,
  onFullscreenPhase: ((phase: DockFullscreenPhase | null) => void) | undefined,
): FullscreenState {
  const [state, setState] = useState<FullscreenState>(DOCKED);
  const { phase, launch } = state;

  // The callbacks as the latest render gave them, so the effects below key on the phase alone
  // (the caller may hand in a fresh arrow every render). Assigned first, before any effect reads.
  const hostRef = useRef(fullscreenHost);
  const reportRef = useRef(onFullscreenPhase);
  useLayoutEffect(() => {
    hostRef.current = fullscreenHost;
    reportRef.current = onFullscreenPhase;
  });
  const host = useCallback((): Rect => hostRect(hostRef.current?.() ?? null), []);

  // Drive: every change of what is wanted, and every settled step, decides the next state. A
  // layout effect, so a lift measures the box's docked rect while the box still sits in the flow
  // and the lifted first paint lands at that same rect — identical to the eye.
  useLayoutEffect(() => {
    const root = boxRef.current?.parentElement ?? null;
    if (root === null) return;
    if (want) {
      if (phase === "full") return;
      const target = host();
      if (jump) {
        setState({ phase: "full", box: target, inner: sizeOf(target), launch: false });
        return;
      }
      if (phase === "entering") return;
      if (phase === "docked") {
        setState({
          phase: "entering",
          box: dockedRect(root),
          inner: sizeOf(target),
          launch: true,
        });
        return;
      }
      // Exiting: the box is on its way back — turn it round from wherever it is.
      setState({ phase: "entering", box: target, inner: sizeOf(target), launch: false });
      return;
    }
    if (phase === "docked") return;
    // Before launch the box never left its docked rect: there is nothing to animate back.
    if (jump || launch) {
      setState(DOCKED);
      return;
    }
    if (phase === "exiting") return;
    const target = dockedRect(root);
    if (sameRect(state.box, target)) {
      setState(DOCKED);
      return;
    }
    setState({ phase: "exiting", box: target, inner: sizeOf(target), launch: false });
  }, [want, jump, state, phase, launch, boxRef, host]);

  // Launch: a frame after the lifted box painted at its docked rect, send it to the host's.
  // Double rAF: the first can land in the same frame as that paint, and a change within one
  // frame is not a transition. A host no bigger than the dock leaves nothing to move.
  useEffect(() => {
    if (phase !== "entering" || !launch) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        const target = host();
        setState((s) =>
          s.phase !== "entering" || !s.launch
            ? s
            : {
                phase: sameRect(s.box, target) ? "full" : "entering",
                box: target,
                inner: sizeOf(target),
                launch: false,
              },
        );
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [phase, launch, host]);

  // Settle: the box arrives when its own transition ends — or, with a theme that moves nothing,
  // at once; and a timer past the computed duration catches an end that never fires (a frame
  // dropped past the event, a transition the browser cancelled). A phase that changed meanwhile
  // (the toggle pressed again mid-flight) re-arms for its new destination.
  useLayoutEffect(() => {
    if ((phase !== "entering" && phase !== "exiting") || launch) return;
    const box = boxRef.current;
    if (box === null) return;
    const settle = () =>
      setState((s) => {
        if (s.phase !== phase) return s;
        return phase === "entering" ? { ...s, phase: "full" } : DOCKED;
      });
    const ms = transitionMs(getComputedStyle(box));
    if (ms === 0) {
      settle();
      return;
    }
    const ended = (event: TransitionEvent) => {
      if (event.target === box && MOVED.has(event.propertyName)) settle();
    };
    box.addEventListener("transitionend", ended);
    // The timer can beat a transition that is still running (a background tab throttles both
    // frames and events): the box is finished where it was going before the phase says it is
    // there, or the next phase would start from wherever the motion had got to.
    const timer = window.setTimeout(() => {
      for (const animation of box.getAnimations()) animation.finish();
      settle();
    }, ms + SETTLE_SLACK_MS);
    return () => {
      box.removeEventListener("transitionend", ended);
      window.clearTimeout(timer);
    };
  }, [phase, launch, boxRef]);

  // Full: follow the covered element's rect as it changes — its size through a ResizeObserver
  // (the navigation column folding animates its width; the bottom dock opening, closing or
  // resizing under a fullscreen right dock changes the row's height), its place through the
  // window — with no transition, so the cover sticks to the element rather than trailing it.
  useEffect(() => {
    if (phase !== "full") return;
    const follow = () => {
      const target = host();
      setState((s) =>
        s.phase === "full" && !sameRect(s.box, target)
          ? { ...s, box: target, inner: sizeOf(target) }
          : s,
      );
    };
    const element = hostRef.current?.() ?? null;
    const observer = element === null ? null : new ResizeObserver(follow);
    if (element !== null) observer?.observe(element);
    window.addEventListener("resize", follow);
    follow();
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", follow);
    };
  }, [phase, host]);

  // Report each phase once it is in the DOM (the attribute and the lifted box exist from this
  // commit on), never the initial docked state.
  const reported = useRef<DockFullscreenPhase | null>(null);
  useLayoutEffect(() => {
    const current = phase === "docked" ? null : phase;
    if (current === reported.current) return;
    reported.current = current;
    reportRef.current?.(current);
  }, [phase]);

  return state;
}

// ----------------------------------------------------------------------------------- frame

export interface DockFrameProps {
  position: DockEdge;
  /** False while the dock collapses on its way out: it stays mounted at size 0, inert. */
  open: boolean;
  /** The box's size on screen (px): the bottom dock's height, the right dock's width. */
  size: number;
  /** The settled size the content lays out at (px), whatever the box is passing through. */
  contentSize: number;
  /** Whether a change of `size` — and a fullscreen flip — animates. */
  animate: boolean;
  /** The tab strip (`DockTabs`). */
  tabs: ReactNode;
  /** The header's right-hand cluster, evenly spaced, ending in the dock's hide button. */
  actions: ReactNode;
  /**
   * Pointer handlers on the header, for a caller that lets the header drag the whole dock.
   * `movable` shows the grab cursor for it.
   */
  headerProps?: HTMLAttributes<HTMLElement>;
  movable?: boolean;
  /** The shown tab's body, or the picker while the dock has no tabs. */
  children: ReactNode;
  /**
   * The resize handle (a `ResizeHandle`), rendered only while open. The frame seats it: the right
   * dock's, given without `edge`, fills the 6px spacer before the box; the bottom dock's, given
   * with `edge: "start"`, straddles the box's top edge. While the surface is lifted the same
   * element sits on the lifted box's leading edge instead, and the spacer keeps its footprint.
   */
  handle?: ReactNode;
  /** Layers that belong to the dock but float over the page (a drag overlay, a confirmation). */
  overlays?: ReactNode;
  /** The box's node: the resize handle measures it, and a drop preview finds it. */
  rootRef?: Ref<HTMLDivElement>;
  /**
   * The surface covers its host instead of sitting in the flow (its in-flow box keeps its size
   * underneath). The flip animates with the theme's layout motion unless `animate` is off or the
   * dock is closing, when it lands at once.
   */
  fullscreen?: boolean;
  /**
   * The element a fullscreen surface covers — the dock grown as far as its own edge goes: the
   * right dock's row, the bottom dock's area — read when the surface lifts and followed while it
   * is full; the viewport when absent or null.
   */
  fullscreenHost?: () => HTMLElement | null;
  /**
   * Each change of the fullscreen phase, once it is in the DOM — `entering`, `full`, `exiting`,
   * and null when the box is back in the flow — for the layers that lay content over the dock by
   * coordinates: the box is still lifted, and still clips, while it exits.
   */
  onFullscreenPhase?: (phase: DockFullscreenPhase | null) => void;
}

export function DockFrame({
  position,
  open,
  size,
  contentSize,
  animate,
  tabs,
  actions,
  headerProps,
  movable = false,
  children,
  handle,
  overlays,
  rootRef,
  fullscreen = false,
  fullscreenHost,
  onFullscreenPhase,
}: DockFrameProps) {
  const header = (
    <header
      data-testid="dock-header"
      {...headerProps}
      className={`flex shrink-0 items-center gap-2 border-b border-line px-2 py-1.5 text-xs ${
        movable ? "cursor-grab select-none" : ""
      }`}
    >
      {tabs}
      <span className="min-w-0 flex-1" />
      <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
    </header>
  );

  // The content box's node: the phase machine measures it, listens for its transition's end and
  // reads its root (the parent) for the docked rect.
  const boxRef = useRef<HTMLDivElement | null>(null);
  const { phase, box, inner } = useFullscreenPhase(
    fullscreen && open,
    // Off while a drag resizes or a flip must land at once, and while the dock closes: the ×
    // hiding a fullscreen dock ends its fullscreen too, and the collapse is the one animation
    // then — the cover simply goes.
    !animate || !open,
    boxRef,
    fullscreenHost,
    onFullscreenPhase,
  );
  const lifted = phase !== "docked";
  const moving = animate && (phase === "entering" || phase === "exiting");

  // The handle's seat. In the flow the seat is `display: contents`, so the handle lays itself out
  // as the caller placed it: the right dock's as the one item of the spacer before the root — the
  // spacer, not the handle, is what costs the row its `RESIZE_HANDLE_PX`, so the footprint stays
  // while the handle is away — and the bottom dock's as the overlay straddling the root's top
  // edge. Lifted, the seat is a fixed box on the lifted surface's LEADING edge, where a pull back
  // inward is the way out: a band straddling the right dock's left edge for the handle to fill, a
  // zero-height line along the bottom dock's top edge for the overlay handle to straddle as it
  // straddles the root's. It takes the step above the surface (the box comes later in the tree,
  // so an equal index would paint it over the handle) and follows the box's rect, with the box's
  // layout motion while it moves. The SEAT changes, never the handle: one element through every
  // phase, so a drag that began on it in the flow goes on when the snap lifts the surface
  // mid-gesture — a remounted handle would keep the pointer's capture and never report the
  // release that ends the drag. There is one handle at a time.
  const seatStyle: CSSProperties | undefined =
    lifted && box !== null
      ? position === "right"
        ? {
            top: box.top,
            left: box.left - RESIZE_HANDLE_PX / 2,
            width: RESIZE_HANDLE_PX,
            height: box.height,
            zIndex: DOCK_FULLSCREEN_Z + 1,
          }
        : {
            top: box.top,
            left: box.left,
            width: box.width,
            height: 0,
            zIndex: DOCK_FULLSCREEN_Z + 1,
          }
      : undefined;
  const seatClass =
    seatStyle === undefined ? "contents" : position === "right" ? "fixed flex" : "fixed";
  const seat = open ? (
    <div data-layout-motion={moving ? "" : undefined} style={seatStyle} className={seatClass}>
      {handle}
    </div>
  ) : null;

  // Lifted: a fixed box at the rect the phase machine gives it, transitioning its place and size
  // through the theme's layout motion while it enters or exits, clipping what the inside lays out
  // past it. In the flow: the settled box the header and body lay out in, whatever size the
  // outer box is passing through.
  const boxStyle: CSSProperties =
    lifted && box !== null
      ? {
          top: box.top,
          left: box.left,
          width: box.width,
          height: box.height,
          zIndex: DOCK_FULLSCREEN_Z,
        }
      : position === "bottom"
        ? { height: contentSize }
        : { width: contentSize };
  const boxClass = lifted
    ? "fixed overflow-hidden bg-canvas"
    : position === "bottom"
      ? "flex min-h-0 shrink-0 flex-col"
      : "flex min-h-0 flex-1 flex-col";

  // The inside: lifted, laid out once at the size the box is heading to and anchored to the
  // box's top and to the edge the docked and the host rect share — the right dock's right, the
  // bottom dock's left — so the header rides the top edge and nothing reflows while the box
  // moves. In the flow, it fills the content box.
  const insideStyle: CSSProperties | undefined =
    lifted && inner !== null ? { width: inner.width, height: inner.height } : undefined;
  const insideClass = lifted
    ? `absolute top-0 ${position === "right" ? "right-0" : "left-0"} flex flex-col`
    : "flex min-h-0 flex-1 flex-col";

  const content = (
    <div
      ref={boxRef}
      data-layout-motion={moving ? "" : undefined}
      style={boxStyle}
      className={boxClass}
    >
      <div style={insideStyle} className={insideClass}>
        {header}
        {children}
      </div>
    </div>
  );

  if (position === "bottom") {
    return (
      <div
        ref={rootRef}
        data-testid="dock"
        data-position="bottom"
        data-open={open}
        data-layout-motion={animate ? "" : undefined}
        data-fullscreen={lifted ? phase : undefined}
        style={{ height: size }}
        inert={!open}
        className={`relative flex w-full shrink-0 flex-col overflow-hidden bg-canvas ${
          open ? "border-t border-line" : ""
        }`}
      >
        {seat}
        {content}
        {overlays}
      </div>
    );
  }

  return (
    <>
      {/* The spacer: `w-1.5` is RESIZE_HANDLE_PX, the width the handle costs the row. */}
      {seat !== null && <div className="flex w-1.5 shrink-0">{seat}</div>}
      <div
        ref={rootRef}
        data-testid="dock"
        data-position="right"
        data-open={open}
        data-layout-motion={animate ? "" : undefined}
        data-fullscreen={lifted ? phase : undefined}
        style={{ width: size }}
        inert={!open}
        className={`relative flex min-h-0 shrink-0 flex-col overflow-hidden bg-canvas ${
          open ? "border-l border-line" : ""
        }`}
      >
        {content}
        {overlays}
      </div>
    </>
  );
}
