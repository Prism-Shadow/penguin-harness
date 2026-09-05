/**
 * Whether the reader asked their system to reduce motion, as live state.
 *
 * `styles.css` already disables the app's CSS animations under that preference, so this hook is
 * for the motion CSS cannot reach: a spring driven frame by frame in JS. Its callers replace the
 * animation with the resting state it would have ended on — the sheet snaps to its target, the
 * dock launcher's ball jumps home and its fan opens and folds without one.
 */
import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia(QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
