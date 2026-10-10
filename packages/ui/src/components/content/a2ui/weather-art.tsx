/**
 * A weather condition as line art: a sun, a moon, clouds, rain, snow, fog, lightning and wind,
 * drawn on a 64-unit grid in the surrounding ink, with two accents — the sun, the moon and the
 * bolt in the attention tone's ink, raindrops and snowflakes in the info tone's — and no fill but
 * a faint wash inside the sun's and the moon's disc.
 *
 * Animated, each moving part carries a `data-anim` the motion sheet (a2ui-motion.css) loops: the
 * rays breathe and turn, clouds drift, drops fall, flakes drift down, fog slides, the bolt
 * flashes, wind streams. Every loop rests on the drawn frame, so a still drawing (reduced motion,
 * `animated={false}` for the small forecast icons) is the whole picture.
 *
 * Whatever stands behind a cloud — the sun of a partly cloudy sky, the far cloud of an overcast
 * one — is clipped a little wider than the cloud's outline, so its lines stop short of the cloud
 * instead of running through it, and still clear it while the cloud drifts.
 *
 * Small sizes (under 32 px) draw a sparer picture with a heavier line: fewer drops and flakes,
 * two fog lines, wind without its cloud, and a stroke that stays about a pixel wide on screen.
 */
import { useId } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { A2uiWeatherCondition } from "@prismshadow/penguin-core/a2ui";
import "./a2ui-motion.css";

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

type Point = readonly [x: number, y: number];
type Circle = readonly [cx: number, cy: number, r: number];

/**
 * A cloud as the union of its bumps, left to right, on a flat bottom: the first and the last
 * circle sit on the baseline (`base` is their lowest point), the ones between rise above it.
 */
interface Cloud {
  readonly circles: readonly Circle[];
  readonly base: number;
}

const round = (v: number) => Math.round(v * 100) / 100;

/** The upper of the two points where two overlapping circles cross. */
function upperCrossing(a: Circle, b: Circle): Point {
  const [ax, ay, ar] = a;
  const [bx, by, br] = b;
  const dx = bx - ax;
  const dy = by - ay;
  const d = Math.hypot(dx, dy);
  const along = (ar * ar - br * br + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, ar * ar - along * along));
  const mx = ax + (dx * along) / d;
  const my = ay + (dy * along) / d;
  const one: Point = [mx - (dy * h) / d, my + (dx * h) / d];
  const two: Point = [mx + (dy * h) / d, my - (dx * h) / d];
  return one[1] < two[1] ? one : two;
}

/**
 * A cloud's outline as a closed path: up the first bump from the baseline, over every bump to
 * where it meets the next, down the last one and back along the bottom. `grow` widens every bump
 * and drops the baseline by that much — the knockout behind a cloud.
 */
function cloudOutline(cloud: Cloud, grow = 0): string {
  const circles: Circle[] = cloud.circles.map(([cx, cy, r]) => [cx, cy, r + grow]);
  const base = cloud.base + grow;
  const first = circles[0]!;
  const last = circles[circles.length - 1]!;
  const points: Point[] = [[first[0], base]];
  for (let i = 0; i < circles.length - 1; i++) {
    points.push(upperCrossing(circles[i]!, circles[i + 1]!));
  }
  points.push([last[0], base]);
  const arcs = circles.map(([cx, cy, r], i) => {
    const [fx, fy] = points[i]!;
    const [tx, ty] = points[i + 1]!;
    // Clockwise on screen is the growing angle (y points down); a bump's arc is the long way
    // round when it turns through more than half the circle.
    let turn = Math.atan2(ty - cy, tx - cx) - Math.atan2(fy - cy, fx - cx);
    while (turn <= 0) turn += 2 * Math.PI;
    return `A${round(r)} ${round(r)} 0 ${turn > Math.PI ? 1 : 0} 1 ${round(tx)} ${round(ty)}`;
  });
  return `M${round(first[0])} ${round(base)} ${arcs.join(" ")} Z`;
}

/** The clouds, on the 64-unit grid. */
const CLOUDS = {
  /** The cloud a shower, a storm, snow or fog comes from: high, with room below. */
  top: {
    circles: [
      [19, 31, 7],
      [29, 23, 10.5],
      [43, 28, 10],
    ],
    base: 38,
  },
  /** A partly cloudy sky's cloud, low and right, in front of the sun or the moon. */
  front: {
    circles: [
      [27, 44, 7],
      [37, 36, 10.5],
      [49, 42, 9],
    ],
    base: 51,
  },
  /** An overcast sky's near cloud, low and left. */
  near: {
    circles: [
      [14, 43, 7],
      [26, 33, 12],
      [41, 40, 10],
    ],
    base: 50,
  },
  /** Its far cloud, high and right, behind it. */
  far: {
    circles: [
      [34, 24, 6],
      [43, 17, 9],
      [53, 23, 7],
    ],
    base: 30,
  },
  /** The small cloud the wind blows from. */
  wind: {
    circles: [
      [12, 18, 4.5],
      [19, 12.5, 7],
      [27.5, 16.5, 6],
    ],
    base: 22.5,
  },
} as const satisfies Record<string, Cloud>;

type CloudName = keyof typeof CLOUDS;

const OUTLINES = Object.fromEntries(
  Object.entries(CLOUDS).map(([name, shape]) => [name, cloudOutline(shape)]),
) as Record<CloudName, string>;

/**
 * The knockouts behind the two clouds that stand in front of something: the outline widened by
 * half the cloud's line, its drift (two units each way) and a little air — a little more for the
 * heavy small line — inside a frame wider than the grid, cut out of it by the even-odd rule.
 */
const FRAME = "M-8 -8H72V72H-8Z";
const KNOCKOUTS = {
  front: {
    large: `${FRAME} ${cloudOutline(CLOUDS.front, 3.4)}`,
    small: `${FRAME} ${cloudOutline(CLOUDS.front, 3.8)}`,
  },
  near: {
    large: `${FRAME} ${cloudOutline(CLOUDS.near, 3.4)}`,
    small: `${FRAME} ${cloudOutline(CLOUDS.near, 3.8)}`,
  },
} as const;

/** How long one drop takes to fall, in seconds: the heavier the rain, the faster. */
const FALL: Partial<Record<A2uiWeatherCondition, number>> = {
  drizzle: 1.6,
  rain: 1.1,
  "heavy-rain": 0.7,
  thunder: 1.1,
  sleet: 1.1,
};
/** A snowflake's drift down, and a star's twinkle, in seconds (the motion sheet's durations). */
const SNOW = 2.4;
const TWINKLE = 2.5;

/** Where in its loop each repeated part starts, as a share of the loop: a scattered order. */
const STAGGER = [0, 0.5, 0.25, 0.75, 0.12, 0.62] as const;
const stagger = (i: number) => STAGGER[i % STAGGER.length]!;

/** The falling parts under the top cloud: where each starts, at the large and the small size. */
interface Shower {
  readonly large: readonly Point[];
  readonly small: readonly Point[];
  /** A drop's length, or a flake's radius. */
  readonly size: { readonly large: number; readonly small: number };
}

const DRIZZLE: Shower = {
  large: [
    [22, 45],
    [32, 48],
    [42, 45],
  ],
  small: [
    [24, 45],
    [38, 45],
  ],
  size: { large: 4, small: 5 },
};
const RAIN: Shower = {
  large: [
    [20, 44],
    [28, 49],
    [36, 44],
    [44, 49],
  ],
  small: [
    [21, 44],
    [32, 47],
    [43, 44],
  ],
  size: { large: 7, small: 8 },
};
const HEAVY_RAIN: Shower = {
  large: [
    [20, 43],
    [30, 43],
    [40, 43],
    [25, 52],
    [35, 52],
    [45, 52],
  ],
  small: [
    [18, 43],
    [27, 46],
    [36, 43],
    [45, 46],
  ],
  size: { large: 9, small: 11 },
};
const SNOWFALL: Shower = {
  large: [
    [22, 46],
    [38, 46],
    [30, 55],
    [46, 55],
  ],
  small: [
    [22, 47],
    [42, 47],
    [32, 56],
  ],
  size: { large: 3.4, small: 3.5 },
};
/** A storm's two drops beside the bolt, and sleet's drops and flakes, at every size. */
const SIDE_DROPS: readonly Point[] = [
  [20, 44],
  [44, 44],
];
const SLEET_DROPS: readonly Point[] = [
  [21, 44],
  [44, 44],
];
const SLEET_FLAKES: readonly Point[] = [
  [33, 47],
  [27, 56],
];

const BOLT = "M34 40L28 50H35L30 59";

/** Fog layers under the top cloud: three, or two at the small size. */
const FOG: { readonly large: readonly string[]; readonly small: readonly string[] } = {
  large: ["M14 45H44", "M20 52H52", "M12 59H38"],
  small: ["M12 47H44", "M20 57H52"],
};

/** Streamlines curling at their ends, the last one down; the small set spreads out, cloudless. */
const WIND = {
  large: [
    "M8 31H40A5 5 0 1 0 35 26",
    "M14 40H52A5 5 0 1 0 47 35",
    "M8 49H34A4.5 4.5 0 1 1 29.5 53.5",
  ],
  small: ["M8 22H36A6 6 0 1 0 30 16", "M8 34H50A6 6 0 1 0 44 28", "M14 46H36A5 5 0 1 1 31 51"],
};

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

interface Pen {
  readonly small: boolean;
  readonly animated: boolean;
  /** This drawing's id, for the ids its parts reference. */
  readonly id: string;
}

const sized = <T,>(pen: Pen, both: { readonly large: T; readonly small: T }): T =>
  pen.small ? both.small : both.large;

/** The loop a part runs and where in it it starts; nothing when the drawing is still. */
function anim(
  pen: Pen,
  name: string,
  delaySeconds = 0,
): { "data-anim"?: string; style?: CSSProperties } {
  if (!pen.animated) return {};
  if (delaySeconds === 0) return { "data-anim": name };
  return {
    "data-anim": name,
    style: { "--a2ui-delay": `${round(delaySeconds)}s` } as CSSProperties,
  };
}

/** A cloud that drifts. */
function cloud(pen: Pen, name: CloudName, delaySeconds = 0): ReactNode {
  return <path key={name} {...anim(pen, "cloud", delaySeconds)} d={OUTLINES[name]} />;
}

/** A cloud that holds still: what rain, snow, fog or wind comes from. */
function stillCloud(name: CloudName): ReactNode {
  return <path key={name} d={OUTLINES[name]} />;
}

/**
 * What lies behind a front cloud, clipped to stop short of it. The clip's id names its shape as
 * well as the drawing, so two pages' ids that happen to meet still name the same shape.
 */
function behind(pen: Pen, front: keyof typeof KNOCKOUTS, children: ReactNode): ReactNode {
  const size = pen.small ? "small" : "large";
  const id = `a2ui-knockout-${front}-${size}-${pen.id}`;
  return (
    <g key="behind">
      <defs>
        <clipPath id={id}>
          <path clipRule="evenodd" d={KNOCKOUTS[front][size]} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id})`}>{children}</g>
    </g>
  );
}

/** A sun: the disc with its faint wash, and eight rays that turn about its centre. */
function sun(pen: Pen, cx: number, cy: number, r: number): ReactNode {
  const inner = r + (pen.small ? 6 : 4.5);
  const outer = r + (pen.small ? 11 : 9.5);
  let rays = "";
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    rays += `M${round(cx + inner * cos)} ${round(cy + inner * sin)}`;
    rays += `L${round(cx + outer * cos)} ${round(cy + outer * sin)}`;
  }
  return (
    <g key="sun" className="text-tone-attention-fg">
      <circle cx={cx} cy={cy} r={r} fill="currentColor" fillOpacity={0.12} />
      <g
        {...anim(pen, "rays")}
        {...(pen.animated ? { style: { transformOrigin: `${cx}px ${cy}px` } } : {})}
      >
        <path d={rays} />
      </g>
    </g>
  );
}

/** A crescent: from the disc's top, cut on its upper right, round the far side back to the top. */
function moon(cx: number, cy: number, r: number): ReactNode {
  const cut = round((r * 2) / 3);
  return (
    <path
      key="moon"
      className="text-tone-attention-fg"
      fill="currentColor"
      fillOpacity={0.12}
      d={crescentPath(cx, cy, r, cut)}
    />
  );
}

/** A crescent: a disc of radius `r` at (`cx`, `cy`) with an arc of radius `cut` taken out. */
function crescentPath(cx: number, cy: number, r: number, cut: number): string {
  return `M${cx} ${cy - r}a${cut} ${cut} 0 0 0 ${r} ${r} ${r} ${r} 0 1 1-${r}-${r}Z`;
}

/** A plus-shaped sparkle of half-size `s` at (`x`, `y`). */
function sparklePath(x: number, y: number, s: number): string {
  return `M${x} ${y - s}V${y + s}M${x - s} ${y}H${x + s}`;
}

/** A raindrop stroke from (`x`, `y`), `length` long, slanting with the fall. */
function dropPath(x: number, y: number, length: number): string {
  return `M${x} ${y}l${round(-length / 4)} ${length}`;
}

/** Four-pointed sparkles as two strokes each, so every theme's line cap keeps them. */
function stars(pen: Pen): ReactNode {
  const list: readonly (readonly [number, number, number])[] = pen.small
    ? [
        [47, 15, 2.5],
        [40, 8, 2],
      ]
    : [
        [47, 15, 2.6],
        [53, 27, 2],
        [40, 8, 1.6],
      ];
  return (
    <g key="stars" className="text-tone-attention-fg">
      {list.map(([x, y, s], i) => (
        <path key={i} {...anim(pen, "stars", -TWINKLE * stagger(i))} d={sparklePath(x, y, s)} />
      ))}
    </g>
  );
}

/** Raindrops: short strokes slanting with the fall. */
function drops(pen: Pen, list: readonly Point[], length: number, fall: number): ReactNode {
  return (
    <g key="drops" className="text-tone-info-fg">
      {list.map(([x, y], i) => (
        <path key={i} {...anim(pen, "rain", -fall * stagger(i))} d={dropPath(x, y, length)} />
      ))}
    </g>
  );
}

/** Snowflakes: six points as three strokes through the centre. */
function flakes(pen: Pen, list: readonly Point[], r: number): ReactNode {
  return (
    <g key="flakes" className="text-tone-info-fg">
      {list.map(([x, y], i) => {
        let d = "";
        for (let k = 0; k < 3; k++) {
          const a = Math.PI / 2 + (k * Math.PI) / 3;
          const dx = round(r * Math.cos(a));
          const dy = round(r * Math.sin(a));
          d += `M${round(x + dx)} ${round(y + dy)}L${round(x - dx)} ${round(y - dy)}`;
        }
        return <path key={i} {...anim(pen, "snow", -SNOW * stagger(i))} d={d} />;
      })}
    </g>
  );
}

/** A shower's falling parts at the pen's size: drops, or flakes. */
function shower(pen: Pen, kind: "drops" | "flakes", parts: Shower, fall: number): ReactNode {
  const list = sized(pen, parts);
  const size = sized(pen, parts.size);
  return kind === "drops" ? drops(pen, list, size, fall) : flakes(pen, list, size);
}

/** Fog layers or streamlines, grouped on their own so `:nth-of-type` counts only them. */
function lines(pen: Pen, name: "fog" | "wind", paths: readonly string[], step: number): ReactNode {
  return (
    <g key={name}>
      {paths.map((d, i) => (
        <path key={i} {...anim(pen, name, -step * i)} d={d} />
      ))}
    </g>
  );
}

/** The parts of a condition's picture, back to front. */
function picture(condition: A2uiWeatherCondition, night: boolean, pen: Pen): ReactNode[] {
  const fall = FALL[condition] ?? 1.1;
  switch (condition) {
    case "clear":
      return night
        ? [moon(30, 34, pen.small ? 15 : 14), stars(pen)]
        : [sun(pen, 32, 32, pen.small ? 11 : 10.5)];
    case "partly-cloudy": {
      const light = night ? moon(23, 25, 10) : sun(pen, 23, 24, pen.small ? 8 : 7.5);
      return [behind(pen, "front", light), cloud(pen, "front")];
    }
    case "cloudy":
      // The far cloud drifts half a beat behind the near one.
      return [behind(pen, "near", cloud(pen, "far", -3)), cloud(pen, "near")];
    case "fog":
      return [stillCloud("top"), lines(pen, "fog", sized(pen, FOG), 1.2)];
    case "drizzle":
      return [stillCloud("top"), shower(pen, "drops", DRIZZLE, fall)];
    case "rain":
      return [stillCloud("top"), shower(pen, "drops", RAIN, fall)];
    case "heavy-rain":
      return [stillCloud("top"), shower(pen, "drops", HEAVY_RAIN, fall)];
    case "thunder":
      return [
        stillCloud("top"),
        <path key="bolt" className="text-tone-attention-fg" {...anim(pen, "flash")} d={BOLT} />,
        drops(pen, SIDE_DROPS, 7, fall),
      ];
    case "snow":
      return [stillCloud("top"), shower(pen, "flakes", SNOWFALL, fall)];
    case "sleet":
      return [stillCloud("top"), drops(pen, SLEET_DROPS, 7, fall), flakes(pen, SLEET_FLAKES, 3.4)];
    case "wind":
      return pen.small
        ? [lines(pen, "wind", WIND.small, 0.5)]
        : [stillCloud("wind"), lines(pen, "wind", WIND.large, 0.5)];
  }
}

export function WeatherArt({
  condition,
  night = false,
  size = 72,
  animated = true,
  label,
  className = "",
}: {
  condition: A2uiWeatherCondition;
  /** Draws the moon in place of the sun (a clear or a partly cloudy sky). */
  night?: boolean;
  /** Width and height, px. */
  size?: number;
  /** Loops the moving parts; off, the resting frame with no `data-anim` at all. */
  animated?: boolean;
  /** The accessible name (the condition's); without one the drawing is hidden as decoration. */
  label?: string;
  /** Layout only (a margin, an alignment); the ink is the surrounding text's. */
  className?: string;
}) {
  // React's ids carry punctuation a `url(#…)` reference would have to escape.
  const id = useId().replace(/[^\w-]/g, "");
  const pen: Pen = { small: size < 32, animated, id };
  // The grid is 64 units: at a large size the theme's icon stroke reads as it is; under 40 px it
  // is scaled up, so the line stays about as heavy on screen as an icon's.
  const scale = size >= 40 ? 1 : round(40 / size);
  const fall = FALL[condition];
  const style = {
    strokeWidth:
      scale === 1 ? "var(--ui-icon-stroke, 1.7)" : `calc(var(--ui-icon-stroke, 1.7) * ${scale})`,
    ...(animated && fall !== undefined ? { "--a2ui-fall": `${fall}s` } : {}),
  } as CSSProperties;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      data-art
      data-condition={condition}
      {...(label === undefined
        ? { "aria-hidden": true }
        : { role: "img" as const, "aria-label": label })}
      className={`block shrink-0 ${className}`}
    >
      {picture(condition, night, pen)}
    </svg>
  );
}
