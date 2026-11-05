/**
 * The chart patterns and filter a theme's chart recipe may paint with, defined once per document:
 * an empty, zero-size svg holding only `<defs>`, which `AppShell` mounts (and the gallery's board
 * page, which has no shell). Nothing references them but a theme's CSS, so in a theme that does
 * not, they draw nothing and cost nothing.
 *
 * - `#ui-hatch-1` … `#ui-hatch-8`: one diagonal hatch per palette slot, in the slot's own colour
 *   over a faint wash of it, for the bars of `data-series="<n>"`.
 * - `#ui-hatch-cache-read`, `#ui-hatch-cache-write`, `#ui-hatch-output`: the Token kinds' own
 *   colours, at three densities — sparse, medium, dense — so a stacked Token bar still reads in
 *   black and white.
 * - `#ui-rough`: a fixed noise field that displaces a stroke by under a pixel, so a pen line looks
 *   drawn. Its seed is fixed, so a redraw of the same data is the same picture. Its region is the
 *   chart's own viewport padded by a tenth on every side, in user space rather than the mark's
 *   box, because a horizontal grid line or a flat series has a box with no height and a region
 *   measured off it would hide the line.
 *
 * Each pattern takes its colour from the theme's chart tokens through CSS (`color` on the
 * pattern, `currentColor` inside it), so it follows the theme and the mode with nothing to
 * re-render. Pattern content inherits from the pattern, never from the mark that uses it.
 *
 * The svg is out of flow (absolutely positioned, zero-sized) and hidden from assistive
 * technology; it is not `display: none`, which would stop some engines from painting what it
 * defines.
 */

/** One hatch: the pattern's id suffix, the chart token it draws in, and its line spacing in px. */
interface Hatch {
  id: string;
  token: string;
  gap: number;
}

/** The palette slots' hatch spacing; the Token kinds take their own density. */
const SERIES_GAP = 6;

const HATCHES: readonly Hatch[] = [
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((slot) => ({
    id: String(slot),
    token: `--ui-chart-${slot}`,
    gap: SERIES_GAP,
  })),
  { id: "cache-read", token: "--ui-chart-cache-read", gap: 8 },
  { id: "cache-write", token: "--ui-chart-cache-write", gap: 6 },
  { id: "output", token: "--ui-chart-output", gap: 4 },
];

/** The wash under a hatch's lines, so a hatched bar still reads as one filled shape. */
const WASH_OPACITY = 0.18;

export function ChartDefs() {
  return (
    <svg aria-hidden width="0" height="0" className="pointer-events-none absolute overflow-hidden">
      <defs>
        {HATCHES.map(({ id, token, gap }) => (
          <pattern
            key={id}
            id={`ui-hatch-${id}`}
            patternUnits="userSpaceOnUse"
            width={gap}
            height={gap}
            patternTransform="rotate(45)"
            style={{ color: `var(${token})` }}
          >
            <rect width={gap} height={gap} fill="currentColor" fillOpacity={WASH_OPACITY} />
            <line x1={gap / 2} y1="0" x2={gap / 2} y2={gap} stroke="currentColor" strokeWidth="1" />
          </pattern>
        ))}
        <filter
          id="ui-rough"
          filterUnits="userSpaceOnUse"
          x="-10%"
          y="-10%"
          width="120%"
          height="120%"
        >
          <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves={2} seed={7} />
          <feDisplacementMap
            in="SourceGraphic"
            scale={1.4}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
}
