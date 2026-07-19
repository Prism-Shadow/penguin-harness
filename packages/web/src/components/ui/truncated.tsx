/**
 * Single-line truncated text: attaches `title` (hover to see the full text)
 * **only when actually truncated**.
 *
 * The site-wide rule is "don't duplicate `title` when the element already shows
 * the text", but text whose tail is cut off by `truncate` isn't fully shown —
 * this is the one exception. Whether it overflows must be measured
 * (`scrollWidth > clientWidth`), and re-measured whenever the container's size
 * changes (sidebar collapse / window resize).
 */
import { useLayoutEffect, useRef, useState } from "react";

export function Truncated({ text, className = "" }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  // className is also a dependency: when the caller switches to font-medium in the
  // selected state, the font weight changes and content width (scrollWidth) changes
  // with it, but this element is a flex child whose width is constrained by its
  // parent, so clientWidth doesn't move -> ResizeObserver won't fire. Without
  // re-measuring, this would under-report (should have `title` but doesn't) or
  // over-report (should remove `title` but keeps it).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Subpixel rounding can make even monospace text off by 1px; allow a 1px tolerance to avoid a spurious title.
    const measure = () => setOverflowing(el.scrollWidth > el.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, className]);

  return (
    <span ref={ref} className={`truncate ${className}`} {...(overflowing ? { title: text } : {})}>
      {text}
    </span>
  );
}
