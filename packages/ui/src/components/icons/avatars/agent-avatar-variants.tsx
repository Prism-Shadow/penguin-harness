/**
 * The Agent mascot — the ball penguin: one round shape that is the whole penguin, a dark hood over
 * a broad pale face, two small nub flippers, and a smile — drawn once per theme's visual language.
 * Every Agent wears the same smiling face; only its colour is its own. Every drawing has the same
 * anatomy on the same 24-unit box, so the character is recognisably one across themes: a tile in
 * the Agent's hue, and on it the penguin in that hue's five colours (agent-palette.ts) — coat,
 * face, the marks on the face (eyes, beak, smile) and the blush. No letter is drawn.
 *
 * The face is one broad heart with a small widow's peak, its edge well clear of the eyes, so no
 * eye sits in a ring of its own; the eyes are small bead dots, with a small beak and a smile under
 * it. The smile reads at every size: below 32 px the face is two bold dots and one wide, clearly
 * curved smile, without the beak — beak and thin smile there blur into a speck or fuse into a bar;
 * from 32 px up it is the bead eyes, the beak and the smile under it. The blush shows from 20 px
 * and a catch-light in the eyes from 48 px.
 *
 * - `flat` (Primer): the rounded-square tile.
 * - `soft` (Frost, and every pack on it — Doodle too): a round tile, the penguin a touch smaller
 *   inside it. Flat fills still: no gradient and no glow.
 * - `pixel` (Console): a 16x16 pixel drawing on a square tile, on crisp edges. From 16 px up the
 *   cells are laid out on whole CSS pixels (one, two, three to a cell) and centred; below 16 px no
 *   placement keeps sixteen cells whole, so the drawing scales to the box and is antialiased
 *   rather than lose an eye to rounding.
 *
 * A theme picks its drawing in CSS (the `ui-avatar` hook, see `AgentAvatar`); a theme that has
 * none shows `flat`. Adding a theme's drawing is one entry here and two rules in its pack.
 */
// deslop-ignore-file 24: the mascot is the cartoon character the owner asked for (2026-11-04), drawn in code per theme like the icon sets.
import type { ReactNode } from "react";
import type { AgentColors } from "./agent-palette";

export interface AgentDrawingProps {
  colors: AgentColors;
  /** The avatar's rendered side, in CSS px: the face's detail and the pixel layout follow it. */
  size: number;
}

/** From this rendered size up the cheeks carry their blush. */
const BLUSH_PX = 20;
/** Below this rendered size the face is drawn in its small form: no beak, a bolder smile. */
const SMALL_FACE_PX = 32;
/** From this rendered size up the eyes carry a catch-light. */
const GLINT_PX = 48;

function Blush({ colors }: Pick<AgentDrawingProps, "colors">) {
  return (
    <g style={{ fill: colors.blush }}>
      <ellipse cx="7.9" cy="15" rx="1.15" ry="0.75" />
      <ellipse cx="16.1" cy="15" rx="1.15" ry="0.75" />
    </g>
  );
}

/** The face from 32 px up: bead eyes, a small beak with a smile under it, and the blush. */
function Face({ colors, size }: AgentDrawingProps) {
  return (
    <>
      <Blush colors={colors} />
      <g style={{ fill: colors.mark }}>
        <ellipse cx="9" cy="12.6" rx="1" ry="1.28" />
        <ellipse cx="15" cy="12.6" rx="1" ry="1.28" />
        <path d="M11 13.63Q12 13.18 13 13.63Q12.36 14.84 12 14.92Q11.64 14.84 11 13.63Z" />
      </g>
      {size >= GLINT_PX && (
        <g style={{ fill: colors.face }}>
          <circle cx="9.32" cy="12.1" r="0.33" />
          <circle cx="15.32" cy="12.1" r="0.33" />
        </g>
      )}
      <path
        d="M10.6 15.95Q12 17.25 13.4 15.95"
        fill="none"
        strokeWidth="1"
        strokeLinecap="round"
        style={{ stroke: colors.mark }}
      />
    </>
  );
}

/**
 * The face below 32 px: two bold dots, so each lands on whole dark pixels, and one wide, clearly
 * curved smile in place of the beak and the thin smile under it, which there blur into a speck or
 * fuse into a bar; the blush from 20 px up.
 */
function SmallFace({ colors, size }: AgentDrawingProps) {
  return (
    <>
      {size >= BLUSH_PX && <Blush colors={colors} />}
      <g style={{ fill: colors.mark }}>
        <ellipse cx="9" cy="12" rx="1.35" ry="1.6" />
        <ellipse cx="15" cy="12" rx="1.35" ry="1.6" />
      </g>
      <path
        d="M9.9 15.1Q12 18 14.1 15.1"
        fill="none"
        strokeWidth="1.5"
        strokeLinecap="round"
        style={{ stroke: colors.mark }}
      />
    </>
  );
}

/** The ball and its face, on the 24-unit box. */
function BallPenguin({ colors, size }: AgentDrawingProps) {
  return (
    <>
      <g style={{ fill: colors.coat }}>
        <ellipse cx="3.75" cy="15.2" rx="1" ry="1.7" transform="rotate(28 3.75 15.2)" />
        <ellipse cx="20.25" cy="15.2" rx="1" ry="1.7" transform="rotate(-28 20.25 15.2)" />
        <circle cx="12" cy="12.3" r="8.8" />
      </g>
      <path
        d="M12 7.9C10.4 6.3 5.8 6.8 5.5 11.8C5.2 16.6 8.4 18.9 12 18.9C15.6 18.9 18.8 16.6 18.5 11.8C18.2 6.8 13.6 6.3 12 7.9Z"
        style={{ fill: colors.face }}
      />
      {size < SMALL_FACE_PX ? (
        <SmallFace colors={colors} size={size} />
      ) : (
        <Face colors={colors} size={size} />
      )}
    </>
  );
}

function FlatPenguin(props: AgentDrawingProps) {
  return (
    <>
      <rect width="24" height="24" rx="5" style={{ fill: props.colors.tile }} />
      <BallPenguin {...props} />
    </>
  );
}

function SoftPenguin(props: AgentDrawingProps) {
  return (
    <>
      <circle cx="12" cy="12" r="12" style={{ fill: props.colors.tile }} />
      {/* A touch smaller, about the ball's middle, so the flippers clear the round tile. */}
      <g transform="translate(0.48 0.496) scale(0.96)">
        <BallPenguin {...props} />
      </g>
    </>
  );
}

/**
 * The pixel penguin, 16 rows of 16 cells: `#` the coat, `o` the face, `x` a mark (eye, beak,
 * smile), `c` a cheek (the face below 20 px) and `.` the tile. Row 0 is the top; rows 7 and 8 hold
 * the eyes, row 9 the beak, and rows 10 and 11 the smile, a row clear of the beak so the two never
 * close into an "o". The cells are crisp from 16 px, so the smile reads there as it does larger.
 */
const PIXEL_PENGUIN = [
  "................",
  "................",
  ".....######.....",
  "...##########...",
  "..############..",
  ".###ooo##ooo###.",
  ".##oooooooooo##.",
  ".##oxooooooxo##.",
  ".##oxooooooxo##.",
  "###coooxxoooc###",
  "###ooxooooxoo###",
  ".##oooxxxxooo##.",
  "..###oooooo###..",
  "...##########...",
  ".....######.....",
  "................",
] as const;

type PixelPaint = "coat" | "face" | "mark" | "blush";

const PIXEL_PAINT: Readonly<Record<string, PixelPaint>> = {
  "#": "coat",
  o: "face",
  x: "mark",
  c: "blush",
};

/** Each paint's cells as path data in the 16-cell space: a rectangle per run of cells. */
function pixelRuns(grid: readonly string[], blush: boolean): Partial<Record<PixelPaint, string>> {
  const paintOf = (cell: string): PixelPaint | undefined => {
    const paint = PIXEL_PAINT[cell];
    return paint === "blush" && !blush ? "face" : paint;
  };
  const runs: Partial<Record<PixelPaint, string>> = {};
  grid.forEach((row, y) => {
    for (let x = 0; x < row.length;) {
      const paint = paintOf(row[x]!);
      if (paint === undefined) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < row.length && paintOf(row[x]!) === paint) x += 1;
      runs[paint] = `${runs[paint] ?? ""}M${start} ${y}h${x - start}v1h-${x - start}z`;
    }
  });
  return runs;
}

/** The cells a side. */
const PIXEL_CELLS = 16;

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

const PIXEL_ORDER: readonly PixelPaint[] = ["coat", "face", "blush", "mark"];

function PixelPenguin({ colors, size }: AgentDrawingProps) {
  const { transform, crisp } = pixelPlacement(size);
  const runs = pixelRuns(PIXEL_PENGUIN, size >= BLUSH_PX);
  return (
    <>
      <rect width="24" height="24" style={{ fill: colors.tile }} />
      <g transform={transform} shapeRendering={crisp ? "crispEdges" : undefined}>
        {PIXEL_ORDER.map((paint) =>
          runs[paint] === undefined ? null : (
            <path key={paint} d={runs[paint]} style={{ fill: colors[paint] }} />
          ),
        )}
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
