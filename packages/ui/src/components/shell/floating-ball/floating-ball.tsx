/**
 * A floating ball over a page: the launcher's round glass ball (`LauncherBall`, no caption) that
 * the reader presses, drags to either side edge, or tucks away into a slim handle on that edge.
 *
 * - A press that travels less than `dragThreshold` is a click and calls `onActivate`; so do
 *   Enter and Space, the ball being a button.
 * - A drag follows the pointer (mouse, touch or pen) inside the area: vertically within the
 *   inset, horizontally until the ball's centre reaches a side edge. On release it springs to
 *   the side edge its centre is on. The click the browser fires after a drag does not activate.
 * - Two ways to tuck it: the × on the ball's inner top corner, shown on hover and on keyboard
 *   focus; or a release with the ball's centre within `tuckZone` of a side edge (the ball dims
 *   while it is there). Tucked, a handle on that edge at the same height stands in for it, and
 *   a click on the handle brings the ball back. A tuck or an untuck from the keyboard hands
 *   focus to the control that replaced the one pressed; a pointer's leaves it where it fell, so
 *   no hint pops up under a mouse that has moved on.
 * - While a press is live, a transparent shield covers the area so a frame under the pointer
 *   (a workbench's iframe) cannot swallow the moves; the rest of the time only the ball, its ×
 *   and the handle take events, and the page under the area receives everything else.
 *
 * Controlled: `placement` says where the ball rests and whether it is tucked, and each change
 * the reader makes — a drop, a tuck, an untuck — is handed to `onChange` once, for the caller to
 * store and hand back. A resize re-places the ball from the placement's ratio and stores nothing.
 * The words, the storage and what activation does are the caller's.
 *
 * The area is this component's own layer, filling its nearest positioned ancestor below
 * `areaTop`. The ball's position is a transform written to its wrapper by two spring drivers
 * rather than React state, because a drag moves it every frame; reduced motion places it at once.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { SPRING_DEFAULT, createSpringDriver, type SpringDriver } from "../../../motion/spring";
import { usePrefersReducedMotion } from "../../../motion/use-reduced-motion";
import { usePointerDrag } from "../../layout/resize-handle/use-pointer-drag";
import { LauncherBall, LauncherDismiss, LauncherEdgeHandle } from "../launcher/launcher";
import {
  FLOATING_BALL_METRICS,
  floatingBallDrag,
  floatingBallDrop,
  floatingBallInTuckZone,
  floatingBallRest,
  type FloatingBallArea,
  type FloatingBallMetrics,
  type FloatingBallPlacement,
  type FloatingBallPoint,
} from "./floating-ball-geometry";

/** Movement that turns a press into a drag (px); under it the press is a click. */
const DRAG_THRESHOLD = 4;
/** The tucked handle's width (px); its height is the ball's. */
const HANDLE_WIDTH = 14;

export interface FloatingBallProps {
  /** Where the ball rests and whether it is tucked away; the caller holds and stores it. */
  placement: FloatingBallPlacement;
  /** A drop, a tuck or an untuck: the placement to store and hand back. */
  onChange: (next: FloatingBallPlacement) => void;
  /** A click on the ball (a press that never became a drag), Enter or Space. */
  onActivate: () => void;
  /** The ball's face: one glyph. */
  glyph: ReactNode;
  /** The ball's accessible name and hover hint. */
  label: string;
  /** The × that tucks the ball away: its accessible name and hover hint. */
  tuckLabel: string;
  /** The handle a tucked ball leaves on its edge: its accessible name and hover hint. */
  showLabel: string;
  /** The ball's diameter (px). */
  size?: number;
  /** Room kept to the side edge at rest, and to the area's top and bottom (px). */
  inset?: number;
  /** A release whose centre is within this of a side edge tucks the ball (px). */
  tuckZone?: number;
  /** Movement that turns a press into a drag (px). */
  dragThreshold?: number;
  /** The tucked handle's width (px). */
  handleWidth?: number;
  /** Where the area starts below its positioned ancestor's top (a CSS length): a band to keep clear. */
  areaTop?: string | number;
  /** The ball's test id; the area takes `<testId>-area`. */
  testId?: string;
}

interface Press {
  start: FloatingBallPoint;
  clientX: number;
  clientY: number;
}

export function FloatingBall({
  placement,
  onChange,
  onActivate,
  glyph,
  label,
  tuckLabel,
  showLabel,
  size = FLOATING_BALL_METRICS.size,
  inset = FLOATING_BALL_METRICS.inset,
  tuckZone = FLOATING_BALL_METRICS.tuckZone,
  dragThreshold = DRAG_THRESHOLD,
  handleWidth = HANDLE_WIDTH,
  areaTop = 0,
  testId = "floating-ball",
}: FloatingBallProps) {
  const metrics = useMemo<FloatingBallMetrics>(
    () => ({ size, inset, tuckZone }),
    [size, inset, tuckZone],
  );
  const reducedMotion = usePrefersReducedMotion();

  const areaRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const ballRef = useRef<HTMLButtonElement | null>(null);
  const handleRef = useRef<HTMLButtonElement | null>(null);
  const [area, setArea] = useState<FloatingBallArea | null>(null);
  const [dragging, setDragging] = useState(false);
  /** Mid-drag inside the tuck zone: letting go here tucks the ball, and it dims to say so. */
  const [armed, setArmed] = useState(false);

  // What the gesture handlers read: they run on window listeners, between renders.
  const latest = useRef({ placement, area, metrics, reducedMotion, onChange, onActivate });
  latest.current = { placement, area, metrics, reducedMotion, onChange, onActivate };
  const draggingRef = useRef(false);
  const armedRef = useRef(false);
  /** A press is live: the ball is the gesture's, and nothing re-places it. */
  const pressing = useRef(false);
  /** Set by a completed drag, so the click the browser fires on its release does not activate. */
  const suppressClick = useRef(false);
  /** Where the drivers rest or are heading; null while nothing has placed the ball. */
  const target = useRef<FloatingBallPoint | null>(null);
  /** The control to focus once a keyboard tuck or untuck has swapped the one that held focus. */
  const refocus = useRef<"ball" | "handle" | null>(null);

  // -------------------------------------------------------------------------------- position
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

  /** Moves the ball to a resting point: a spring, or at once under reduced motion. */
  const glide = useCallback((rest: FloatingBallPoint) => {
    const d = drivers.current;
    if (!d) return;
    target.current = rest;
    if (latest.current.reducedMotion) {
      d.x.set(rest.left);
      d.y.set(rest.top);
      return;
    }
    d.x.animateTo(rest.left, SPRING_DEFAULT);
    d.y.animateTo(rest.top, SPRING_DEFAULT);
  }, []);

  // The area's size bounds everything: measured on mount and on every resize.
  useLayoutEffect(() => {
    const node = areaRef.current;
    if (!node) return;
    const measure = () => {
      const width = node.clientWidth;
      const height = node.clientHeight;
      setArea((prev) =>
        prev !== null && prev.width === width && prev.height === height ? prev : { width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // The ball sits at its placement's rest, at once: on mount, when it comes back from the edge,
  // when the area changes size, when the caller hands a placement other than the one a drop is
  // springing toward. Never while a press holds it, and with no spring: a load or a resize puts
  // the ball in place at once.
  useLayoutEffect(() => {
    const d = drivers.current;
    if (placement.tucked) {
      target.current = null;
      return;
    }
    if (!d || area === null || pressing.current) return;
    const rest = floatingBallRest(placement, area, metrics);
    const at = target.current;
    if (at !== null && at.left === rest.left && at.top === rest.top) return;
    target.current = rest;
    d.x.set(rest.left);
    d.y.set(rest.top);
  }, [placement, area, metrics, dragging]);

  // A keyboard tuck or untuck swapped the control that held focus: hand it to its replacement.
  useLayoutEffect(() => {
    const want = refocus.current;
    if (want === null) return;
    refocus.current = null;
    (want === "handle" ? handleRef.current : ballRef.current)?.focus();
  }, [placement.tucked]);

  // ---------------------------------------------------------------------------------- shield
  /** The transparent cover over the area while a press is live; the drag's cursor goes on it too. */
  const shield = (on: boolean) => {
    const node = areaRef.current;
    if (!node) return;
    node.style.pointerEvents = on ? "auto" : "";
    if (!on) node.style.cursor = "";
  };

  // ------------------------------------------------------------------------------------ drag
  /** Ends a press, however it ended: a click, a drop, or a gesture the browser called off. */
  const finish = (how: "press" | "drop" | "cancel") => {
    pressing.current = false;
    shield(false);
    draggingRef.current = false;
    armedRef.current = false;
    setDragging(false);
    setArmed(false);
    const d = drivers.current;
    const { placement: current, area: now, metrics: m, onChange: change } = latest.current;
    // Tucked by the caller mid-press: the ball is gone, and its gesture with it.
    if (!d || now === null || current.tucked) return;
    if (how !== "drop") {
      // A press that never moved, or an abandoned one: back to where it rests (a spring the
      // press interrupted resumes), and nothing stored.
      glide(floatingBallRest(current, now, m));
      return;
    }
    suppressClick.current = true;
    const next = floatingBallDrop({ left: d.x.value, top: d.y.value }, now, current, m);
    if (next.tucked) {
      target.current = null;
    } else {
      glide(floatingBallRest(next, now, m));
    }
    change(next);
  };

  const dragProps = usePointerDrag<Press>({
    threshold: dragThreshold,
    begin: (event) => {
      const d = drivers.current;
      if (!d || latest.current.area === null) return null;
      suppressClick.current = false;
      // Gesture takeover: a spring in flight stops where it is, and the press continues from there.
      const [left] = d.x.stop();
      const [top] = d.y.stop();
      pressing.current = true;
      // Imperatively, not through state: re-rendering the pressed ball can cost its capture.
      shield(true);
      return { start: { left, top }, clientX: event.clientX, clientY: event.clientY };
    },
    onMove: (event, press) => {
      const d = drivers.current;
      const { area: now, metrics: m } = latest.current;
      if (!d || now === null) return;
      if (!draggingRef.current) {
        draggingRef.current = true;
        setDragging(true);
        if (areaRef.current) areaRef.current.style.cursor = "grabbing";
      }
      const point = floatingBallDrag(
        press.start,
        event.clientX - press.clientX,
        event.clientY - press.clientY,
        now,
        m,
      );
      d.x.set(point.left);
      d.y.set(point.top);
      const inZone = floatingBallInTuckZone(point, now, m);
      if (inZone !== armedRef.current) {
        armedRef.current = inZone;
        setArmed(inZone);
      }
    },
    onEnd: (_press, dragged) => finish(dragged ? "drop" : "press"),
    onCancel: () => finish("cancel"),
  });

  // ---------------------------------------------------------------------------------- clicks
  const onBallClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      // A keyboard press (no pointer, detail 0) is never the release of a drag.
      if (event.detail !== 0) return;
    }
    latest.current.onActivate();
  };

  // A click with no pointer behind it (detail 0) is Enter or Space.
  const tuck = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (event.detail === 0 && rootRef.current?.contains(document.activeElement)) {
      refocus.current = "handle";
    }
    target.current = null;
    onChange({ ...placement, tucked: true });
  };

  const untuck = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (event.detail === 0 && handleRef.current === document.activeElement) {
      refocus.current = "ball";
    }
    onChange({ ...placement, tucked: false });
  };

  // ---------------------------------------------------------------------------------- render
  const rest = area === null ? null : floatingBallRest(placement, area, metrics);
  return (
    <div
      ref={areaRef}
      data-testid={`${testId}-area`}
      className="pointer-events-none absolute inset-x-0 bottom-0 z-window-overlay"
      style={{ top: areaTop }}
    >
      {placement.tucked ? (
        rest !== null && (
          <LauncherEdgeHandle
            buttonRef={handleRef}
            side={placement.side}
            width={handleWidth}
            height={size}
            label={showLabel}
            onClick={untuck}
            className="pointer-events-auto absolute"
            style={{
              top: rest.top,
              left: placement.side === "left" ? 0 : undefined,
              right: placement.side === "right" ? 0 : undefined,
            }}
          />
        )
      ) : (
        <div
          ref={rootRef}
          className={`group pointer-events-auto absolute left-0 top-0 transition-opacity duration-150 ${
            armed ? "opacity-50" : ""
          }`}
          style={{ width: size, height: size }}
        >
          <LauncherBall
            buttonRef={ballRef}
            {...dragProps}
            onClick={onBallClick}
            size={size}
            glyph={glyph}
            label={label}
            lit={dragging}
            dragging={dragging}
            testId={testId}
            // The hint would trail the ball through a drag, so it goes while one is live.
            data-tooltip={dragging ? undefined : label}
          />
          {!dragging && (
            // Shown while the ball is pointed at or keyboard-focused (the ball's own focus or
            // the ×'s), never by the focus a mouse press leaves behind.
            <LauncherDismiss
              corner={placement.side === "right" ? "left" : "right"}
              label={tuckLabel}
              onClick={tuck}
              className="pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-has-[:focus-visible]:pointer-events-auto group-has-[:focus-visible]:opacity-100"
            />
          )}
        </div>
      )}
    </div>
  );
}
