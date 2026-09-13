/**
 * Semantic status tones: the one place a status colour is spelled out.
 *
 * Every status mark in the app — glyph inks, badge and strip surfaces, the small state dots —
 * picks a tone by meaning and never writes a palette class of its own. A tone says what the
 * mark *means*, not which state it belongs to, so two different states legitimately share one
 * tone and are told apart by shape and motion instead (the chat stream's spinning ring and the
 * session list's turning hourglass are both live work; one spins, one turns over).
 *
 * | tone        | meaning                                                     |
 * | ----------- | ----------------------------------------------------------- |
 * | `busy`      | executing right now                                          |
 * | `attention` | unfinished — waiting on time, on a queue, or on the user     |
 * | `success`   | finished well, healthy                                       |
 * | `link`      | a live connection held right now — in contact, not a verdict |
 * | `danger`    | failed, destructive, over a limit                            |
 * | `muted`     | settled; the mark should recede                              |
 *
 * What does NOT belong here: categorical palettes, where colour is an identity rather than a
 * judgement — the chart series in `category-colors.ts`, the token buckets in `token-colors.ts`,
 * the timeline phase bars, the per-skill avatar tints, the terminal theme. Those must stay free
 * to grow a new hue without it reading as a new severity. Secondary body text
 * (`text-gray-500 dark:text-gray-400`) is typography, not a status tone, and stays inline too.
 */

/**
 * The ink pairs, written once each. `busy` and `success` deliberately resolve to the same
 * emerald: the app has never distinguished them by colour, and giving them separate hues would
 * invent a difference the user is not being asked to read.
 */
const INK = {
  emerald: "text-emerald-600 dark:text-emerald-400",
  blue: "text-blue-600 dark:text-blue-400",
  amber: "text-amber-600 dark:text-amber-400",
  red: "text-red-600 dark:text-red-400",
  gray: "text-gray-400 dark:text-gray-500",
} as const;

export type Tone = "busy" | "attention" | "success" | "link" | "danger" | "muted";

/**
 * Ink for a glyph or a line of status text. Measured as WCAG 2.x contrast ratios against the
 * four surfaces these marks actually sit on — white and gray-50 in light (chat surfaces and the
 * sidebar), and the neutral scale this app overrides in `styles.css` for dark: gray-950 `#000000`
 * and gray-900 `#0d0d0d`. The lower number of each pair is the sidebar, which is the worse case
 * in both themes:
 *
 * - `busy` / `success`  emerald-600 / emerald-400 …… 3.65–3.50 : 1 light, 10.83–10.03 : 1 dark
 * - `link`              blue-600 / blue-400 …………… 5.17–4.95 : 1 light, 8.26–7.69 : 1 dark
 * - `attention`         amber-600 / amber-400 ……… 3.20–3.06 : 1 light, 12.19–11.28 : 1 dark
 * - `danger`            red-600 / red-400 …………… 4.77–4.56 : 1 light, 7.27–6.73 : 1 dark
 * - `muted`             gray-400 / gray-500 ……… 2.60–2.49 : 1 light, 4.34–4.02 : 1 dark
 *
 * The first four clear the 3:1 that WCAG 1.4.11 asks of a graphical object in both themes.
 * `muted` does not, and is the one tone that may only mark a state already spelled out in
 * adjacent text or in the mark's own accessible name — receding is its entire job.
 */
export const toneInk: Record<Tone, string> = {
  busy: INK.emerald,
  attention: INK.amber,
  success: INK.emerald,
  link: INK.blue,
  danger: INK.red,
  muted: INK.gray,
};

const SURFACE = {
  emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  blue: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  red: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  gray: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
} as const;

/** Tinted background plus its own readable text: badges, pills, and the soft notice strips. */
export const toneSurface: Record<Tone, string> = {
  busy: SURFACE.emerald,
  attention: SURFACE.amber,
  success: SURFACE.emerald,
  link: SURFACE.blue,
  danger: SURFACE.red,
  muted: SURFACE.gray,
};

/**
 * Fill for the 6px state dots. One value across both themes on purpose: a solid dot this small
 * has no interior to read, so it needs a mid-scale hue that stays vivid on a white and on a
 * black surface rather than an ink pair tuned for stroke weight. Each dot is accompanied by a
 * label or folded into its row's accessible name, so the fill is never the only carrier.
 */
export const toneDot: Record<Tone, string> = {
  busy: "bg-emerald-500",
  attention: "bg-amber-500",
  success: "bg-emerald-500",
  link: "bg-blue-500",
  danger: "bg-red-500",
  muted: "bg-gray-400 dark:bg-gray-600",
};

/**
 * Border plus tinted background for the bordered notice strips (the degraded-mode banner, the
 * missing-placeholder alerts): a heavier treatment than `toneSurface`, for a notice that owns a
 * whole row rather than sitting inside one.
 */
export const toneStrip: Record<Tone, string> = {
  busy: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  attention:
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  success:
    "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  link: "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  danger:
    "border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-950/40 dark:text-red-300",
  muted:
    "border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400",
};
