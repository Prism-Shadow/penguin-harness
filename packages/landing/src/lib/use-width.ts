/**
 * An element's content width, followed as it changes. A small chart lays itself out at this width
 * (a viewBox as wide as its box) so its labels keep the page's type sizes instead of shrinking or
 * growing with the drawing.
 */
import { useEffect, useRef, useState } from "react";

/** `fallback` until the element has been measured (and where ResizeObserver is missing). */
export function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(Math.max(1, Math.round(el.clientWidth)));
    read();
    if (!("ResizeObserver" in window)) return;
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}
