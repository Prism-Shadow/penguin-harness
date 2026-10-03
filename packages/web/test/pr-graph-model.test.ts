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
  focusedProposal,
  layoutGraph,
  rowOfProposal,
  splitArgs,
} from "../src/features/proposals/pr-graph-model";

const node = (number: number, parent: number | null, over: Partial<ProposalGraphNode> = {}) =>
  ({
    number,
    url: `https://github.com/acme/app/pull/${number}`,
    title: `PR ${number}`,
    draft: false,
    branch: `b${number}`,
    head: `h${number}`,
    base: parent === 0 ? "dev" : `b${parent}`,
    parent,
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
    const layout = layoutGraph([node(2, 1), node(1, 0), node(3, 2)], 3);
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
    const layout = layoutGraph([node(1, 0), node(2, 1), node(5, 2), node(3, 1)], 3);
    expect(layout.rows[0]!.node?.number).toBe(3);
    expect(layout.rows[0]!.lane).toBe(0);
    expect(layout.rows.find((r) => r.node?.number === 5)!.lane).toBe(1);
  });

  it("does not reuse a lane an earlier side branch's edge still runs through", () => {
    // 1 has three children: 2 continues, 3 and 4 branch off; 3 has its own child 6.
    const layout = layoutGraph(
      [node(1, 0), node(2, 1), node(3, 1), node(4, 1), node(6, 3), node(7, 2), node(8, 7)],
      8,
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
      off: { reason, at },
    });
    const layout = layoutGraph(
      [
        node(1, 0, { fork: true }),
        node(2, 1, { relation: "diverged", stacked: false, ...off("old-line", null) }),
        node(3, 1, off("not-taken", 1)),
        node(4, 1),
        node(5, 4),
      ],
      5,
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
      2,
    );
    expect(shape(layout.rows)).toEqual([
      [2, 0, 1],
      [1, 0, 2],
      [0, 0, null],
    ]);
    expect(layout.detached).toEqual([]);
  });

  it("lists apart a PR on an unknown branch and PRs whose declarations form a cycle", () => {
    const layout = layoutGraph([node(1, 0), node(9, null), node(5, 6), node(6, 5), node(7, 42)], 1);
    expect(layout.rows.map((r) => r.node?.number ?? 0)).toEqual([1, 0]);
    expect(layout.detached.map((n) => n.number)).toEqual([5, 6, 7, 9]);
  });

  it("draws the base alone when there are no PRs", () => {
    const layout = layoutGraph([], null);
    expect(shape(layout.rows)).toEqual([[0, 0, null]]);
    expect(layout.lanes).toBe(1);
  });
});

describe("the proposal focus", () => {
  it("finds the row of a proposal's impl PR, and -1 without one", () => {
    const layout = layoutGraph(
      [node(1, 0), node(2, 1, { proposal: { number: 138, title: "Graph", status: "ready" } })],
      2,
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
