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
 * The two marks drawn on their own smaller grids (the form-control caret and the close cross)
 * and the rotating chevron are components, not entries: their geometry depends on the grid they
 * are drawn on (`marks.tsx`, `chevron.tsx`).
 */

/**
 * The eye's almond outline, shared by the two marks drawn from it — the open eye with its pupil
 * and the same eye struck through — so the pair cannot drift into looking unrelated.
 */
const EYE_OUTLINE = "M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z";

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
  /** A person: head and shoulders (lucide user). The person at the keyboard, beside the agent. */
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
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
  /** A trophy: cup, two handles and a base. */
  trophy: "M7 4h10v5a5 5 0 0 1-10 0V4zM7 5H4v1a3 3 0 0 0 3 3m10-4h3v1a3 3 0 0 1-3 3M12 14v4m-4 0h8",
  /** A `>_` prompt in a window frame. */
  terminalWindow: "M3 5h18v14H3zM7 9l3 3-3 3M13 15h4",
  /** A tower with wings and windows (lucide building-2). */
  building:
    "M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2M10 6h4M10 10h4M10 14h4M10 18h4",
  /** Two pages meeting at the spine (lucide book-open). */
  bookOpen: "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z",
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
  /** A wrench. */
  wrench: "M14.7 6.3a4 4 0 0 0-5 5L4 17v3h3l5.7-5.7a4 4 0 0 0 5-5l-2.5 2.5-2-2 2.5-2.5z",
  /** A key: a round bow, the shaft and two teeth (feather key). */
  key: "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4",
  /**
   * The same key struck through corner to corner, like `eyeOff`. Spelled out rather than composed
   * from `key`: a fragment equal to a whole entry would name one path twice. Redraw both together.
   */
  keyOff:
    "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4M2 2l20 20",
  /** Stacked cylinders: a database. */
  database:
    "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zm0 0v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  /** A speedometer: half a ring and its needle. */
  gauge: "M5 18a8 8 0 1 1 14 0M12 12l4-3",
  /** A bullseye: two rings and a centre. */
  target:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-5a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0-3a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  /** A coin: a circle stamped with a dollar sign. */
  coin: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-15v12m2.6-9.3c-.5-.8-1.5-1.2-2.6-1.2-1.5 0-2.7.8-2.7 2 0 2.7 5.4 1.3 5.4 4 0 1.2-1.2 2-2.7 2-1.2 0-2.2-.5-2.7-1.4",
  /** A dollar sign in a circle (lucide circle-dollar-sign). */
  dollarCircle:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 18V6",

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

  // --- Messages and actions -----------------------------------------------------------------

  /** A speech bubble with a plus: putting something into a conversation rather than sending it. */
  messagePlus: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM12 7v6M9 10h6",
  /** A paper plane. */
  paperPlane: "M22 2 11 13M22 2l-7 20-4-9-9-4z",
  /** A pane with an arrow leaving it: this opens outside the app, in a tab of its own. */
  externalLink: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3",
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
  /** A plus. `PlusIcon` (marks.tsx) draws this path with a stroke weight of its own. */
  plus: "M12 5v14M5 12h14",
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
   * A chevron pointing left at an upright bar on the left edge: fold a column away against that
   * edge — the sidebar collapsing to its rail.
   */
  chevronLeftPipe: "M15 6l-6 6 6 6M4 4v16",
  /** The mirror: a chevron pointing right at a bar on the right edge, unfolding the column. */
  chevronRightPipe: "M9 6l6 6-6 6M20 4v16",

  // --- Layout -------------------------------------------------------------------------------

  /** A window with a bottom pane. */
  panelBottom: "M4 5h16v14H4zM4 14h16",
  /** A window with a right pane. */
  panelRight: "M4 5h16v14H4zM14 5v14",
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
  /** A question mark in the status circle: the "?" that discloses an explanation (InfoPopover). */
  helpCircle:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.6 9.3a2.5 2.5 0 0 1 4.9.8c0 1.7-2.5 2.5-2.5 2.5M12 16.8h.01",
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
