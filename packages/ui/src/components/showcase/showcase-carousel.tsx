/**
 * The selected carousel: the head of a showcase. One slide at a time is the header post — its
 * cover large, beside it its name, its one line, a short description and its actions — and under
 * it a rail of every slide's thumbnail, the one on show marked.
 *
 * It moves on by itself every `intervalMs`, and stops whenever the reader would lose their
 * place: while the pointer is over it, while its tab is in the background, once keyboard focus
 * enters it or a thumbnail is picked (until the play button is pressed again), and it never
 * starts by itself under reduced motion. The previous and next buttons only move it. The play /
 * pause button is always there, so rotation is the reader's to stop (WCAG 2.2.2). The slide
 * region is live only while the carousel is stopped, so a screen reader is told about a slide
 * the reader asked for and not about every turn.
 *
 * Nothing but the slide's own content changes when it turns: the text block holds fixed line
 * counts, so a long description and a short one take the same room, and the rail, the controls
 * and everything under the carousel stay where they were.
 *
 * Which slide leads is the host's (`start`, see carousel-rotation.ts `leadIndex`). Every word
 * is the caller's; the look is showcase.css, and the carousel is a `ui-showcase` host (hooks.ts).
 */
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { ICON_SIZE } from "../../icon-scale";
import { usePrefersReducedMotion } from "../../motion/use-reduced-motion";
import { ICONS } from "../icons/icons";
import { rotates, stepIndex } from "./carousel-rotation";

export interface ShowcaseSlide {
  key: string;
  /** The slide's cover at its full rendition. */
  cover: ReactNode;
  /** The same cover at its thumbnail rendition, for the rail. */
  thumb: ReactNode;
  /** The subject's own mark beside its name (an icon tile). */
  lead?: ReactNode;
  title: string;
  /** One line under the name. */
  tagline: string;
  /** Up to three lines more. */
  description?: string;
  /** The slide's actions: the host's buttons or links. */
  actions?: ReactNode;
  /** Where the subject's detail is, when it is a page. */
  href?: string;
  /** Opens the detail (the cover's press). */
  onOpen?: (event: MouseEvent<HTMLElement>) => void;
}

export interface ShowcaseCarouselLabels {
  previous: string;
  next: string;
  pause: string;
  play: string;
  /** "2 of 5": the slide's place, for its accessible name. */
  position: (index: number, count: number) => string;
}

export interface ShowcaseCarouselProps {
  slides: readonly ShowcaseSlide[];
  /** The carousel's accessible name ("Selected plugins"). */
  label: string;
  /** The small line over the name ("Selected"). */
  eyebrow?: string;
  labels: ShowcaseCarouselLabels;
  /** How long a slide stays, in ms. */
  intervalMs?: number;
  /** The slide that leads. */
  start?: number;
  className?: string;
}

/**
 * A control's mark: a registry path as its line drawing alone, on the 24 grid at the line
 * family's weight, at the rung of a glyph alone in an icon button. The public sites do not load
 * the icon sets, so the carousel draws the line set in every theme (as the sites' menu check
 * does).
 */
function Mark({ d, filled = false }: { d: string; filled?: boolean }) {
  return (
    <svg
      width={ICON_SIZE.iconButton}
      height={ICON_SIZE.iconButton}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

export function ShowcaseCarousel({
  slides,
  label,
  eyebrow,
  labels,
  intervalMs = 7000,
  start = 0,
  className = "",
}: ShowcaseCarouselProps) {
  const count = slides.length;
  const reduced = usePrefersReducedMotion();
  const [index, setIndex] = useState(() => Math.min(Math.max(start, 0), Math.max(count - 1, 0)));
  const [playing, setPlaying] = useState(!reduced);
  const [hovered, setHovered] = useState(false);
  const [hidden, setHidden] = useState(
    () => typeof document !== "undefined" && document.visibilityState === "hidden",
  );
  const railRef = useRef<HTMLDivElement>(null);
  const at = Math.min(index, Math.max(count - 1, 0));
  const running = rotates({ count, playing, hovered, hidden });

  useEffect(() => {
    if (reduced) setPlaying(false);
  }, [reduced]);

  useEffect(() => {
    const onVisibility = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // One timer per stay: a slide that was paused over starts its stay again.
  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => setIndex((i) => stepIndex(i, count, 1)), intervalMs);
    return () => clearTimeout(timer);
  }, [running, at, count, intervalMs]);

  // The rail follows the slide on show by the least it has to, sideways only: a thumbnail
  // already in view is left where it is, and the page itself is never scrolled.
  useEffect(() => {
    const rail = railRef.current;
    const item = rail?.children[at] as HTMLElement | undefined;
    if (rail == null || item === undefined) return;
    const start = item.offsetLeft;
    const end = start + item.clientWidth - rail.clientWidth;
    const left = rail.scrollLeft > start ? start : rail.scrollLeft < end ? end : null;
    if (left !== null) rail.scrollTo({ left, behavior: reduced ? "auto" : "smooth" });
  }, [at, reduced]);

  if (count === 0) return null;
  const slide = slides[at]!;
  const pick = (i: number) => {
    setIndex(i);
    setPlaying(false);
  };
  const cover =
    slide.href !== undefined ? (
      <a
        href={slide.href}
        onClick={slide.onOpen}
        aria-label={slide.title}
        className="showcase-hero-cover"
      >
        {slide.cover}
      </a>
    ) : (
      <button
        type="button"
        onClick={slide.onOpen}
        aria-label={slide.title}
        className="showcase-hero-cover"
      >
        {slide.cover}
      </button>
    );

  return (
    <section
      className={`showcase showcase-carousel ui-showcase ${className}`}
      data-part="carousel"
      aria-roledescription="carousel"
      aria-label={label}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      // Keyboard focus coming in stops the rotation until the reader starts it again.
      onFocusCapture={(e) => {
        if ((e.target as HTMLElement).matches(":focus-visible")) setPlaying(false);
      }}
    >
      <div
        className="showcase-hero"
        role="group"
        aria-roledescription="slide"
        aria-label={`${labels.position(at + 1, count)}: ${slide.title}`}
        aria-live={running ? "off" : "polite"}
      >
        <div key={slide.key} className="showcase-hero-media showcase-turn">
          {cover}
        </div>
        <div key={`${slide.key}:text`} className="showcase-hero-text showcase-turn">
          {eyebrow !== undefined && <p className="showcase-eyebrow">{eyebrow}</p>}
          <div className="showcase-hero-heading">
            {slide.lead}
            <h2 className="showcase-hero-title">{slide.title}</h2>
          </div>
          <p className="showcase-hero-tagline">{slide.tagline}</p>
          <p className="showcase-hero-desc">{slide.description ?? ""}</p>
          {slide.actions !== undefined && (
            <div className="showcase-hero-actions">{slide.actions}</div>
          )}
        </div>
      </div>
      {count > 1 && (
        <div className="showcase-rail-row">
          <div ref={railRef} className="showcase-rail">
            {slides.map((s, i) => (
              <button
                key={s.key}
                type="button"
                className="showcase-rail-item"
                aria-label={s.title}
                aria-current={i === at ? "true" : undefined}
                onClick={() => pick(i)}
              >
                {s.thumb}
                <span className="showcase-rail-title">{s.title}</span>
                <span className="showcase-rail-track" aria-hidden>
                  {i === at && (
                    <span
                      // A new stay draws its bar from the start.
                      key={`${at}:${running ? "run" : "rest"}`}
                      className="showcase-rail-bar"
                      data-running={running ? "true" : undefined}
                      style={{ animationDuration: `${intervalMs}ms` }}
                    />
                  )}
                </span>
              </button>
            ))}
          </div>
          <div className="showcase-controls">
            <button
              type="button"
              className="showcase-control"
              aria-label={labels.previous}
              title={labels.previous}
              onClick={() => setIndex(stepIndex(at, count, -1))}
            >
              <Mark d={ICONS.chevronLeft} />
            </button>
            <button
              type="button"
              className="showcase-control"
              aria-label={playing ? labels.pause : labels.play}
              title={playing ? labels.pause : labels.play}
              aria-pressed={!playing}
              onClick={() => setPlaying((p) => !p)}
            >
              {playing ? <Mark d={ICONS.pause} /> : <Mark d={ICONS.play} filled />}
            </button>
            <button
              type="button"
              className="showcase-control"
              aria-label={labels.next}
              title={labels.next}
              onClick={() => setIndex(stepIndex(at, count, 1))}
            >
              <Mark d={ICONS.chevronRight} />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
