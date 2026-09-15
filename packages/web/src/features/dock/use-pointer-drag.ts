/**
 * Shared pointer-drag state machine for the dock's gestures (header move, tab drag, boundary
 * resize) and the context gauge's threshold cutter: a movement threshold separating taps from
 * drags, and latest-callback refs so `onEnd` never sees stale state. Spread the returned props
 * on the gesture's surface.
 *
 * The press is taken on the element; everything after it runs on WINDOW listeners. An
 * element-bound `pointermove` stops arriving the moment pointer capture is lost — a control
 * under the pointer taking it, a frame, a re-render of the captured node — and the gesture then
 * froze mid-drag: the pointer went on moving, nothing followed it, and no `pointerup` ever
 * reached the element to end it, so the surface stayed stuck in its dragging look. Window
 * listeners keep tracking wherever the pointer travels, and a release anywhere ends the gesture
 * through `onEnd`. Capture is still requested on the press, best-effort, because it is what
 * keeps a fast pull from selecting text or scrolling the page under it; losing it costs nothing.
 */
import { useEffect, useMemo, useRef } from "react";

interface DragState<T> {
  payload: T;
  /** Only this pointer's events belong to the gesture; another finger's are ignored. */
  pointerId: number;
  x: number;
  y: number;
  started: boolean;
  /** Drops the gesture's listeners and its capture, and clears the state. Idempotent. */
  release: () => void;
}

export function usePointerDrag<T>(options: {
  /** Resolves the drag payload from the initial event; null refuses the gesture. */
  begin: (event: React.PointerEvent<HTMLElement>) => T | null;
  /** px of movement that turns the press into a drag (0 = immediately). */
  threshold?: number;
  /** Movement, as the native event: the gesture is tracked on the window, not on the element. */
  onMove?: (event: PointerEvent, payload: T) => void;
  /** Release: `dragged` distinguishes a completed drag from a plain tap. */
  onEnd?: (payload: T, dragged: boolean) => void;
  /** Abandoned gesture (pointercancel): clear visuals, apply nothing. */
  onCancel?: () => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  const state = useRef<DragState<T> | null>(null);

  // An unmount mid-gesture would otherwise leave the window listening for a pointer nothing
  // is following any more.
  useEffect(() => () => state.current?.release(), []);

  return useMemo(
    () => ({
      onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
        if (event.button !== 0) return;
        // A second press while a gesture is live (another finger, a release the window never
        // saw): abandon the old one rather than leave its visuals stuck.
        const running = state.current;
        if (running) {
          running.release();
          latest.current.onCancel?.();
        }
        const payload = latest.current.begin(event);
        if (payload === null) return;
        const element = event.currentTarget;
        const pointerId = event.pointerId;
        let captured = false;

        const onMove = (native: PointerEvent) => {
          const drag = state.current;
          if (!drag || native.pointerId !== drag.pointerId) return;
          if (!drag.started) {
            const threshold = latest.current.threshold ?? 5;
            if (Math.hypot(native.clientX - drag.x, native.clientY - drag.y) < threshold) return;
            drag.started = true;
          }
          latest.current.onMove?.(native, drag.payload);
        };
        const onUp = (native: PointerEvent) => {
          const drag = state.current;
          if (!drag || native.pointerId !== drag.pointerId) return;
          drag.release();
          latest.current.onEnd?.(drag.payload, drag.started);
        };
        const onPointerCancel = (native: PointerEvent) => {
          const drag = state.current;
          if (!drag || native.pointerId !== drag.pointerId) return;
          drag.release();
          latest.current.onCancel?.();
        };
        // Capture taken away mid-gesture. Nothing ends here: the window listeners carry the
        // gesture on, and there is simply no capture left to release.
        const onLostCapture = () => {
          captured = false;
        };
        const release = () => {
          state.current = null;
          window.removeEventListener("pointermove", onMove, true);
          window.removeEventListener("pointerup", onUp, true);
          window.removeEventListener("pointercancel", onPointerCancel, true);
          element.removeEventListener("lostpointercapture", onLostCapture);
          if (!captured) return;
          captured = false;
          try {
            element.releasePointerCapture(pointerId);
          } catch {
            // The pointer is already gone; there is nothing left to release.
          }
        };

        state.current = {
          payload,
          pointerId,
          x: event.clientX,
          y: event.clientY,
          started: false,
          release,
        };
        // Capture phase: a handler that stops propagation somewhere in between must not be
        // able to strand the gesture.
        window.addEventListener("pointermove", onMove, true);
        window.addEventListener("pointerup", onUp, true);
        window.addEventListener("pointercancel", onPointerCancel, true);
        element.addEventListener("lostpointercapture", onLostCapture);
        try {
          element.setPointerCapture(pointerId);
          captured = true;
        } catch {
          // A pointer the browser has already finished with refuses capture; the gesture
          // runs on the window listeners either way.
        }
      },
    }),
    [],
  );
}
