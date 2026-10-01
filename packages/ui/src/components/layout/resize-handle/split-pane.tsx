/**
 * SplitPane: two columns side by side with a `ResizeHandle` between them — the leading one at a
 * width the caller keeps, the trailing one taking the rest. The Files panel's tree beside its
 * preview is one.
 *
 * The caller owns the width and its preference: `onResize` hands back each new width during a
 * drag (and per arrow key), already brought within `min`–`max` and rounded, and `onResizeEnd` the
 * width to keep once the gesture is over — once per drag, not per frame, which is when a caller
 * writes its stored preference.
 *
 * `collapsed` slides the leading column (with its handle) out of the container's start edge and
 * back. Both keep their own width inside a clipping window whose width is what moves, so the
 * column never reflows while it travels, and the trailing column takes the room it leaves. The
 * slide runs on the theme's layout motion (`data-layout-motion`), and only for the length of the
 * slide: the window's width also follows every drag of the handle, and a transition left on would
 * make the column trail a fifth of a second behind the pointer. A collapsed column is `inert` —
 * a column at zero width is not somewhere to tab into.
 */
import { useEffect, useRef, useState } from "react";
import type { ReactNode, TransitionEvent } from "react";
import { RESIZE_HANDLE_PX, ResizeHandle } from "./resize-handle";

/**
 * How long a slide may keep the layout motion on when its `transitionend` never arrives — under
 * reduced motion there is no transition at all. Comfortably past every theme's layout duration.
 */
const SLIDE_FALLBACK_MS = 400;

export interface SplitPaneProps {
  /** The leading column's width, in px. */
  size: number;
  min: number;
  max: number;
  /** A new width during a drag or per arrow key, within `min`–`max`. */
  onResize: (size: number) => void;
  /** The width to keep, once a drag or an arrow key is done with. */
  onResizeEnd?: (size: number) => void;
  /** The handle's accessible name and tooltip. */
  label: string;
  /** Slide the leading column out; it stays mounted, with everything it holds. */
  collapsed?: boolean;
  /** The leading column's content; it fills the column's height. */
  first: ReactNode;
  /** The trailing column: a flex item that takes the rest of the row. */
  second: ReactNode;
  className?: string;
}

export function SplitPane({
  size,
  min,
  max,
  onResize,
  onResizeEnd,
  label,
  collapsed = false,
  first,
  second,
  className = "",
}: SplitPaneProps) {
  const firstRef = useRef<HTMLDivElement | null>(null);
  // The width last handed out, which is what a release keeps: the `size` prop may still be a
  // render behind the pointer when the release lands.
  const requested = useRef(size);
  requested.current = size;

  // Armed in the render that flips `collapsed`, so the width change and the motion rule land in
  // the same commit and the transition starts from where the window was.
  const [sliding, setSliding] = useState(false);
  const [shownCollapsed, setShownCollapsed] = useState(collapsed);
  if (shownCollapsed !== collapsed) {
    setShownCollapsed(collapsed);
    setSliding(true);
  }
  useEffect(() => {
    if (!sliding) return;
    const timer = window.setTimeout(() => setSliding(false), SLIDE_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [sliding, collapsed]);

  const clamp = (px: number): number => Math.min(max, Math.max(min, Math.round(px)));
  const request = (px: number): number => {
    const next = clamp(px);
    requested.current = next;
    onResize(next);
    return next;
  };

  const onSlideEnd = (event: TransitionEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget && event.propertyName === "width") setSliding(false);
  };

  return (
    <div className={`flex min-h-0 ${className}`}>
      <div
        aria-hidden={collapsed}
        inert={collapsed}
        style={{ width: collapsed ? 0 : size + RESIZE_HANDLE_PX }}
        {...(sliding ? { "data-layout-motion": "" } : {})}
        onTransitionEnd={onSlideEnd}
        className="flex min-h-0 shrink-0 overflow-hidden"
      >
        <div
          ref={firstRef}
          style={{ width: size }}
          className="flex min-h-0 shrink-0 flex-col border-r border-line"
        >
          {first}
        </div>
        <ResizeHandle
          axis="x"
          label={label}
          value={size}
          min={min}
          max={max}
          // Against the column's own left edge rather than an accumulated delta, so a drag that
          // outruns the bounds comes back in step instead of offset by however far it overshot.
          onResize={(event) => {
            const rect = firstRef.current?.getBoundingClientRect();
            if (rect) request(event.clientX - rect.left);
          }}
          onResizeEnd={(committed) => {
            if (committed) onResizeEnd?.(requested.current);
          }}
          onStep={(delta) => onResizeEnd?.(request(size + delta))}
        />
      </div>
      {second}
    </div>
  );
}
