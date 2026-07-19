/**
 * Agent avatar: a pixel identicon deterministically generated from agentId (the same approach
 * GitHub's default avatars use).
 *
 * 5x5 grid with left-right mirror symmetry (only the left 3 columns are randomized, the right 2
 * columns mirror back), a single soft-hue foreground, and a very light background of the same
 * color. No external dependencies — seeds mulberry32 with an FNV-1a hash.
 */

/** Grid side length (must be odd for left-right symmetry). */
const N = 5;
/** Number of columns that need randomizing (including the center column). */
const HALF = Math.ceil(N / 2);

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Randomly samples points on the left half + center column, mirrored into a full 5x5 boolean grid. */
function buildGrid(rnd: () => number): boolean[][] {
  const grid: boolean[][] = Array.from({ length: N }, () => Array.from({ length: N }, () => false));
  for (let col = 0; col < HALF; col++) {
    for (let row = 0; row < N; row++) {
      // The center column has a slightly lower fill rate, to avoid a solid vertical line.
      const on = rnd() < (col === HALF - 1 ? 0.4 : 0.55);
      grid[row]![col] = on;
      grid[row]![N - 1 - col] = on;
    }
  }
  return grid;
}

export function AgentAvatar({
  id,
  size = 18,
  className,
}: {
  id: string;
  size?: number;
  className?: string;
}) {
  const rnd = mulberry32(hashStr(id || "agent"));
  const hue = Math.floor(rnd() * 360);
  const grid = buildGrid(rnd);
  // 24x24 viewport: 2px margin on each side, 4x4 cells.
  const cell = 4;
  const pad = 2;
  const fg = `hsl(${hue} 52% 46%)`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden
      role="img"
    >
      <rect x="0" y="0" width="24" height="24" rx="5" fill={`hsl(${hue} 55% 50% / 0.14)`} />
      {grid.map((cols, row) =>
        cols.map((on, col) =>
          on ? (
            <rect
              key={`${row}-${col}`}
              x={pad + col * cell}
              y={pad + row * cell}
              width={cell}
              height={cell}
              fill={fg}
            />
          ) : null,
        ),
      )}
    </svg>
  );
}
