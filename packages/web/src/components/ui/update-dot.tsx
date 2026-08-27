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
 * The carve-out is about the MARK. The block one of these dots sits inside on a page
 * (`todo-notice.tsx`) is an ordinary `toneStrip.attention` notice: a bordered strip with a
 * ground of its own is a shape `tone.ts` does own, and what it says there — unfinished, waiting
 * on the user — is one of its five meanings.
 *
 * Red, because that is what a notification badge is everywhere else a user has seen one, and
 * `red-400`, the pale rung, so the mark reads as news rather than as an alarm. WCAG 2.x contrast
 * against the six surfaces a dot lands on — in light, 2.89 : 1 on white, 2.76 : 1 on the
 * sidebar's gray-50 and 2.46 : 1 on a nav row's active/hover fill (gray-200/70 over gray-50); in
 * dark, 7.27 : 1 on gray-950 (`#000000` here), 6.73 : 1 on gray-900 (`#0d0d0d` here) and
 * 5.71 : 1 on gray-800. Dark clears on all three the 3 : 1 WCAG 1.4.11 asks of a graphical
 * object; light misses on all three, by 4% to 18%, knowingly. 1.4.11 scopes to a graphical
 * object *required* to understand the content, and this one never is: it is `aria-hidden`, and
 * its anchor states what is updatable in its own `title` and accessible name, so no information
 * reaches the user through the mark alone. Light is what binds: red-500 is the palest rung on
 * Tailwind's red ramp that clears 3 : 1 on all three light surfaces (3.81 / 3.64 / 3.25 : 1), so
 * the pale end of the ramp and the threshold do not overlap. One value across both themes, for
 * the reason `toneDot` keeps one: a dot this small has no interior to read.
 *
 * **The dot never carries the meaning.** It is `aria-hidden`, and the anchor states what is
 * updatable in its own `title` and accessible name ("<anchor> · <what is updatable>"). A
 * decorative dot with no accessible text beside it is the bug this pattern usually ships with.
 *
 * Layout-neutral: absolutely positioned, so a caller only has to be `relative`, and no row
 * changes height for carrying one. `pointer-events-none` keeps it out of its anchor's hit area.
 *
 * Anchoring rule, owner-specified: a dot marks its control's **full box** — the whole row, tab or
 * button — never the label glyphs, where it would track the text's width, float over whatever
 * follows the word and ride above the line box. Two shapes of box, two placements. A full-width
 * row hangs the dot at the right edge, vertically centred (`right-2.5 top-1/2 -translate-y-1/2`,
 * the inset matching the row's own horizontal padding): a row has an end to align to and no
 * corner a reader's eye goes to. A button or a tab takes the top-right corner, straddling the
 * border where that corner is visible and pulled inside the padding where an ancestor clips it
 * (the tab strip's `overflow-y-hidden`). Chrome anchors are their own box, so their default
 * overhang stands.
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

/**
 * The dot's fill and inline size without the positioning — for the one mark on an update trail
 * that sits in normal flow rather than over an anchor (`todo-notice.tsx`). Exported so the red
 * stays written once, here, for the reason the header gives.
 */
export const UPDATE_DOT_INLINE = `rounded-full bg-red-400 ${DOT_SIZE.inline}`;

export function UpdateDot({
  size = "chrome",
  position = "-right-0.5 -top-0.5",
}: {
  size?: UpdateDotSize;
  /**
   * Where the dot sits inside its `relative` anchor — Tailwind inset utilities, plus a
   * `translate-*` where the dot is centred on an edge or straddles a corner instead of being
   * inset from one. The default hangs it just past the anchor's top-right corner; an anchor
   * whose own padding or a clipping ancestor would swallow that (a tab strip's
   * `overflow-y-hidden`) moves it in.
   */
  position?: string;
}) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute rounded-full bg-red-400 ${DOT_SIZE[size]} ${position}`}
    />
  );
}

/**
 * The labeled form of the badge, for the one stop on a trail where a bare dot undersells the
 * state: the Agents list card of an outdated Agent, which is also the control the sidebar's
 * dot leads to. A real button — it opens the Agent settings overview the trail ends on —
 * shaped exactly like the `Badge` pills sharing its row (`v<version>`: same radius, padding
 * and 11px semibold type), so the row reads as one family of capsules.
 *
 * A tinted capsule, not the dot's flat fill: this one has an interior, so its label owes WCAG
 * 1.4.3's 4.5 : 1 against its own background, and a surface pale enough to belong beside the
 * dots can only pay that with a dark ink.
 *
 * **How pale is set by the capsule beside it, not by taste.** The fill is measured against the
 * card it sits on — white in light, gray-900 (`#0d0d0d` here) in dark — and aimed at the plain
 * gray `Badge` sharing the row, which shows at 1.10 : 1 in light and 1.18 : 1 in dark. red-50
 * lands at 1.09 : 1 and red-950/70 at 1.11 : 1, so the capsule now reads as red without
 * reading as an alarm; the earlier red-100 / red-950 pair sat a fifth louder than its
 * neighbour, which is what made it shout. The ink is unchanged and keeps a wide margin:
 * red-800 on red-50 7.67 : 1 (hover red-100 6.86 : 1) in light, red-300 on red-950/70
 * 9.13 : 1 (hover red-950 8.40 : 1) in dark. Tint against card rather than ink against card is
 * what the neighbouring gray `Badge` also runs on: the capsule is found by its text.
 * The badge colours stay in this module, with the dot's, for the reason the header gives — an
 * update mark is not a `tone.ts` status.
 */
export function UpdatePill({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-800 transition-colors duration-150 hover:bg-red-100 dark:bg-red-950/70 dark:text-red-300 dark:hover:bg-red-950"
    >
      {children}
    </button>
  );
}
