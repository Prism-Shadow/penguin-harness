/**
 * Single-line truncated text: attaches `title` (hover to see the full text)
 * **only when actually truncated**.
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
 * this component only measures and publishes numbers. There are no timers and no
 * media-query subscriptions to leak — reduced motion is handled by the global
 * `animation: none !important` block in styles.css, which disables the keyframes
 * outright and leaves the plain ellipsis plus the `title` tooltip. The full text
 * also always stays in the DOM, so screen readers announce it regardless of the
 * visual clipping.
 */
import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { revealDistancePx, revealDurationMs } from "../../lib/title-reveal";

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

  const overflowing = overflowPx > 0;
  // The scroll class and variables are attached only while there is something to
  // scroll: without them the styles.css rules match nothing, leaving exactly the
  // pre-#309 rendering (native ellipsis + conditional title) for titles that fit.
  const scrolling = scrollReveal && overflowing;
  return (
    <span
      ref={ref}
      className={`truncate ${className}${scrolling ? " title-scroll" : ""}`}
      {...(scrolling
        ? {
            style: {
              "--title-scroll-shift": `-${overflowPx}px`,
              "--title-scroll-ms": `${revealDurationMs(overflowPx)}ms`,
            } as CSSProperties,
          }
        : {})}
      {...(overflowing ? { title: text } : {})}
    >
      {/* The scroll needs a child the keyframes can turn into an inline-block and
          transform; at rest it renders inline, i.e. exactly like the bare text node
          every other caller keeps (native ellipsis included). */}
      {scrollReveal ? <span className="title-scroll-text">{text}</span> : text}
    </span>
  );
}
