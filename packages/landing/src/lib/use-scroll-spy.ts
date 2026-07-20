/**
 * Live scroll-spy for the landing nav: returns the id of the LAST section whose
 * anchor top has crossed the activation line under the sticky header, or null
 * while the viewport is still above the first section (the hero). Scroll events
 * are captured at the document level so any scrolling container works, and
 * positions are measured with viewport rects (rAF-throttled).
 */
import { useEffect, useState } from "react";

/** Just below the sticky header plus the .section-anchor scroll margin (5.5rem). */
const ACTIVATION_LINE_PX = 96;

export function useScrollSpy(ids: readonly string[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  const key = ids.join("|");

  useEffect(() => {
    if (ids.length === 0) {
      setActive(null);
      return;
    }
    let raf = 0;
    const measure = () => {
      raf = 0;
      let current: string | null = null;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= ACTIVATION_LINE_PX) current = id;
      }
      setActive(current);
    };
    const schedule = () => {
      if (raf === 0) raf = requestAnimationFrame(measure);
    };
    measure();
    document.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      document.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      if (raf) cancelAnimationFrame(raf);
    };
    // The id list is captured via its joined key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return active;
}
