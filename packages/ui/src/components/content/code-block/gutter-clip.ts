/**
 * The gutter's clearance on an unwrapped surface.
 *
 * Unwrapped, long lines scroll sideways and their numbers stay put (sticky), so the code slides
 * under the numbers. The gutter has no fill of its own — it shows whatever the surface sits on,
 * a wallpaper or a translucent theme's panel included — so the code is clipped where it passes
 * under the numbers instead of being painted over (prose.css, `data-scrolled-x`). The clip
 * follows the scroll box's offset, which only the box knows: this keeps it on the surface as
 * `--code-scroll-x`, from the nearest ancestor that scrolls sideways. Nothing is done while the
 * box sits at its left edge, which is also every wrapped surface.
 */
import { useEffect } from "react";
import type { RefObject } from "react";

/** The nearest ancestor that scrolls sideways. */
function horizontalScroller(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node !== null; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowX;
    if (overflow === "auto" || overflow === "scroll") return node;
  }
  return null;
}

export function useGutterClip(surface: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const el = surface.current;
    if (!enabled || el === null) return;
    const box = horizontalScroller(el);
    if (box === null) return;
    const follow = () => {
      const x = box.scrollLeft;
      if (x > 0) {
        el.style.setProperty("--code-scroll-x", `${x}px`);
        el.dataset.scrolledX = "";
      } else {
        el.style.removeProperty("--code-scroll-x");
        delete el.dataset.scrolledX;
      }
    };
    follow();
    box.addEventListener("scroll", follow, { passive: true });
    return () => {
      box.removeEventListener("scroll", follow);
      el.style.removeProperty("--code-scroll-x");
      delete el.dataset.scrolledX;
    };
  }, [surface, enabled]);
}
