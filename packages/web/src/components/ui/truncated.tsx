/**
 * Single-line truncated text: attaches `title` (hover to see the full text)
 * **only when actually truncated**, and only where nothing else reveals the tail.
 *
 * The site-wide rule is "don't duplicate `title` when the element already shows
 * the text", but text whose tail is cut off by `truncate` isn't fully shown —
 * this is the one exception. Whether it overflows must be measured
 * (`scrollWidth > clientWidth`), and re-measured whenever the container's size
 * changes (sidebar collapse / window resize).
 *
 * `scrollReveal` additionally scrolls the clipped tail into view (#309): while
 * the nearest `data-title-reveal` ancestor (the sidebar conversation row) is
 * hovered or holds keyboard focus, the text slides left by the measured overflow
 * at a constant reading speed, holds at the end, and snaps back the instant the
 * hover/focus ends. The animation itself is pure CSS (styles.css
 * `title-scroll-reveal` keyframes) driven by the two custom properties set here:
 * this component only measures and publishes numbers. There are no timers, and
 * the reduced-motion query is one app-wide subscription shared by every row
 * (use-reduced-motion.ts), not one per row.
 *
 * Which of the two discloses the tail is `titleDisclosure` (title-reveal.ts), and
 * they are alternatives: the tooltip covers the text the scroll cannot reach —
 * callers without `scrollReveal`, and scroll-reveal rows under reduced motion,
 * where the global `animation: none !important` block in styles.css disables the
 * keyframes outright and leaves the plain ellipsis. Where the reveal does run, no
 * `title` is attached: having both put a tooltip over the very text sliding past
 * underneath it (#570). The full text always stays in the DOM either way, so the
 * accessible name carries it whole no matter how much of it is visually clipped.
 */
import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { revealDistancePx, revealDurationMs, titleDisclosure } from "../../lib/title-reveal";
import { usePrefersReducedMotion } from "./use-reduced-motion";

export function Truncated({
  text,
  className = "",
  scrollReveal = false,
}: {
  text: string;
  className?: string;
  /** Scroll the clipped tail into view while a `data-title-reveal` ancestor is hovered / keyboard-focused (sidebar conversation rows). */
  scrollReveal?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  /** Measured overflow in px (0 = fits): > 0 drives both the `title` tooltip and the scroll distance. */
  const [overflowPx, setOverflowPx] = useState(0);
  const reducedMotion = usePrefersReducedMotion();

  // className is also a dependency: when the caller switches to font-medium in the
  // selected state, the font weight changes and content width (scrollWidth) changes
  // with it, but this element is a flex child whose width is constrained by its
  // parent, so clientWidth doesn't move -> ResizeObserver won't fire. Without
  // re-measuring, this would under-report (should have `title` but doesn't) or
  // over-report (should remove `title` but keeps it).
  // Measuring while the reveal is mid-scroll is safe: the animation only transforms
  // the inner span, which leaves the outer span's scrollWidth at its layout value.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The subpixel tolerance lives in revealDistancePx (title-reveal.ts) so a 1px
    // rounding artifact produces neither a spurious title nor a 1px scroll.
    const measure = () => setOverflowPx(revealDistancePx(el.scrollWidth, el.clientWidth));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, className]);

  // One decision drives all three: the scroll class and its variables are attached
  // only where the reveal will actually run, so anywhere else the styles.css rules
  // match nothing and the row renders exactly as it did pre-#309 (native ellipsis
  // plus the conditional title).
  const disclosure = titleDisclosure({
    overflowing: overflowPx > 0,
    scrollReveal,
    reducedMotion,
  });
  return (
    <span
      ref={ref}
      className={`truncate ${className}${disclosure === "scroll" ? " title-scroll" : ""}`}
      {...(disclosure === "scroll"
        ? {
            style: {
              "--title-scroll-shift": `-${overflowPx}px`,
              "--title-scroll-ms": `${revealDurationMs(overflowPx)}ms`,
            } as CSSProperties,
          }
        : {})}
      {...(disclosure === "tooltip" ? { title: text } : {})}
    >
      {/* The scroll needs a child the keyframes can turn into an inline-block and
          transform; at rest it renders inline, i.e. exactly like the bare text node
          every other caller keeps (native ellipsis included). */}
      {scrollReveal ? <span className="title-scroll-text">{text}</span> : text}
    </span>
  );
}
