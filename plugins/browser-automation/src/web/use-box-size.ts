/**
 * An element's box, whole pixels, measured after it mounts and again on every resize: the Browser
 * panel's page area, which the page size tooltip reads its zoom against. Null until measured,
 * and where the engine has no ResizeObserver. Unchanged sizes set nothing, so a dock dragged
 * across many frames re-renders only when the rounded box actually changes.
 */
import { useLayoutEffect, useState, type RefObject } from "react";
import type { Size } from "./geometry";

export function useBoxSize(ref: RefObject<HTMLElement | null>): Size | null {
  const [size, setSize] = useState<Size | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      const next = { width: Math.round(box.width), height: Math.round(box.height) };
      setSize((current) =>
        current !== null && current.width === next.width && current.height === next.height
          ? current
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
