/**
 * The Agent mascot — one small penguin, standing, seen from the front — drawn once per theme's
 * visual language. Every drawing has the same anatomy on the same 24-unit box, so the character is
 * recognisably one across themes: a pale tile in the Agent's hue, and on it the penguin in that
 * hue's ink — head and body, its face and belly cut out of it to show the tile, two eye dots, a
 * small beak and its feet. One colour family per avatar, as the letter tiles had: the whole body
 * reads at 16 px where a face alone turned to noise, and the ink on a quiet tile keeps a column of
 * Agents as calm as the text beside it. No letter is drawn.
 *
 * - `flat` (Primer): the rounded-square tile, smooth shapes, flippers held out a little.
 * - `soft` (Frost): a round tile and a rounder penguin with no flippers — flat fills still, no
 *   gradient and no glow.
 * - `pixel` (Console): a 16x16 pixel drawing on a square tile, on crisp edges. From 16 px up the
 *   cells are laid out on whole CSS pixels (one, two, three to a cell) and centred; below 16 px no
 *   placement keeps sixteen cells whole, so the drawing scales to the box and is antialiased
 *   rather than lose an eye to rounding.
 *
 * A theme picks its drawing in CSS (the `ui-avatar` hook, see `AgentAvatar`); a theme that has
 * none shows `flat`. Adding a theme's drawing is one entry here and two rules in its theme file.
 */
// deslop-ignore-file 24: the mascot is the cartoon character the owner asked for (2026-11-04), drawn in code per theme like the icon sets.
import type { ReactNode } from "react";
import type { AgentColors } from "./agent-palette";

export interface AgentDrawingProps {
  colors: AgentColors;
  /** The avatar's rendered side, in CSS px: the pixel drawing lays its cells out on it. */
  size: number;
}

function FlatPenguin({ colors }: AgentDrawingProps) {
  return (
    <>
      <rect width="24" height="24" rx="5" style={{ fill: colors.tile }} />
      <g style={{ fill: colors.ink }}>
        <ellipse cx="5.9" cy="14.4" rx="1.35" ry="3.5" transform="rotate(18 5.9 14.4)" />
        <ellipse cx="18.1" cy="14.4" rx="1.35" ry="3.5" transform="rotate(-18 18.1 14.4)" />
        <circle cx="12" cy="8.3" r="5.1" />
        <ellipse cx="12" cy="14.6" rx="6.3" ry="6.9" />
        <ellipse cx="9.6" cy="21.3" rx="2" ry="0.95" />
        <ellipse cx="14.4" cy="21.3" rx="2" ry="0.95" />
      </g>
      <g style={{ fill: colors.tile }}>
        <circle cx="10.1" cy="9.2" r="2.5" />
        <circle cx="13.9" cy="9.2" r="2.5" />
        <ellipse cx="12" cy="15.1" rx="4.5" ry="5.5" />
      </g>
      <g style={{ fill: colors.ink }}>
        <circle cx="10.4" cy="9.3" r="0.95" />
        <circle cx="13.6" cy="9.3" r="0.95" />
        <path d="M10.8 11.2H13.2L12 12.9Z" />
      </g>
    </>
  );
}

function SoftPenguin({ colors }: AgentDrawingProps) {
  return (
    <>
      <circle cx="12" cy="12" r="12" style={{ fill: colors.tile }} />
      <g style={{ fill: colors.ink }}>
        <circle cx="12" cy="8.96" r="5.15" />
        <ellipse cx="12" cy="14.67" rx="6.35" ry="5.98" />
        <ellipse cx="9.79" cy="20.56" rx="1.84" ry="0.87" />
        <ellipse cx="14.21" cy="20.56" rx="1.84" ry="0.87" />
      </g>
      <g style={{ fill: colors.tile }}>
        <circle cx="10.25" cy="9.88" r="2.3" />
        <circle cx="13.75" cy="9.88" r="2.3" />
        <ellipse cx="12" cy="15.13" rx="4.51" ry="4.78" />
      </g>
      <g style={{ fill: colors.ink }}>
        <circle cx="10.53" cy="9.98" r="0.87" />
        <circle cx="13.47" cy="9.98" r="0.87" />
        <path d="M10.9 11.63H13.1L12 13.2Z" />
      </g>
    </>
  );
}

/**
 * The pixel penguin, 16 rows of 16 cells: `#` the body, `e` an eye, `b` the beak and `f` a foot,
 * all in ink; `o` the face and belly and `.` the ground, both the tile the drawing stands on.
 * Row 0 is the top.
 */
const PIXEL_PENGUIN = [
  "................",
  "......####......",
  "....########....",
  "...##########...",
  "...##oo##oo##...",
  "..##oeooooeo##..",
  "..##ooobbooo##..",
  ".###oooooooo###.",
  ".###oooooooo###.",
  "..##oooooooo##..",
  "..##oooooooo##..",
  "..###oooooo###..",
  "...###oooo###...",
  "....########....",
  "....ff....ff....",
  "................",
] as const;

/** The ink parts of the pixel penguin. */
const PIXEL_INK = new Set(["#", "e", "b", "f"]);

/** The ink cells as path data in their 16-cell space: a rectangle per run of cells. */
function inkRuns(): string {
  let d = "";
  PIXEL_PENGUIN.forEach((row, y) => {
    for (let x = 0; x < row.length;) {
      if (!PIXEL_INK.has(row[x]!)) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < row.length && PIXEL_INK.has(row[x]!)) x += 1;
      d += `M${start} ${y}h${x - start}v1h-${x - start}z`;
    }
  });
  return d;
}

const PIXEL_INK_PATH = inkRuns();

/** The cells a side. */
const PIXEL_CELLS = PIXEL_PENGUIN.length;

const round4 = (value: number) => Math.round(value * 1e4) / 1e4;

/**
 * Where the pixel penguin sits in the 24-unit box at `size` px: from 16 px up, whole CSS pixels
 * to a cell and centred on whole pixels; below, scaled to the box.
 */
function pixelPlacement(size: number): { transform: string; crisp: boolean } {
  if (size < PIXEL_CELLS) return { transform: `scale(${24 / PIXEL_CELLS})`, crisp: false };
  const unit = 24 / size;
  const cell = Math.floor(size / PIXEL_CELLS);
  const at = round4(Math.round((size - cell * PIXEL_CELLS) / 2) * unit);
  return { transform: `translate(${at} ${at}) scale(${round4(cell * unit)})`, crisp: true };
}

function PixelPenguin({ colors, size }: AgentDrawingProps) {
  const { transform, crisp } = pixelPlacement(size);
  return (
    <>
      <rect width="24" height="24" style={{ fill: colors.tile }} />
      <g transform={transform} shapeRendering={crisp ? "crispEdges" : undefined}>
        <path d={PIXEL_INK_PATH} style={{ fill: colors.ink }} />
      </g>
    </>
  );
}

/** Every theme's drawing, by name: the `data-variant` a theme's CSS shows. */
export const AGENT_AVATAR_VARIANTS = {
  flat: FlatPenguin,
  soft: SoftPenguin,
  pixel: PixelPenguin,
} as const satisfies Readonly<Record<string, (props: AgentDrawingProps) => ReactNode>>;

export type AgentAvatarVariant = keyof typeof AGENT_AVATAR_VARIANTS;

/** The drawings in the order an avatar writes them; `flat`, the fallback, first. */
export const AGENT_AVATAR_VARIANT_NAMES = Object.keys(
  AGENT_AVATAR_VARIANTS,
) as readonly AgentAvatarVariant[];
