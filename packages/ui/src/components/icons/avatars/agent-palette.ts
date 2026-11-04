/**
 * An Agent's colour: one of twelve palette slots, chosen by the Agent's id alone.
 *
 * The slot comes from the same FNV-1a hash of the id that has always coloured an Agent's avatar
 * (`avatarHue`), rounded to the nearest of the twelve hues the slots sit on (0°, 30°, … 330°), so
 * an Agent keeps the colour family it had before the mascot, and keeps it across renames, themes
 * and modes. Twelve rather than a continuous hue: two Agents next to each other in a list must be
 * told apart at 16 px, and twelve hand-picked colours, each a step from its neighbours in hue or
 * in lightness, are easier to tell apart there than 360 hues, half of which sit within a few
 * degrees of another.
 *
 * Each slot is a body colour — the penguin's head, the one colour the drawing is identified by,
 * the same in both modes — and every slot shares the accents drawn on it: the white face mask
 * (a step dimmer in dark mode, so a column of faces does not glare), the eye ink and the beak.
 * The body is dark enough for the mask to read on it (≥ 3:1) and to stand off a light page, and
 * light enough to stand off a dark one (≥ 3:1 against every theme's canvas, card and muted
 * surface); the eyes keep ≥ 4.5:1 and the beak ≥ 3:1 on the mask — checked for every slot, theme
 * and mode in test/agent-palette.test.ts.
 *
 * The colours are identity data, not theme colours, like the letter tiles' in `avatar.ts`.
 */
import { avatarHue } from "./avatar";

/**
 * The body colours, by slot (the old hue anchor, 30° × slot, in the comment). They were picked in
 * OKLCH: every hue at the largest chroma sRGB holds there, lightness alternating between 0.585
 * and 0.625 so that neighbours in hue also differ in lightness, and the hues spaced wider where
 * sRGB's chroma runs short (teal to azure). The luminance band that leaves is narrow on purpose:
 * dark enough for the white mask, light enough for Frost's dark muted surface.
 */
export const AGENT_PALETTE: readonly string[] = [
  "#d83833", // 0°: red
  "#c96c05", // 30°: orange
  "#9a7606", // 60°: mustard
  "#819206", // 90°: olive
  "#05953b", // 120°: green
  "#009d8d", // 150°: teal
  "#0189a9", // 180°: cyan
  "#1e85fb", // 210°: azure
  "#6e63eb", // 240°: indigo
  "#a460e5", // 270°: violet
  "#b943b2", // 300°: magenta
  "#dc458e", // 330°: pink
];

/** The accents every slot shares, per mode. */
export const AGENT_ACCENTS = {
  /** The face mask. */
  mask: { light: "#ffffff", dark: "#f2f2f2" },
  /** The eyes. */
  eye: { light: "#1f2328", dark: "#1f2328" },
  /** The beak. */
  beak: { light: "#e8590c", dark: "#e8590c" },
  /** Frost's cheeks: a blush on the mask, drawn at the opacity below. */
  cheek: { light: "#f783ac", dark: "#f783ac" },
} as const;

/** The slot an Agent's id falls in: its hue, rounded to the nearest of the twelve anchors. */
export function agentSlot(id: string): number {
  return Math.round(avatarHue(id) / 30) % AGENT_PALETTE.length;
}

/** What a drawing paints with: each value follows the colour scheme where the modes differ. */
export interface AgentColors {
  /** The head: the Agent's colour. */
  body: string;
  mask: string;
  eye: string;
  beak: string;
  cheek: string;
}

/** Two hex colours as one `light-dark()` value, or the colour itself when both modes share it. */
function perMode(pair: { light: string; dark: string }): string {
  return pair.light === pair.dark ? pair.light : `light-dark(${pair.light}, ${pair.dark})`;
}

/** The colours a slot is drawn in. */
export function agentColorsOfSlot(slot: number): AgentColors {
  return {
    body: AGENT_PALETTE[slot % AGENT_PALETTE.length]!,
    mask: perMode(AGENT_ACCENTS.mask),
    eye: perMode(AGENT_ACCENTS.eye),
    beak: perMode(AGENT_ACCENTS.beak),
    cheek: perMode(AGENT_ACCENTS.cheek),
  };
}

/** The colours an Agent is drawn in, from its id. */
export function agentColors(id: string): AgentColors {
  return agentColorsOfSlot(agentSlot(id));
}
