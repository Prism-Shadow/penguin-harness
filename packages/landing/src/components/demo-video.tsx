/**
 * A demo recording in a plain frame. Nothing downloads until play (preload="none"), and the poster
 * only once the frame is about half a screen away, so the page's first load does not carry it; the
 * poster is the recording's own title frame, so one still stands in for it in light and dark mode
 * alike.
 */
import { useEffect, useRef, useState } from "react";

/** How far outside the viewport the poster starts loading, above or below. */
const POSTER_AHEAD = "400px 0px";

export function DemoVideo({ src, poster, label }: { src: string; poster: string; label: string }) {
  const frame = useRef<HTMLDivElement | null>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: POSTER_AHEAD },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={frame}
      className="overflow-hidden rounded-xl border border-gray-200 bg-gray-950 shadow-sm dark:border-gray-800"
    >
      <video
        src={src}
        poster={near ? poster : undefined}
        controls
        preload="none"
        playsInline
        aria-label={label}
        className="block aspect-video h-auto w-full"
      />
    </div>
  );
}
