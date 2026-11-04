/**
 * The Agent mascot — one small penguin seen face on — drawn once per theme's visual language.
 * Every drawing has the same anatomy on the same 24-unit box, so the character is recognisably
 * one across themes: a head in the Agent's colour, a white face mask whose two lobes leave a V of
 * the head colour on the forehead, two upright capsule eyes and a small orange beak. No mouth,
 * no letter: at 16 px those are what crowd the eyes out.
 *
 * - `flat` (Primer): the head fills the tile edge to edge, flat fills, no outline.
 * - `soft` (Frost): a round head with no tile around it, a rounder face and a blush on the
 *   cheeks — flat fills still, no gradient and no glow, and no tint of its own colour behind it.
 * - `pixel` (Console): a 16x16 pixel drawing on crisp edges. From 16 px up the cells are laid
 *   out on whole CSS pixels (one, two, three to a cell) and centred on the head colour, which
 *   fills the whole tile; below 16 px no placement keeps sixteen cells whole, so the drawing
 *   scales to the box and is antialiased rather than lose an eye to rounding.
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
      <rect width="24" height="24" rx="5" style={{ fill: colors.body }} />
      <g style={{ fill: colors.mask }}>
        <circle cx="8.4" cy="12.4" r="4.6" />
        <circle cx="15.6" cy="12.4" r="4.6" />
        <ellipse cx="12" cy="16.3" rx="7.6" ry="5.3" />
      </g>
      <g style={{ fill: colors.eye }}>
        <rect x="8.1" y="11.2" width="2.3" height="4" rx="1.15" />
        <rect x="13.6" y="11.2" width="2.3" height="4" rx="1.15" />
      </g>
      <path
        d="M10.2 15.9Q12 15.3 13.8 15.9L12.7 18Q12 18.8 11.3 18Z"
        style={{ fill: colors.beak }}
      />
    </>
  );
}

function SoftPenguin({ colors }: AgentDrawingProps) {
  return (
    <>
      <circle cx="12" cy="12" r="11.5" style={{ fill: colors.body }} />
      <g style={{ fill: colors.mask }}>
        <circle cx="8.6" cy="12.2" r="4.6" />
        <circle cx="15.4" cy="12.2" r="4.6" />
        <ellipse cx="12" cy="16" rx="7.2" ry="5.2" />
      </g>
      <g style={{ fill: colors.cheek }} opacity="0.6">
        <ellipse cx="7.2" cy="16.4" rx="1.4" ry="0.9" />
        <ellipse cx="16.8" cy="16.4" rx="1.4" ry="0.9" />
      </g>
      <g style={{ fill: colors.eye }}>
        <rect x="8.4" y="11.2" width="2.4" height="3.6" rx="1.2" />
        <rect x="13.2" y="11.2" width="2.4" height="3.6" rx="1.2" />
      </g>
      <path
        d="M10.5 15.6Q12 15 13.5 15.6Q13.2 17.5 12 18Q10.8 17.5 10.5 15.6Z"
        style={{ fill: colors.beak }}
      />
    </>
  );
}

/**
 * The pixel face, 16 rows of 16 cells: `o` the mask, `e` an eye, `b` the beak, `.` the head
 * colour the tile already paints. Row 0 is the top.
 */
const PIXEL_FACE = [
  "................",
  "................",
  "................",
  "................",
  "....ooo..ooo....",
  "...oooooooooo...",
  "...ooeooooeoo...",
  "..oooeooooeooo..",
  "..ooooobbooooo..",
  "..oooooooooooo..",
  "...oooooooooo...",
  "....oooooooo....",
  ".....oooooo.....",
  "................",
  "................",
  "................",
] as const;

/** One part of the pixel face as path data in its 16-cell space: a rectangle per run of cells. */
function cellRuns(part: string): string {
  let d = "";
  PIXEL_FACE.forEach((row, y) => {
    for (let x = 0; x < row.length;) {
      if (row[x] !== part) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < row.length && row[x] === part) x += 1;
      d += `M${start} ${y}h${x - start}v1h-${x - start}z`;
    }
  });
  return d;
}

const PIXEL_MASK = cellRuns("o");
const PIXEL_EYES = cellRuns("e");
const PIXEL_BEAK = cellRuns("b");

/** The cells a side. */
const PIXEL_CELLS = PIXEL_FACE.length;

const round4 = (value: number) => Math.round(value * 1e4) / 1e4;

/**
 * Where the pixel face sits in the 24-unit box at `size` px: from 16 px up, whole CSS pixels to a
 * cell and centred on whole pixels; below, scaled to the box.
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
      <rect width="24" height="24" style={{ fill: colors.body }} />
      <g transform={transform} shapeRendering={crisp ? "crispEdges" : undefined}>
        <path d={PIXEL_MASK} style={{ fill: colors.mask }} />
        <path d={PIXEL_EYES} style={{ fill: colors.eye }} />
        <path d={PIXEL_BEAK} style={{ fill: colors.beak }} />
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
