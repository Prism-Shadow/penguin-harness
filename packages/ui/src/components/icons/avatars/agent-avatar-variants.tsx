/**
 * The Agent mascot — the ball penguin: one round shape that is the whole penguin, a dark hood over
 * a broad pale face, two small nub flippers — drawn once per theme's visual language, and wearing
 * the Agent's expression (agent-expression.ts). Every drawing has the same anatomy on the same
 * 24-unit box, so the character is recognisably one across themes: a tile in the Agent's hue, and
 * on it the penguin in that hue's five colours (agent-palette.ts) — coat, face, the marks on the
 * face (eyes, beak, a smile) and the blush. No letter is drawn.
 *
 * The face is one broad heart with a small widow's peak, its edge well clear of the eyes, so no
 * eye sits in a ring of its own; the eyes are small. Below 20 px every face becomes two bold bead
 * dots — a closed eye there antialiases into a dash, and two of them into one bar across the face —
 * and the catch-light, the blush and the smile are left out, so each eye lands on whole dark
 * pixels; the faces part from 20 px up. A catch-light shows from 48 px up. The pixel drawing keeps
 * every face at every size: its cells stay crisp from 16 px.
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
import type { AgentExpression } from "./agent-expression";
import type { AgentColors } from "./agent-palette";

export interface AgentDrawingProps {
  colors: AgentColors;
  expression: AgentExpression;
  /** The avatar's rendered side, in CSS px: the face's detail and the pixel layout follow it. */
  size: number;
}

/** Below this rendered size the face drops what cannot resolve and draws its eyes bolder. */
const SMALL_PX = 20;
/** From this rendered size up a bead eye carries its catch-light. */
const GLINT_PX = 48;

/** The eyes' line, and their distance either side of the middle. */
const EYE_Y = 12.6;
const EYE_DX = 3;

const r2 = (value: number) => Math.round(value * 100) / 100;

function BeadEye({ x, colors, size }: { x: number; colors: AgentColors; size: number }) {
  const [rx, ry] = size < SMALL_PX ? [1.45, 1.7] : [1, 1.28];
  return (
    <>
      <ellipse cx={x} cy={EYE_Y} rx={rx} ry={ry} style={{ fill: colors.mark }} />
      {size >= GLINT_PX && (
        <circle cx={r2(x + 0.32)} cy={EYE_Y - 0.5} r={0.33} style={{ fill: colors.face }} />
      )}
    </>
  );
}

/** A closed eye: an arc bowed upward (happy) or a flatter one bowed downward (relaxed). */
function ClosedEye({ x, up, colors }: { x: number; up: boolean; colors: AgentColors }) {
  const half = 1.25;
  const [end, bow] = up
    ? [EYE_Y + half * 0.5, EYE_Y - half * 1.5]
    : [EYE_Y - half * 0.3, EYE_Y + half * 0.9];
  return (
    <path
      d={`M${r2(x - half)} ${r2(end)}Q${x} ${r2(bow)} ${r2(x + half)} ${r2(end)}`}
      fill="none"
      strokeWidth="1"
      strokeLinecap="round"
      style={{ stroke: colors.mark }}
    />
  );
}

function Eyes({ expression, colors, size }: AgentDrawingProps) {
  const [left, right] = [12 - EYE_DX, 12 + EYE_DX];
  const bead = (x: number) => <BeadEye x={x} colors={colors} size={size} />;
  const closed = (x: number, up: boolean) => <ClosedEye x={x} up={up} colors={colors} />;
  // Below 20 px a closed eye cannot resolve: every face is two bead dots there.
  switch (size < SMALL_PX ? "bead" : expression) {
    case "happy":
      return (
        <>
          {closed(left, true)}
          {closed(right, true)}
        </>
      );
    case "wink":
      return (
        <>
          {bead(left)}
          {closed(right, true)}
        </>
      );
    case "sleepy":
      return (
        <>
          {closed(left, false)}
          {closed(right, false)}
        </>
      );
    case "bead":
    case "smile":
      return (
        <>
          {bead(left)}
          {bead(right)}
        </>
      );
  }
}

/** The ball and its face, on the 24-unit box. */
function BallPenguin(props: AgentDrawingProps) {
  const { colors, expression, size } = props;
  const detail = size >= SMALL_PX;
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
      {detail && (
        <g style={{ fill: colors.blush }}>
          <ellipse cx="7.9" cy="15" rx="1.15" ry="0.75" />
          <ellipse cx="16.1" cy="15" rx="1.15" ry="0.75" />
        </g>
      )}
      <Eyes {...props} />
      <path
        d="M11 13.63Q12 13.18 13 13.63Q12.36 14.84 12 14.92Q11.64 14.84 11 13.63Z"
        style={{ fill: colors.mark }}
      />
      {expression === "smile" && detail && (
        <path
          d="M10.9 15.75Q12 16.75 13.1 15.75"
          fill="none"
          strokeWidth="1"
          strokeLinecap="round"
          style={{ stroke: colors.mark }}
        />
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
 * the eyes, rows 10 and 11 a smile, a row clear of the beak so the two never close into an "o".
 */
function pixelBall(eyes: readonly [string, string], mouth?: readonly [string, string]) {
  return [
    "................",
    "................",
    ".....######.....",
    "...##########...",
    "..############..",
    ".###ooo##ooo###.",
    ".##oooooooooo##.",
    eyes[0],
    eyes[1],
    "###coooxxoooc###",
    mouth?.[0] ?? "###oooooooooo###",
    mouth?.[1] ?? ".##oooooooooo##.",
    "..###oooooo###..",
    "...##########...",
    ".....######.....",
    "................",
  ] as const;
}

const BEAD_EYES = [".##oxooooooxo##.", ".##oxooooooxo##."] as const;

const PIXEL_FACES: Readonly<Record<AgentExpression, readonly string[]>> = {
  bead: pixelBall(BEAD_EYES),
  happy: pixelBall([".##ooxooooxoo##.", ".##oxoxooxoxo##."]),
  wink: pixelBall([".##ooxooooxoo##.", ".##ooxoooxoxo##."]),
  smile: pixelBall(BEAD_EYES, ["###ooxooooxoo###", ".##oooxxxxooo##."]),
  sleepy: pixelBall([".##oxoxooxoxo##.", ".##ooxooooxoo##."]),
};

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

function PixelPenguin({ colors, expression, size }: AgentDrawingProps) {
  const { transform, crisp } = pixelPlacement(size);
  const runs = pixelRuns(PIXEL_FACES[expression], size >= SMALL_PX);
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
