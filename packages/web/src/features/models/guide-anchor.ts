import { useLayoutEffect, useState, type CSSProperties } from "react";

/** Place the non-modal guide beside a visible product control, including in a narrow pane. */
export function useGuideAnchor(selector: string): CSSProperties | undefined {
  const [position, setPosition] = useState<CSSProperties>();
  useLayoutEffect(() => {
    let anchor: HTMLElement | undefined;
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(place);
    };
    const sizes = new ResizeObserver(schedule);
    const changes = new MutationObserver(schedule);
    function place() {
      const found = [...document.querySelectorAll<HTMLElement>(selector)].find(
        (el) => el.getClientRects().length && el.getBoundingClientRect().width > 0,
      );
      if (anchor !== found) {
        if (anchor) sizes.unobserve(anchor);
        anchor = found;
        if (anchor) sizes.observe(anchor);
      }
      if (!anchor) {
        setPosition(undefined);
        return;
      }
      const r = anchor.getBoundingClientRect();
      const margin = 12;
      const above = r.top > window.innerHeight - r.bottom;
      const left = Math.min(
        Math.max(margin, r.left),
        Math.max(margin, window.innerWidth - 336 - margin),
      );
      const available = above ? r.top : window.innerHeight - r.bottom;
      if (available < 100) {
        setPosition(undefined);
        return;
      }
      setPosition({
        left,
        right: "auto",
        top: above ? "auto" : Math.max(margin, r.bottom + 6),
        bottom: above ? Math.max(margin, window.innerHeight - r.top + 6) : "auto",
        maxHeight: Math.min(available - margin - 6, window.innerHeight * 0.45),
      });
    }
    changes.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    place();
    return () => {
      cancelAnimationFrame(raf);
      sizes.disconnect();
      changes.disconnect();
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [selector]);
  return position;
}
