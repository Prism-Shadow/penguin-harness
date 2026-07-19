/**
 * Bottom sheet (used by the mobile Files panel): a top-to-bottom layout with two
 * snap points, half (browse) / full (preview).
 *
 * Interaction spec (following Apple's Designing Fluid Interfaces):
 * - The header (grab handle + title row) is the drag surface, tracking Pointer
 *   Events 1:1 while respecting the grab offset; the content area only scrolls
 *   and never drags (v1 intentionally skips scroll/drag disambiguation).
 * - On release, project the velocity to pick the nearest snap point (a fast
 *   downward flick naturally projects to close); velocity hands off to a spring,
 *   so drag and animation feel seamless; dragging up past full applies
 *   progressive rubberband damping.
 * - Mid-animation, grabbing again takes over from the current rendered value
 *   with no jump; programmatic moves use critical damping with no overshoot,
 *   while a gesture release allows slight springy overshoot.
 * - The overlay's opacity is driven by the same translateY progress (no separate
 *   animation); prefers-reduced-motion degrades to a fade plus a direct snap
 *   into position.
 * - Body scroll is locked while open; Esc or clicking the overlay closes it;
 *   focus returns to the element that had it before opening.
 *
 * Coordinate system: the panel sits at bottom-0 with height 92dvh (FULL_FRACTION
 * and the class must be changed together), translateY y is in [0, panel height],
 * 0 = full open, panel height = fully off-screen; half's y is derived from the
 * 60dvh visible height.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { S } from "../../lib/strings";
import { SPRING_DEFAULT, SPRING_MOMENTUM, createSpringDriver } from "../../lib/spring";
import type { SpringDriver } from "../../lib/spring";
import { nearestSnap, project, rubberband } from "../../lib/sheet-physics";

export type SheetSnap = "half" | "full";

/** Fraction of viewport height the full-state panel occupies — same fact as the panel class `h-[92dvh]`, change one and you must change the other. */
const FULL_FRACTION = 0.92;
/** Fraction of viewport height that's visible in the half state. */
const HALF_VISIBLE_FRACTION = 0.6;

export interface SheetProps {
  open: boolean;
  /** Target snap point; a change while open animates to it (e.g. tapping into preview from list state promotes it to full). */
  snap: SheetSnap;
  /** Reported back after a gesture lands on a new snap point, to keep parent state in sync. */
  onSnapChange?: (snap: SheetSnap) => void;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function Sheet({ open, snap, onSnapChange, onClose, title, children }: SheetProps) {
  // Don't unmount immediately when open=false: unmount only after the exit animation finishes (onSettle).
  const [mounted, setMounted] = useState(open);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const scrimRef = useRef<HTMLDivElement | null>(null);
  const driverRef = useRef<SpringDriver | null>(null);
  /** Actual panel height (= full-state travel distance); re-measured on resize/keyboard popup. */
  const heightRef = useRef(0);
  const draggingRef = useRef(false);
  const closingRef = useRef(false);
  /** Target of the most recent spring command: prevents the prop change that flows
   *  back from onSnapChange after a gesture release from restarting the spring as
   *  a "programmatic" move, which would kill the momentum's springiness. */
  const lastTargetRef = useRef<number | null>(null);
  /** Drag velocity samples (keeps only the most recent ~100ms window). */
  const historyRef = useRef<{ y: number; t: number }[]>([]);
  const grabRef = useRef({ pointerY: 0, sheetY: 0 });
  const openRef = useRef(open);
  openRef.current = open;
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const reduced = usePrefersReducedMotion();

  /** The same progress value drives both panel translation and overlay opacity (writes the DOM directly, bypassing React rendering). */
  const applyFrame = useCallback((y: number) => {
    const h = heightRef.current || 1;
    if (panelRef.current) panelRef.current.style.transform = `translate3d(0, ${y}px, 0)`;
    if (scrimRef.current) {
      scrimRef.current.style.opacity = String(Math.min(1, Math.max(0, 1 - y / h)));
    }
  }, []);

  const snapYFor = useCallback((s: SheetSnap) => {
    const h = heightRef.current;
    return s === "full" ? 0 : h * (1 - HALF_VISIBLE_FRACTION / FULL_FRACTION);
  }, []);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  // Measure height on mount and place the panel fully off-screen (the orchestration effect below then animates it into view).
  useLayoutEffect(() => {
    if (!mounted) return;
    const panel = panelRef.current;
    if (!panel) return;
    heightRef.current = panel.offsetHeight;
    if (!driverRef.current) {
      driverRef.current = createSpringDriver(heightRef.current, applyFrame);
      driverRef.current.set(heightRef.current);
    }
  }, [mounted, applyFrame]);

  // Open/close/snap-point orchestration.
  useEffect(() => {
    if (!mounted) return;
    const driver = driverRef.current;
    if (!driver) return;
    if (open) {
      closingRef.current = false;
      if (draggingRef.current) return; // While dragging, the gesture is in control — don't let a prop change interfere
      const target = snapYFor(snap);
      if (lastTargetRef.current !== null && Math.abs(lastTargetRef.current - target) < 1) return;
      lastTargetRef.current = target;
      if (reduced) {
        driver.set(target);
        return;
      }
      driver.animateTo(target, SPRING_DEFAULT);
    } else {
      closingRef.current = true;
      lastTargetRef.current = heightRef.current;
      if (reduced) {
        setMounted(false);
        return;
      }
      driver.animateTo(heightRef.current, SPRING_DEFAULT, { onSettle: () => setMounted(false) });
    }
  }, [mounted, open, snap, reduced, snapYFor]);

  // Unmount cleanup: when mounted becomes false, dispose the driver (rebuilt and
  // re-measured on next open) and reset gesture state — pointerup may never fire
  // (interrupted by a system gesture, tab switch, or lost capture), and without
  // this reset a leaked draggingRef would make the orchestration effect refuse to
  // animate the entrance next time it opens.
  useEffect(() => {
    if (mounted) return;
    driverRef.current?.dispose();
    driverRef.current = null;
    lastTargetRef.current = null;
    draggingRef.current = false;
    closingRef.current = false;
  }, [mounted]);
  useEffect(() => () => driverRef.current?.dispose(), []);

  // Lock body scroll while open (on iOS, the page behind the overlay would otherwise keep scrolling).
  useEffect(() => {
    if (!mounted) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mounted]);

  useEffect(() => {
    if (!mounted || !open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mounted, open, onClose]);

  // Focus restoration: return to the element that had focus before opening, after closing.
  useEffect(() => {
    if (!mounted) return;
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => restoreFocusRef.current?.focus();
  }, [mounted]);

  // Viewport change (rotation/soft keyboard): re-measure height and snap directly to the current snap point, no animation.
  useEffect(() => {
    if (!mounted) return;
    const onResize = () => {
      const panel = panelRef.current;
      if (!panel) return;
      heightRef.current = panel.offsetHeight;
      if (draggingRef.current || closingRef.current) return;
      const target = snapYFor(snap);
      lastTargetRef.current = target;
      driverRef.current?.set(target);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [mounted, snap, snapYFor]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (closingRef.current) return;
    const driver = driverRef.current;
    if (!driver) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const [y] = driver.stop(); // Take over: continue from the rendered value, a mid-flight panel stops the instant it's grabbed
    draggingRef.current = true;
    grabRef.current = { pointerY: e.clientY, sheetY: y };
    historyRef.current = [{ y: e.clientY, t: performance.now() }];
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const driver = driverRef.current;
    if (!driver) return;
    const raw = grabRef.current.sheetY + (e.clientY - grabRef.current.pointerY);
    const h = heightRef.current;
    // Above full (raw<0) applies progressive damping; below fully-off-screen is clamped.
    const y = raw < 0 ? -rubberband(-raw, h) : Math.min(raw, h);
    driver.set(y);
    const now = performance.now();
    const hist = historyRef.current;
    hist.push({ y: e.clientY, t: now });
    while (hist.length > 2 && now - hist[0]!.t > 100) hist.shift();
  };

  /** Shared by release/cancel: pick a snap point via projection, hand velocity off to the spring. */
  const release = (velocity: number) => {
    draggingRef.current = false;
    const driver = driverRef.current;
    if (!driver) return;
    const h = heightRef.current;
    const halfY = snapYFor("half");
    // Parent already requested a close (e.g. a session switch during the drag): go straight to the exit animation.
    const projected = openRef.current ? driver.value + project(velocity) : h;
    const target = nearestSnap(projected, [0, halfY, h]);
    lastTargetRef.current = target;
    if (target === h) {
      closingRef.current = true;
      if (reduced) {
        setMounted(false);
        onClose();
        return;
      }
      driver.animateTo(h, SPRING_MOMENTUM, {
        velocity,
        onSettle: () => {
          setMounted(false);
          onClose();
        },
      });
      return;
    }
    driver.animateTo(target, SPRING_MOMENTUM, { velocity });
    const nextSnap: SheetSnap = target === 0 ? "full" : "half";
    if (nextSnap !== snap) onSnapChange?.(nextSnap);
  };

  const onPointerUp = () => {
    if (!draggingRef.current) return;
    const hist = historyRef.current;
    const last = hist[hist.length - 1];
    const first = hist[0];
    const dt = last && first ? last.t - first.t : 0;
    release(dt > 0 ? ((last!.y - first!.y) / dt) * 1000 : 0);
  };

  const onPointerCancel = () => {
    if (!draggingRef.current) return;
    release(0);
  };

  if (!mounted) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <div
        ref={scrimRef}
        className={`absolute inset-0 bg-black/45 ${reduced ? "anim-fade" : ""}`}
        style={{ opacity: 0 }}
        onPointerDown={() => onClose()}
      />
      <div
        ref={panelRef}
        className={`absolute inset-x-0 bottom-0 flex h-[92dvh] flex-col overflow-hidden rounded-t-2xl border-t border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900 ${
          reduced ? "anim-fade" : ""
        }`}
        style={{ transform: "translate3d(0, 100%, 0)" }}
      >
        {/* Drag surface: grab handle + title row. touch-none ensures pointermove isn't interrupted by scrolling during a touch drag. */}
        <div
          className="shrink-0 cursor-grab touch-none select-none active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          // Fallback for when capture is lost with no pointercancel (system preemption, etc.): settle at zero velocity.
          // Also fires after a normal pointerup — the draggingRef guard in onPointerCancel prevents double handling.
          onLostPointerCapture={onPointerCancel}
        >
          <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-gray-300 dark:bg-gray-600" />
          <div className="flex items-center justify-between px-4 pb-2 pt-1.5">
            <span className="text-base font-semibold">{title ?? ""}</span>
            <button
              type="button"
              aria-label={S.common.close}
              onClick={onClose}
              onPointerDown={(e) => e.stopPropagation()}
              className="rounded-md p-1.5 text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor">
                <path d="M2 2l10 10M12 2L2 12" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
          {children}
        </div>
      </div>
    </div>
  );
}
