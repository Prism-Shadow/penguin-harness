/**
 * Rotating announcement bar above the sticky nav (it scrolls away with the page).
 * Light brand-tinted background; announcements auto-advance by SLIDING in one
 * direction only (a clone of the first slide follows the last one, and the track
 * snaps back without animation once the clone is fully in view). No manual
 * switch controls; hovering pauses the rotation. Every announcement is a link
 * into the blog, with a small arrow marking it as click-through.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { S } from "../lib/strings";
import { ArrowRightIcon } from "./icons";

const ROTATE_MS = 6000;

/** Both announcements point at blog posts (content/blog/<slug>.*.md). */
const ITEMS = [
  { key: "models", to: "/blog/introducing-penguinharness" },
  { key: "fireworks", to: "/blog/fireworks-credits-amd" },
] as const;

export function AnnouncementBar() {
  const texts: Record<(typeof ITEMS)[number]["key"], string> = {
    models: S.announcement.models,
    fireworks: S.announcement.fireworks,
  };
  // pos runs 0..ITEMS.length where ITEMS.length is the clone of slide 0.
  const [pos, setPos] = useState(0);
  const [animate, setAnimate] = useState(true);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => setPos((p) => (p >= ITEMS.length ? p : p + 1)), ROTATE_MS);
    return () => clearInterval(timer);
  }, [paused]);

  // After snapping back to the real first slide, re-enable the transition on the
  // next frame pair so the jump itself never animates.
  useEffect(() => {
    if (animate) return;
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setAnimate(true)));
    return () => cancelAnimationFrame(raf);
  }, [animate]);

  const slides = [...ITEMS, ITEMS[0]!];

  return (
    <div
      role="region"
      aria-label={S.announcement.label}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="border-b border-brand-100 bg-brand-50 dark:border-brand-950 dark:bg-brand-950/50"
    >
      <div className="mx-auto h-9 max-w-6xl overflow-hidden px-4 sm:px-6">
        <div
          className={`flex h-full ${animate ? "transition-transform duration-500 ease-out" : ""}`}
          style={{ transform: `translateX(-${pos * 100}%)` }}
          onTransitionEnd={(e) => {
            if (e.target !== e.currentTarget || e.propertyName !== "transform") return;
            if (pos === ITEMS.length) {
              setAnimate(false);
              setPos(0);
            }
          }}
        >
          {slides.map((item, i) => (
            <div
              key={`${item.key}-${i}`}
              aria-hidden={i !== pos}
              className="flex w-full shrink-0 items-center justify-center"
            >
              <Link
                to={item.to}
                tabIndex={i === pos ? 0 : -1}
                className="inline-flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-brand-800 underline-offset-2 hover:underline dark:text-brand-200"
              >
                <span className="truncate">{texts[item.key]}</span>
                <ArrowRightIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              </Link>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
