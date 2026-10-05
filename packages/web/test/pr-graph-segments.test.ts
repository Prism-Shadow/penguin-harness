/**
 * features/proposals/pr-graph-segments.ts unit tests over the server's smartlog rows: a segment
 * starts at the base's child and at each branch of a fork and runs up to the next fork; the rows
 * come out base on top, each segment headed by its roadmaps right above its first PR; a folded
 * segment is one line in its column; and every line is carried on, across headings and folded
 * runs, from the newest PRs to the base.
 */
import { describe, expect, it } from "vitest";
import type { ProposalGraphNode, ProposalGraphRow } from "@prismshadow/penguin-server/api";
import {
  cellsOf,
  connectsDown,
  displayRows,
  linesFromNewer,
  segments,
} from "../src/features/proposals/pr-graph-segments";
import type { DisplayRow, RoadmapRef } from "../src/features/proposals/pr-graph-segments";
import { searchHits } from "../src/features/proposals/pr-graph-search";

const k = (n: number): string => (n === 0 ? "" : `b${n}`);

const node = (number: number, parent: number): ProposalGraphNode =>
  ({
    key: k(number),
    number,
    parent: k(parent),
    branch: `feat/b${number}`,
    title: `PR ${number}`,
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
  connector: false,
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

/** A display row as `kind:segment-or-key`, to read an order at a glance. */
const label = (d: DisplayRow): string =>
  d.kind === "row" ? `${d.row.kind}:${d.row.key}` : `${d.kind}:${d.segment}`;

/** The lines from the newer row, keyed by row, over the rows only (no headings, nothing folded). */
const rowLines = (d: readonly DisplayRow[]): Map<string, boolean[]> => {
  const only = d.filter((r) => r.kind === "row");
  const up = linesFromNewer(only);
  return new Map(only.map((r, i) => [label(r), up[i]!]));
};

describe("displayRows", () => {
  const roadmapsOf = (n: ProposalGraphNode) =>
    n.number === 1 ? [rm(4), rm(7)] : n.number === 6 ? [rm(9)] : [];

  it("draws base on top, each segment's heading right above its first PR, its rows base-most first", () => {
    const d = displayRows(rows, nodes, roadmapsOf, new Set());
    expect(d.map(label)).toEqual([
      "base:",
      `roadmap:${k(1)}`,
      `node:${k(1)}`,
      `node:${k(2)}`,
      `node:${k(3)}`,
      `join:${k(3)}`,
      `roadmap:${k(6)}`,
      `node:${k(6)}`,
      `roadmap:${k(4)}`,
      `node:${k(4)}`,
      `node:${k(5)}`,
    ]);
    expect(d[1]).toMatchObject({ count: 3, roadmaps: [rm(4), rm(7)] });
    expect(d[6]).toMatchObject({ count: 1, roadmaps: [rm(9)] });
    expect(d[8]).toMatchObject({ count: 2, roadmaps: [] });
  });

  it("keeps every lane continuous across the headings", () => {
    const d = displayRows(rows, nodes, roadmapsOf, new Set());
    const up = linesFromNewer(d);
    // The topmost heading carries the line from #1 up into the base.
    expect(cellsOf(d[1]!)).toEqual(["│ "]);
    // Between the fork's join and #6 pass the trunk's line and #6's own line.
    expect(cellsOf(d[6]!)).toEqual(["│ ", "│ "]);
    // Between #6 and #4 passes only the trunk's line: #6's column starts at #6.
    expect(cellsOf(d[8]!)).toEqual(["│ "]);
    d.forEach((r, i) => {
      if (r.kind !== "roadmap") return;
      const drawn = cellsOf(r).map(connectsDown);
      // Every lane the heading draws comes into it from the newer row, and goes on into the older.
      expect(up[i], label(r)).toEqual(drawn);
      expect(up[i - 1], label(d[i - 1]!)).toEqual(
        cellsOf(d[i - 1]!).map((_, c) => drawn[c] ?? false),
      );
    });
    // Each row gets exactly the lines it would get with no headings at all.
    const plain = rowLines(d);
    d.forEach((r, i) => {
      if (r.kind === "row") expect(up[i], label(r)).toEqual(plain.get(label(r)));
    });
  });

  it("folds a segment into one line under its heading, and keeps every line connected through it", () => {
    const d = displayRows(rows, nodes, roadmapsOf, new Set([k(1)]));
    expect(d.map(label)).toEqual([
      "base:",
      `roadmap:${k(1)}`,
      `folded:${k(1)}`,
      `join:${k(3)}`,
      `roadmap:${k(6)}`,
      `node:${k(6)}`,
      `roadmap:${k(4)}`,
      `node:${k(4)}`,
      `node:${k(5)}`,
    ]);
    expect(d[2]).toMatchObject({ count: 3, cells: ["┆ "] });
    expect(d[1]).toMatchObject({ folded: true, cells: ["│ "] });
    const up = linesFromNewer(d);
    // The folded line takes the join's line, the heading the folded line's, the base the heading's.
    expect(up[2]).toEqual([true]);
    expect(up[1]).toEqual([true]);
    expect(up[0]).toEqual([true]);
  });

  it("folds a segment above a fork the same way, the trunk's line going on beside it", () => {
    const d = displayRows(rows, nodes, roadmapsOf, new Set([k(6)]));
    const at = d.findIndex((r) => r.kind === "folded");
    expect(label(d[at - 1]!)).toBe(`roadmap:${k(6)}`);
    expect(d[at]).toMatchObject({ count: 1, cells: ["│ ", "┆ "] });
    expect(cellsOf(d[at - 1]!)).toEqual(["│ ", "│ "]);
    expect(linesFromNewer(d)[at - 1]).toEqual([true, true]);
  });

  it("lists search hits in the order their rows are drawn, so a jump and the focus land on them", () => {
    const d = displayRows(rows, nodes, roadmapsOf, new Set());
    const drawn = d.flatMap((r) => (r.kind === "row" && r.row.kind === "node" ? [r.row.key] : []));
    expect(searchHits(rows, nodes, "PR")).toEqual(drawn);
    // The page finds the focused or targeted row by its key in the display list.
    const at = d.findIndex((r) => r.kind === "row" && r.row.kind === "node" && r.row.key === k(6));
    expect(at).toBe(7);
    expect(d[at - 1]).toMatchObject({ kind: "roadmap", segment: k(6) });
  });
});
