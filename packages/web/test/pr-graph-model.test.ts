/**
 * features/proposals/pr-graph-model.ts unit tests: a straight chain is one lane with the base at
 * the bottom; a fork puts the side branch in its own lane, below the continuing chain; the chain
 * that leads to the server's top keeps the lane; an edge that does not hold is drawn unstacked,
 * while a branch the chain did not take keeps its solid edge; a layer the server reached through a
 * closed PR hangs from its parent; a PR with no parent, or in a cycle of declarations, is listed
 * apart; and the
 * `?proposal=` focus finds its row.
 */
import { describe, expect, it } from "vitest";
import type { ProposalGraphNode } from "@prismshadow/penguin-server/api";
import {
  baseStacks,
  focusedProposal,
  graphGeometry,
  deployTarget,
  layoutGraph,
  foldedAsMerged,
  nodeRef,
  rowOfProposal,
  rowWidths,
  splitArgs,
  topDown,
} from "../src/features/proposals/pr-graph-model";
import type { GraphRow } from "../src/features/proposals/pr-graph-model";

/** A PR's node key in these tests (its head branch), `""` for the base branch (0). */
const k = (n: number): string => (n === 0 ? "" : `b${n}`);

const node = (number: number, parent: number | null, over: Partial<ProposalGraphNode> = {}) =>
  ({
    key: k(number),
    number,
    url: `https://github.com/acme/app/pull/${number}`,
    title: `PR ${number}`,
    draft: false,
    branch: `b${number}`,
    head: `h${number}`,
    base: parent === 0 ? "dev" : `b${parent}`,
    parent: parent === null ? null : k(parent),
    via: [],
    relation: "ahead",
    ahead: 1,
    behind: 0,
    stacked: true,
    stale: false,
    onChain: true,
    off: null,
    fork: false,
    proposal: null,
    origins: [],
    ...over,
  }) as ProposalGraphNode;

const shape = (rows: ReturnType<typeof layoutGraph>["rows"]) =>
  rows.map((r) => [r.node?.number ?? 0, r.lane, r.parentRow]);

describe("layoutGraph", () => {
  it("draws a straight chain in one lane, newest on top and the base last", () => {
    const layout = layoutGraph([node(2, 1), node(1, 0), node(3, 2)], k(3));
    expect(shape(layout.rows)).toEqual([
      [3, 0, 1],
      [2, 0, 2],
      [1, 0, 3],
      [0, 0, null],
    ]);
    expect(layout.lanes).toBe(1);
    expect(layout.detached).toEqual([]);
  });

  it("gives a side branch its own lane, below the chain that continues", () => {
    // 1 forks into 2 (continues to 4) and 3 (a side branch).
    const layout = layoutGraph(
      [node(1, 0, { fork: true }), node(2, 1), node(3, 1), node(4, 2)],
      null,
    );
    expect(shape(layout.rows)).toEqual([
      [4, 0, 1],
      [2, 0, 3],
      [3, 1, 3],
      [1, 0, 4],
      [0, 0, null],
    ]);
    expect(layout.lanes).toBe(2);
  });

  it("keeps the lane for the child that leads to the top, even when it is shorter", () => {
    const layout = layoutGraph([node(1, 0), node(2, 1), node(5, 2), node(3, 1)], k(3));
    expect(layout.rows[0]!.node?.number).toBe(3);
    expect(layout.rows[0]!.lane).toBe(0);
    expect(layout.rows.find((r) => r.node?.number === 5)!.lane).toBe(1);
  });

  it("does not reuse a lane an earlier side branch's edge still runs through", () => {
    // 1 has three children: 2 continues, 3 and 4 branch off; 3 has its own child 6.
    const layout = layoutGraph(
      [node(1, 0), node(2, 1), node(3, 1), node(4, 1), node(6, 3), node(7, 2), node(8, 7)],
      k(8),
    );
    const lane = (n: number) => layout.rows.find((r) => r.node?.number === n)!.lane;
    expect(lane(2)).toBe(0);
    expect(new Set([lane(3), lane(4)]).size).toBe(2);
    expect(lane(6)).toBe(lane(3));
    expect(lane(3)).toBeGreaterThan(0);
    expect(lane(4)).toBeGreaterThan(0);
  });

  it("draws an edge that does not hold unstacked, and a branch the chain did not take with its solid edge", () => {
    const off = (reason: "old-line" | "not-taken", at: number | null) => ({
      onChain: false,
      off: { reason, at: at === null ? null : k(at) },
    });
    const layout = layoutGraph(
      [
        node(1, 0, { fork: true }),
        node(2, 1, { relation: "diverged", stacked: false, ...off("old-line", null) }),
        node(3, 1, off("not-taken", 1)),
        node(4, 1),
        node(5, 4),
      ],
      k(5),
    );
    const row = (n: number) => layout.rows.find((r) => r.node?.number === n)!;
    expect(row(2).stacked).toBe(false);
    expect(row(3).stacked).toBe(true);
    expect(row(1).stacked).toBe(true);
    // The chain keeps the lane; of the two branches off it, the stacked one sits nearer.
    expect(row(4).lane).toBe(0);
    expect(row(3).lane).toBeLessThan(row(2).lane);
  });

  it("hangs a layer the server reached through a closed PR from its parent instead of listing it apart", () => {
    const layout = layoutGraph(
      [node(1, 0), node(2, 1, { base: "closed-branch", via: [{ number: 9, state: "closed" }] })],
      k(2),
    );
    expect(shape(layout.rows)).toEqual([
      [2, 0, 1],
      [1, 0, 2],
      [0, 0, null],
    ]);
    expect(layout.detached).toEqual([]);
  });

  it("lists apart a PR on an unknown branch and PRs whose declarations form a cycle", () => {
    const layout = layoutGraph(
      [node(1, 0), node(9, null), node(5, 6), node(6, 5), node(7, 42)],
      k(1),
    );
    expect(layout.rows.map((r) => r.node?.number ?? 0)).toEqual([1, 0]);
    // In the order the server listed them.
    expect(layout.detached.map((n) => n.number)).toEqual([9, 5, 6, 7]);
  });

  it("draws the base alone when there are no PRs", () => {
    const layout = layoutGraph([], null);
    expect(shape(layout.rows)).toEqual([[0, 0, null]]);
    expect(layout.lanes).toBe(1);
  });
});

describe("several stacks on the base", () => {
  it("draws each stack as its own line and counts the stacks on the base", () => {
    // Three stacks on dev: 1→2, 3→4, 5→6.
    const nodes = [node(1, 0), node(2, 1), node(3, 0), node(4, 3), node(5, 0), node(6, 5)];
    const { rows, lanes } = layoutGraph(nodes, null);
    expect(lanes).toBe(3);
    // Every stack keeps one lane from its bottom to its top.
    const laneOf = new Map(rows.filter((r) => r.node).map((r) => [r.node!.number, r.lane]));
    expect(laneOf.get(1)).toBe(laneOf.get(2));
    expect(laneOf.get(3)).toBe(laneOf.get(4));
    expect(laneOf.get(5)).toBe(laneOf.get(6));
    expect(new Set([laneOf.get(1), laneOf.get(3), laneOf.get(5)]).size).toBe(3);
    expect(baseStacks(nodes)).toBe(3);
    // A branch on the base that is off the chain does not count as a stack.
    expect(baseStacks([...nodes, node(7, 0, { onChain: false })])).toBe(3);
  });
});

describe("branch nodes", () => {
  /** An impl branch no PR is open on: no number, keyed by its branch, its proposal named. */
  const branchNode = (branch: string, parent: string, proposal: number) =>
    node(0, null, {
      key: branch,
      number: null,
      url: null,
      title: `P${proposal}`,
      branch,
      base: parent === "" ? "dev" : parent,
      parent,
      proposal: { number: proposal, title: `P${proposal}`, status: "drafting" },
    });

  it("lays a branch node out like a PR, a PR stacked on it hanging from it, and focuses its proposal", () => {
    // dev ─ #1 ─ impl/a (proposal 40) ─ #2
    const nodes = [
      node(1, 0),
      node(2, 0, { parent: "impl/a", base: "impl/a" }),
      branchNode("impl/a", k(1), 40),
    ];
    const layout = layoutGraph(nodes, k(2));
    expect(layout.rows.map((r) => r.node?.key ?? "")).toEqual([k(2), "impl/a", k(1), ""]);
    expect(layout.rows.every((r) => r.lane === 0)).toBe(true);
    expect(layout.detached).toEqual([]);
    expect(rowOfProposal(layout.rows, 40)).toBe(1);
  });

  it("names a branch node by its branch and deploys it through its proposal", () => {
    const b = branchNode("impl/a", "", 40);
    expect(nodeRef(b)).toBe("impl/a");
    expect(nodeRef(node(7, 0))).toBe("#7");
    expect(deployTarget(b)).toEqual({ proposal: 40 });
    expect(deployTarget(node(7, 0))).toEqual({ pr: 7 });
    expect(deployTarget({ number: null, proposal: null })).toBeNull();
  });
});

describe("the proposal focus", () => {
  it("finds the row of a proposal's impl PR, and -1 without one", () => {
    const layout = layoutGraph(
      [node(1, 0), node(2, 1, { proposal: { number: 138, title: "Graph", status: "ready" } })],
      k(2),
    );
    expect(rowOfProposal(layout.rows, 138)).toBe(0);
    expect(rowOfProposal(layout.rows, 7)).toBe(-1);
  });

  it("reads ?proposal= as a positive integer, anything else as no focus", () => {
    expect(focusedProposal(new URLSearchParams("proposal=138"))).toBe(138);
    expect(focusedProposal(new URLSearchParams("proposal=0"))).toBeNull();
    expect(focusedProposal(new URLSearchParams("proposal=x"))).toBeNull();
    expect(focusedProposal(new URLSearchParams(""))).toBeNull();
  });
});

describe("splitArgs", () => {
  it("splits a deploy's extra arguments at whitespace and drops the empty ones", () => {
    expect(splitArgs("  --extra-args   x\ty \n")).toEqual(["--extra-args", "x", "y"]);
    expect(splitArgs("")).toEqual([]);
  });
});

describe("rowWidths", () => {
  const row = (lane: number, parentRow: number | null): GraphRow => ({
    node: null,
    lane,
    parentRow,
    stacked: true,
  });

  it("gives each row only the lanes it crosses, so a stack forking near the base indents only there", () => {
    // 0, 1: the main stack (lane 0); 2: a side stack (lane 1) hanging from the fork at 3; 4: base.
    const rows = [row(0, 1), row(0, 3), row(1, 3), row(0, 4), row(0, null)];
    // Row 3 is the fork: the side stack's edge bends into it there.
    expect(rowWidths(rows)).toEqual([1, 1, 2, 2, 1]);
  });

  it("counts an edge's lane on every row it passes", () => {
    // 0: lane 1, hanging from row 3; rows 1 and 2 sit on lane 0 but the edge passes them.
    const rows = [row(1, 3), row(0, 2), row(0, 3), row(0, null)];
    expect(rowWidths(rows)).toEqual([2, 2, 2, 2]);
  });
});

describe("topDown", () => {
  it("puts the base first and the top last, and renumbers every parent row", () => {
    const layout = layoutGraph([node(1, 0), node(2, 1), node(3, 2)], k(3));
    const down = topDown(layout);
    expect(down.rows.map((r) => r.node?.number ?? 0)).toEqual([0, 1, 2, 3]);
    expect(down.rows.map((r) => r.parentRow)).toEqual([null, 0, 1, 2]);
    expect(down.lanes).toBe(layout.lanes);
  });

  it("keeps the widths a row crosses when the edges run downward", () => {
    const layout = topDown(layoutGraph([node(1, 0), node(2, 1), node(5, 1), node(3, 2)], k(3)));
    const widths = rowWidths(layout.rows);
    expect(widths[0]).toBe(1); // the base
    expect(Math.max(...widths)).toBe(layout.lanes);
  });
});

describe("graphGeometry", () => {
  it("scales every measure with the root font-size the theme's text size sets", () => {
    const base = graphGeometry(16);
    const large = graphGeometry(20);
    expect(base.row).toBe(60);
    expect(base.lane).toBe(16);
    expect(large.row / base.row).toBe(20 / 16);
    expect(large.lane / base.lane).toBe(20 / 16);
    expect(large.rowY(2)).toBeCloseTo(2.5 * large.row);
  });
});

describe("foldedAsMerged", () => {
  it("folds a merged proposal and nothing else", () => {
    expect(foldedAsMerged("merged")).toBe(true);
    for (const s of ["ready", "approved", "drafting", "rejected", null, undefined]) {
      expect(foldedAsMerged(s)).toBe(false);
    }
  });
});
