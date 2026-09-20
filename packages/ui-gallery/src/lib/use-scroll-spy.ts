/**
 * Scroll-spy for the rail: the id of the last section whose top has crossed the activation line,
 * measured with viewport rects on a rAF-throttled capture-phase scroll listener.
 */
import { useEffect, useState } from "react";

const ACTIVATION_LINE_PX = 120;

export function useScrollSpy(ids: readonly string[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  const key = ids.join("|");
  useEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
      let current: string | null = ids[0] ?? null;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= ACTIVATION_LINE_PX) current = id;
        else break;
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
    // The id list is captured through its joined key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return active;
}
