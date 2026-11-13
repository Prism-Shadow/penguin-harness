/**
 * The gutter's clearance on an unwrapped surface.
 *
 * Unwrapped, long lines scroll sideways while the numbers stay at the box's left edge, so the
 * code slides under them. The gutter has no fill of its own — it shows whatever the surface sits
 * on, a wallpaper or a translucent theme's panel included — so the code is clipped where it
 * passes under the numbers instead of being painted over. Unwrapped, the numbers are one column
 * of their own (CodeSurface's `.code-gutter`) rather than a mark on every line, so the clip is
 * one inline property on the code layer: a scroll step restyles that one element. A value
 * inherited by every line would restyle all of them — a quarter of a second a step on a file of
 * ten thousand lines.
 *
 * The clip follows the nearest ancestor that scrolls sideways, at most once a frame, and is
 * checked again on every render: a new file may come with a new scroll box, or with the old one
 * put back at its left edge without a scroll event, and a clip left over from the previous file
 * would cut the start off every line. Nothing is clipped at the left edge.
 */
import { useEffect, useRef } from "react";
import type { RefObject } from "react";

/** The nearest ancestor that scrolls sideways. */
function horizontalScroller(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node !== null; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowX;
    if (overflow === "auto" || overflow === "scroll") return node;
  }
  return null;
}

/** What the clip reads and writes. */
export interface GutterClipTargets {
  /** The surface: the scroll box is looked for from here. */
  surface: RefObject<HTMLElement | null>;
  /** The code layer the clip is set on. */
  layer: RefObject<HTMLElement | null>;
  /** The numbers' column: the code is hidden up to its right edge. */
  gutter: RefObject<HTMLElement | null>;
}

/** Clips `layer` up to the gutter's right edge at `box`'s offset, or not at all at its left edge. */
function follow(targets: GutterClipTargets, box: HTMLElement): void {
  const layer = targets.layer.current;
  if (layer === null) return;
  const x = box.scrollLeft;
  const gutter = targets.gutter.current?.offsetWidth ?? 0;
  if (x > 0) layer.style.clipPath = `inset(0 0 0 ${gutter + x}px)`;
  else layer.style.removeProperty("clip-path");
}

interface Attached {
  surface: HTMLElement;
  box: HTMLElement;
  detach: () => void;
}

function attach(surface: HTMLElement, targets: GutterClipTargets): Attached | null {
  const box = horizontalScroller(surface);
  if (box === null) return null;
  let frame = 0;
  const onScroll = () => {
    if (frame !== 0) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      follow(targets, box);
    });
  };
  follow(targets, box);
  box.addEventListener("scroll", onScroll, { passive: true });
  return {
    surface,
    box,
    detach: () => {
      box.removeEventListener("scroll", onScroll);
      if (frame !== 0) cancelAnimationFrame(frame);
      targets.layer.current?.style.removeProperty("clip-path");
    },
  };
}

/** Keeps the code layer's clip in step with the surface's scroll box while `enabled`. */
export function useGutterClip(targets: GutterClipTargets, enabled: boolean): void {
  const attached = useRef<Attached | null>(null);
  // Every render: the layer may be a new element, the box a new one or moved without a word.
  useEffect(() => {
    const surface = targets.surface.current;
    const current = attached.current;
    if (!enabled || surface === null) {
      current?.detach();
      attached.current = null;
      return;
    }
    if (
      current !== null &&
      current.surface === surface &&
      current.box.isConnected &&
      current.box.contains(surface)
    ) {
      follow(targets, current.box);
      return;
    }
    current?.detach();
    attached.current = attach(surface, targets);
  });
  // Unmounted: the listener goes with the surface.
  useEffect(
    () => () => {
      attached.current?.detach();
      attached.current = null;
    },
    [],
  );
}
