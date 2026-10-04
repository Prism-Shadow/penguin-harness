/**
 * The PR graph's glyph cells, drawn: each display row (pr-graph-segments.ts) carries the cells
 * the server laid out — two characters per column, the same ones `penguin org proposal graph`
 * prints — and the page draws them in a fixed-width grid beside the row's text. A text glyph
 * cannot stretch to a row two lines tall, so each cell is drawn as a few strokes instead: `│` a
 * line through, a node a dot with its line down to its parent, `├─╯` a line joining back into
 * the node below, `~` the base branch. A line into a cell from above is drawn when the cell
 * above goes on down, so the strokes meet across rows of different heights.
 *
 * Also here: the two row kinds segmenting adds — a segment's roadmap heading and a folded run.
 */
import { Link } from "react-router";
import type { ProposalGraphNode } from "@prismshadow/penguin-server/api";
import { Chevron, GlyphIcon, ICONS, ICON_GAP, ICON_SIZE } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { orgChannelPath } from "../company/company-nav";
import { RELATION_TONE } from "./pr-graph-rows";
import { FOLDED_GLYPH, type DisplayRow, type RoadmapRef } from "./pr-graph-segments";

/** The measures, in rem: the theme's text size sets the root font-size, so the graph scales with it. */
const NODE_REM = 3.75;
const HEAD_REM = 2.25;
const JOIN_REM = 1.25;
const CELL_REM = 1;
const DOT_REM = 0.28;
const TEXT_GAP_REM = 0.625;

export interface GraphGeometry {
  cell: number;
  dot: number;
  textGap: number;
  height: (d: DisplayRow) => number;
}

/** The measures in px for one root font-size. */
export function graphGeometry(remPx: number): GraphGeometry {
  return {
    cell: CELL_REM * remPx,
    dot: DOT_REM * remPx,
    textGap: TEXT_GAP_REM * remPx,
    height: (d) =>
      (d.kind === "row" && d.row.kind === "node"
        ? NODE_REM
        : d.kind === "row" && d.row.kind === "join"
          ? JOIN_REM
          : HEAD_REM) * remPx,
  };
}

const LINE = "text-gray-400 dark:text-gray-500";

/** A vertical stroke at `x` from `y1` down to `y2`. */
const vline = (x: number, y1: number, y2: number): string => `M${x} ${y1}V${y2}`;

/** The joining stroke: from `from` at mid-height to `to`, bending up there to the top. */
const joinUp = (from: number, to: number, mid: number, bend: number): string =>
  `M${from} ${mid}H${to - bend}Q${to} ${mid} ${to} ${mid - bend}V0`;

/** One row's cells. `up[c]`: a line comes into column c from the row above. */
export function GraphCells({
  cells,
  up,
  node,
  height,
  hovered,
  geo,
}: {
  cells: readonly string[];
  up: readonly boolean[];
  /** The node a node row draws (its dot's fill and ink); null on any other row. */
  node: ProposalGraphNode | null;
  height: number;
  hovered: boolean;
  geo: GraphGeometry;
}) {
  const x = (c: number) => c * geo.cell + geo.cell / 2;
  const mid = height / 2;
  const stroke = hovered ? 2.6 : 1.7;
  const bend = Math.min(mid, geo.cell / 2);
  const parts = cells.flatMap((cell, c) => {
    const g = cell[0];
    const into = up[c] ? [<path key={`u${c}`} d={vline(x(c), 0, mid)} className={LINE} />] : [];
    if (g === "│" || g === "├")
      return [<path key={`v${c}`} d={vline(x(c), 0, height)} className={LINE} />];
    if (g === "╯") {
      // The joining line: from the column on its left, bending up into its own.
      return [<path key={`j${c}`} d={joinUp(x(c - 1), x(c), mid, bend)} className={LINE} />];
    }
    if (g === "~") {
      return [
        ...into,
        <circle
          key={`b${c}`}
          cx={x(c)}
          cy={mid}
          r={geo.dot + 1}
          className="fill-current text-gray-600 dark:text-gray-300"
        />,
      ];
    }
    if (g === FOLDED_GLYPH) {
      const w = geo.dot * 2;
      return [
        ...into,
        <path key={`d${c}`} d={vline(x(c), mid, height)} className={LINE} />,
        <rect
          key={`f${c}`}
          x={x(c) - w / 2}
          y={mid - geo.dot * 1.8}
          width={w}
          height={geo.dot * 3.6}
          rx={geo.dot}
          className="fill-white text-gray-500 dark:fill-gray-950 dark:text-gray-400"
        />,
      ];
    }
    if (g === undefined || g === " " || node === null) return into;
    // A node: its line down to the parent is dashed when that edge does not hold.
    const ink = node.stacked
      ? "text-gray-500 dark:text-gray-400"
      : toneInk[RELATION_TONE[node.relation]];
    return [
      ...into,
      <path
        key={`d${c}`}
        d={vline(x(c), mid, height)}
        strokeDasharray={node.stacked ? undefined : "3 3"}
        className={node.stacked ? LINE : ink}
      />,
      <circle
        key={`n${c}`}
        cx={x(c)}
        cy={mid}
        r={geo.dot + (hovered ? 1.5 : 0)}
        className={`${node.proposal !== null ? "fill-current" : "fill-white dark:fill-gray-950"} ${
          g === "○" ? ink : `${ink} opacity-70`
        }`}
      />,
    ];
  });
  return (
    <svg
      aria-hidden="true"
      width={cells.length * geo.cell}
      height={height}
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      className="pointer-events-none shrink-0"
    >
      {parts}
    </svg>
  );
}

/** A segment's heading: its roadmaps as links, how many PRs it holds, and the fold state. */
export function RoadmapHeading({
  projectId,
  orgId,
  roadmaps,
  count,
  folded,
}: {
  projectId: string;
  orgId: string;
  roadmaps: readonly RoadmapRef[];
  count: number;
  folded: boolean;
}) {
  const t = S.company.proposals.graph.segments;
  return (
    <div className={`flex min-w-0 flex-1 items-center ${ICON_GAP.row} text-xs`}>
      <Chevron open={!folded} size={ICON_SIZE.rowMark} className="shrink-0 text-fg-subtle" />
      {roadmaps.length === 0 ? (
        <span className="text-fg-subtle">{t.noRoadmap}</span>
      ) : (
        roadmaps.map((r) => {
          const label = (
            <>
              <GlyphIcon d={ICONS.foldedMap} size={ICON_SIZE.rowMark} className="shrink-0" />
              <span className="font-mono text-fg-subtle">#{r.number}</span>
              <span className="min-w-0 truncate">{r.name}</span>
            </>
          );
          return r.channelId === null ? (
            <span
              key={r.number}
              className={`flex min-w-0 items-center ${ICON_GAP.row} font-medium`}
            >
              {label}
            </span>
          ) : (
            <Link
              key={r.number}
              to={orgChannelPath(projectId, orgId, r.channelId)}
              // The link opens the roadmap; the rest of the row folds the segment.
              onClick={(e) => e.stopPropagation()}
              data-tooltip={t.openRoadmap}
              className={`flex min-w-0 items-center ${ICON_GAP.row} font-medium hover:underline`}
            >
              {label}
            </Link>
          );
        })
      )}
      <span className="shrink-0 text-fg-subtle tabular-nums">· {t.prs(count)}</span>
    </div>
  );
}

/** A folded run, as one line. */
export function FoldedLine({ count }: { count: number }) {
  const t = S.company.proposals.graph.segments;
  return <span className="text-xs text-fg-subtle">{t.folded(count)}</span>;
}
