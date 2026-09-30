/**
 * "The primary pointer is a finger" — the one condition every touch-only affordance in the
 * app hangs off.
 *
 * It is a pointer question, not a width question: a phone in landscape is wider than a
 * small desktop window, and a desktop window narrowed to phone width still has a mouse and
 * a full keyboard. `(pointer: coarse)` asks about the primary input device, so a touchscreen
 * laptop — primary pointer still fine — keeps the desktop affordances it can actually use.
 *
 * Live, not a mount-time snapshot: a tablet switching to a paired keyboard and trackpad
 * changes the answer without reloading the page.
 */
import { useEffect, useState } from "react";

export const COARSE_POINTER_QUERY = "(pointer: coarse)";

function matches(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(COARSE_POINTER_QUERY).matches;
}

export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(matches);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(COARSE_POINTER_QUERY);
    const onChange = (event: MediaQueryListEvent) => setCoarse(event.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return coarse;
}
