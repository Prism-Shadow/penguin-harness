/**
 * The line set's duotone layer, and the hue each glyph wears where it is decorative.
 *
 * `DUOTONE` is a filled body under a line drawing, in the manner of a duotone icon family: for
 * a glyph with a closed silhouette — a robot's head, a file's page, a folder, a gear — the one
 * part that carries the shape, as 24-grid closed subpaths that reuse the line drawing's own
 * coordinates, so the fill meets the stroke's centre line with no gap and no overhang. The
 * renderer paints it in currentColor under the strokes, at the theme's `--ui-icon-duo-opacity`:
 * Frost sets a low opacity, and the themes that draw another set (Primer's Octicons, Console's
 * pixels) set 0. It follows the icon's ink, so a tinted icon gets a tinted body and a danger
 * row's a red one.
 *
 * `ICON_TINTS` gives every glyph one hue by concept family — agents violet, models and files
 * blue, conversations and people teal, plugins green, money amber, evaluation orange, time red,
 * memory and knowledge pink, the machinery and the plain controls slate — so a concept wears one
 * colour wherever it is a decorative icon, and neighbours in a navigation column differ. The
 * names are hues, not meanings: a theme that colours decorative icons maps each to its
 * `--ui-icon-tint-<name>` token, and an icon that carries information (a status mark, a file
 * kind) never takes a tint, since only a decorative icon is written with one.
 */
import { ICONS } from "../icons";
import type { IconName } from "../icons";
import type { GlyphKey } from "./types";

/** The 9-radius circle the status marks, the globe and the coins are drawn on. */
const STATUS_CIRCLE = "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z";

/** The head of the bust `userPlus` and `users` draw, set left of centre to make room beside it. */
const HEAD = "M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z";

/** The eye's almond, under both the open eye and the struck-through one. */
const EYE = "M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z";

/** The padlock's body, the same whether the shackle is seated or swung open. */
const LOCK_BODY = "M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z";

/** The key's round bow, under the key and the struck-through key. */
const KEY_BOW = "M11.39 11.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777z";

/** The whole shield, under the shields whose inner mark sits on it. */
const SHIELD =
  "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z";

/** The page, folded corner and all, under the file and the file with a plus. */
const PAGE = "M6 3h8l4 4v14H6z";

/** The archive box below its lid, under both archive marks. */
const ARCHIVE_BOX = "M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z";

/**
 * The duotone body of each glyph that has one, by registry key. One part, not every enclosed
 * region: the head, not the eyes; the front of an open folder, not the back. Where the body's
 * edge has no stroke of its own (a tower's foot, a dial's chord) it closes along the line the
 * drawing implies. A glyph drawn in strokes alone — an arrow, a chevron, a plus, a check, the
 * menu and slider lines, the text marks, the paperclip — has no entry, nor does one whose closed
 * parts are too small to read as a body (the fish hook's eye, the percent sign's rings), one
 * whose outline breaks where a slash crosses it (`shieldOff`), the checkbox frames, whose fill
 * would read as a state, or the trays, whose open top would leave the fill's edge in mid-air.
 * Every value is closed subpaths only. An entry that is the line drawing itself (`ICONS.puzzle`)
 * follows a redraw of it, which must keep that drawing closed.
 */
export const DUOTONE: Readonly<Partial<Record<GlyphKey, string>>> = {
  // --- Objects and places -------------------------------------------------------------------

  robot: "M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z",
  /** The large head alone: the agent, not what runs under it. */
  robotPair:
    "M3.8 4.2h7a2.2 2.2 0 0 1 2.2 2.2v5.8a2.2 2.2 0 0 1-2.2 2.2h-7a2.2 2.2 0 0 1-2.2-2.2V6.4a2.2 2.2 0 0 1 2.2-2.2z",
  robotPlus:
    "M3.92 5.56h9.84a1.64 1.64 0 0 1 1.64 1.64v6.56a1.64 1.64 0 0 1-1.64 1.64H3.92a1.64 1.64 0 0 1-1.64-1.64v-6.56a1.64 1.64 0 0 1 1.64-1.64z",
  /**
   * The head: the shoulders end open at the foot of the box, and a fill closed across them would
   * stop in mid-air.
   */
  user: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z",
  /** The circle the person stands in, as on the other circled marks. */
  userCircle: STATUS_CIRCLE,
  userPlus: HEAD,
  users: HEAD,
  /** The lobed outline; the gyri stay lines on it. */
  brain:
    "M5.1 17.9c-1.4 0 -2.5 -1.05 -2.5 -2.45 -1.1 -1 -.95 -2.75 .25 -3.6 -.5 -1.75 .6 -3.5 2.3 -3.8 .2 -1.85 1.95 -3.15 3.75 -2.7 1.3 -1.3 3.5 -1.45 4.95 -.25 2 -.35 3.8 .8 4.35 2.6 2 .1 3.45 1.9 3.05 3.85 .9 1.2 .5 2.95 -.75 3.7 .2 1.6 -1.1 2.9 -2.7 2.75 -1.15 1.15 -2.85 1.3 -4.15 .5 -1.6 1.55 -4.4 1.4 -5.45 -.8 -.85 .75 -2.1 .85 -3.1 .2Z",
  eye: EYE,
  eyeOff: EYE,
  /** The package; the die and the pins stay lines on and around it. */
  chip: "M5 5h14v14H5z",
  /** Both units: the pair is the shape. */
  server: "M4 4h16v6H4zM4 14h16v6H4z",
  monitor: "M3 4h18v12H3z",
  /** The slab, not the tapering top above it. */
  hardDrive: "M3 13h18v6H3z",
  keyboard: "M3 6h18a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z",
  keyboardChevronDown: "M4 4.5h16v10H4z",
  keyboardChevronUp: "M4 9.5h16v10H4z",
  /** The cup, without the handles. */
  trophy: "M7 4h10v5a5 5 0 0 1-10 0V4z",
  terminalWindow: "M3 5h18v14H3z",
  /** The tower, closed across its foot, which the drawing leaves open between the wings. */
  building: "M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18z",
  /** The door leaf swung open, not the frame. */
  doorOpen: "M3 20h11V4L3 6z",
  /** Both pages, as drawn: the open book is the pair. */
  bookOpen: ICONS.bookOpen,
  globe: STATUS_CIRCLE,
  /** The whole house; the door stays a line on it. */
  house:
    "M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  /** The piece, as drawn. */
  puzzle: ICONS.puzzle,
  /**
   * The hand's outline traced up and over each finger and round the thumb, closed where the thumb
   * meets the index finger.
   */
  hand: "M6 14V6a2 2 0 0 1 4 0V4a2 2 0 0 1 4 0v2a2 2 0 0 1 4 0v2a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15z",
  /**
   * The drawing itself: its hub runs the other way round from the tooth outline, so under the
   * nonzero fill rule the body is a ring and the hub stays open. A redraw keeps the two wound
   * apart.
   */
  gear: ICONS.gear,
  /** The tack's head and body; the stem stays a line. */
  pin: "M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z",
  lock: LOCK_BODY,
  lockOpen: LOCK_BODY,
  wrench: ICONS.wrench,
  /** The plug's body below its prongs. */
  plug: "M6 6h12v4a6 6 0 0 1-12 0V6z",
  /** The lifted plug's body; the socket cup stays open. */
  plugLifted: "M6 5h12v3a6 6 0 0 1-12 0V5z",
  key: KEY_BOW,
  keyOff: KEY_BOW,
  shieldAlert: SHIELD,
  /** The right half alone, so the split reads. */
  shieldHalf:
    "M12 2a1.17 1.17 0 0 1 .76.28C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1v7c0 5-3.5 7.5-7.66 8.95L12 22z",
  shieldCheck: SHIELD,
  /** The top of the stack, the one ellipse drawn whole; the rings below stay lines. */
  database: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z",
  /** The dial, closed by the chord between the ring's two ends. */
  gauge: "M5 18a8 8 0 1 1 14 0z",
  /** The outer ring's disc; the inner rings stay lines. */
  target: STATUS_CIRCLE,
  coin: STATUS_CIRCLE,
  dollarCircle: STATUS_CIRCLE,
  /** The glass and its neck, above the base's two lines. */
  lightbulb: "M12 3a6 6 0 0 0-3 11v2h6v-2a6 6 0 0 0-3-11z",
  /** The bell, not its clapper. */
  bell: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9z",
  zap: ICONS.zap,
  /** The disc inside the rays. */
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z",
  /** The half disc, closed across its foot above the horizon. */
  sunrise: "M6 18a6 6 0 0 1 12 0z",

  // --- Time ---------------------------------------------------------------------------------

  clock: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z",
  clockCompact: STATUS_CIRCLE,
  /** The face, closed up the side where the arc turns into the arrow. */
  history: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8z",
  /** The header band above the rule: the part of a page that says calendar. */
  calendar: "M5 4h14a2 2 0 0 1 2 2v4H3V6a2 2 0 0 1 2-2z",
  /** The dial, without the bells and feet. */
  alarmClock: "M12 19.5a6.7 6.7 0 1 0 0-13.4 6.7 6.7 0 0 0 0 13.4z",
  /** Both bulbs of glass, without the frame. */
  hourglass: "M8 3v3.5L12 10l4-3.5V3zM8 21v-3.5L12 14l4 3.5V21z",

  // --- Files and data -----------------------------------------------------------------------

  file: PAGE,
  filePlus: PAGE,
  /** The pen, not the baseline. */
  penLine: "M16.5 3.5a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z",
  pencil: "M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z",
  /** The whole folder, tab and front in one outline, as drawn. */
  folder: ICONS.folder,
  /** The whole folder, as `folder`. */
  folderPlus: ICONS.folder,
  /** The front flap, its open left side closed along the line its slanted edge points down. */
  folderOpen:
    "M6 14l1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4z",
  /** The front sheet only. */
  copy: "M9 9h9v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V9z",
  /** The board, its outline run round the underside of the clip so the clip stays open. */
  clipboard:
    "M9 5.5H6.5A1.5 1.5 0 0 0 5 7v12a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V7a1.5 1.5 0 0 0-1.5-1.5H15V7H9z",
  archive: ARCHIVE_BOX,
  archiveRestore: ARCHIVE_BOX,
  /** The can below its lid. */
  trash: "M6 6v13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6z",
  /** Both marks, as drawn. */
  quote: ICONS.quote,
  copyright: STATUS_CIRCLE,

  // --- Messages and actions -----------------------------------------------------------------

  /** The bubble, tail and all. */
  messagePlus: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  paperPlane: "M22 2l-7 20-4-9-9-4z",
  play: ICONS.play,
  /** The lens, not the handle. */
  search: "M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0z",
  /** The frame; the mountain line stays a line on it. */
  image: "M6 5h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z",
  sparkle: ICONS.sparkle,
  /** The large star alone; its two companions are crosses. */
  sparkles:
    "M12 3l-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275z",

  // --- Layout -------------------------------------------------------------------------------

  /** The pane the glyph names, as in each pane glyph below. */
  panelBottom: "M4 14h16v5H4z",
  panelRight: "M14 5h6v14h-6z",
  panelLeft: "M4 5h6v14H4z",
  panelLeftText: "M5 4h4v16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
  /** The chrome bar above the rule, which is what makes the frame a window. */
  appWindow: "M3 9V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3z",
  /** All four tiles, as drawn (and so for `dashboard`). */
  tiles: ICONS.tiles,
  dashboard: ICONS.dashboard,
  /** The three boxes, not the bus. */
  network: "M9 3h6v5H9zM2 16h6v5H2zM16 16h6v5h-6z",
  /** The three nodes. */
  gitBranch:
    "M8 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM20 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM8 19a2 2 0 1 1-4 0 2 2 0 0 1 4 0z",
  /** The frame; the columns stay lines on it. */
  kanban: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",

  // --- Status -------------------------------------------------------------------------------

  info: STATUS_CIRCLE,
  alertCircle: STATUS_CIRCLE,
  helpCircle: STATUS_CIRCLE,
  triangleAlert: "M21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z",
  checkCircle: STATUS_CIRCLE,
  xCircle: STATUS_CIRCLE,
  stopCircle: STATUS_CIRCLE,
};

/** The hues a decorative icon may wear, each a `--ui-icon-tint-<name>` token. */
export const ICON_TINT_NAMES = [
  "blue",
  "violet",
  "pink",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "slate",
] as const;
export type IconTint = (typeof ICON_TINT_NAMES)[number];

/**
 * Every glyph's hue, grouped by family. A hue is chosen for the concept the glyph stands for, so
 * one concept never changes colour between surfaces, and the families were spread so that the
 * sidebar's entries (agents, models, plugins, machines, cost, evaluation), company mode's pages
 * (overview, org chart, calendar, tickets, finance, handbook) and the settings rail never put one
 * hue on two neighbours.
 */
export const ICON_TINTS: Readonly<Record<IconName, IconTint>> = {
  /**
   * Agents, what they make and the company they form: the robots, the wand and sparks of describing
   * a thing to an agent, the org chart and the company's building.
   */
  robot: "violet",
  robotPair: "violet",
  robotPlus: "violet",
  building: "violet",
  wand: "violet",
  sparkle: "violet",
  sparkles: "violet",
  network: "violet",

  /**
   * Models and their measures, and files: the chip, the gauge, the eye that watches a run, pages,
   * folders and what holds or copies them, pictures and windows, the overview and the info mark.
   */
  eye: "blue",
  eyeOff: "blue",
  chip: "blue",
  gauge: "blue",
  file: "blue",
  filePlus: "blue",
  folder: "blue",
  folderPlus: "blue",
  folderOpen: "blue",
  upload: "blue",
  download: "blue",
  arrowUpFromLine: "blue",
  arrowDownToLine: "blue",
  copy: "blue",
  clipboard: "blue",
  paperclip: "blue",
  archive: "blue",
  archiveRestore: "blue",
  image: "blue",
  appWindow: "blue",
  dashboard: "blue",
  info: "blue",

  /**
   * Conversations, the people in them and the web: bubbles, quotes, channels, the pen that writes,
   * people, the globe and links, the pulse of work going on.
   */
  user: "teal",
  userCircle: "teal",
  userPlus: "teal",
  users: "teal",
  globe: "teal",
  house: "teal",
  penLine: "teal",
  pencil: "teal",
  quote: "teal",
  hash: "teal",
  messagePlus: "teal",
  bubbleLines: "teal",
  paperPlane: "teal",
  externalLink: "teal",
  chainLink: "teal",
  pulse: "teal",

  /**
   * Plugins, tools and protection, and things done: the puzzle piece, the hook, the wrench, the
   * shields, the ticket board, a check and a play.
   */
  puzzle: "green",
  fishHook: "green",
  wrench: "green",
  shieldAlert: "green",
  shieldHalf: "green",
  shieldCheck: "green",
  shieldOff: "green",
  check: "green",
  play: "green",
  kanban: "green",
  checkCircle: "green",

  /**
   * Money, credentials and light: cost, coins and percentages, keys and locks, the bulb, the bolt
   * and the sun, and the warning triangle.
   */
  lock: "amber",
  lockOpen: "amber",
  key: "amber",
  keyOff: "amber",
  coin: "amber",
  dollarCircle: "amber",
  lightbulb: "amber",
  zap: "amber",
  sun: "amber",
  sunrise: "amber",
  percent: "amber",
  barChart: "amber",
  triangleAlert: "amber",

  /** Evaluation and goals: the trophy and the targets, and the hand that does a thing itself. */
  trophy: "orange",
  hand: "orange",
  target: "orange",
  targetArrow: "orange",

  /**
   * Time and alarms, and removal: clocks, the calendar, the hourglass and the bell, the bin and the
   * faults.
   */
  bell: "red",
  clock: "red",
  clockCompact: "red",
  history: "red",
  calendar: "red",
  alarmClock: "red",
  hourglass: "red",
  trash: "red",
  alertCircle: "red",
  xCircle: "red",

  /** Memory, knowledge and credit: the brain, the open book, the copyright mark. */
  brain: "pink",
  bookOpen: "pink",
  copyright: "pink",

  /**
   * The machinery and the plain controls: machines, drives, terminals and keyboards, settings,
   * arrows, chevrons, layout, undo and refresh, and the remaining status marks.
   */
  server: "slate",
  monitor: "slate",
  hardDrive: "slate",
  keyboard: "slate",
  keyboardChevronDown: "slate",
  keyboardChevronUp: "slate",
  terminalWindow: "slate",
  terminalPrompt: "slate",
  doorOpen: "slate",
  gear: "slate",
  pin: "slate",
  plug: "slate",
  plugLifted: "slate",
  database: "slate",
  arrowUpDown: "slate",
  ellipsis: "slate",
  wrapText: "slate",
  textLines: "slate",
  signIn: "slate",
  signOut: "slate",
  angleBrackets: "slate",
  refresh: "slate",
  rotateCw: "slate",
  rotateCcw: "slate",
  plus: "slate",
  minus: "slate",
  cross: "slate",
  pause: "slate",
  search: "slate",
  undo: "slate",
  sliders: "slate",
  arrowLeft: "slate",
  chevronLeft: "slate",
  chevronRight: "slate",
  chevronDown: "slate",
  chevronsDownUp: "slate",
  chevronLeftPipe: "slate",
  chevronRightPipe: "slate",
  arrowLeftCentered: "slate",
  arrowRightCentered: "slate",
  arrowUp: "slate",
  arrowDown: "slate",
  arrowUpRight: "slate",
  letterMArrow: "slate",
  panelBottom: "slate",
  panelRight: "slate",
  panelLeft: "slate",
  panelLeftText: "slate",
  rectangle: "slate",
  rectangleCheck: "slate",
  boxArrowOut: "slate",
  tiles: "slate",
  cornersOut: "slate",
  cornersIn: "slate",
  gitBranch: "slate",
  menu: "slate",
  slidersHorizontal: "slate",
  helpCircle: "slate",
  stopCircle: "slate",
  compress: "slate",
};
