/**
 * The pet figure contract: what a figure driver answers for, and nothing else.
 *
 * A driver is a plugin of its own (plugins/pet-live2d-cubism, plugins/pet-live2d-coopanion)
 * whose `ui/` ships a figure.js module: the pet's page imports the one its configuration
 * names and calls it with the stage. The driver draws the pet on that stage and moves her;
 * it never reads the pet's state and never speaks — the bubble, the habits, the hunger and
 * the coins are the page's, and what the body wants to report (a touch, a state word) comes
 * back through the stage's `emit`.
 *
 * This file is the one thing a driver and the page agree on, so it is TYPES ONLY: the page
 * imports it for its types (erased at build), a driver keeps its own copy of the same shapes,
 * and neither side carries the other's code.
 *
 * Stage geometry: one stage is the page document's whole window. The driver draws the pet
 * inside a 256-unit square (logo units, facing right, ground at y=256), scaled by `stage.S`
 * pixels per unit; `floorY` is where the ground is, in stage pixels. A stage point is in
 * stage pixels, origin at the stage box's top left.
 */

/** The stage a figure is drawn on: the page document's window, handed over once. */
export interface PetStage {
  /** The stage element: the driver appends its canvas here and moves the pet inside it. */
  root: HTMLElement;
  /**
   * The stage box, re-read on demand (a resize re-measures the window); `S` is pixels per
   * logo unit, `floorY` where the ground is.
   */
  bounds(): { W: number; H: number; floorY: number; S: number };
  /** What the body reports into the page: `touch` with `{kind: "pet"|"poke"|"grab"|"throw"|"drop"}`. */
  emit(kind: string, detail?: unknown): void;
  /** The page's mouth: a driver's own line asks for a breath — the page paces the balloon. */
  talk(text: string): void;
  /** Where she starts, in stage pixels (the page passes the spot beside the entry control). */
  start?: { x: number; y: number };
}

/**
 * The configuration a driver is created with: the pet's own state, read-only, and the base
 * URL for the driver's assets, carrying the version stamp (`?v=`) the page document was
 * framed with, so everything under it caches for good.
 */
export interface PetFigureConfig {
  url: string;
  /** The driver's own configuration block, verbatim from the pet's state document. */
  figure?: unknown;
  /** The document's colour scheme, as the page reads it (the mode word her palette follows). */
  dark?: () => boolean;
}

/**
 * The per-frame layout of the drawn pet: where she is and what she is standing on. `hit` is
 * the circles a pointer may land on — her body, in stage pixels; `bubble` is the spot her
 * speech balloon anchors to (the page lifts it at least 18 px above).
 */
export interface PetFigureLayout {
  hit: Array<{ x: number; y: number; r: number }>;
  bubble: { x: number; y: number };
}

/**
 * What the page asks of a drawn pet, and everything it will ever ask.
 *
 * A driver keeps its own animation and roams or not by itself; the page's `set` is the
 * frame's conditions, not its orders — `wish` (`pet.mood.doing`) is the one order.
 */
export interface PetFigureInstance {
  /** Advance by `dt` seconds and draw. Called once per animation frame while she is visible. */
  step(dt: number): void;
  /** Where she is, right now. */
  layout(): PetFigureLayout;
  /** An expression or motion word; a word the driver does not know is a no-op, not an error. */
  do(word: string): void;
  /**
   * The page pokes her — a touch on her body that should bring a line out. Optional: a
   * driver whose figure cannot speak stays silent, and the page's own bubble covers it.
   */
  talk?(): void;
  /** The page's own moments, already named by the kit's body contract. */
  cue(kind: "perk" | "heard" | "cheer" | "bounce"): void;
  /** Walk (or run) to stage `x` on the ground line; false when she is busy and cannot start. */
  walk(x: number, run?: boolean): boolean;
  /** Give up the current walk where she stands. */
  stopWalk(): void;
  /** The stage's pointer, in stage pixels (`null` with `leave`). */
  pointer(type: "down" | "move" | "up" | "cancel" | "leave", at: { x: number; y: number } | null): void;
  /** Stand at stage `x`, turned to `facing` (1 right, -1 left). */
  place(x: number, facing: 1 | -1, y?: number): void;
  /** Conditions: whether she may wander, whether one of her surfaces is up, the scheme. */
  set(s: { roam?: "free" | "off"; dialogOpen?: boolean; dark?: boolean }): void;
  /** The stage changed size: re-measure, keep standing. */
  resize(): void;
  /** The document is going away: release the WebGL context, remove what was appended. */
  dispose(): void;
  /** The driver's own expression and motion words, for the page to pass back through `do`. */
  readonly words: readonly string[];
}

/** The module a driver's `ui/figure.js` exports: the only call a driver answers. */
export interface FigureDriverModule {
  createFigure(stage: PetStage, config: PetFigureConfig): Promise<PetFigureInstance>;
}
