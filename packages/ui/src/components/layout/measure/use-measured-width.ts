/**
 * An element's own width, for a layout that follows the room it was given rather than the
 * viewport: a panel in a dock, a reader in a dialog. Measured in a layout effect, so the first
 * paint already has it, and again on every resize. 0 means "not measured yet" (and stays so where
 * the engine has no ResizeObserver): a caller treats 0 as unknown, not as zero room.
 *
 * The element may mount after the component does — a page that draws a skeleton until its data
 * arrives, and its measured box only then — so every commit checks which element the ref holds,
 * and a new one is measured and observed from then on.
 */
import { useLayoutEffect, useState } from "react";
import type { RefObject } from "react";

export function useMeasuredWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  const [element, setElement] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (ref.current !== element) setElement(ref.current);
  });

  useLayoutEffect(() => {
    if (element === null) return;
    const measure = () => setWidth(Math.round(element.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return width;
}
