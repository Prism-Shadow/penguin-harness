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
 * Each slot paints the ball penguin in one colour family, five roles per mode: the tile it sits
 * on, its coat (the dark hood, body and flippers), its face, the marks drawn on the face (eyes,
 * beak, a smile) and its cheeks' blush. In light mode the coat is the slot's dark ink, the face is
 * the pale tile showing through, and the marks are the ink again. In dark mode the penguin keeps a
 * real penguin's colouring rather than inverting it: a mid-tone coat on the deep tile, a near-white
 * tinted face, and the marks in the tile's deep colour — light eyes on a dark face read as a
 * stare. The coat keeps ≥ 3:1 on its tile and against every theme's page surfaces (a graphic,
 * WCAG non-text contrast), and the marks keep ≥ 4.5:1 on the face — checked for every slot, theme
 * and mode in test/agent-palette.test.ts.
 *
 * The values were picked in OKLCH: the twelve hues spaced evenly by eye (25°, 52°, … 356°), the
 * tile at L 0.955 / C 0.03 in light and L 0.30 / C 0.045 in dark, the ink at C 0.15 / 0.13 with
 * its lightness alternating between neighbours (0.45 and 0.52 in light, 0.79 and 0.86 in dark),
 * each clamped into sRGB. The dark coat is the ink mixed 74% into the tile in OKLab, the dark face
 * the ink mixed 38% into white, and the light blush the ink mixed 42% into the tile in OKLCH; the
 * dark blush is the ink. The colours are identity data, not theme colours, like the letter tiles'
 * in `avatar.ts`.
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
  /** The coat: the hood, body and flippers. */
  coat: ModePair;
  /** The face. */
  face: ModePair;
  /** What is drawn on the face: the eyes, the beak, a smile. */
  mark: ModePair;
  /** The cheeks. */
  blush: ModePair;
}

/** The slots, in hue order (the old letter tile's hue anchor, 30° × slot, in the comment). */
export const AGENT_PALETTE: readonly AgentSlotColors[] = [
  // 0°: red
  {
    tile: { light: "#ffebe9", dark: "#422522" },
    coat: { light: "#972527", dark: "#ca7a73" },
    face: { light: "#ffebe9", dark: "#ffdad5" },
    mark: { light: "#972527", dark: "#422522" },
    blush: { light: "#d89994", dark: "#ff9b93" },
  },
  // 30°: orange
  {
    tile: { light: "#ffece1", dark: "#402718" },
    coat: { light: "#a24e02", dark: "#c99678" },
    face: { light: "#ffece1", dark: "#ffe8da" },
    mark: { light: "#a24e02", dark: "#402718" },
    blush: { light: "#daa98c", dark: "#ffc29e" },
  },
  // 60°: amber
  {
    tile: { light: "#f9efda", dark: "#382c11" },
    coat: { light: "#6d5001", dark: "#b18d3c" },
    face: { light: "#f9efda", dark: "#f4e3c0" },
    mark: { light: "#6d5001", dark: "#382c11" },
    blush: { light: "#bca984", dark: "#e1b34d" },
  },
  // 90°: olive
  {
    tile: { light: "#eef3dd", dark: "#2c3116" },
    coat: { light: "#637100", dark: "#9dac5b" },
    face: { light: "#eef3dd", dark: "#eaf3ce" },
    mark: { light: "#637100", dark: "#2c3116" },
    blush: { light: "#b1bb8a", dark: "#c9dd76" },
  },
  // 120°: green
  {
    tile: { light: "#e4f6e4", dark: "#1f3420" },
    coat: { light: "#016819", dark: "#67a569" },
    face: { light: "#e4f6e4", dark: "#d1eed1" },
    mark: { light: "#016819", dark: "#1f3420" },
    blush: { light: "#8db98e", dark: "#83d186" },
  },
  // 150°: teal
  {
    tile: { light: "#ddf7ee", dark: "#12352b" },
    coat: { light: "#047b62", dark: "#4eb99b" },
    face: { light: "#ddf7ee", dark: "#cdf9e9" },
    mark: { light: "#047b62", dark: "#12352b" },
    blush: { light: "#8ec2b1", dark: "#66edc7" },
  },
  // 180°: cyan
  {
    tile: { light: "#daf7f8", dark: "#0a3537" },
    coat: { light: "#026266", dark: "#1ca7ad" },
    face: { light: "#daf7f8", dark: "#bfeff1" },
    mark: { light: "#026266", dark: "#0a3537" },
    blush: { light: "#87b6b8", dark: "#20d3db" },
  },
  // 210°: azure
  {
    tile: { light: "#e2f3ff", dark: "#163142" },
    coat: { light: "#0171a3", dark: "#7aaaca" },
    face: { light: "#e2f3ff", dark: "#dcf1ff" },
    mark: { light: "#0171a3", dark: "#163142" },
    blush: { light: "#90bbd9", dark: "#a1d9ff" },
  },
  // 240°: indigo
  {
    tile: { light: "#eaf0ff", dark: "#242d45" },
    coat: { light: "#324ca7", dark: "#7c91cb" },
    face: { light: "#eaf0ff", dark: "#d9e4ff" },
    mark: { light: "#324ca7", dark: "#242d45" },
    blush: { light: "#97abdc", dark: "#9eb8ff" },
  },
  // 270°: violet
  {
    tile: { light: "#f2edff", dark: "#302942" },
    coat: { light: "#7551b3", dark: "#a89aca" },
    face: { light: "#f2edff", dark: "#f0e9ff" },
    mark: { light: "#7551b3", dark: "#302942" },
    blush: { light: "#bbabe1", dark: "#d7c6ff" },
  },
  // 300°: magenta
  {
    tile: { light: "#fce9fb", dark: "#3a2639" },
    coat: { light: "#7f2e7e", dark: "#b77bb5" },
    face: { light: "#fce9fb", dark: "#f8daf6" },
    mark: { light: "#7f2e7e", dark: "#3a2639" },
    blush: { light: "#c89ac6", dark: "#e89ce5" },
  },
  // 330°: pink
  {
    tile: { light: "#ffeaf1", dark: "#40242e" },
    coat: { light: "#a83b6c", dark: "#c990a4" },
    face: { light: "#ffeaf1", dark: "#ffe5ee" },
    mark: { light: "#a83b6c", dark: "#40242e" },
    blush: { light: "#dea1b7", dark: "#ffbbd3" },
  },
];

/** The slot an Agent's id falls in: its hue, rounded to the nearest of the twelve anchors. */
export function agentSlot(id: string): number {
  return Math.round(avatarHue(id) / 30) % AGENT_PALETTE.length;
}

/** What a drawing paints with: each value follows the colour scheme the theme sets on the root. */
export type AgentColors = Readonly<Record<keyof AgentSlotColors, string>>;

/** Two hex colours as one `light-dark()` value. */
const perMode = (pair: ModePair): string => `light-dark(${pair.light}, ${pair.dark})`;

/** The colours a slot is drawn in. */
export function agentColorsOfSlot(slot: number): AgentColors {
  const colors = AGENT_PALETTE[slot % AGENT_PALETTE.length]!;
  return {
    tile: perMode(colors.tile),
    coat: perMode(colors.coat),
    face: perMode(colors.face),
    mark: perMode(colors.mark),
    blush: perMode(colors.blush),
  };
}

/** The colours an Agent is drawn in, from its id. */
export function agentColors(id: string): AgentColors {
  return agentColorsOfSlot(agentSlot(id));
}
