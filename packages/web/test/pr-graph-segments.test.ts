/**
 * features/proposals/pr-graph-segments.ts unit tests over the server's smartlog rows: a segment
 * starts at the base's child and at each branch of a fork and runs up to the next fork; each is
 * headed by its roadmaps; a folded one is one line in its column; and every line coming from
 * above is carried on, across headings and folded runs, down to the base.
 */
import { describe, expect, it } from "vitest";
import type { ProposalGraphNode, ProposalGraphRow } from "@prismshadow/penguin-server/api";
import {
  cellsOf,
  displayRows,
  linesFromAbove,
  segments,
} from "../src/features/proposals/pr-graph-segments";
import type { RoadmapRef } from "../src/features/proposals/pr-graph-segments";

const k = (n: number): string => (n === 0 ? "" : `b${n}`);

const node = (number: number, parent: number): ProposalGraphNode =>
  ({
    key: k(number),
    number,
    parent: k(parent),
    stacked: true,
    onChain: true,
    relation: "ahead",
    proposal: { number: number * 10, title: `P${number}`, status: "ready" },
  }) as unknown as ProposalGraphNode;

const row = (kind: ProposalGraphRow["kind"], n: number, cells: string[]): ProposalGraphRow => ({
  kind,
  key: k(n),
  cells,
  behind: null,
});

const rm = (n: number): RoadmapRef => ({
  number: n,
  name: `Roadmap ${n}`,
  channelId: `roadmap_${n}`,
});

// dev ─ 1 ─ 2 ─ 3 (fork) ┬ 4 ─ 5, └ 6 — as the server draws it:
//   ○  5
//   ○  4
//   │ ○  6
//   ├─╯
//   ○  3
//   ○  2
//   ○  1
//   ~  dev
const nodes = [node(1, 0), node(2, 1), node(3, 2), node(4, 3), node(5, 4), node(6, 3)];
const rows: ProposalGraphRow[] = [
  row("node", 5, ["○ "]),
  row("node", 4, ["○ "]),
  row("node", 6, ["│ ", "○ "]),
  row("join", 3, ["├─", "╯ "]),
  row("node", 3, ["○ "]),
  row("node", 2, ["○ "]),
  row("node", 1, ["○ "]),
  row("base", 0, ["~ "]),
];

describe("segments", () => {
  it("starts one at the base's child and one at each branch of a fork, running up to the next fork", () => {
    const runs = [...segments(rows, nodes)].map(([top, run]) => [top, run]);
    expect(runs).toEqual(
      expect.arrayContaining([
        [4, [4, 5, 6]],
        [0, [0, 1]],
        [2, [2]],
      ]),
    );
    expect(runs).toHaveLength(3);
  });
});

describe("displayRows", () => {
  const roadmapsOf = (n: ProposalGraphNode) => (n.number === 1 ? [rm(4), rm(7)] : []);

  it("heads every segment, right above its top, with its head's roadmaps", () => {
    const d = displayRows(rows, nodes, roadmapsOf, new Set());
    const headings = d.filter((r) => r.kind === "roadmap");
    expect(headings).toHaveLength(3);
    expect(d.map((r) => r.kind)).toEqual([
      "roadmap",
      "row",
      "row",
      "roadmap",
      "row",
      "row",
      "roadmap",
      "row",
      "row",
      "row",
      "row",
    ]);
    expect(headings[2]).toMatchObject({ segment: k(1), count: 3, roadmaps: [rm(4), rm(7)] });
    // The heading above #6 carries the trunk's line on through it.
    expect(cellsOf(d[3]!)).toEqual(["│ ", "  "]);
  });

  it("folds a segment into one line in its column, and keeps every line connected through it", () => {
    const d = displayRows(rows, nodes, roadmapsOf, new Set([k(1)]));
    const folded = d.findIndex((r) => r.kind === "folded");
    expect(d[folded]).toMatchObject({ count: 3, cells: ["┆ "] });
    expect(d.filter((r) => r.kind === "row")).toHaveLength(rows.length - 3);
    const up = linesFromAbove(d);
    // The folded line takes the join's line from above, and the base takes the folded line's.
    expect(up[folded]).toEqual([true]);
    expect(up[d.length - 1]).toEqual([true]);
  });
});
