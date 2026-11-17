/**
 * An Agent's colour: one of twelve palette slots, chosen by the Agent's id alone.
 *
 * The slot comes from the same FNV-1a hash of the id that has always coloured an Agent's avatar
 * (`avatarHue`), rounded to the nearest of the twelve hues the slots sit on (0°, 30°, … 330°), so
 * an Agent keeps the colour family it had as a letter tile, and keeps it across renames, themes
 * and modes. Twelve rather than a continuous hue: two Agents next to each other in a list must be
 * told apart at 16 px, and twelve picked colours, each a step from its neighbours in hue and in
 * lightness, are easier to tell apart there than 360 hues, half of which sit within a few degrees
 * of another.
 *
 * Each slot paints the penguin in one colour family, five roles per mode: the tile it sits on, its
 * coat (the body and flippers), its face, the marks drawn on the face (the eyes) and its cheeks'
 * blush. The coat is the bright one: in light mode the lightest tone of the slot's hue that still
 * stands off the pale tile, in dark mode a pastel on the deep tile. The face is a warm cream, the
 * eyes a warm dark brown and the cheeks a pink, each with a touch of the slot's hue and the same in
 * both modes — the penguin is not inverted in dark mode, because light eyes on a dark face read as
 * a stare. The coat keeps ≥ 3:1 on its tile and against every theme's page surfaces (a graphic,
 * WCAG non-text contrast), and the marks keep ≥ 4.5:1 on the face — checked for every slot, theme
 * and mode in test/agent-palette.test.ts. That floor is what keeps the light-mode coat a bright
 * mid-tone rather than a pastel: a pastel body on a pale tile would vanish at 14 px.
 *
 * Three colours come from outside the slot's own family. The beak and the feet are one orange, and
 * the line the penguin is drawn with is one brown, for every slot and both modes. What the penguin
 * wears (agent-accessory.ts) is painted in the coat of the slot opposite on the wheel: a hue from
 * across the wheel stands off the coat at the coat's own lightness, and the brown line edges it
 * against the face and the tile. None carries meaning, so none is held to a contrast floor.
 *
 * The values were picked in OKLCH, on the twelve hues spaced evenly by eye (25°, 52°, … 356°). The
 * tiles are L 0.955 / C 0.03 in light and L 0.30 / C 0.045 in dark. The light coat is C 0.13 at
 * the highest lightness up to 0.63 (0.58 for odd slots, so neighbours differ in lightness as well
 * as hue) that keeps 3.05:1 on its tile and every light page surface; the dark coat is C 0.10 at L
 * 0.83 (0.765 for odd slots). In OKLab, the face is the cream #fffaf3 mixed 25% toward the light
 * tile, the marks the brown #4a342b mixed 30% toward the dark tile, and the blush the pink #ffb1bc
 * mixed 20% toward the hue's pastel (L 0.84 / C 0.09). Each is clamped into sRGB. The colours are
 * identity data, not theme colours, like the letter tiles' in `avatar.ts`.
 */
import { avatarHue } from "./avatar";

/** A colour in each mode. */
export interface ModePair {
  light: string;
  dark: string;
}

/** One palette slot: the five colours the penguin is painted in, per mode. */
export interface AgentSlotColors {
  /** The ground the penguin sits on. */
  tile: ModePair;
  /** The coat: the body and flippers. */
  coat: ModePair;
  /** The face. */
  face: ModePair;
  /** What is drawn on the face: the eyes. */
  mark: ModePair;
  /** The cheeks. */
  blush: ModePair;
}

/** The slots, in hue order (the old letter tile's hue anchor, 30° × slot, in the comment). */
export const AGENT_PALETTE: readonly AgentSlotColors[] = [
  // 0°: red
  {
    tile: { light: "#ffebe9", dark: "#422522" },
    coat: { light: "#cc6661", dark: "#ffb0a9" },
    face: { light: "#fff6f0", dark: "#fff6f0" },
    mark: { light: "#482f28", dark: "#482f28" },
    blush: { light: "#ffb2b9", dark: "#ffb2b9" },
  },
  // 30°: orange
  {
    tile: { light: "#ffece1", dark: "#402718" },
    coat: { light: "#b56124", dark: "#e6a176" },
    face: { light: "#fff7ee", dark: "#fff7ee" },
    mark: { light: "#473025", dark: "#473025" },
    blush: { light: "#feb3b4", dark: "#feb3b4" },
  },
  // 60°: amber
  {
    tile: { light: "#f9efda", dark: "#382c11" },
    coat: { light: "#ae8100", dark: "#e6c27a" },
    face: { light: "#fdf7ed", dark: "#fdf7ed" },
    mark: { light: "#453224", dark: "#453224" },
    blush: { light: "#fab6b2", dark: "#fab6b2" },
  },
  // 90°: olive
  {
    tile: { light: "#eef3dd", dark: "#2c3116" },
    coat: { light: "#748410", dark: "#adbc71" },
    face: { light: "#fbf8ee", dark: "#fbf8ee" },
    mark: { light: "#413325", dark: "#413325" },
    blush: { light: "#f5b9b4", dark: "#f5b9b4" },
  },
  // 120°: green
  {
    tile: { light: "#e4f6e4", dark: "#1f3420" },
    coat: { light: "#4e9a52", dark: "#9ed99f" },
    face: { light: "#f8f9ef", dark: "#f8f9ef" },
    mark: { light: "#3e3428", dark: "#3e3428" },
    blush: { light: "#f0bbb8", dark: "#f0bbb8" },
  },
  // 150°: teal
  {
    tile: { light: "#ddf7ee", dark: "#12352b" },
    coat: { light: "#008f72", dark: "#69c8ab" },
    face: { light: "#f7f9f2", dark: "#f7f9f2" },
    mark: { light: "#3c352b", dark: "#3c352b" },
    blush: { light: "#edbbbe", dark: "#edbbbe" },
  },
  // 180°: cyan
  {
    tile: { light: "#daf7f8", dark: "#0a3537" },
    coat: { light: "#00999f", dark: "#6fdbe1" },
    face: { light: "#f6f9f4", dark: "#f6f9f4" },
    mark: { light: "#3b352f", dark: "#3b352f" },
    blush: { light: "#ebbbc4", dark: "#ebbbc4" },
  },
  // 210°: azure
  {
    tile: { light: "#e2f3ff", dark: "#163142" },
    coat: { light: "#0083bd", dark: "#72bceb" },
    face: { light: "#f8f8f6", dark: "#f8f8f6" },
    mark: { light: "#3c3433", dark: "#3c3433" },
    blush: { light: "#edb9ca", dark: "#edb9ca" },
  },
  // 240°: indigo
  {
    tile: { light: "#eaf0ff", dark: "#242d45" },
    coat: { light: "#6785d8", dark: "#b0c6ff" },
    face: { light: "#faf8f6", dark: "#faf8f6" },
    mark: { light: "#3f3334", dark: "#3f3334" },
    blush: { light: "#f2b7ca", dark: "#f2b7ca" },
  },
  // 270°: violet
  {
    tile: { light: "#f2edff", dark: "#302942" },
    coat: { light: "#8467bd", dark: "#baa5ea" },
    face: { light: "#fcf7f6", dark: "#fcf7f6" },
    mark: { light: "#423133", dark: "#423133" },
    blush: { light: "#f6b4ca", dark: "#f6b4ca" },
  },
  // 300°: magenta
  {
    tile: { light: "#fce9fb", dark: "#3a2639" },
    coat: { light: "#b36bb0", dark: "#ebb0e8" },
    face: { light: "#fef6f5", dark: "#fef6f5" },
    mark: { light: "#453030", dark: "#453030" },
    blush: { light: "#fbb2c5", dark: "#fbb2c5" },
  },
  // 330°: pink
  {
    tile: { light: "#ffeaf1", dark: "#40242e" },
    coat: { light: "#b4567d", dark: "#e698b5" },
    face: { light: "#fff6f3", dark: "#fff6f3" },
    mark: { light: "#472f2c", dark: "#472f2c" },
    blush: { light: "#feb1bf", dark: "#feb1bf" },
  },
];

/** The slot an Agent's id falls in: its hue, rounded to the nearest of the twelve anchors. */
export function agentSlot(id: string): number {
  return Math.round(avatarHue(id) / 30) % AGENT_PALETTE.length;
}

/** The beak and the feet: one orange in every slot and both modes. */
export const AGENT_BEAK = "#f7a83e";

/** The line the penguin is drawn with: one brown in every slot and both modes. */
export const AGENT_LINE = "#7a5848";

/**
 * What a drawing paints with: the slot's five colours, the beak, the line, and the accent what the
 * penguin wears is painted in. Each value follows the colour scheme the theme sets on the root.
 */
export type AgentColors = Readonly<
  Record<keyof AgentSlotColors | "beak" | "line" | "accent", string>
>;

/** Two hex colours as one `light-dark()` value. */
const perMode = (pair: ModePair): string => `light-dark(${pair.light}, ${pair.dark})`;

/** The colours a slot is drawn in. */
export function agentColorsOfSlot(slot: number): AgentColors {
  const count = AGENT_PALETTE.length;
  const colors = AGENT_PALETTE[slot % count]!;
  const opposite = AGENT_PALETTE[(slot + count / 2) % count]!;
  return {
    tile: perMode(colors.tile),
    coat: perMode(colors.coat),
    face: perMode(colors.face),
    mark: perMode(colors.mark),
    blush: perMode(colors.blush),
    beak: AGENT_BEAK,
    line: AGENT_LINE,
    accent: perMode(opposite.coat),
  };
}

/** The colours an Agent is drawn in, from its id. */
export function agentColors(id: string): AgentColors {
  return agentColorsOfSlot(agentSlot(id));
}
