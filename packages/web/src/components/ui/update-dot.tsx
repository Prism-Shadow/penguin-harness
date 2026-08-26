/**
 * The update notification badge: a small dot hung on the top-right corner of whatever entry
 * leads toward something updatable, the way a phone marks a menu that has news behind it.
 *
 * **Not a status tone, deliberately.** `lib/tone.ts` is the one place a *status* colour is
 * spelled, and each of its five tones is a judgement about a thing's own state — `danger` is
 * failed, destructive or over a limit; `attention` is unfinished work waiting on someone. An
 * available update is neither: nothing has gone wrong and nothing is stuck. What this mark
 * says is "there is something new further down this path", a category `tone.ts` explicitly
 * keeps out of scope. So the badge colour lives here instead, written once, and every dot on
 * an update trail renders through this component rather than spelling a palette class inline.
 *
 * Red, because that is what a notification badge is everywhere else a user has seen one.
 * `red-500` measures, as WCAG 2.x contrast against the four surfaces a dot lands on, 3.76 : 1
 * on white and 3.66 : 1 on the sidebar's gray-50 in light, and 5.58 : 1 on gray-950 (`#000000`
 * here) and 5.16 : 1 on gray-900 (`#0d0d0d` here) in dark — clearing the 3 : 1 WCAG 1.4.11 asks
 * of a graphical object on every one of them. One value across both themes, for the reason
 * `toneDot` keeps one: a dot this small has no interior to read.
 *
 * **The dot never carries the meaning.** It is `aria-hidden`, and the anchor states what is
 * updatable in its own `title` and accessible name ("<anchor> · <what is updatable>"). A
 * decorative dot with no accessible text beside it is the bug this pattern usually ships with.
 *
 * Layout-neutral: absolutely positioned, so a caller only has to be `relative`, and no row
 * changes height for carrying one. `pointer-events-none` keeps it out of its anchor's hit area.
 *
 * Anchoring rule, owner-specified: a dot marks the **top-right corner of its control's full
 * box** — the whole row, tab or button — sitting inside that box, never hung off the label
 * glyphs (a dot that tracks the text's width floats over whatever follows the label and rides
 * above the line box). Chrome anchors are their own box, so their default overhang stands.
 */
import type { ReactNode } from "react";

/**
 * Sizes named by the anchor they sit on, not by a number (the `icon-scale.ts` convention).
 * Note the web root font is 18px, so a Tailwind spacing unit is 1.125× its usual pixel value:
 * `h-2.5` is 11.25px, `h-1.5` is 6.75px.
 */
const DOT_SIZE = {
  /**
   * A filled or boxed chrome anchor — an avatar, a rail icon button, the mobile menu button.
   * The ring is the chrome's own background colour (gray-50 pinned/rail sidebar, gray-900 in
   * dark), which is what separates the dot from the avatar fill or the row's hover fill
   * underneath it; 11.25px outer leaves a 7.25px core.
   */
  chrome: "h-2.5 w-2.5 border-2 border-gray-50 dark:border-gray-900",
  /**
   * A line of text or a bare glyph, where the dot sits directly on the page surface: no ring,
   * because there is nothing underneath to separate it from and a ring would only shrink it.
   */
  inline: "h-1.5 w-1.5",
} as const;

export type UpdateDotSize = keyof typeof DOT_SIZE;

export function UpdateDot({
  size = "chrome",
  position = "-right-0.5 -top-0.5",
}: {
  size?: UpdateDotSize;
  /**
   * Where the dot sits inside its `relative` anchor — Tailwind inset utilities only. The
   * default hangs it just past the anchor's top-right corner; an anchor whose own padding or
   * a clipping ancestor would swallow that (a tab strip's `overflow-y-hidden`) moves it in.
   */
  position?: string;
}) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute rounded-full bg-red-500 ${DOT_SIZE[size]} ${position}`}
    />
  );
}

/**
 * The labeled form of the badge, for the one stop on a trail where a bare dot undersells the
 * state: the Agents list card of an outdated Agent, which is also the control the sidebar's
 * dot leads to. A real button — it performs the same navigation the icon it replaced did —
 * shaped exactly like the `Badge` pills sharing its row (`v<version>`: same radius, padding
 * and 11px semibold type), so the row reads as one family of capsules.
 *
 * Dark red rather than the dot's `red-500`, because unlike the dot this pill has an interior
 * to read: the label needs WCAG 1.4.3's 4.5 : 1 on its own background. Measured: white on
 * red-700 6.42 : 1 in light, red-100 on red-900 8.23 : 1 in dark; both hover fills (red-800)
 * clear 4.5 : 1 with their resting text. The badge colours stay in this module, with the dot's,
 * for the reason the header gives — an update mark is not a `tone.ts` status.
 */
export function UpdatePill({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-red-700 px-2 py-0.5 text-[11px] font-semibold text-white transition-colors duration-150 hover:bg-red-800 dark:bg-red-900 dark:text-red-100 dark:hover:bg-red-800"
    >
      {children}
    </button>
  );
}
