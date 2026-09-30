/**
 * The floating launcher: a round, translucent ball floating over the conversation, with a short
 * caption hanging under it, and the fan of round entries it opens onto an arc around itself.
 *
 * The ball is quiet at rest (translucent, a little faded) and clear while it is pointed at,
 * focused, open or dragged. The caption is the one name on screen: it reads out whatever is
 * pointed at, so the entries are glyphs alone and nothing carries a tooltip. It is the visible
 * readout only — every button carries its own accessible name — so it is hidden from assistive
 * technology and never folded into the ball's name.
 *
 * Every entry's box sits on the ball's centre; its place on the arc is its own `x` / `y` offset,
 * carried as `--fan-x` / `--fan-y` into the resting transform and the entrance's end state, so
 * with the animation dropped (reduced motion) an entry still stands on the arc. The entrance runs
 * down the arc from the top with a short stagger; the fold runs all at once.
 *
 * What the launcher is for, where it sits, how it drags and springs, and what an entry opens are
 * the caller's: these draw the ball and the fan from what they are given.
 */
import type { ButtonHTMLAttributes, CSSProperties, ReactNode, Ref } from "react";
import { Dot } from "../../icons/dot/dot";

/** Gap between the ball and its caption (px); the pill takes the rest of the caption height. */
const CAPTION_GAP = 4;
/**
 * Delay between one entry's entrance and the next, the topmost entry first (ms). Short enough
 * that the ring arrives as one shape rather than as a trickle of circles.
 */
const FAN_STAGGER_MS = 16;

export interface LauncherBallProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "aria-label"
> {
  /** The ball's diameter (px). */
  size: number;
  /** The height reserved under the ball for the caption, the gap included (px). */
  captionHeight: number;
  /** The ball's face: the resting mark, or the mark of what is pointed at. */
  glyph: ReactNode;
  /** The readout under the ball. */
  caption: string;
  /** The ball's accessible name. */
  label: string;
  /** Clear rather than quiet: the fan is open, or the ball is being dragged. */
  lit: boolean;
  dragging: boolean;
  /** An attention dot on the ball (a pending approval); the caller folds it into `label`. */
  badge?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
}

export function LauncherBall({
  size,
  captionHeight,
  glyph,
  caption,
  label,
  lit,
  dragging,
  badge = false,
  buttonRef,
  className = "",
  style,
  ...rest
}: LauncherBallProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      {...rest}
      aria-label={label}
      data-testid="dock-launcher-ball"
      style={{ ...style, width: size, height: size }}
      className={`ui-glass anim-pop relative flex touch-none select-none items-center justify-center rounded-full border border-line/80 text-fg-muted shadow-sm backdrop-blur-md transition-[background-color,color,opacity,box-shadow] duration-150 hover:bg-surface/95 hover:text-fg hover:opacity-100 hover:shadow-lg focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        lit ? "bg-surface/95 text-fg opacity-100" : "bg-surface/75 opacity-80"
      } ${dragging ? "cursor-grabbing" : "cursor-pointer"} ${className}`}
    >
      {glyph}
      {/* A small pill on the same glass, with no ink of its own, so it follows the ball's resting
          and clear ink. 13px in every theme: the caption belongs to the ball's fixed geometry,
          not to the text around it, and the code rung is the contract's 13px. Its height is the
          caller's reserved one, so the caption and the room kept for it cannot drift apart. */}
      <span
        aria-hidden
        className="ui-glass pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-line/80 bg-surface/85 px-2 py-0.5 text-[length:var(--ui-text-code-size)] font-medium leading-5 shadow-sm backdrop-blur-md transition-colors duration-150"
        style={{ top: size + CAPTION_GAP, height: captionHeight - CAPTION_GAP }}
      >
        {caption}
      </span>
      {badge && (
        // The ring is the page's fill, cutting the dot out of the ball's edge.
        <span
          aria-hidden
          className="absolute right-0.5 top-0.5 flex rounded-full ring-2 ring-canvas"
        >
          <Dot tone="attention" size="md" />
        </span>
      )}
    </button>
  );
}

export interface LauncherFanEntry {
  key: string;
  /** The entry's accessible name; the caption reads it out while the entry is pointed at. */
  label: string;
  glyph: ReactNode;
  /** An attention dot on the entry. */
  badge?: boolean;
  testId?: string;
  /** The entry's centre as an offset from the ball's centre (px). */
  x: number;
  y: number;
  onChoose: () => void;
}

export interface LauncherFanProps {
  /** In arc order, top to bottom: the DOM order is the visual order. */
  entries: readonly LauncherFanEntry[];
  /** "closing" plays the fold; the owner unmounts the fan once it has run. */
  phase: "open" | "closing";
  /** An entry's diameter (px). */
  entrySize: number;
  /** The group's accessible name. */
  label: string;
  /** The pointer or focus arrived on an entry. */
  onPoint: (key: string) => void;
  /** The pointer or focus left an entry. */
  onLeave: (key: string) => void;
  /** The group's node: a caller walking the entries with the arrow keys reads them from it. */
  fanRef?: Ref<HTMLDivElement>;
}

/**
 * The arc of entries, on a zero-size anchor at the ball's centre: the entries are placed by their
 * own transforms, so nothing here may size or clip the arc.
 */
export function LauncherFan({
  entries,
  phase,
  entrySize,
  label,
  onPoint,
  onLeave,
  fanRef,
}: LauncherFanProps) {
  return (
    <div
      ref={fanRef}
      role="group"
      aria-label={label}
      data-testid="dock-launcher-fan"
      className="absolute left-1/2 top-1/2 h-0 w-0"
    >
      {entries.map((entry, index) => (
        <button
          key={entry.key}
          type="button"
          data-testid={entry.testId}
          aria-label={entry.label}
          onClick={entry.onChoose}
          onMouseEnter={() => onPoint(entry.key)}
          onMouseLeave={() => onLeave(entry.key)}
          onFocus={() => onPoint(entry.key)}
          onBlur={() => onLeave(entry.key)}
          className={`ui-glass absolute flex items-center justify-center rounded-full border border-line/80 bg-surface/90 text-fg-muted shadow-sm backdrop-blur-md transition-colors duration-150 hover:bg-surface hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            phase === "closing" ? "launcher-fan-out" : "launcher-fan-in"
          }`}
          style={
            {
              width: entrySize,
              height: entrySize,
              left: -entrySize / 2,
              top: -entrySize / 2,
              transform: "translate(var(--fan-x), var(--fan-y))",
              animationDelay: phase === "closing" ? "0ms" : `${index * FAN_STAGGER_MS}ms`,
              "--fan-x": `${entry.x.toFixed(1)}px`,
              "--fan-y": `${entry.y.toFixed(1)}px`,
            } as CSSProperties
          }
        >
          {entry.glyph}
          {entry.badge === true && (
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 flex rounded-full ring-2 ring-canvas"
            >
              <Dot tone="attention" size="sm" />
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
