/**
 * What an off-chain node says about fixing it (off-detail.ts), through buildGraph over plain data:
 * a base nothing registers names itself and the proposal that registered it; a base a merged PR
 * claimed away names the proposal that registered the PR and the PR; a node whose base is drawn
 * (stacked on an off-chain node, or an old line) says nothing more than its reason.
 */
import { describe, expect, it } from "vitest";
import type { ProposalGraphResponse } from "@prismshadow/penguin-server/api";
import {
  buildGraph,
  type Comparison,
  type GraphInput,
  type GraphProposal,
  type OpenPull,
} from "../src/pr-chain.js";

const sha = (c: string): string => c.repeat(40);
const DEV = sha("0");
const ahead: Comparison = { relation: "ahead", ahead: 1, behind: 0, mergeBase: null, empty: false };

const impl = (
  n: number,
  branch: string,
  base: string,
  fields: Partial<GraphProposal> = {},
): GraphProposal => ({
  number: n,
  title: `P${n}`,
  status: "drafting",
  implPr: null,
  implBranch: { label: `origin/${branch}`, repo: "acme/site", branch, base },
  ...fields,
});

function graph(more: Partial<GraphInput>): ProposalGraphResponse {
  return buildGraph({
    repo: "acme/site",
    base: { branch: "dev", head: DEV },
    pulls: [],
    origins: [],
    compare: () => undefined,
    proposals: [],
    deployments: [],
    errors: [],
    checkedAt: "2026-10-06T00:00:00.000Z",
    ...more,
  });
}

const offOf = (g: ProposalGraphResponse, key: string) => g.nodes.find((n) => n.key === key)?.off;

describe("an off-chain node's detail", () => {
  it("names a base nothing registers, and who registered it", () => {
    const pull: OpenPull = {
      number: 3,
      url: "https://github.com/acme/site/pull/3",
      title: "PR 3",
      draft: false,
      branch: "b3",
      head: sha("3"),
      base: "nothing",
    };
    const g = graph({
      pulls: [pull],
      proposals: [impl(5, "feat/c", "nowhere"), impl(6, "feat/d", "feat/c")],
      tips: new Map([
        ["feat/c", sha("c")],
        ["feat/d", sha("d")],
      ]),
      compare: (from, to) => (from === sha("c") && to === sha("d") ? ahead : undefined),
    });
    expect(offOf(g, "feat/c")).toEqual({
      reason: "no-base",
      at: null,
      missing: "nowhere",
      by: { proposal: 5 },
    });
    // A PR no proposal registered: the base alone.
    expect(offOf(g, "b3")).toEqual({ reason: "no-base", at: null, missing: "nothing" });
    // Stacked on the off-chain node: its base is drawn, `at` says where to look.
    expect(offOf(g, "feat/d")).toEqual({ reason: "above", at: "feat/c" });
  });

  it("names the proposal whose merged PR claimed the base branch away, and the PR", () => {
    const merged = "https://github.com/acme/site/pull/20";
    const proposals = [
      impl(1, "feat/a", "dev", { implPr: merged }),
      impl(2, "feat/b", "feat/a"),
      impl(3, "feat/e", "feat/b"),
    ];
    const implPulls = new Map([
      ["acme/site#20", { state: "merged" as const, branch: "feat/a", head: sha("a"), base: "dev" }],
    ]);
    const tips = new Map([
      ["feat/b", sha("b")],
      ["feat/e", sha("e")],
    ]);
    const claimed = { missing: "feat/a", by: { proposal: 1, pr: merged } };
    const compare = (from: string, to: string) =>
      from === sha("b") && to === sha("e") ? ahead : undefined;

    // The merged PR on the branch not looked up yet: no parent at all.
    const unwalked = graph({ proposals, implPulls, tips, compare });
    expect(unwalked.unplaced).toMatchObject([{ number: 1, reason: "merged" }]);
    expect(offOf(unwalked, "feat/b")).toEqual({ reason: "no-base", at: null, ...claimed });
    expect(offOf(unwalked, "feat/e")).toEqual({ reason: "above", at: "feat/b" });

    // Walked through to the base branch, the edge not compared: the same detail on `unread`.
    const walked = graph({
      proposals,
      implPulls,
      tips,
      compare,
      shut: new Map([["feat/a", { number: 20, state: "merged" as const, base: "dev" }]]),
    });
    expect(offOf(walked, "feat/b")).toEqual({ reason: "unread", at: null, ...claimed });
  });

  it("says nothing more for an old line whose base is drawn", () => {
    const g = graph({
      proposals: [impl(1, "feat/a", "dev"), impl(2, "feat/b", "feat/a")],
      tips: new Map([
        ["feat/a", sha("a")],
        ["feat/b", sha("b")],
      ]),
      compare: (from, to) =>
        from === DEV && to === sha("a")
          ? ahead
          : from === sha("a") && to === sha("b")
            ? { relation: "diverged", ahead: 1, behind: 1, mergeBase: null, empty: false }
            : undefined,
    });
    expect(offOf(g, "feat/a")).toBeNull();
    expect(offOf(g, "feat/b")).toEqual({ reason: "old-line", at: null });
  });
});
