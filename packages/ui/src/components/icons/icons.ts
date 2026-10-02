/**
 * The line-icon registry: every shared glyph as 24x24 path data, drawn by `GlyphIcon` in
 * currentColor at the theme's stroke weight.
 *
 * Keys name the drawing, never the use: `robot`, not `agents`; `alarmClock`, not `schedule`. A
 * glyph means different things in different places — the chip is the model library in the nav,
 * the eye is watching a run — and the app's own manifests say which drawing stands for which
 * concept (the nav's entries, the stat chips, the grouping options). So a redraw happens here
 * once and every use follows, and two uses that should look alike cannot end up with two
 * drawings of one thing.
 *
 * Each path is one string because `GlyphIcon` draws a single `<path>`: a figure made of several
 * strokes is several subpaths in the one string. Every glyph is stroked at the family's weight,
 * whatever weight it was first drawn at — the weight belongs to the set, not to the mark.
 *
 * Every line glyph the apps draw is an entry here: a feature file reads `ICONS` and never spells
 * out a path of its own (the web app's icon-registry test holds both packages to that), so a
 * theme that redraws the set reaches every surface.
 *
 * The small marks drawn as components are not entries: the form-control caret and the close
 * cross on their own smaller grids, and the menu check, the create plus and the download and
 * upload trays at stroke weights of their own (`marks.tsx`); and the rotating collapse chevron
 * (`chevron.tsx`). Their geometry depends on the grid and the weight they are drawn at.
 */

/**
 * The eye's almond outline, shared by the two marks drawn from it — the open eye with its pupil
 * and the same eye struck through — so the pair cannot drift into looking unrelated.
 */
const EYE_OUTLINE = "M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z";

/**
 * lucide's shield outline, shared by the three shields drawn on it (alert, half, check) so they
 * read as one family. lucide draws each as several `<path>`s; here they are joined into one
 * string, a relative `m` rewritten as the same absolute move, since a joined path would
 * otherwise start it from the previous subpath.
 */
const SHIELD_OUTLINE =
  "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z";

export const ICONS = {
  // --- Objects and places -------------------------------------------------------------------

  /**
   * A robot head with an antenna, two ears, two eyes and a smile — lucide's `bot` with the mouth
   * added. It is the agent: the thing in this product a person talks to, and the friendliest mark
   * on the rail should be the one that stands for it.
   *
   * The landing page draws the same agent from its own copy of this string (`BotIcon` in
   * packages/landing/src/components/icons.tsx — it carries no icon dependency to share one
   * with); redraw this and redraw that. Its agent-glyph-sync test fails if only one moves.
   */
  robot:
    "M12 8V4H8M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM2 14h2M20 14h2M9 13h.01M15 13h.01M10 16.5s.8 1 2 1 2-1 2-1",
  /**
   * Two robot heads, a large one above-left and a small one below-right: an agent and what it
   * has going on underneath it (its subagents). Reduced to antenna, head and two eye dots,
   * because the ears and the smile `robot` carries fall below a pixel at 13px.
   */
  robotPair:
    "M7.3 4.2V2.2M3.8 4.2h7a2.2 2.2 0 0 1 2.2 2.2v5.8a2.2 2.2 0 0 1-2.2 2.2h-7a2.2 2.2 0 0 1-2.2-2.2V6.4a2.2 2.2 0 0 1 2.2-2.2zM4.6 9.2h.01M10 9.2h.01M18.6 14.8v-1.7M16.5 14.8h4.2a1.7 1.7 0 0 1 1.7 1.7v3.8a1.7 1.7 0 0 1-1.7 1.7h-4.2a1.7 1.7 0 0 1-1.7-1.7v-3.8a1.7 1.7 0 0 1 1.7-1.7zM17.3 18.4h.01M20.5 18.4h.01",
  /**
   * `robot` shrunk toward the top-left, with a plus in the freed bottom-right corner: a new agent
   * made. The shrink (0.82 about the origin, then one unit up and to the left) is baked into the
   * coordinates, since the renderer has nowhere to put a transform; redraw it with `robot`.
   */
  robotPlus:
    "M8.84 5.56V2.28H5.56M3.92 5.56h9.84a1.64 1.64 0 0 1 1.64 1.64v6.56a1.64 1.64 0 0 1-1.64 1.64H3.92a1.64 1.64 0 0 1-1.64-1.64v-6.56a1.64 1.64 0 0 1 1.64-1.64zM.64 10.48h1.64M15.4 10.48h1.64M6.38 9.66h.01M11.3 9.66h.01M7.2 12.53s.66.82 1.64.82 1.64-.82 1.64-.82M18.5 15.5v6M15.5 18.5h6",
  /** A person: head and shoulders (lucide user). The person at the keyboard, beside the agent. */
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  /** A person in the status circle: an account's own identity, apart from the bare `user`. */
  userCircle:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6.2 18.4a6 6 0 0 1 11.6 0",
  /** A person with a plus beside them (lucide user-plus): somebody added. */
  userPlus:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM19 8v6M22 11h-6",
  /** Two people, one behind the other (lucide users): a group of people. */
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  /**
   * The cerebrum from the side: the lobed outline, then the gyri inside it. The drawing was
   * authored with the whole figure shifted a little down the box; the shift is baked into the
   * coordinates rather than carried as a transform, since the renderer has nowhere to put one.
   */
  brain:
    "M5.1 17.9c-1.4 0 -2.5 -1.05 -2.5 -2.45 -1.1 -1 -.95 -2.75 .25 -3.6 -.5 -1.75 .6 -3.5 2.3 -3.8 .2 -1.85 1.95 -3.15 3.75 -2.7 1.3 -1.3 3.5 -1.45 4.95 -.25 2 -.35 3.8 .8 4.35 2.6 2 .1 3.45 1.9 3.05 3.85 .9 1.2 .5 2.95 -.75 3.7 .2 1.6 -1.1 2.9 -2.7 2.75 -1.15 1.15 -2.85 1.3 -4.15 .5 -1.6 1.55 -4.4 1.4 -5.45 -.8 -.85 .75 -2.1 .85 -3.1 .2ZM5.15 8.05C5.05 9.75 6.4 10.8 8 10.55m5.85 -5.45c-1.1 .65 -1.8 1.9 -1.6 3.25m5.95 -.65c-1.7 -.2 -2.8 1.2 -2.6 2.65M8.2 17.7c-1.2 -1.1 -.85 -3 .55 -3.65 1.7 -.8 3.3 -.45 4.5 -2.1m4.55 6.05c-1.35 -.45 -1.9 -1.65 -1.45 -2.85",
  /** An open eye with its pupil: watching what something actually did. */
  eye: `${EYE_OUTLINE}M14.7 12a2.7 2.7 0 1 1-5.4 0 2.7 2.7 0 0 1 5.4 0z`,
  /**
   * The same eye struck through. The slash runs corner to corner rather than across the eye
   * alone, because the open eye is often drawn nearby and the slash is the only thing telling
   * the two apart.
   */
  eyeOff: `${EYE_OUTLINE}M3 3l18 18`,
  /**
   * A chip: body, die and three pins a side. Three pins rather than six — at 16px six pins a
   * side fuse into a serrated edge. The die is what keeps the mark clear of `server`: a bare
   * body with side ticks and a stack of server units both reduce to "a rectangle with lines",
   * while concentric squares ringed with pins reduce to nothing else in this table.
   */
  chip: "M5 5h14v14H5zM9 9h6v6H9zM7.5 5V2.4M12 5V2.4M16.5 5V2.4M7.5 19v2.6M12 19v2.6M16.5 19v2.6M5 7.5H2.4M5 12H2.4M5 16.5H2.4M19 7.5h2.6M19 12h2.6M19 16.5h2.6",
  /** Two stacked server units, each with its own status lamp. */
  server: "M4 4h16v6H4zM4 14h16v6H4zM7 7h.01M7 17h.01",
  /** A display on its stand: a desktop computer's screen. */
  monitor: "M3 4h18v12H3zM8 20h8M12 16v4",
  /** A drive: a slab with its status lamp under a tapering top. */
  hardDrive: "M3 13h18v6H3zM5 13l2-8h10l2 8M17 16h.01",
  /** A keyboard: a rounded plate, two rows of keys and a space bar. */
  keyboard:
    "M3 6h18a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM6 9.5h.01M9.5 9.5h.01M13 9.5h.01M16.5 9.5h.01M6 12.5h.01M9.5 12.5h.01M13 12.5h.01M16.5 12.5h.01M8.5 15.5h7",
  /** A smaller keyboard raised in the box, a chevron under it pointing down. */
  keyboardChevronDown: "M4 4.5h16v10H4zM7.5 8h.01M12 8h.01M16.5 8h.01M8.5 11.5h7M9 18l3 2.5 3-2.5",
  /** The same keyboard lowered in the box, a chevron above it pointing up. */
  keyboardChevronUp: "M4 9.5h16v10H4zM7.5 13h.01M12 13h.01M16.5 13h.01M8.5 16.5h7M9 6.5 12 4l3 2.5",
  /** A trophy: cup, two handles and a base. */
  trophy: "M7 4h10v5a5 5 0 0 1-10 0V4zM7 5H4v1a3 3 0 0 0 3 3m10-4h3v1a3 3 0 0 1-3 3M12 14v4m-4 0h8",
  /** A `>_` prompt in a window frame. */
  terminalWindow: "M3 5h18v14H3zM7 9l3 3-3 3M13 15h4",
  /** A bare `>_` prompt, without the window frame `terminalWindow` draws round it. */
  terminalPrompt: "M4 6l4 4-4 4M12 18h8",
  /** A tower with wings and windows (lucide building-2). */
  building:
    "M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2M10 6h4M10 10h4M10 14h4M10 18h4",
  /** A door standing open in its frame, its knob showing (after lucide door-open). */
  doorOpen: "M13 4h3v16h-3M3 20h11V4L3 6zM10 12h.01",
  /** Two pages meeting at the spine (lucide book-open). */
  bookOpen: "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z",
  /** A globe: the 9-radius circle, its equator and one meridian. */
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a13 13 0 0 1 0 18 13 13 0 0 1 0-18z",
  /** A house with its door (lucide house). */
  house:
    "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  /** A puzzle piece (lucide puzzle). */
  puzzle:
    "M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 1.998c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z",
  /** A fishing hook: eye, shank, bend and a barbed tip. */
  fishHook: "M16 4a2 2 0 1 0-4 0 2 2 0 0 0 4 0zM14 6v8a5 5 0 0 1-10 0v-2m0 0l-2 2m2-2l2 2",
  /**
   * A magic wand with two sparkles (after lucide's wand-sparkles, reduced so it still reads at
   * 13px): describing something to the agent instead of configuring it by hand.
   */
  wand: "M21.64 3.64l-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72zM14 7l3 3M5 6v4M3 8h4M19 14v4M17 16h4",
  /** An open hand — doing it by hand, the counterpart of `wand`. */
  hand: "M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15",
  /** The standard gear (lucide settings): full tooth outline and centre circle, crisp at 16px. */
  gear: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  /** A pushpin (lucide pin): head, body and stem. */
  pin: "M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z",
  /**
   * A five-pointed star with softened points (lucide star). Drawn with `GlyphIcon`'s `filled`
   * mode for its "on" state: the solid star is a favourite, the outline the way to make one.
   */
  star: "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",
  /** A wrench. */
  wrench: "M14.7 6.3a4 4 0 0 0-5 5L4 17v3h3l5.7-5.7a4 4 0 0 0 5-5l-2.5 2.5-2-2 2.5-2.5z",
  /** A plug: two prongs, the body and its cord trailing below. */
  plug: "M9 2v4M15 2v4M6 6h12v4a6 6 0 0 1-12 0V6zM12 16v6",
  /**
   * The same plug lifted clear of its socket: prongs up, a gap, and the empty socket cup below.
   * It differs from `plug` in silhouette rather than in detail, because at icon size a detail is
   * invisible.
   */
  plugLifted: "M9 2v3M15 2v3M6 5h12v3a6 6 0 0 1-12 0V5zM7 22h10M7 22v-4M17 22v-4",
  /** A key: a round bow, the shaft and two teeth (feather key). */
  key: "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4",
  /**
   * The same key struck through corner to corner, like `eyeOff`. Spelled out rather than composed
   * from `key`: a fragment equal to a whole entry would name one path twice. Redraw both together.
   */
  keyOff:
    "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4M2 2l20 20",
  /** The shield with an exclamation mark inside (lucide shield-alert). */
  shieldAlert: `${SHIELD_OUTLINE}M12 8v4M12 16h.01`,
  /** The shield split down the middle (lucide shield-half). */
  shieldHalf: `${SHIELD_OUTLINE}M12 22V2`,
  /** The shield with a check inside (lucide shield-check). */
  shieldCheck: `${SHIELD_OUTLINE}M9 12l2 2 4-4`,
  /**
   * The shield struck through corner to corner, its outline broken where the slash crosses it
   * (lucide shield-off). Spelled out: the break leaves nothing of the shared outline whole.
   */
  shieldOff:
    "M2 2l20 20M5 5a1 1 0 0 0-1 1v7c0 5 3.5 7.5 7.67 8.94a1 1 0 0 0 .67.01c2.35-.82 4.48-1.97 5.9-3.71M9.309 3.652A12.252 12.252 0 0 0 11.24 2.28a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1v7a9.784 9.784 0 0 1-.08 1.264",
  /** A closed padlock (lucide lock): a value that cannot be changed here. */
  lock: "M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM7 11V7a5 5 0 0 1 10 0v4",
  /** Stacked cylinders: a database. */
  database:
    "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zm0 0v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  /** A speedometer: half a ring and its needle. */
  gauge: "M5 18a8 8 0 1 1 14 0M12 12l4-3",
  /** A bullseye: two rings and a centre. */
  target:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-5a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0-3a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  /** A bullseye with an arrow lodged at its centre, both rings left open where it flew in. */
  targetArrow: "M21 12A9 9 0 1 1 12 3M17 12A5 5 0 1 1 12 7M12 12L15 9V5L18 2V6H22L19 9H15",
  /** A coin: a circle stamped with a dollar sign. */
  coin: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-15v12m2.6-9.3c-.5-.8-1.5-1.2-2.6-1.2-1.5 0-2.7.8-2.7 2 0 2.7 5.4 1.3 5.4 4 0 1.2-1.2 2-2.7 2-1.2 0-2.2-.5-2.7-1.4",
  /** A dollar sign in a circle (lucide circle-dollar-sign). */
  dollarCircle:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 18V6",
  /** A light bulb: the glass, its neck and two lines of the base. */
  lightbulb: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3 11v2h6v-2a6 6 0 0 0-3-11z",
  /** A bell and its clapper (lucide bell). */
  bell: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0",
  /** A lightning bolt (lucide zap). */
  zap: "M13 2 3 14h9l-1 8 10-12h-9l1-8z",
  /** A sun: a disc and eight rays. */
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4l1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4l1.4-1.4",
  /** Half a sun rising over the horizon, its rays out. */
  sunrise: "M12 2v3M4.9 5.9l2.1 2.1M2 13h3M19 13h3M17 8l2.1-2.1M6 18a6 6 0 0 1 12 0M2 22h20",

  // --- Time ---------------------------------------------------------------------------------

  /** A clock face with its hands (lucide clock, drawn as one path). */
  clock: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M12 6v6l4 2",
  /**
   * The same clock drawn at the 9-unit radius of the status circles (`info`, `checkCircle`), so
   * it sits level with the other marks of a stats row.
   */
  clockCompact: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-14v5l3 2",
  /**
   * A clock read backwards (lucide history): the face opens into an arrow turning back. Going
   * back to where the reader was, which a bare clock face — "ordered by time" — does not say.
   */
  history: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5M12 7v5l4 2",
  /** A calendar (lucide calendar): two rings, the header rule and the page. */
  calendar:
    "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
  /**
   * An alarm clock — domed bells on its shoulders, a dial with hands and two splayed feet.
   * Distinct from the plain `clock`, which reads as "most recent". Its smallest use is a 12px
   * row mark, which bounds the detail: bells, feet and the hands' right angle each hold a whole
   * pixel there, while a second dial ring or ticks would not, and the notch between the bells
   * is what keeps them reading as two.
   */
  alarmClock:
    "M12 19.5a6.7 6.7 0 1 0 0-13.4 6.7 6.7 0 0 0 0 13.4zM12 8.9v3.9l2.6 1.8M3.1 7.7A3.5 3.5 0 0 1 7.7 4.3M16.3 4.3a3.5 3.5 0 0 1 4.6 3.4M7.8 18.8 5.4 21.6M16.2 18.8l2.4 2.8",
  /** An hourglass: frame top and bottom, sand funnelling to the waist. */
  hourglass: "M6 3h12M6 21h12M8 3v3.5L12 10l4-3.5V3M8 21v-3.5L12 14l4 3.5V21",

  // --- Files and data -----------------------------------------------------------------------

  /** A page with a folded corner. */
  file: "M6 3h8l4 4v14H6zM14 3v4h4",
  /** The same page with a plus: a whole file written. */
  filePlus: "M6 3h8l4 4v14H6zM12 11v6M9 14h6",
  /** A pen over a baseline (lucide pen-line): an edit in place. */
  penLine: "M12 20h9M16.5 3.5a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z",
  /** A pencil (thin line, matching the row-action set). */
  pencil: "M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3zM14 7l3 3",
  /** A folder outline, closed. */
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z",
  /** The closed folder with a plus: a new folder made. */
  folderPlus:
    "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7zM12 10v6M9 13h6",
  /** A folder outline, open (lucide folder-open: back panel and a tilted front flap). */
  folderOpen:
    "m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2",
  /**
   * A tray with an arrow leaving it. The same tray serves `download`, so the pair reads as one
   * axis; the arrow's direction is the only difference.
   */
  upload: "M12 15V4m0 0L8 8m4-4 4 4M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3",
  /** The tray with an arrow landing in it. */
  download: "M12 4v11m0 0 4-4m-4 4-4-4M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3",
  /** An arrow rising from a baseline. */
  arrowUpFromLine: "M12 15V5m0 0L8 9m4-4l4 4M4 19h16",
  /** An arrow falling to a baseline. */
  arrowDownToLine: "M12 3v10m0 0l-4-4m4 4l4-4M4 19h16",
  /** Opposed up and down arrows (lucide arrow-up-down). */
  arrowUpDown: "m21 16-4 4-4-4M17 20V4M3 8l4-4 4 4M7 4v16",
  /** Two overlapping sheets. */
  copy: "M9 9h9v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V9zM7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1",
  /** A clipboard: the board, and the clip at its top edge. */
  clipboard:
    "M9 4h6v3H9zM9 5.5H6.5A1.5 1.5 0 0 0 5 7v12a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V7a1.5 1.5 0 0 0-1.5-1.5H15",
  /** A paperclip (lucide paperclip). */
  paperclip:
    "M21.4 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.2-9.19a4 4 0 0 1 5.65 5.66l-9.19 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48",
  /** A checkmark. */
  check: "M5 13l4 4L19 7",
  /** An archive box with a downward chevron. */
  archive:
    "M3 8h18M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M4 8l1.5-3h13L20 8M9.5 13.5 12 16l2.5-2.5",
  /** The archive box with an arrow rising out of it. */
  archiveRestore:
    "M3 8h18M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M4 8l1.5-3h13L20 8M12 17v-5m-2.5 2L12 11l2.5 3",
  /** A trash can: lid, handle, body and two slats. */
  trash:
    "M4 6h16M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6M6 6v13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6M10 10.5v6M14 10.5v6",
  /**
   * Three dots. Hairline-stroke dots vanish at row-glyph size, so this mark is drawn with
   * `GlyphIcon`'s `filled` mode: the stroke rides on top of the fill.
   */
  ellipsis:
    "M4.5 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM19.5 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  /** Opening quotation marks: a passage carried in from somewhere else. */
  quote:
    "M9.5 6.5C7 7.5 5.5 9.5 5.5 12.5v4h5v-5h-3c0-1.8.9-3.1 2.6-3.8zM19.5 6.5c-2.5 1-4 3-4 6v4h5v-5h-3c0-1.8.9-3.1 2.6-3.8z",
  /**
   * Soft wrap: three lines of text where the middle one runs past the edge, turns back and
   * returns with an arrow. The turn is the whole mark, so it keeps the full bulge.
   */
  wrapText: "M4 6h16M4 12h12a3 3 0 1 1 0 6h-3m2-2-2 2 2 2M4 18h5",
  /** Three lines of text, each shorter than the one above. */
  textLines: "M4 6h16M4 12h12M4 18h8",
  /** A hash sign (lucide hash). */
  hash: "M4 9h16M4 15h16M10 3L8 21M16 3l-2 18",
  /** A percent sign: a slash between two small rings. */
  percent:
    "M19 5 5 19M6.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM17.5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  /** A C in the status circle (lucide copyright). */
  copyright: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15 9.5a3.5 3.5 0 1 0 0 5",

  // --- Messages and actions -----------------------------------------------------------------

  /** A speech bubble with a plus: putting something into a conversation rather than sending it. */
  messagePlus: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM12 7v6M9 10h6",
  /** A round speech bubble, open at its upper right, with two lines of text inside. */
  bubbleLines: "M8 10h8M8 14h5M21 12a9 9 0 1 1-4-7.5",
  /** A paper plane. */
  paperPlane: "M22 2 11 13M22 2l-7 20-4-9-9-4z",
  /** A pane with an arrow leaving it: this opens outside the app, in a tab of its own. */
  externalLink: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3",
  /** An arrow entering a doorway (lucide log-in). */
  signIn: "M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3",
  /** An arrow leaving a doorway (lucide log-out). */
  signOut: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  /** Two links of a chain (lucide link): an address. */
  chainLink:
    "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  /** A pair of angle brackets facing apart (lucide code). */
  angleBrackets: "M16 18l6-6-6-6M8 6l-6 6 6 6",
  /**
   * Two arcs chasing each other round a circle (lucide refresh-cw): read it again. The arc idiom
   * keeps it in the same family as the other round-trip glyphs.
   */
  refresh:
    "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M3 21v-5h5",
  /**
   * One arc turning clockwise into an arrowhead (feather rotate-cw) — a single arc where `refresh`
   * has two. The head reaches x=23, past the other glyphs' margin, as drawn upstream.
   */
  rotateCw: "M23 4v6h-6M20.49 15a9 9 0 1 1-2.12-9.36L23 10",
  /** One arc turning anticlockwise into an arrowhead at its upper left: `rotateCw` mirrored. */
  rotateCcw: "M3 12a9 9 0 1 0 2.64-6.36M3 4v5h5",
  /** A plus. `PlusIcon` (marks.tsx) draws this path with a stroke weight of its own. */
  plus: "M12 5v14M5 12h14",
  /** A minus: the plus's crossbar alone. */
  minus: "M5 12h14",
  /**
   * An X, two strokes corner to corner, on the 24 grid. The close button's cross is a different
   * mark (`CloseIcon`, drawn on its own smaller grid).
   */
  cross: "M18 6 6 18M6 6l12 12",
  /** A play triangle; drawn with `GlyphIcon`'s `filled` mode where it should read solid. */
  play: "M7 4l13 8-13 8z",
  /** Two upright bars: paused. */
  pause: "M8 4v16M16 4v16",
  /** A magnifier: a lens and its handle. The search box's leading mark and the toggle that opens one. */
  search: "M21 21l-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0z",
  /**
   * An arrow that turns back on itself: the head at the left, the shaft looping round beneath it.
   * Bring it back — the undo reading, not the bin's: what it takes back is returned, not thrown
   * away.
   */
  undo: "M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
  /** A picture: the rounded frame, and a mountain line across its lower half. */
  image:
    "M6 5h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3zM3 15l5-5 4 4 3-3 6 6",
  /** Three sliders set at different heights (feather sliders): how something behaves, adjustable. */
  sliders: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  /** A four-pointed spark: effort and thought, the dial a model thinks harder on. */
  sparkle: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z",
  /**
   * A larger four-pointed star with two small plus-shaped companions (lucide sparkles): a fuller
   * mark than the single `sparkle`.
   */
  sparkles:
    "M12 3l-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275zM5 3v4M19 17v4M3 5h4M17 19h4",

  // --- Direction ----------------------------------------------------------------------------

  /**
   * An arrow pointing left. The head sits left of centre and the shaft runs out to the right
   * edge, as the detail pages' back buttons have always drawn it.
   */
  arrowLeft: "M15 18l-6-6 6-6M9 12h12",
  /**
   * A chevron pointing left: back one level, the previous page. A still mark — the collapse
   * indicator that turns is the `Chevron` component, a different drawing.
   */
  chevronLeft: "M15 18l-6-6 6-6",
  /** The same chevron pointing right: the next page. */
  chevronRight: "M9 18l6-6-6-6",
  /**
   * The same chevron pointing down: more below. Not the form-control caret, which is the
   * `ChevronDown` mark on a grid of its own.
   */
  chevronDown: "M6 9l6 6 6-6",
  /** Two chevrons closing on each other across the middle (lucide chevrons-down-up). */
  chevronsDownUp: "M7 20l5-5 5 5M7 4l5 5 5-5",
  /**
   * A chevron pointing left at an upright bar on the left edge: fold a column away against that
   * edge — the sidebar collapsing to its rail.
   */
  chevronLeftPipe: "M15 6l-6 6 6 6M4 4v16",
  /** The mirror: a chevron pointing right at a bar on the right edge, unfolding the column. */
  chevronRightPipe: "M9 6l6 6-6 6M20 4v16",
  /**
   * An arrow pointing left, centred in the box: head and shaft span the same width, where
   * `arrowLeft`'s head sits left of centre. With its mirror, a pair that steps back and forward
   * along one line.
   */
  arrowLeftCentered: "M19 12H5m6-6-6 6 6 6",
  /** The mirror of `arrowLeftCentered`, pointing right. */
  arrowRightCentered: "M5 12h14m-6-6 6 6-6 6",
  /** An arrow pointing straight up, shaft and head centred in the box. */
  arrowUp: "M12 19V5m-6 6 6-6 6 6",
  /** The mirror of `arrowUp`, pointing down. */
  arrowDown: "M12 5v14m-6-6 6 6 6-6",
  /** An arrow leaving to the upper right (lucide arrow-up-right). */
  arrowUpRight: "M7 7h10v10M7 17 17 7",
  /** A capital M with an arrow leaving its top-right shoulder. */
  letterMArrow: "M4 17V7l4 4 4-4v10M16 7h4v4m0-4-6 6",

  // --- Layout -------------------------------------------------------------------------------

  /** A window with a bottom pane. */
  panelBottom: "M4 5h16v14H4zM4 14h16",
  /** A window with a right pane. */
  panelRight: "M4 5h16v14H4zM14 5v14",
  /** A window with a left pane: the mirror of `panelRight`. */
  panelLeft: "M4 5h16v14H4zM10 5v14",
  /** A rounded window with a left pane, and two lines of text in the space beside it. */
  panelLeftText:
    "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm4 0v16M12 9h5m-5 4h5",
  /** The bare window outline the pane glyphs are drawn on: an empty frame. */
  rectangle: "M4 5h16v14H4z",
  /** The same frame with a check inside it. */
  rectangleCheck: "M4 5h16v14H4zM8 12l3 3 5-6",
  /** A browser window: the rounded frame, its chrome bar and two dots on the bar. */
  appWindow:
    "M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6zM3 9h18M6 6.5h.01M9 6.5h.01",
  /**
   * A pane with an arrow escaping its top-right corner: this moves out into a window of its own.
   * A different drawing from `externalLink`, whose arrow leaves from the pane's edge.
   */
  boxArrowOut: "M14 4h6v6M20 4l-8 8M10 6H5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5",
  /** Four square tiles of two heights. */
  tiles: "M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z",
  /** Four rounded tiles of two heights (lucide layout-dashboard). */
  dashboard:
    "M4 3h5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM15 3h5a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM15 12h5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1zM4 16h5a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z",
  /**
   * Four corner brackets opening outward. Brackets rather than an arrow, because what they
   * announce may open in several directions at once, and a mark with a direction in it would
   * name the wrong one.
   */
  cornersOut: "M9 3H3v6M15 3h6v6M15 21h6v-6M9 21H3v-6",
  /** The same four corner brackets turned inward. */
  cornersIn: "M3 9h6V3M21 9h-6V3M21 15h-6v6M3 15h6v6",
  /** One box over two, joined by a bus (lucide network). */
  network: "M9 3h6v5H9zM2 16h6v5H2zM16 16h6v5h-6zM5 16v-3h14v3M12 13V8",
  /** Three nodes: a trunk, and a branch curving off it to a node of its own (lucide git-branch). */
  gitBranch:
    "M8 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM20 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM8 19a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM6 7v8M8 11h4a6 6 0 0 0 6-2",
  /** Three columns of unequal height in a frame (lucide square-kanban). */
  kanban:
    "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 7v7M12 7v4M16 7v9",
  /** Bars of three heights on a baseline. */
  barChart: "M4 20V10m6 10V4m6 16v-7m4 7H2",
  /** Three full-width lines (lucide menu): the phone's button that opens the navigation drawer. */
  menu: "M4 6h16M4 12h16M4 18h16",
  /** Three sliders on their tracks (lucide sliders-horizontal): a list's display options. */
  slidersHorizontal: "M21 5h-7M10 5H3M21 12h-9M8 12H3M21 19h-5M12 19H3M14 2v6M8 9v6M16 16v6",

  // --- Status -------------------------------------------------------------------------------

  /** An info circle: the 9-radius status circle with a bar and a dot inside it. */
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5m0-8h.01",
  /** An exclamation mark in the status circle: `info` turned over, a fault rather than a note. */
  alertCircle: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 8v4m0 4h.01",
  /** A question mark in the status circle: the "?" that discloses an explanation (InfoPopover). */
  helpCircle:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.6 9.3a2.5 2.5 0 0 1 4.9.8c0 1.7-2.5 2.5-2.5 2.5M12 16.8h.01",
  /** A triangle with an exclamation mark (lucide triangle-alert): a warning worth acting on. */
  triangleAlert:
    "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3zM12 9v4m0 4h.01",
  /** A check in the status circle. */
  checkCircle: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm-3.5-9.2 2.4 2.5 4.6-4.8",
  /** A cross in the status circle. */
  xCircle: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9 9l6 6m0-6-6 6",
  /** A square in the status circle: ended on purpose, neither a success nor a fault. */
  stopCircle: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 8.5h7v7h-7z",
  /** A centre bar with a chevron bearing down on it from above and up from below. */
  compress: "M4 12h16M8 7l4 3 4-3M8 17l4-3 4 3",
  /**
   * A flat line with one tall beat in it: work still going on. One continuous stroke with a
   * single beat keeps its shape at a 12px row mark, and it is nobody else's shape among the
   * status marks (the hourglass, `compress`, the spinner, the circled check and cross, a dot).
   */
  pulse: "M2 12h4l3 9 6-18 3 9h4",
} as const;

/** A glyph's registry key. */
export type IconName = keyof typeof ICONS;
