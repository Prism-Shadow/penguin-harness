/** A small return path on long public pages, offered after the first screenful. */
import { useEffect, useRef, useState } from "react";
import { ArrowUpIcon } from "./site-icons";

export function SiteScrollTop({ label, targetId }: { label: string; targetId: string }) {
  const marker = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!marker.current) return;
    if (!("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry?.isIntersecting === false),
      { rootMargin: "640px 0px 0px" },
    );
    observer.observe(marker.current);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      <span ref={marker} className="site-scroll-top-marker" aria-hidden="true" />
      {visible && (
        <button
          type="button"
          className="site-scroll-top"
          aria-label={label}
          title={label}
          onClick={() => {
            document.getElementById(targetId)?.focus({ preventScroll: true });
            window.scrollTo({
              top: 0,
              behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
                ? "instant"
                : "smooth",
            });
          }}
        >
          <ArrowUpIcon />
        </button>
      )}
    </>
  );
}
