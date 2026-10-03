/**
 * features/proposals/pr-graph-model.ts unit tests: the stacks on the base are counted, a branch
 * node is named by its branch and deploys through its proposal, the `?proposal=` focus finds its
 * node, and a merged proposal folds. The layout itself is the
 * server's (company-proposals smartlog.ts, tested there).
 */
import { describe, expect, it } from "vitest";
import type { ProposalGraphNode } from "@prismshadow/penguin-server/api";
import {
  baseStacks,
  deployTarget,
  focusedProposal,
  foldedAsMerged,
  nodeOfProposal,
  nodeRef,
} from "../src/features/proposals/pr-graph-model";

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

describe("several stacks on the base", () => {
  it("counts each line on the base that is on the chain as a stack", () => {
    // Three stacks on dev: 1→2, 3→4, 5→6.
    const nodes = [node(1, 0), node(2, 1), node(3, 0), node(4, 3), node(5, 0), node(6, 5)];
    expect(baseStacks(nodes)).toBe(3);
    // A line on the base whose edge does not hold is off the chain and no stack.
    expect(baseStacks([...nodes, node(7, 0, { onChain: false, stacked: false })])).toBe(3);
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

  it("names a branch node by its branch and deploys it through its proposal", () => {
    const b = branchNode("impl/a", "", 40);
    expect(nodeRef(b)).toBe("impl/a");
    expect(nodeRef(node(7, 0))).toBe("#7");
    expect(deployTarget(b)).toEqual({ proposal: 40 });
    expect(deployTarget(node(7, 0))).toEqual({ pr: 7 });
    expect(deployTarget({ number: null, proposal: null })).toBeNull();
  });

  it("finds a branch node by its proposal", () => {
    const nodes = [node(1, 0), branchNode("impl/a", k(1), 40)];
    expect(nodeOfProposal(nodes, 40)?.key).toBe("impl/a");
  });
});

describe("the proposal focus", () => {
  it("finds the node of a proposal's impl PR, and none without one", () => {
    const nodes = [
      node(1, 0),
      node(2, 1, { proposal: { number: 138, title: "Graph", status: "ready" } }),
    ];
    expect(nodeOfProposal(nodes, 138)?.key).toBe(k(2));
    expect(nodeOfProposal(nodes, 7)).toBeNull();
  });

  it("reads ?proposal= as a positive integer, anything else as no focus", () => {
    expect(focusedProposal(new URLSearchParams("proposal=138"))).toBe(138);
    expect(focusedProposal(new URLSearchParams("proposal=0"))).toBeNull();
    expect(focusedProposal(new URLSearchParams("proposal=x"))).toBeNull();
    expect(focusedProposal(new URLSearchParams(""))).toBeNull();
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
