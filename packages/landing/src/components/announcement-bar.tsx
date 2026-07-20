/**
 * Rotating announcement bar above the sticky nav (it scrolls away with the page).
 * Light brand-tinted background; announcements SLIDE horizontally between each
 * other (auto-advance on a timer, paused while hovered) with dot indicators for
 * manual switching — no arrows. Every announcement links to a blog post.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { S } from "../lib/strings";

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
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => setActive((i) => (i + 1) % ITEMS.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [paused]);

  return (
    <div
      role="region"
      aria-label={S.announcement.label}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="border-b border-brand-100 bg-brand-50 dark:border-brand-950 dark:bg-brand-950/50"
    >
      <div className="mx-auto flex h-9 max-w-6xl items-center gap-3 px-4 sm:px-6">
        {/* Sliding track: one full-width slide per announcement. */}
        <div className="min-w-0 flex-1 overflow-hidden">
          <div
            className="flex transition-transform duration-500 ease-out"
            style={{ transform: `translateX(-${active * 100}%)` }}
          >
            {ITEMS.map((item, i) => (
              <div
                key={item.key}
                aria-hidden={i !== active}
                className="flex w-full shrink-0 justify-center"
              >
                <Link
                  to={item.to}
                  tabIndex={i === active ? 0 : -1}
                  className="truncate text-[13px] font-medium text-brand-800 underline-offset-2 hover:underline dark:text-brand-200"
                >
                  {texts[item.key]}
                </Link>
              </div>
            ))}
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          {ITEMS.map((item, i) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setActive(i)}
              aria-label={texts[item.key]}
              aria-current={i === active}
              className={`h-1.5 rounded-full transition-all ${
                i === active
                  ? "w-4 bg-brand-600 dark:bg-brand-300"
                  : "w-1.5 bg-brand-300 hover:bg-brand-400 dark:bg-brand-800 dark:hover:bg-brand-700"
              }`}
            />
          ))}
        </span>
      </div>
    </div>
  );
}
