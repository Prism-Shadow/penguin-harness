/**
 * Scroll reveal: adds .reveal on mount and .reveal-visible once the element enters
 * the viewport (one-shot). Reduced-motion users see content immediately via the CSS
 * override in styles.css.
 */
import { useEffect, useRef } from "react";
import type { RefObject } from "react";

export function useReveal<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.classList.add("reveal");
    if (!("IntersectionObserver" in window)) {
      el.classList.add("reveal-visible");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            el.classList.add("reveal-visible");
            io.disconnect();
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}
