/**
 * The update notification badge: a small dot hung on the top-right corner of whatever entry leads
 * toward something updatable, the way a phone marks a menu that has news behind it.
 *
 * **Not a status tone, deliberately.** A tone is a judgement about a thing's own state — `danger`
 * is failed, destructive or over a limit; `attention` is unfinished work waiting on someone. An
 * available update is neither: nothing has gone wrong and nothing is stuck. What this mark says
 * is "there is something new further down this path", so its colour is a token of its own,
 * `--ui-mark-new`, which each theme sets: a notification red in Primer (the pale red-400, so the
 * mark reads as news rather than as an alarm), the theme's own news hue elsewhere. The carve-out
 * is about the MARK: a block one of these dots sits inside (a to-do notice) is an ordinary
 * attention notice, which a tone does own.
 *
 * **The dot never carries the meaning.** It is `aria-hidden`, and its anchor states what is
 * updatable in its own tooltip and accessible name ("<anchor> · <what is updatable>"). That is
 * also why the mark has no contrast floor: nothing reaches the reader through the dot alone, so
 * a theme may pick a hue pale enough to read as news.
 *
 * Layout-neutral: absolutely positioned, so a caller only has to be `relative`, and no row
 * changes height for carrying one. `pointer-events-none` keeps it out of its anchor's hit area.
 *
 * Anchoring: a dot marks its control's **full box** — the whole row, tab or button — never the
 * label glyphs, where it would track the text's width and float over whatever follows the word.
 * A full-width row hangs the dot at the right edge, vertically centred (`right-2.5 top-1/2
 * -translate-y-1/2`, the inset matching the row's own padding). A button or a tab takes the
 * top-right corner, straddling the border where that corner is visible and pulled inside the
 * padding where an ancestor clips it (a tab strip's `overflow-y-hidden`). Chrome anchors are their
 * own box, so the default overhang stands.
 */
import type { ReactNode } from "react";

/** Sizes named by the anchor they sit on, not by a number (the icon-scale convention). */
const DOT_SIZE = {
  /**
   * A filled or boxed chrome anchor — an avatar, a rail icon button, the mobile menu button. The
   * ring is the sidebar's fill, which is what separates the dot from the avatar or the row's
   * hover fill underneath it.
   */
  chrome: "h-2.5 w-2.5 border-2 border-surface-muted",
  /**
   * A line of text or a bare glyph, where the dot sits directly on the page surface: no ring,
   * because there is nothing underneath to separate it from and a ring would only shrink it.
   */
  inline: "h-1.5 w-1.5",
} as const;

export type UpdateDotSize = keyof typeof DOT_SIZE;

/**
 * The dot's fill and inline size without the positioning — for the one mark on an update trail
 * that sits in normal flow rather than over an anchor (a to-do notice). Exported so the fill stays
 * written once, here.
 */
export const UPDATE_DOT_INLINE = `rounded-full bg-mark-new ${DOT_SIZE.inline}`;

export function UpdateDot({
  size = "chrome",
  position = "-right-0.5 -top-0.5",
}: {
  size?: UpdateDotSize;
  /**
   * Where the dot sits inside its `relative` anchor — inset utilities, plus a `translate-*` where
   * the dot is centred on an edge or straddles a corner instead of being inset from one. The
   * default hangs it just past the anchor's top-right corner; an anchor whose own padding or a
   * clipping ancestor would swallow that moves it in.
   */
  position?: string;
}) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute rounded-full bg-mark-new ${DOT_SIZE[size]} ${position}`}
    />
  );
}

/**
 * The labelled form of the badge, for a stop on a trail where a bare dot undersells the state:
 * the card of an outdated agent, which is also where the sidebar's dot leads, and the card of a
 * machine on another build. A real button — it opens the place the update is taken from — shaped
 * like the `Badge` capsules sharing its row (same radius, padding and type), so the row reads as
 * one family.
 *
 * A tinted capsule, not the dot's flat fill: this one has an interior, so its label owes 4.5:1
 * against its own background, which every tone's tint and ink are held to in every theme. The
 * attention tone paints it: being behind is unfinished work waiting on someone, not a failure,
 * and red stays for what failed or destroys. The words on it, not the colour, say what is new.
 * Hover deepens the tint toward the ink.
 */
export function UpdatePill({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex shrink-0 items-center whitespace-nowrap rounded-[var(--ui-radius-pill)] bg-tone-attention-bg p-[var(--ui-badge-pad-md)] text-[length:var(--ui-badge-size)] leading-[var(--ui-badge-lh)] font-[number:var(--ui-badge-weight)] text-tone-attention-fg ring-[length:var(--ui-badge-soft-ring)] ring-inset ring-tone-attention-line transition-colors duration-150 hover:bg-[color-mix(in_oklab,var(--ui-tone-attention-bg),var(--ui-tone-attention-fg)_12%)]"
    >
      {children}
    </button>
  );
}
