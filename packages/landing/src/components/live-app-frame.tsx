/**
 * The real Web App, live, in a browser window: one gallery surface framed (lib/live-frame.ts) and
 * scaled to the column. The app is laid out at the gallery's window size and only the picture
 * shrinks, so the page shows the app's own line breaks at every width.
 *
 * - **Lazy.** The frame is created only once the box comes near the viewport, and a quiet
 *   placeholder of the app's outline stands in until the frame reports ready (the gallery marks
 *   its document `data-gallery-ready` once the app is up and its fonts are in).
 * - **A guest.** The frame is embedded, so it takes no focus and hands the wheel to the page until
 *   the reader clicks into it (the gallery's guest-frame.ts).
 * - **Phones and touch.** Below `sm` the frame is the gallery's phone window, which the app lays
 *   out as on a phone; a 1280-wide window scaled to a phone would be unreadable. Without a fine
 *   pointer the frame is a picture only (inert): a finger dragging over a full-width frame would
 *   scroll the app's lists instead of the page. The link in the window bar opens the same surface
 *   in the gallery, full size, for anyone who wants to use it.
 * - **The site's language and mode.** A switch of either points the frame at a new document.
 */
import { useEffect, useRef, useState } from "react";
import type { SyntheticEvent } from "react";
import { S } from "../lib/strings";
import { frameSize, gallerySurfaceUrl, liveFrameSrc } from "../lib/live-frame";
import type { SurfaceId } from "../lib/live-frame";
import { useSiteLocale, useSiteTheme } from "@prismshadow/penguin-ui/site";
import { BrowserFrame } from "./browser-frame";
import { ArrowUpRightIcon } from "./icons";
import { LivePlaybackControl } from "./live-playback-control";

/** A short lead-in loads the app when its window is about to enter view. */
const LOAD_AHEAD = "200px 0px";
/** How long a frame may take to say it is ready before it is shown anyway. */
const READY_FALLBACK_MS = 8000;

/** A media query's live answer; false until mounted. */
function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** The app's outline in flat blocks: the sidebar column and a few lines, no motion. */
function Placeholder({ phone }: { phone: boolean }) {
  const block = "rounded bg-gray-200/70 dark:bg-gray-800";
  return (
    <div className="absolute inset-0 flex bg-gray-50 dark:bg-gray-950" aria-hidden="true">
      {!phone && (
        <div className="flex w-[19%] flex-col gap-3 border-r border-gray-200 p-[2.5%] dark:border-gray-800">
          <div className={`${block} h-[3%] w-2/3`} />
          <div className={`${block} h-[2%] w-1/2`} />
          <div className={`${block} h-[2%] w-3/5`} />
          <div className={`${block} h-[2%] w-1/2`} />
        </div>
      )}
      <div className="flex flex-1 flex-col gap-3 p-[5%]">
        <div className={`${block} h-[4%] w-2/5`} />
        <div className={`${block} h-[2.5%] w-4/5`} />
        <div className={`${block} h-[2.5%] w-3/4`} />
        <div className={`${block} mt-auto h-[14%] w-full`} />
      </div>
    </div>
  );
}

export function LiveAppFrame({
  surface,
  title,
  className = "",
  autoplay,
}: {
  surface: SurfaceId;
  /** What the frame shows, for the frame's accessible name. */
  title: string;
  className?: string;
  autoplay?: "evolution";
}) {
  const { locale } = useSiteLocale();
  const { dark } = useSiteTheme();
  const phone = useMedia("(max-width: 639.98px)");
  const fine = useMedia("(hover: hover) and (pointer: fine)");
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const size = frameSize(phone);
  const src = liveFrameSrc(surface, locale, dark, autoplay);
  const box = useRef<HTMLDivElement | null>(null);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [near, setNear] = useState(false);
  const [width, setWidth] = useState(0);
  const [readySrc, setReadySrc] = useState<string | null>(null);
  const settle = useRef<() => void>(() => undefined);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const resize = new ResizeObserver(() => setWidth(el.clientWidth));
    resize.observe(el);
    setWidth(el.clientWidth);
    if (!("IntersectionObserver" in window)) {
      setNear(true);
      return () => resize.disconnect();
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: LOAD_AHEAD },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      resize.disconnect();
    };
  }, []);

  // A frame left behind (a new language or mode, or the page going away) stops waiting.
  useEffect(() => () => settle.current(), [src]);

  const onLoad = (event: SyntheticEvent<HTMLIFrameElement>) => {
    const loaded = event.currentTarget.getAttribute("src");
    const done = () => {
      settle.current();
      if (loaded !== null) setReadySrc(loaded);
    };
    let root: HTMLElement | null = null;
    try {
      root = event.currentTarget.contentDocument?.documentElement ?? null;
    } catch {
      // A gallery of another origin: its load is all this page can see.
    }
    if (root === null || root.dataset.galleryReady) {
      done();
      return;
    }
    const watched = root;
    const observer = new MutationObserver(() => {
      if (watched.dataset.galleryReady) done();
    });
    observer.observe(watched, { attributes: true, attributeFilter: ["data-gallery-ready"] });
    const timer = window.setTimeout(done, READY_FALLBACK_MS);
    settle.current = () => {
      observer.disconnect();
      window.clearTimeout(timer);
      settle.current = () => undefined;
    };
  };

  const ready = readySrc === src;
  const scale = width > 0 ? width / size.width : 0;
  const open = gallerySurfaceUrl(surface, locale, dark, phone);

  return (
    <BrowserFrame
      className={className}
      aside={
        <div className="flex shrink-0 items-center gap-2">
          <a
            href={open}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-gray-500 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
          >
            {S.live.open}
            <ArrowUpRightIcon className="h-3 w-3" />
          </a>
          {autoplay && !reduced && <LivePlaybackControl key={src} frame={frame} src={src} />}
        </div>
      }
    >
      <div
        ref={box}
        className="relative w-full overflow-hidden"
        style={{ aspectRatio: `${size.width} / ${size.height}` }}
      >
        {!ready && <Placeholder phone={phone} />}
        {!ready && <span className="sr-only">{S.live.loading}</span>}
        {near && scale > 0 && (
          <iframe
            ref={frame}
            key={src}
            src={src}
            title={title}
            width={size.width}
            height={size.height}
            onLoad={onLoad}
            inert={!fine}
            tabIndex={fine ? undefined : -1}
            className={`absolute top-0 left-0 origin-top-left border-0 transition-opacity duration-300 ${ready ? "opacity-100" : "opacity-0"} ${fine ? "" : "pointer-events-none"}`}
            style={{ transform: `scale(${scale})` }}
          />
        )}
      </div>
    </BrowserFrame>
  );
}
