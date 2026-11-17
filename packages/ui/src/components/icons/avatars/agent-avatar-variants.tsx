/**
 * The Agent mascot — a small penguin in the manner of stationery-shop character goods: one egg
 * that is the whole penguin, flippers held at its sides and two orange feet, a cream face that runs
 * down into the belly, tiny eyes set low and wide, a small orange beak and a curl of a feather on
 * top, all drawn with one thin brown line — drawn once per theme's visual language. Every Agent has
 * the same face, and the same face at every size; its colours are its own (agent-palette.ts), and
 * so is what it wears (agent-accessory.ts). Every drawing has the same anatomy on the same box, so
 * the character is recognisably one across themes. No letter is drawn.
 *
 * The features are tiny by design, so the smaller the avatar, the larger they are drawn (`detail`):
 * from 40 px up they are at their true size and the line is at its finest; from 24 px a step
 * larger; under 24 px larger again, with a heavier line in the eyes' darker brown, so at 14 px the
 * outline and the two eyes still land on whole pixels. The cheeks blush from 20 px, and the beak
 * has a brown rim from 24 px.
 *
 * The penguin is drawn on a 48-unit grid, half the box's unit, so its line takes the icon family's
 * weights — 2, 1.5 and 1 there, a unit, three quarters and a half of the box's. It stays inside a
 * round tile, accessories included: nothing is clipped, so a theme may cut the avatar's box to a
 * shape of its own and lose only the edge.
 *
 * - `flat` (Primer): the rounded-square tile.
 * - `soft` (Frost, and every pack on it — Doodle too): a round tile. Flat fills still: no gradient
 *   and no glow.
 * - `pixel` (Console): the same penguin on a 16x16 grid, outline and all, on a square tile, on
 *   crisp edges. From 16 px up the cells are laid out on whole CSS pixels (one, two, three to a
 *   cell) and centred; below 16 px no placement keeps sixteen cells whole, so the drawing scales to
 *   the box and is antialiased rather than lose an eye to rounding, and its eyes are a cell wider.
 *
 * A theme picks its drawing in CSS (the `ui-avatar` hook, see `AgentAvatar`); a theme that has
 * none shows `flat`. Adding a theme's drawing is one entry here and two rules in its pack.
 */
// deslop-ignore-file 24: the mascot is the cartoon character the owner asked for (2026-11-04), drawn in code per theme like the icon sets.
import type { ReactNode } from "react";
import type { AgentAccessory } from "./agent-accessory";
import type { AgentColors } from "./agent-palette";

export interface AgentDrawingProps {
  colors: AgentColors;
  /** What the Agent wears. */
  accessory: AgentAccessory;
  /** The avatar's rendered side, in CSS px: the face's detail and the pixel layout follow it. */
  size: number;
}

/** From this rendered size up the cheeks carry their blush. */
const BLUSH_PX = 20;
/** From this rendered size up the features are drawn a step smaller, and the line is lighter. */
const MID_PX = 24;
/** From this rendered size up the features are at their true size, and the line at its finest. */
const FINE_PX = 40;

/** What covers the top of the head, where the feather curl would stand. */
const HEADWEAR: ReadonlySet<AgentAccessory> = new Set(["beanie", "cap", "headphones", "sprout"]);

/** The colour the line is drawn in at `size` px: under 24 px, the eyes' darker brown. */
const lineInk = (size: number): "line" | "mark" => (size < MID_PX ? "mark" : "line");

/** The face's detail at a rendered size, on the 48-unit grid. */
interface Detail {
  /** The line's weight: one of the icon family's. */
  weight: "1" | "1.5" | "2";
  /** Each eye's radius across; it is a tenth taller than wide. */
  eye: number;
  /** The beak's size, as a multiple of its true size. */
  beak: number;
  /** Whether the beak has a brown rim. */
  rim: boolean;
}

function detail(size: number): Detail {
  if (size >= FINE_PX) return { weight: "1", eye: 1.32, beak: 1, rim: true };
  if (size >= MID_PX) return { weight: "1.5", eye: 1.64, beak: 1.2, rim: true };
  return { weight: "2", eye: 2.6, beak: 1.45, rim: false };
}

const round4 = (value: number) => Math.round(value * 1e4) / 1e4;

/** Where the eyes sit on the 48-unit grid: the left one's centre, and the right one's x. */
const EYE = { x: 17.8, y: 27, mirror: 30.2 } as const;

/**
 * What the penguin wears, over the finished penguin, on the 48-unit grid: filled in the accent and
 * edged by the line the caller has set. Headwear stands a little proud of the head and the scarf
 * of the body, both inside a round tile.
 */
function Accessory({
  colors,
  accessory,
  ink,
}: Pick<AgentDrawingProps, "colors" | "accessory"> & {
  ink: string;
}) {
  const fill = { fill: colors.accent };
  switch (accessory) {
    case "scarf":
      return (
        <g style={fill}>
          <path d="M30.8 37L35.2 36L36.8 42L32.4 42.4Z" />
          <path d="M8.4 32.4Q24 39.2 39.6 32.4L40.4 36.2Q24 43.4 7.6 36.2Z" />
        </g>
      );
    case "beanie":
      return (
        <g style={fill}>
          <circle cx="24" cy="5" r="2.8" />
          <path d="M9.4 18.8C9.4 10.8 16 5.8 24 5.8C32 5.8 38.6 10.8 38.6 18.8Z" />
          <rect x="7.8" y="16.2" width="32.4" height="4.4" rx="2.2" />
        </g>
      );
    case "cap":
      return (
        <g style={fill}>
          <path d="M23 16.2H42.4Q44.6 16.2 44.6 18.3Q44.6 20.4 42.4 20.4H23Z" />
          <path d="M10 18.4C10 10.8 16.4 6 24 6C31.6 6 38 10.8 38 18.4Z" />
        </g>
      );
    case "headphones":
      return (
        <g style={fill}>
          <path d="M6.8 22.4C6.8 11.6 14.4 4.4 24 4.4C33.6 4.4 41.2 11.6 41.2 22.4H38.4C38.4 13.2 32 7.2 24 7.2C16 7.2 9.6 13.2 9.6 22.4Z" />
          <rect x="3.8" y="20.8" width="6.8" height="10" rx="3" />
          <rect x="37.4" y="20.8" width="6.8" height="10" rx="3" />
        </g>
      );
    case "sprout":
      return (
        <>
          <path d="M24 8V5" fill="none" />
          <path
            d="M24 5.8C21 6 18.4 4.2 18 1.8C21.2 1.2 23.8 3 24 5.8ZM24 5.8C27 6 29.6 4.2 30 1.8C26.8 1.2 24.2 3 24 5.8Z"
            style={fill}
          />
        </>
      );
    case "bow":
      return (
        <g transform="translate(33.8 11) rotate(24)" style={fill}>
          <path d="M-0.6 0C-2.4-3.2-5.8-3.6-6.6-1.6C-7 0.4-5.8 2.6-3.6 3C-2.2 2.6-1.2 1.4-0.6 0Z" />
          <path d="M0.6 0C2.4-3.2 5.8-3.6 6.6-1.6C7 0.4 5.8 2.6 3.6 3C2.2 2.6 1.2 1.4 0.6 0Z" />
          <circle r="1.6" />
        </g>
      );
    case "glasses": {
      // Round frames clear of the eyes at every size: an accent ring edged by the line, drawn as
      // the line's width with the accent's narrower one over it.
      const frames = (
        <>
          <circle cx={EYE.x} cy={EYE.y} r="4.4" />
          <circle cx={EYE.mirror} cy={EYE.y} r="4.4" />
          <path d="M21.9 25.5Q24 24.3 26.1 25.5" />
        </>
      );
      return (
        <g fill="none">
          <g style={{ stroke: ink }} strokeWidth="2.2">
            {frames}
          </g>
          <g style={{ stroke: colors.accent }} strokeWidth="1">
            {frames}
          </g>
        </g>
      );
    }
    case "none":
      return null;
  }
}

/** The penguin on the 48-unit grid: the egg (24 7.6 to 24 43.2) and everything on it. */
function Penguin({ colors, accessory, size }: AgentDrawingProps) {
  const d = detail(size);
  const ink = colors[lineInk(size)];
  const eye = { rx: round4(d.eye), ry: round4(d.eye * 1.1) };
  const beak = { rx: round4(1.9 * d.beak), ry: round4(1.24 * d.beak) };
  return (
    <g transform="scale(0.5)">
      <g
        style={{ stroke: ink }}
        strokeWidth={d.weight}
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        <g style={{ fill: colors.beak }}>
          <ellipse cx="18.6" cy="43.8" rx="3.6" ry="1.7" />
          <ellipse cx="29.4" cy="43.8" rx="3.6" ry="1.7" />
        </g>
        <g style={{ fill: colors.coat }}>
          <path d="M9.2 25.2C5.6 26 3.6 30 4.6 34.4C7.2 34.4 9.6 32.8 10.8 30Z" />
          <path d="M38.8 25.2C42.4 26 44.4 30 43.4 34.4C40.8 34.4 38.4 32.8 37.2 30Z" />
          <path d="M24 7.6C33.2 7.6 40.8 16.4 40.8 28C40.8 37.6 34.4 43.2 24 43.2C13.6 43.2 7.2 37.6 7.2 28C7.2 16.4 14.8 7.6 24 7.6Z" />
        </g>
        {!HEADWEAR.has(accessory) && <path d="M24 7.8C23.2 5.6 24.4 4 26.6 4.2" fill="none" />}
      </g>
      <path
        d="M24 18.8C21.8 16.6 17.8 16.4 15.2 18.6C11.8 21.6 10.8 27.2 12 32.4C13.4 38 18 41.2 24 41.2C30 41.2 34.6 38 36 32.4C37.2 27.2 36.2 21.6 32.8 18.6C30.2 16.4 26.2 16.6 24 18.8Z"
        style={{ fill: colors.face }}
      />
      {size >= BLUSH_PX && (
        <g style={{ fill: colors.blush }}>
          <ellipse cx="14.4" cy="30.6" rx="2.6" ry="1.56" />
          <ellipse cx="33.6" cy="30.6" rx="2.6" ry="1.56" />
        </g>
      )}
      <g style={{ fill: colors.mark }}>
        <ellipse cx={EYE.x} cy={EYE.y} {...eye} />
        <ellipse cx={EYE.mirror} cy={EYE.y} {...eye} />
      </g>
      {d.rim && (
        <ellipse
          cx="24"
          cy="28.8"
          rx={round4(beak.rx + 0.6)}
          ry={round4(beak.ry + 0.6)}
          style={{ fill: ink }}
        />
      )}
      <ellipse cx="24" cy="28.8" {...beak} style={{ fill: colors.beak }} />
      <g
        style={{ stroke: ink }}
        strokeWidth={d.weight}
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        <Accessory colors={colors} accessory={accessory} ink={ink} />
      </g>
    </g>
  );
}

function FlatPenguin(props: AgentDrawingProps) {
  return (
    <>
      <rect width="24" height="24" rx="5" style={{ fill: props.colors.tile }} />
      <Penguin {...props} />
    </>
  );
}

function SoftPenguin(props: AgentDrawingProps) {
  return (
    <>
      <circle cx="12" cy="12" r="12" style={{ fill: props.colors.tile }} />
      <Penguin {...props} />
    </>
  );
}

/**
 * The pixel penguin, 16 rows of 16 cells: `l` the line, `#` the coat, `o` the face, `x` an eye,
 * `c` a cheek (the face below 20 px), `b` the beak, `f` a foot, `a` what it wears and `.` the tile.
 * Row 0 is the top; rows 8 and 9 hold the eyes and row 9 the beak. The cells are crisp from 16 px.
 */
const PIXEL_PENGUIN = [
  "................",
  "................",
  ".....llllll.....",
  "....l######l....",
  "...l########l...",
  "..l##########l..",
  "..l##oo##oo##l..",
  "..l#oooooooo#l..",
  ".l##oxooooxo##l.",
  ".l##oxobboxo##l.",
  ".l##cooooooc##l.",
  "..l#oooooooo#l..",
  "..l##oooooo##l..",
  "...l##oooo##l...",
  "....llllllll....",
  ".....ff..ff.....",
] as const;

/** Rows laid over the penguin from `top` down: a cell other than `.` replaces the one under it. */
interface PixelOverlay {
  top: number;
  rows: readonly string[];
}

/** The feather curl, where nothing covers the head. */
const PIXEL_CURL: PixelOverlay = { top: 0, rows: ["........ll......", ".......l........"] };

/**
 * The eyes a cell wider, for a penguin scaled below 16 px: there a one-cell eye is less than a
 * pixel wide and blurs to grey. Glasses, laid over after, take the outer cell back.
 */
const PIXEL_WIDE_EYES: PixelOverlay = {
  top: 8,
  rows: ["....xx....xx....", "....xx....xx...."],
};

/** What the pixel penguin wears. */
const PIXEL_ACCESSORIES: Readonly<Record<AgentAccessory, PixelOverlay | null>> = {
  none: null,
  scarf: {
    top: 11,
    rows: ["...aaaaaaaaaa...", "...aaaaaaaaaa...", ".........aa....."],
  },
  beanie: {
    top: 0,
    rows: [
      ".......aa.......",
      ".....aaaaaa.....",
      "....aaaaaaaa....",
      "...aaaaaaaaaa...",
      "..llllllllllll..",
      "..aaaaaaaaaaaa..",
    ],
  },
  cap: {
    top: 1,
    rows: [".....aaaaaa.....", "....aaaaaaaa....", "...aaaaaaaaaa...", "...aaaaaaaaaaaaa"],
  },
  headphones: {
    top: 1,
    rows: [
      ".....aaaaaa.....",
      "....a......a....",
      "...a........a...",
      "..a..........a..",
      ".a............a.",
      "aa............aa",
      "aaa..........aaa",
      "aaa..........aaa",
      "aaa..........aaa",
      "aa............aa",
    ],
  },
  sprout: {
    top: 0,
    rows: [".....aa..aa.....", "......alla......"],
  },
  bow: {
    top: 2,
    rows: ["..........aa.aa.", "..........aaaaa.", "..........aa.aa."],
  },
  glasses: {
    top: 7,
    rows: ["....aaa..aaa....", "....a.aaaa.a....", "....a.a..a.a....", "....aaa..aaa...."],
  },
};

/** The penguin's grid with `overlay` laid over it. */
function overlaid(grid: readonly string[], overlay: PixelOverlay | null): readonly string[] {
  if (overlay === null) return grid;
  return grid.map((row, y) => {
    const over = overlay.rows[y - overlay.top];
    if (over === undefined) return row;
    return Array.from(row, (cell, x) => (over[x] === "." ? cell : over[x]!)).join("");
  });
}

/**
 * The pixel penguin as each accessory dresses it, with the curl wherever the head is bare: `fine`
 * from 16 px up, `wide` (the wider eyes) below.
 */
const PIXEL_GRIDS = Object.fromEntries(
  (["fine", "wide"] as const).map((eyes) => {
    const face = eyes === "wide" ? overlaid(PIXEL_PENGUIN, PIXEL_WIDE_EYES) : PIXEL_PENGUIN;
    const dressed = Object.fromEntries(
      Object.entries(PIXEL_ACCESSORIES).map(([accessory, overlay]) => [
        accessory,
        overlaid(
          HEADWEAR.has(accessory as AgentAccessory) ? face : overlaid(face, PIXEL_CURL),
          overlay,
        ),
      ]),
    );
    return [eyes, dressed];
  }),
) as Readonly<Record<"fine" | "wide", Readonly<Record<AgentAccessory, readonly string[]>>>>;

type PixelPaint = "line" | "coat" | "face" | "mark" | "blush" | "beak" | "accent";

const PIXEL_PAINT: Readonly<Record<string, PixelPaint>> = {
  l: "line",
  "#": "coat",
  o: "face",
  x: "mark",
  b: "beak",
  f: "beak",
  a: "accent",
};

/** Each paint's cells as path data in the 16-cell space: a rectangle per run of cells. */
function pixelRuns(grid: readonly string[], size: number): Partial<Record<PixelPaint, string>> {
  const paintOf = (cell: string): PixelPaint | undefined => {
    if (cell === "c") return size >= BLUSH_PX ? "blush" : "face";
    return PIXEL_PAINT[cell];
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

const PIXEL_ORDER: readonly PixelPaint[] = [
  "line",
  "coat",
  "face",
  "blush",
  "beak",
  "accent",
  "mark",
];

function PixelPenguin({ colors, accessory, size }: AgentDrawingProps) {
  const { transform, crisp } = pixelPlacement(size);
  const runs = pixelRuns(PIXEL_GRIDS[crisp ? "fine" : "wide"][accessory], size);
  const paint = (name: PixelPaint) => colors[name === "line" ? lineInk(size) : name];
  return (
    <>
      <rect width="24" height="24" style={{ fill: colors.tile }} />
      <g transform={transform} shapeRendering={crisp ? "crispEdges" : undefined}>
        {PIXEL_ORDER.map((name) =>
          runs[name] === undefined ? null : (
            <path key={name} d={runs[name]} style={{ fill: paint(name) }} />
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
