/**
 * Login page background decoration: circuit-board-style trace lines extending outward — sparse, thin (1px),
 * low contrast, so they don't interfere with form readability.
 * Traces are seed-randomly pre-generated (orthogonal polylines, some branching midway, each ending in a
 * "via" dot); on the CSS side, pathLength=1 normalization drives a "draw in -> hold -> fade out" loop
 * (.login-trace/.login-via in styles.css).
 * Blank first paint: all traces start hidden, with positive delays staggering their start so lines grow in
 * one after another once loaded (reduced-motion falls back to fully static lines).
 * Non-overlapping: the canvas is divided into a 3x3 grid, the center cell is reserved for the form and left
 * blank, and each of the other 8 cells hosts one trace (branches share the same cell); polylines are
 * confined to their own cell with margins between adjacent cells, and segments within a cell are checked
 * for clearance-based collisions.
 * Color follows the light/dark theme: light theme uses low-opacity slate-blue, dark theme uses
 * low-brightness cyan. Mounted only on the login page; does not affect other pages.
 */
import type { CSSProperties } from "react";

const W = 1440;
const H = 900;
const COLS = 3;
const ROWS = 3;
const CELL_W = W / COLS;
const CELL_H = H / ROWS;
/** Padding between traces and cell edges: lines in adjacent cells stay at least 2xMARGIN apart, so they never touch across the boundary. */
const MARGIN = 28;
/** Minimum clearance between segments within the same cell (parallel segments don't touch, perpendicular ones don't cross). */
const CLEARANCE = 14;

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface TraceSpec {
  d: string;
  /** Endpoint "via" dot. */
  end: readonly [number, number];
  dur: number;
  delay: number;
}

/** Axis-aligned segment (normalized so x1<=x2, y1<=y2). */
interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Axis-aligned segment collision with clearance: expand each bounding box by CLEARANCE, and any overlap counts as a conflict (catches both parallel touching and perpendicular crossing). */
function conflicts(a: Seg, b: Seg): boolean {
  return (
    a.x1 - CLEARANCE <= b.x2 &&
    a.x2 + CLEARANCE >= b.x1 &&
    a.y1 - CLEARANCE <= b.y2 &&
    a.y2 + CLEARANCE >= b.y1
  );
}

function toSeg(x1: number, y1: number, x2: number, y2: number): Seg {
  return {
    x1: Math.min(x1, x2),
    y1: Math.min(y1, y2),
    x2: Math.max(x1, x2),
    y2: Math.max(y1, y2),
  };
}

type Dir = readonly [number, number];

/** Starting edge for each cell (start point touches the edge, direction points inward); center cell #4 is reserved for the form and left blank. */
const CELL_STARTS: ReadonlyArray<{ cell: number; edge: "left" | "right" | "top" | "bottom" }> = [
  { cell: 0, edge: "left" },
  { cell: 1, edge: "top" },
  { cell: 2, edge: "right" },
  { cell: 3, edge: "left" },
  { cell: 5, edge: "right" },
  { cell: 6, edge: "bottom" },
  { cell: 7, edge: "bottom" },
  { cell: 8, edge: "right" },
];

function buildTraces(): TraceSpec[] {
  const rnd = mulberry32(0x0c1bc17);
  const traces: TraceSpec[] = [];

  for (const { cell, edge } of CELL_STARTS) {
    // The traversable rectangle for this cell (including padding): the polyline stays within it throughout.
    const bx1 = (cell % COLS) * CELL_W + MARGIN;
    const by1 = Math.floor(cell / COLS) * CELL_H + MARGIN;
    const bx2 = bx1 + CELL_W - 2 * MARGIN;
    const by2 = by1 + CELL_H - 2 * MARGIN;
    /** Segments already placed (main line + branches): new segments must keep clearance from existing ones in this cell. */
    const placed: Seg[] = [];

    /** Step from (x,y) along dir: length is clamped to the remaining space, and halved and retried on conflict with existing segments. */
    const step = (
      x: number,
      y: number,
      dir: Dir,
      skip: ReadonlySet<number>,
    ): readonly [number, number] | null => {
      const room = dir[0] > 0 ? bx2 - x : dir[0] < 0 ? x - bx1 : dir[1] > 0 ? by2 - y : y - by1;
      for (let len = Math.min(60 + rnd() * 150, room); len >= 40; len /= 2) {
        const nx = Math.round(x + dir[0] * len);
        const ny = Math.round(y + dir[1] * len);
        const seg = toSeg(x, y, nx, ny);
        if (placed.every((p, i) => skip.has(i) || !conflicts(seg, p))) {
          placed.push(seg);
          return [nx, ny] as const;
        }
      }
      return null;
    };

    /** Pick turn direction: toward whichever side of the cell has more room (with random weighting). */
    const turnSign = (pos: number, lo: number, hi: number) =>
      (hi - pos) * (0.35 + rnd() * 0.3) > pos - lo ? 1 : -1;

    /**
     * Orthogonal polyline: switch to a perpendicular direction after each segment; stop early if a step
     * fails (not enough room, or can't avoid existing segments).
     * skipFirst exempts specific segments from the first-segment collision check (the parent segment that
     * shares an endpoint with a branch's starting point).
     */
    const walk = (
      x0: number,
      y0: number,
      dir0: Dir,
      segs: number,
      dur: number,
      delay: number,
      skipFirst: ReadonlySet<number>,
    ): Array<readonly [number, number]> => {
      let [x, y] = [x0, y0];
      let dir = dir0;
      const parts = [`M${Math.round(x)},${Math.round(y)}`];
      const vertices: Array<readonly [number, number]> = [];
      for (let i = 0; i < segs; i += 1) {
        // First segment uses the exemption set; later segments only exempt their own previous segment (shared endpoints would otherwise always "conflict").
        const skip = i === 0 ? skipFirst : new Set([placed.length - 1]);
        const next = step(x, y, dir, skip);
        if (!next) break;
        [x, y] = next;
        parts.push(`L${x},${y}`);
        vertices.push([x, y] as const);
        dir = dir[0] !== 0 ? [0, turnSign(y, by1, by2)] : [turnSign(x, bx1, bx2), 0];
      }
      if (vertices.length >= 2) {
        traces.push({ d: parts.join(" "), end: vertices[vertices.length - 1]!, dur, delay });
      }
      return vertices;
    };

    // Start point sits on the canvas edge (random position within this cell's span), direction points inward.
    const along = 0.15 + rnd() * 0.7;
    const sx = edge === "left" ? 0 : edge === "right" ? W : Math.round(bx1 + (bx2 - bx1) * along);
    const sy = edge === "top" ? 0 : edge === "bottom" ? H : Math.round(by1 + (by2 - by1) * along);
    const dir: Dir =
      edge === "left" ? [1, 0] : edge === "right" ? [-1, 0] : edge === "top" ? [0, 1] : [0, -1];

    const dur = 12 + rnd() * 8;
    const delay = rnd() * 3.2; // Positive delay: blank on first paint, then each line starts at a staggered time
    const vertices = walk(sx, sy, dir, 3 + Math.floor(rnd() * 3), dur, delay, new Set());
    // Branching: roughly half the cells branch a short offshoot from the main line's second vertex
    // (starting slightly later, read as a "spur extending off the main trace").
    // Its direction is perpendicular to the main line's third segment with opposite sign (perpendicular to
    // the incoming direction, and not overlapping the third segment's direction);
    // the first segment is exempt from collision with the second and third segments sharing that vertex
    // (placed indices 1 and 2).
    if (cell % 2 === 0 && vertices.length >= 3) {
      const [bx, by] = vertices[1]!;
      const [cx, cy] = vertices[2]!;
      const bdir: Dir = [-Math.sign(cx - bx), -Math.sign(cy - by)];
      walk(bx, by, bdir, 2, dur, delay + 1.4, new Set([1, 2]));
    }
  }
  return traces;
}

const TRACES = buildTraces();

export function LoginCircuit() {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full text-slate-500/25 dark:text-cyan-300/15"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      fill="none"
    >
      {TRACES.map((t, i) => (
        <g key={i} style={{ "--trace-dur": `${t.dur.toFixed(1)}s` } as CSSProperties}>
          <path
            d={t.d}
            pathLength={1}
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="login-trace"
            style={{ animationDelay: `${t.delay.toFixed(1)}s` }}
          />
          <circle
            cx={t.end[0]}
            cy={t.end[1]}
            r="3"
            fill="currentColor"
            className="login-via"
            style={{ animationDelay: `${t.delay.toFixed(1)}s` }}
          />
        </g>
      ))}
    </svg>
  );
}
