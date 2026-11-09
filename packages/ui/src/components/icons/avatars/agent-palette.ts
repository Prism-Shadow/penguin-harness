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
 * Each slot is two colours per mode, the letter tile's logic carried over to the mascot: a pale
 * tile in the slot's hue, and the penguin drawn on it in that hue's ink. The colour is carried by
 * a small glyph on a quiet ground rather than by a saturated block, so a column of Agents in a
 * list reads as calm as the text beside it. In light mode the tile is nearly the page and the ink
 * is dark; in dark mode the tile is a deep tint and the ink is light. The ink keeps ≥ 4.5:1 on its
 * tile (AA, as the letter's did) and ≥ 3:1 against every theme's page surfaces, so the penguin
 * stands off the page even where the tile does not — checked for every slot, theme and mode in
 * test/agent-palette.test.ts.
 *
 * The values were picked in OKLCH: the twelve hues spaced evenly by eye (25°, 52°, … 356°), the
 * tile at L 0.955 / C 0.03 in light and L 0.30 / C 0.045 in dark, the ink at C 0.15 / 0.13 with
 * its lightness alternating between neighbours (0.45 and 0.52 in light, 0.79 and 0.86 in dark),
 * each clamped into sRGB. The colours are identity data, not theme colours, like the letter
 * tiles' in `avatar.ts`.
 */
import { avatarHue } from "./avatar";

/** A colour in each mode. */
export interface ModePair {
  light: string;
  dark: string;
}

/** One palette slot: the tile, and the ink the penguin is drawn in. */
export interface AgentSlotColors {
  tile: ModePair;
  ink: ModePair;
}

/** The slots, in hue order (the old letter tile's hue anchor, 30° × slot, in the comment). */
export const AGENT_PALETTE: readonly AgentSlotColors[] = [
  // 0°: red
  { tile: { light: "#ffebe9", dark: "#422522" }, ink: { light: "#972527", dark: "#ff9b93" } },
  // 30°: orange
  { tile: { light: "#ffece1", dark: "#402718" }, ink: { light: "#a24e02", dark: "#ffc29e" } },
  // 60°: amber
  { tile: { light: "#f9efda", dark: "#382c11" }, ink: { light: "#6d5001", dark: "#e1b34d" } },
  // 90°: olive
  { tile: { light: "#eef3dd", dark: "#2c3116" }, ink: { light: "#637100", dark: "#c9dd76" } },
  // 120°: green
  { tile: { light: "#e4f6e4", dark: "#1f3420" }, ink: { light: "#016819", dark: "#83d186" } },
  // 150°: teal
  { tile: { light: "#ddf7ee", dark: "#12352b" }, ink: { light: "#047b62", dark: "#66edc7" } },
  // 180°: cyan
  { tile: { light: "#daf7f8", dark: "#0a3537" }, ink: { light: "#026266", dark: "#20d3db" } },
  // 210°: azure
  { tile: { light: "#e2f3ff", dark: "#163142" }, ink: { light: "#0171a3", dark: "#a1d9ff" } },
  // 240°: indigo
  { tile: { light: "#eaf0ff", dark: "#242d45" }, ink: { light: "#324ca7", dark: "#9eb8ff" } },
  // 270°: violet
  { tile: { light: "#f2edff", dark: "#302942" }, ink: { light: "#7551b3", dark: "#d7c6ff" } },
  // 300°: magenta
  { tile: { light: "#fce9fb", dark: "#3a2639" }, ink: { light: "#7f2e7e", dark: "#e89ce5" } },
  // 330°: pink
  { tile: { light: "#ffeaf1", dark: "#40242e" }, ink: { light: "#a83b6c", dark: "#ffbbd3" } },
];

/** The slot an Agent's id falls in: its hue, rounded to the nearest of the twelve anchors. */
export function agentSlot(id: string): number {
  return Math.round(avatarHue(id) / 30) % AGENT_PALETTE.length;
}

/** What a drawing paints with: each value follows the colour scheme the theme sets on the root. */
export interface AgentColors {
  /** The ground: the tile, and the penguin's face and belly cut out of its body. */
  tile: string;
  /** The penguin: body, eyes, beak and feet. */
  ink: string;
}

/** Two hex colours as one `light-dark()` value. */
const perMode = (pair: ModePair): string => `light-dark(${pair.light}, ${pair.dark})`;

/** The colours a slot is drawn in. */
export function agentColorsOfSlot(slot: number): AgentColors {
  const colors = AGENT_PALETTE[slot % AGENT_PALETTE.length]!;
  return { tile: perMode(colors.tile), ink: perMode(colors.ink) };
}

/** The colours an Agent is drawn in, from its id. */
export function agentColors(id: string): AgentColors {
  return agentColorsOfSlot(agentSlot(id));
}
