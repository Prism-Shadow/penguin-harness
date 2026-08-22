/**
 * Shared pointer-drag state machine for the dock's gestures (header move, tab drag,
 * boundary resize): capture on pointerdown so a fast pull can never escape the surface, a
 * movement threshold separating taps from drags, and latest-callback refs so `onEnd`
 * never sees stale state. Spread the returned props on the gesture's surface.
 */
import { useMemo, useRef } from "react";

export function usePointerDrag<T>(options: {
  /** Resolves the drag payload from the initial event; null refuses the gesture. */
  begin: (event: React.PointerEvent<HTMLElement>) => T | null;
  /** px of movement that turns the press into a drag (0 = immediately). */
  threshold?: number;
  onMove?: (event: React.PointerEvent<HTMLElement>, payload: T) => void;
  /** Release: `dragged` distinguishes a completed drag from a plain tap. */
  onEnd?: (payload: T, dragged: boolean) => void;
  /** Abandoned gesture (pointercancel): clear visuals, apply nothing. */
  onCancel?: () => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  const state = useRef<{ payload: T; x: number; y: number; started: boolean } | null>(null);

  return useMemo(
    () => ({
      onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
        if (event.button !== 0) return;
        const payload = latest.current.begin(event);
        if (payload === null) return;
        state.current = { payload, x: event.clientX, y: event.clientY, started: false };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
        const drag = state.current;
        if (!drag) return;
        if (!drag.started) {
          const threshold = latest.current.threshold ?? 5;
          if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < threshold) return;
          drag.started = true;
        }
        latest.current.onMove?.(event, drag.payload);
      },
      onPointerUp: (event: React.PointerEvent<HTMLElement>) => {
        const drag = state.current;
        state.current = null;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        if (drag) latest.current.onEnd?.(drag.payload, drag.started);
      },
      onPointerCancel: () => {
        state.current = null;
        latest.current.onCancel?.();
      },
    }),
    [],
  );
}
