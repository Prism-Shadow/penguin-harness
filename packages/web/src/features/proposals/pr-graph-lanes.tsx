/**
 * What the PR graph draws beside its rows: the lanes (every edge, then every dot over them) over
 * the display rows of pr-graph-segments, whose heights differ — a PR's row is two lines, a
 * roadmap heading and a folded run one — and the two row kinds that segmenting adds.
 */
import { Link } from "react-router";
import type { ProposalGraphNode } from "@prismshadow/penguin-server/api";
import { Chevron, GlyphIcon, ICONS, ICON_GAP, ICON_SIZE } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { orgChannelPath } from "../company/company-nav";
import type { GraphGeometry, GraphRow } from "./pr-graph-model";
import { RELATION_TONE } from "./pr-graph-rows";
import type { DisplayLayout, RoadmapRef } from "./pr-graph-segments";

/** Each display row's height and centre, from the geometry. */
export function displayMetrics(display: DisplayLayout, geo: GraphGeometry) {
  const heights = display.rows.map((d) => (d.kind === "node" ? geo.row : geo.head));
  const tops: number[] = [];
  let y = 0;
  for (const h of heights) {
    tops.push(y);
    y += h;
  }
  return { heights, tops, centers: tops.map((t, i) => t + heights[i]! / 2), total: y };
}

/** An edge from (x1,y1) to its parent at (x2,y2), bending beside the parent within half its row. */
function edgeD(x1: number, y1: number, x2: number, y2: number, half: number): string {
  if (x1 === x2) return `M${x1} ${y1}V${y2}`;
  const dir = y1 < y2 ? -1 : 1;
  const bend = y2 + dir * half;
  return `M${x1} ${y1}V${bend}C${x1} ${y2 + (dir * half) / 3} ${x2} ${bend - (dir * half) / 3} ${x2} ${y2}`;
}

export function GraphLanes({
  rows,
  display,
  lanes,
  hovered,
  geo,
}: {
  rows: readonly GraphRow[];
  display: DisplayLayout;
  lanes: number;
  /** The display row under the pointer: its dot and its edge are drawn heavier. */
  hovered: number | null;
  geo: GraphGeometry;
}) {
  const { heights, centers, total } = displayMetrics(display, geo);
  const relationInk = (node: ProposalGraphNode | null) =>
    toneInk[RELATION_TONE[node?.relation ?? "unknown"]];
  return (
    <svg
      aria-hidden="true"
      width={lanes * geo.lane + 4}
      height={total}
      className="pointer-events-none absolute top-0 left-0"
    >
      {display.edges.map((e) => {
        const child = rows[e.child]!;
        return (
          <path
            key={`e${e.from}-${e.to}-${e.lane}`}
            d={edgeD(
              geo.laneX(e.lane),
              centers[e.from]!,
              geo.laneX(e.toLane),
              centers[e.to]!,
              heights[e.to]! / 2,
            )}
            fill="none"
            stroke="currentColor"
            strokeWidth={e.from === hovered ? 2.6 : 1.7}
            strokeDasharray={child.stacked ? undefined : "3 3"}
            className={child.stacked ? "text-gray-400 dark:text-gray-500" : relationInk(child.node)}
          />
        );
      })}
      {display.rows.map((d, i) => {
        if (d.kind === "roadmap") return null;
        if (d.kind === "folded") {
          // A run folded into one line: a hollow capsule in its lane, as tall as a few dots.
          const w = geo.dot * 2;
          return (
            <rect
              key={`f${i}`}
              x={geo.laneX(d.lane) - w / 2}
              y={centers[i]! - geo.dot * 1.8}
              width={w}
              height={geo.dot * 3.6}
              rx={geo.dot}
              strokeWidth={1.7}
              stroke="currentColor"
              className="fill-white text-gray-500 dark:fill-gray-950 dark:text-gray-400"
            />
          );
        }
        const row = rows[d.row]!;
        const proposal = row.node?.proposal ?? null;
        return (
          <circle
            key={`d${i}`}
            cx={geo.laneX(row.lane)}
            cy={centers[i]}
            r={(row.node === null ? geo.dot + 1 : geo.dot) + (i === hovered ? 1.5 : 0)}
            stroke="currentColor"
            strokeWidth={i === hovered ? 2.6 : 1.7}
            className={`${
              proposal !== null || row.node === null
                ? "fill-current"
                : "fill-white dark:fill-gray-950"
            } ${
              row.node === null
                ? "text-gray-600 dark:text-gray-300"
                : row.stacked
                  ? "text-gray-500 dark:text-gray-400"
                  : relationInk(row.node)
            }`}
          />
        );
      })}
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
