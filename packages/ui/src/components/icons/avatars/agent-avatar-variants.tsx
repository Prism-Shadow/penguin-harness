/**
 * The Agent mascot — a round penguin chick seen close up: one ball that is the whole penguin,
 * resting on the tile's bottom edge, a dark hood over a broad pale face that runs down into the
 * belly, a feather tuft, two big eyes, an open orange beak and blushing cheeks — drawn once per
 * theme's visual language. Every Agent has the same face, and the same face at every size; its
 * colours are its own (agent-palette.ts), and so is what it wears (agent-accessory.ts). Every
 * drawing has the same anatomy on the same 24-unit box, so the character is recognisably one
 * across themes. No letter is drawn.
 *
 * The ball fills the tile rather than floating in it: the face is what a 14 px avatar has room
 * for, so the tile shows only above the head and in the corners. The face is one broad heart with
 * a small widow's peak, open at the bottom, so the coat is a hood and two sides, not a ring around
 * the face. The eyes sit low and wide, each with a catch-light from 24 px and a second from 48 px;
 * the cheeks blush from 20 px.
 *
 * The ball is one exact circle that touches the tile's bottom edge and stays inside a round tile,
 * and whatever the ball cuts — the belly, a scarf — ends on that circle's own arc. Nothing is
 * clipped, so a theme may cut the avatar's box to a shape of its own and lose only the edge.
 *
 * - `flat` (Primer): the rounded-square tile.
 * - `soft` (Frost, and every pack on it — Doodle too): a round tile. Flat fills still: no gradient
 *   and no glow.
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
/** From this rendered size up the eyes carry a catch-light. */
const GLINT_PX = 24;
/** From this rendered size up the eyes carry a second, smaller catch-light. */
const SPARKLE_PX = 48;

/** What covers the top of the head, where the tuft would stand. */
const HEADWEAR: ReadonlySet<AgentAccessory> = new Set(["beanie", "cap", "headphones", "sprout"]);

const round4 = (value: number) => Math.round(value * 1e4) / 1e4;

/** Where the eyes sit: the left one's centre, and the right one's x. */
const EYE = { x: 8.2, y: 13.9, mirror: 15.8 } as const;

/** The eyes: two tall ovals, `scale` their size (smaller behind glasses), and their catch-lights. */
function Eyes({
  colors,
  size,
  scale,
}: Pick<AgentDrawingProps, "colors" | "size"> & { scale: number }) {
  const at = [EYE.x, EYE.mirror];
  /** A length on the eye, at its scale. */
  const k = (length: number) => round4(length * scale);
  return (
    <>
      <g style={{ fill: colors.mark }}>
        {at.map((x) => (
          <ellipse key={x} cx={x} cy={EYE.y} rx={k(1.8)} ry={k(2.3)} />
        ))}
      </g>
      {size >= GLINT_PX && (
        <g style={{ fill: colors.face }}>
          {at.map((x) => (
            <circle key={x} cx={round4(x + k(0.65))} cy={round4(EYE.y - k(0.9))} r={k(0.65)} />
          ))}
          {size >= SPARKLE_PX &&
            at.map((x) => (
              <circle key={-x} cx={round4(x - k(0.65))} cy={round4(EYE.y + k(1))} r={k(0.32)} />
            ))}
        </g>
      )}
    </>
  );
}

/**
 * What the penguin wears, over the finished penguin, in the accent colour. A scarf ends on the
 * ball's own arc; headwear sits a little proud of the ball, inside a round tile.
 */
function Accessory({ colors, accessory }: Pick<AgentDrawingProps, "colors" | "accessory">) {
  const fill = { fill: colors.accent };
  const line = { stroke: colors.accent };
  switch (accessory) {
    case "scarf":
      return (
        <path
          d="M3.23 19Q12 22.2 20.77 19A10.2 10.2 0 0 1 17.79 22.2Q12 24.6 6.21 22.2A10.2 10.2 0 0 1 3.23 19Z"
          style={fill}
        />
      );
    case "beanie":
      return (
        <>
          <g style={fill}>
            <circle cx="12" cy="2.1" r="1.7" />
            <path d="M2.9 8.6C3.4 5 7 2.6 12 2.6C17 2.6 20.6 5 21.1 8.6Z" />
          </g>
          <rect x="2.4" y="7.2" width="19.2" height="2.7" rx="1.35" style={{ fill: colors.face }} />
        </>
      );
    case "cap":
      return (
        <g style={fill}>
          <path d="M3.3 8.5C3.8 4.7 7.2 2.7 12 2.7C16.8 2.7 20.2 4.7 20.7 8.5Z" />
          <path d="M11.5 7.4H22.1Q23.2 7.4 23.2 8.5Q23.2 9.6 22.1 9.6H11.5Z" />
        </g>
      );
    case "headphones":
      return (
        <>
          <path
            d="M2.9 13C2.9 6.5 6.7 2.6 12 2.6C17.3 2.6 21.1 6.5 21.1 13"
            fill="none"
            strokeWidth="1.5"
            style={line}
          />
          <g style={fill}>
            <rect x="0.9" y="11.3" width="3.6" height="5.8" rx="1.7" />
            <rect x="19.5" y="11.3" width="3.6" height="5.8" rx="1.7" />
          </g>
        </>
      );
    case "sprout":
      return (
        <>
          <path d="M12 5V2.6" fill="none" strokeWidth="1" style={line} />
          <g style={fill}>
            <path d="M12 3.4C9.9 3.6 8.2 2.5 7.8 0.8C10.1 0.3 11.8 1.5 12 3.4Z" />
            <path d="M12 3.4C14.1 3.6 15.8 2.5 16.2 0.8C13.9 0.3 12.2 1.5 12 3.4Z" />
          </g>
        </>
      );
    case "bow":
      return (
        <g style={fill}>
          <path d="M16.6 5.6L12.9 3.2Q12.3 5.9 13.5 8.2Z" />
          <path d="M16.6 5.6L20.6 4.4Q21.4 7 20 9.2Z" />
          <circle cx="16.6" cy="5.6" r="1.15" />
        </g>
      );
    case "glasses":
      return (
        <g fill="none" strokeWidth="1" style={line}>
          <circle cx={EYE.x} cy={EYE.y} r="3.05" />
          <circle cx={EYE.mirror} cy={EYE.y} r="3.05" />
          <path d="M11.25 13.5Q12 13 12.75 13.5" />
        </g>
      );
    case "none":
      return null;
  }
}

/** The penguin on the 24-unit box: the ball (centre 12 13.8, radius 10.2) and everything on it. */
function Penguin({ colors, accessory, size }: AgentDrawingProps) {
  return (
    <>
      <circle cx="12" cy="13.8" r="10.2" style={{ fill: colors.coat }} />
      {!HEADWEAR.has(accessory) && (
        <path
          d="M11.3 4C10.9 2.9 11.3 2 12.2 1.5M12.7 3.9C12.9 3.1 13.5 2.6 14.2 2.5"
          fill="none"
          strokeWidth="1"
          strokeLinecap="round"
          style={{ stroke: colors.coat }}
        />
      )}
      <path
        d="M12 9.7C11.1 8.2 9.1 7.6 7.4 8.4C5.4 9.3 4.4 11.5 4.4 13.9C4.4 17.6 5.6 20.6 7.21 22.81A10.2 10.2 0 0 0 16.79 22.81C18.4 20.6 19.6 17.6 19.6 13.9C19.6 11.5 18.6 9.3 16.6 8.4C14.9 7.6 12.9 8.2 12 9.7Z"
        style={{ fill: colors.face }}
      />
      {size >= BLUSH_PX && (
        <g style={{ fill: colors.blush }}>
          <ellipse cx="6.3" cy="17.3" rx="1.3" ry="0.85" />
          <ellipse cx="17.7" cy="17.3" rx="1.3" ry="0.85" />
        </g>
      )}
      <Eyes colors={colors} size={size} scale={accessory === "glasses" ? 0.8 : 1} />
      <path
        d="M9.7 16.2Q12 15.7 14.3 16.2Q14.5 16.3 14.4 16.7Q13.9 19.1 12 19.1Q10.1 19.1 9.6 16.7Q9.5 16.3 9.7 16.2Z"
        style={{ fill: colors.beak }}
      />
      <Accessory colors={colors} accessory={accessory} />
    </>
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
 * The pixel penguin, 16 rows of 16 cells: `#` the coat, `o` the face, `x` an eye, `c` a cheek (the
 * face below 20 px), `b` the beak, `a` what it wears and `.` the tile. Row 0 is the top; rows 8
 * and 9 hold the eyes and rows 10 and 11 the beak. The cells are crisp from 16 px.
 */
const PIXEL_PENGUIN = [
  "................",
  "................",
  ".....######.....",
  "...##########...",
  "..############..",
  ".####oo##oo####.",
  ".###oooooooo###.",
  ".##oooooooooo##.",
  ".##oxxooooxxo##.",
  ".##oxxooooxxo##.",
  ".##cooobboooc##.",
  ".##oooobboooo##.",
  ".##oooooooooo##.",
  "..##oooooooo##..",
  "...##oooooo##...",
  "....#oooooo#....",
] as const;

/** Rows laid over the penguin from `top` down: a cell other than `.` replaces the one under it. */
interface PixelOverlay {
  top: number;
  rows: readonly string[];
}

/** The feather tuft, where nothing covers the head. */
const PIXEL_TUFT: PixelOverlay = { top: 0, rows: ["........#.......", ".......#........"] };

/** What the pixel penguin wears. */
const PIXEL_ACCESSORIES: Readonly<Record<AgentAccessory, PixelOverlay | null>> = {
  none: null,
  scarf: {
    top: 12,
    rows: [".aa..........aa.", "..aaaaaaaaaaaa..", "....aaaaaaaa...."],
  },
  beanie: {
    top: 0,
    rows: [
      ".......aa.......",
      ".....aaaaaa.....",
      "...aaaaaaaaaa...",
      "..aaaaaaaaaaaa..",
      ".oooooooooooooo.",
    ],
  },
  cap: {
    top: 1,
    rows: [".....aaaaaa.....", "...aaaaaaaaaa...", "..aaaaaaaaaaaa..", "..aaaaaaaaaaaaaa"],
  },
  headphones: {
    top: 1,
    rows: [
      ".....aaaaaa.....",
      "...aa......aa...",
      "..a..........a..",
      ".a............a.",
      ".a............a.",
      "a..............a",
      "aa............aa",
      "aa............aa",
      "aa............aa",
      "aa............aa",
    ],
  },
  sprout: {
    top: 0,
    rows: [".....aa..aa.....", "......aaaa......", ".......aa......."],
  },
  bow: {
    top: 2,
    rows: [".........aa..aa.", ".........aaaaaa.", ".........aa..aa."],
  },
  glasses: {
    top: 7,
    rows: ["...aaaaaaaaaa...", "...a..a..a..a...", "...a..a..a..a...", "....aa....aa...."],
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

/** The pixel penguin as each accessory dresses it, with the tuft wherever the head is bare. */
const PIXEL_GRIDS = Object.fromEntries(
  Object.entries(PIXEL_ACCESSORIES).map(([accessory, overlay]) => [
    accessory,
    overlaid(
      HEADWEAR.has(accessory as AgentAccessory)
        ? PIXEL_PENGUIN
        : overlaid(PIXEL_PENGUIN, PIXEL_TUFT),
      overlay,
    ),
  ]),
) as Readonly<Record<AgentAccessory, readonly string[]>>;

type PixelPaint = "coat" | "face" | "mark" | "blush" | "beak" | "accent";

const PIXEL_PAINT: Readonly<Record<string, PixelPaint>> = {
  "#": "coat",
  o: "face",
  x: "mark",
  b: "beak",
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

const PIXEL_ORDER: readonly PixelPaint[] = ["coat", "face", "blush", "beak", "accent", "mark"];

function PixelPenguin({ colors, accessory, size }: AgentDrawingProps) {
  const { transform, crisp } = pixelPlacement(size);
  const runs = pixelRuns(PIXEL_GRIDS[accessory], size);
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
