import { describe, expect, it } from "vitest";
import type { ProposalGraphNode } from "@prismshadow/penguin-server/api";
import { layoutGraph, topDown } from "../src/features/proposals/pr-graph-model";
import { displayLayout, segments } from "../src/features/proposals/pr-graph-segments";
import type { RoadmapRef } from "../src/features/proposals/pr-graph-segments";

const k = (n: number): string => (n === 0 ? "" : `b${n}`);

const node = (number: number, parent: number | null): ProposalGraphNode =>
  ({
    key: k(number),
    number,
    parent: parent === null ? null : k(parent),
    stacked: true,
    onChain: true,
    relation: "ahead",
    proposal: { number: number * 10, title: `P${number}`, status: "ready" },
  }) as unknown as ProposalGraphNode;

const rm = (n: number): RoadmapRef => ({
  number: n,
  name: `Roadmap ${n}`,
  channelId: `roadmap_${n}`,
});

// dev ─ 1 ─ 2 ─ 3 (fork) ┬ 4 ─ 5
//                       └ 6
const rows = topDown(
  layoutGraph([node(1, 0), node(2, 1), node(3, 2), node(4, 3), node(5, 4), node(6, 3)], k(5)),
).rows;
const numberAt = (i: number) => rows[i]!.node?.number ?? 0;

describe("segments", () => {
  it("starts one at the base's child and one at each branch of a fork, running to the next fork", () => {
    const runs = [...segments(rows)].map(([head, run]) => [numberAt(head), run.map(numberAt)]);
    expect(runs).toEqual(
      expect.arrayContaining([
        [1, [1, 2, 3]],
        [4, [4, 5]],
        [6, [6]],
      ]),
    );
    expect(runs).toHaveLength(3);
  });
});

describe("displayLayout", () => {
  const roadmapsOf = (r: (typeof rows)[number]) => (r.node?.number === 1 ? [rm(4), rm(7)] : []);

  it("heads every segment with its head's roadmaps, all of them", () => {
    const d = displayLayout(rows, roadmapsOf, new Set());
    const headings = d.rows.filter((r) => r.kind === "roadmap");
    expect(headings).toHaveLength(3);
    expect(headings[0]).toMatchObject({ segment: k(1), count: 3, roadmaps: [rm(4), rm(7)] });
    expect(d.rows.filter((r) => r.kind === "node")).toHaveLength(rows.length);
  });

  it("folds a segment into one line and keeps every lane connected through it", () => {
    const d = displayLayout(rows, roadmapsOf, new Set([k(1)]));
    const kinds = d.rows.map((r) => r.kind);
    expect(kinds.filter((k) => k === "folded")).toHaveLength(1);
    // dev, the heading, the folded line, then the two branches below the fork (heading + rows).
    expect(d.rows.filter((r) => r.kind === "node")).toHaveLength(rows.length - 3);
    const line = kinds.indexOf("folded");
    // The fork's two branches now hang from the folded line; the line hangs from dev.
    expect(d.edges.filter((e) => e.to === line)).toHaveLength(2);
    expect(d.edges.filter((e) => e.from === line)).toHaveLength(1);
    expect(d.widths.every((w) => w >= 1)).toBe(true);
  });
});
