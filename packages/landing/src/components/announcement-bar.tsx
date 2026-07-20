/**
 * Rotating announcement bar above the sticky nav (it scrolls away with the page).
 * Auto-advances on a timer (paused while hovered), with prev/next chevrons for
 * manual switching; each announcement is one full-width link. Internal targets go
 * through the router, the docs SPA is a plain anchor.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { S } from "../lib/strings";
import { DOCS_URL } from "../lib/links";
import { ArrowRightIcon, ChevronLeftIcon, ChevronRightIcon } from "./icons";

const ROTATE_MS = 6000;

/** The fireworks-credits campaign post (content/blog/fireworks-credits-amd.*.md). */
const FIREWORKS_POST_PATH = "/blog/fireworks-credits-amd";

export function AnnouncementBar() {
  const items = [
    { key: "models", text: S.announcement.models, href: `${DOCS_URL}models` },
    { key: "fireworks", text: S.announcement.fireworks, to: FIREWORKS_POST_PATH },
  ];
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => setActive((i) => (i + 1) % items.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [paused, items.length]);

  const item = items[active]!;
  const linkCls =
    "anim-fade inline-flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-white hover:underline underline-offset-2";
  const chevronCls =
    "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white/70 transition-colors hover:bg-white/15 hover:text-white";
  const content = (
    <>
      <span className="truncate">{item.text}</span>
      <ArrowRightIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    </>
  );

  return (
    <div
      role="region"
      aria-label={S.announcement.label}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="bg-brand-600 dark:bg-brand-500/20"
    >
      <div className="mx-auto flex h-9 max-w-6xl items-center justify-center gap-2 px-4 sm:px-6">
        <button
          type="button"
          onClick={() => setActive((i) => (i + items.length - 1) % items.length)}
          aria-label={S.announcement.prev}
          className={chevronCls}
        >
          <ChevronLeftIcon className="h-3.5 w-3.5" />
        </button>
        {"to" in item && item.to ? (
          <Link key={item.key} to={item.to} className={linkCls}>
            {content}
          </Link>
        ) : (
          <a key={item.key} href={item.href} className={linkCls}>
            {content}
          </a>
        )}
        <button
          type="button"
          onClick={() => setActive((i) => (i + 1) % items.length)}
          aria-label={S.announcement.next}
          className={chevronCls}
        >
          <ChevronRightIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
