/**
 * The chain rules of the PR graph, without GitHub: buildGraph over plain data walks merged and
 * closed layers through (marking the closed ones), lets an edge whose missing commits carry no
 * content hold, keeps a layer that forked inside the moved-on layer below as stale, takes the
 * branch that keeps going at a fork and leaves the record's forks undecided, and says why every
 * other node is off the chain — and why every impl PR that is not on the graph is not.
 */
import { describe, expect, it } from "vitest";
import type { ProposalGraphResponse } from "@prismshadow/penguin-server/api";
import {
  buildGraph,
  parentsOf,
  type Comparison,
  type GraphInput,
  type ImplPull,
  type OpenPull,
  type ShutPull,
} from "../src/pr-chain.js";

const sha = (c: string): string => c.repeat(40);
const DEV = sha("0");

const pull = (number: number, base: string, head = sha(String(number % 10))): OpenPull => ({
  number,
  url: `https://github.com/acme/site/pull/${number}`,
  title: `PR ${number}`,
  draft: false,
  branch: `b${number}`,
  head,
  base,
});

const ahead = (n = 1): Comparison => ({
  relation: "ahead",
  ahead: n,
  behind: 0,
  mergeBase: null,
  empty: false,
});

/** The graph of these pulls, every comparison looked up in `compares` by `from...to`. */
function graph(
  pulls: OpenPull[],
  compares: Record<string, Comparison>,
  more: Partial<GraphInput> = {},
): ProposalGraphResponse {
  return buildGraph({
    repo: "acme/site",
    base: { branch: "dev", head: DEV },
    pulls,
    origins: [],
    compare: (from, to) => compares[`${from}...${to}`],
    proposals: [],
    deployments: [],
    errors: [],
    checkedAt: "2026-10-01T00:00:00.000Z",
    ...more,
  });
}

const chainOf = (g: ProposalGraphResponse) => g.nodes.filter((n) => n.onChain).map((n) => n.number);
const offOf = (g: ProposalGraphResponse) =>
  Object.fromEntries(g.nodes.filter((n) => !n.onChain).map((n) => [n.number, n.off]));

describe("parentsOf", () => {
  it("walks a base through merged and closed PRs to an open one, and names a branch not looked up yet", () => {
    const shut = new Map<string, ShutPull | null>([
      ["gone-merged", { number: 7, state: "merged", base: "gone-closed" }],
      ["gone-closed", { number: 8, state: "closed", base: "b1" }],
      ["nothing", null],
    ]);
    const parents = parentsOf(
      [pull(1, "dev"), pull(2, "gone-merged"), pull(3, "nothing"), pull(4, "unknown")],
      shut,
      "dev",
    );
    expect(parents.get(1)).toEqual({ parent: 0, via: [], missing: null });
    expect(parents.get(2)).toEqual({
      parent: 1,
      via: [
        { number: 7, state: "merged" },
        { number: 8, state: "closed" },
      ],
      missing: null,
    });
    expect(parents.get(3)).toEqual({ parent: null, via: [], missing: null });
    expect(parents.get(4)).toEqual({ parent: null, via: [], missing: "unknown" });
  });

  it("stops on closed PRs whose bases loop", () => {
    const shut = new Map<string, ShutPull | null>([
      ["x", { number: 7, state: "closed", base: "y" }],
      ["y", { number: 8, state: "closed", base: "x" }],
    ]);
    expect(parentsOf([pull(1, "x")], shut, "dev").get(1)!.parent).toBeNull();
  });
});

describe("buildGraph: the handbook's chain", () => {
  it("keeps a layer on the chain through a closed layer below it, marked, with the layers above it (1a)", () => {
    // #2's base is the branch of #9, closed without merging, whose base was #1's.
    const p = [pull(1, "dev"), pull(2, "closed-branch"), pull(3, "b2")];
    const g = graph(
      p,
      {
        [`${DEV}...${p[0]!.head}`]: ahead(),
        [`${p[0]!.head}...${p[1]!.head}`]: ahead(4),
        [`${p[1]!.head}...${p[2]!.head}`]: ahead(),
      },
      { shut: new Map([["closed-branch", { number: 9, state: "closed", base: "b1" }]]) },
    );
    expect(chainOf(g)).toEqual([1, 2, 3]);
    expect(g.top).toBe(3);
    const n2 = g.nodes.find((n) => n.number === 2)!;
    expect([n2.parent, n2.via, n2.ahead]).toEqual([1, [{ number: 9, state: "closed" }], 4]);
  });

  it("holds an edge whose missing commits carry no content (2) and a layer that forked inside the moved-on parent (2a)", () => {
    const [h1, h2, h3, m] = [sha("1"), sha("2"), sha("3"), sha("m")];
    const p = [pull(1, "dev", h1), pull(2, "b1", h2), pull(3, "b2", h3)];
    const g = graph(p, {
      [`${DEV}...${h1}`]: ahead(),
      // #2 lacks three merge commits of #1's that change nothing.
      [`${h1}...${h2}`]: { relation: "diverged", ahead: 1, behind: 3, mergeBase: m, empty: true },
      // #3 forked at m inside #2's layer, and #2 moved on since.
      [`${h2}...${h3}`]: { relation: "diverged", ahead: 2, behind: 5, mergeBase: m, empty: false },
      [`${h1}...${m}`]: ahead(4),
    });
    expect(chainOf(g)).toEqual([1, 2, 3]);
    const n = new Map(g.nodes.map((x) => [x.number, x]));
    expect([n.get(2)!.stacked, n.get(2)!.stale]).toEqual([true, false]);
    expect([n.get(3)!.stacked, n.get(3)!.stale]).toEqual([true, true]);
  });

  it("puts a layer that forked below its parent's layer on an old line, and the layers on it above an off-chain one", () => {
    const [h1, h2, h3] = [sha("1"), sha("2"), sha("3")];
    const p = [pull(1, "dev", h1), pull(2, "b1", h2), pull(3, "b2", h3)];
    const g = graph(p, {
      [`${DEV}...${h1}`]: ahead(),
      [`${h1}...${h2}`]: {
        relation: "diverged",
        ahead: 1,
        behind: 9,
        mergeBase: DEV,
        empty: false,
      },
      [`${h2}...${h3}`]: ahead(),
    });
    expect(chainOf(g)).toEqual([1]);
    expect(offOf(g)).toEqual({
      2: { reason: "old-line", at: null },
      3: { reason: "above", at: 2 },
    });
  });

  it("takes the branch that keeps going at a fork and names the top; the others are not taken (3)", () => {
    const p = [pull(1, "dev"), pull(2, "b1"), pull(3, "b1"), pull(4, "b3"), pull(5, "b2")];
    const c: Record<string, Comparison> = {};
    for (const x of p) {
      const parent = x.base === "dev" ? DEV : p.find((y) => y.branch === x.base)!.head;
      c[`${parent}...${x.head}`] = ahead();
    }
    // Two leaves on #1: neither keeps going, so the record would decide — both stay, no top.
    const leaves = graph([p[0]!, p[1]!, p[2]!], c);
    expect(chainOf(leaves)).toEqual([1, 2, 3]);
    expect(leaves.top).toBeNull();
    // #2 keeps going (#5 on it), #3 does not: the chain takes #2.
    const one = graph([p[0]!, p[1]!, p[2]!, p[4]!], c);
    expect(chainOf(one)).toEqual([1, 2, 5]);
    expect(one.top).toBe(5);
    expect(one.nodes.find((n) => n.number === 1)!.fork).toBe(true);
    expect(offOf(one)).toEqual({ 3: { reason: "not-taken", at: 1 } });
    // Two branches keep going: the record would decide, so both stay and there is no top.
    const two = graph(p, c);
    expect(chainOf(two).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(two.top).toBeNull();
  });

  it("keeps several stacks that start on the base side by side, and names each one's top", () => {
    // Three stacks on dev: #1→#2→#3, #4→#5 and #6→#7; plus #8 on dev, which goes nowhere.
    const p = [
      pull(1, "dev"),
      pull(2, "b1"),
      pull(3, "b2"),
      pull(4, "dev"),
      pull(5, "b4"),
      pull(6, "dev"),
      pull(7, "b6"),
    ];
    const c: Record<string, Comparison> = {};
    for (const x of p) {
      const parent = x.base === "dev" ? DEV : p.find((y) => y.branch === x.base)!.head;
      c[`${parent}...${x.head}`] = ahead();
    }
    const g = graph(p, c);
    expect(chainOf(g).sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(offOf(g)).toEqual({});
    expect(g.base.fork).toBe(true);
    expect(g.top).toBeNull();
    expect(g.tops).toEqual([3, 5, 7]);
    // A one-layer branch on the base beside stacks that keep going is not taken (rule 3).
    const p8 = pull(8, "dev", sha("8"));
    const withLeaf = graph([...p, p8], { ...c, [`${DEV}...${p8.head}`]: ahead() });
    expect(offOf(withLeaf)).toEqual({ 8: { reason: "not-taken", at: 0 } });
    expect(withLeaf.tops).toEqual([3, 5, 7]);
    // One stack: its top is both `top` and the only entry of `tops`.
    const single = graph(p.slice(0, 3), c);
    expect([single.top, single.tops]).toEqual([3, [3]]);
  });

  it("says why the rest is off: a base that leads nowhere, a cycle, an edge not compared", () => {
    const p = [pull(1, "dev"), pull(2, "nowhere"), pull(3, "b4"), pull(4, "b3"), pull(5, "b1")];
    const g = graph(
      p,
      { [`${DEV}...${p[0]!.head}`]: ahead() },
      { shut: new Map([["nowhere", null]]) },
    );
    expect(chainOf(g)).toEqual([1]);
    expect(offOf(g)).toEqual({
      2: { reason: "no-base", at: null },
      3: { reason: "unread", at: null },
      4: { reason: "unread", at: null },
      5: { reason: "unread", at: null },
    });
    const cyclic = graph(p, {
      [`${DEV}...${p[0]!.head}`]: ahead(),
      [`${p[3]!.head}...${p[2]!.head}`]: ahead(),
      [`${p[2]!.head}...${p[3]!.head}`]: ahead(),
    });
    expect(offOf(cyclic)[3]).toEqual({ reason: "cycle", at: null });
    expect(offOf(cyclic)[4]).toEqual({ reason: "cycle", at: null });
  });
});

describe("buildGraph: why an impl PR is not on the graph", () => {
  it("names a counterpart, a merge, the base, a close, another repository, and an unread PR", () => {
    const url = (repo: string, n: number) => `https://github.com/${repo}/pull/${n}`;
    const proposals = [
      { n: 1, url: url("up/site", 801) },
      { n: 2, url: url("acme/site", 40) },
      { n: 3, url: url("acme/site", 41) },
      { n: 4, url: url("up/site", 802) },
      { n: 5, url: url("other/plugins", 3) },
      { n: 6, url: url("acme/site", 42) },
    ].map((p) => ({ number: p.n, title: `P${p.n}`, status: "ready" as const, implPr: p.url }));
    const implPulls = new Map<string, ImplPull | null>([
      ["up/site#801", { state: "closed", branch: "b1", head: sha("a"), base: "main" }],
      ["acme/site#40", { state: "merged", branch: "old", head: sha("b"), base: "b1" }],
      ["acme/site#41", { state: "closed", branch: "in", head: sha("c"), base: "dev" }],
      ["up/site#802", { state: "closed", branch: "gone", head: sha("d"), base: "main" }],
      ["other/plugins#3", { state: "open", branch: "x", head: sha("e"), base: "main" }],
      ["acme/site#42", null],
    ]);
    const g = graph(
      [pull(1, "dev")],
      {
        [`${DEV}...${sha("1")}`]: ahead(),
        [`${DEV}...${sha("c")}`]: {
          relation: "behind",
          ahead: 0,
          behind: 3,
          mergeBase: sha("c"),
          empty: false,
        },
        [`${DEV}...${sha("d")}`]: {
          relation: "diverged",
          ahead: 2,
          behind: 3,
          mergeBase: DEV,
          empty: false,
        },
      },
      { proposals, implPulls },
    );
    expect(g.unplaced.map((u) => [u.number, u.reason, u.at, u.into])).toEqual([
      [1, "counterpart", 1, null],
      [2, "merged", null, "b1"],
      [3, "in-base", null, null],
      [4, "closed", null, null],
      [5, "open-elsewhere", null, null],
      [6, "unread", null, null],
    ]);
  });
});

describe("buildGraph: an impl branch with no PR", () => {
  it("claims the open PR on the delivery repository whose head branch it is, else is listed as no-pr", () => {
    const branch = (label: string, repo: string | null, name: string) => ({
      label,
      repo,
      branch: name,
    });
    const proposals = [
      // Claims PR 1 (branch b1) on acme/site.
      { n: 1, implBranch: branch("origin/b1", "acme/site", "b1") },
      // The same branch name on another repository claims nothing.
      { n: 2, implBranch: branch("fork/b2", "me/site", "b2") },
      // No open PR on that branch yet.
      { n: 3, implBranch: branch("origin/later", "acme/site", "later") },
      // A remote that resolved to no repository.
      { n: 4, implBranch: branch("ghost/b2", null, "b2") },
      // A rejected proposal claims nothing and is not listed.
      { n: 5, implBranch: branch("origin/b2", "acme/site", "b2"), status: "rejected" as const },
    ].map((p) => ({
      number: p.n,
      title: `P${p.n}`,
      status: p.status ?? ("ready" as const),
      implPr: null,
      implBranch: p.implBranch,
    }));
    const g = graph(
      [pull(1, "dev"), pull(2, "b1")],
      { [`${DEV}...${sha("1")}`]: ahead(), [`${sha("1")}...${sha("2")}`]: ahead() },
      { proposals },
    );
    expect(g.nodes.map((n) => [n.number, n.proposal?.number ?? null])).toEqual([
      [1, 1],
      [2, null],
    ]);
    expect(g.unplaced.map((u) => [u.number, u.reason, u.implPr, u.branch])).toEqual([
      [2, "no-pr", null, "fork/b2"],
      [3, "no-pr", null, "origin/later"],
      [4, "unread", null, "ghost/b2"],
    ]);
  });

  it("an impl PR wins over a branch name: a proposal with a PR is placed by it", () => {
    const g = graph(
      [pull(1, "dev")],
      { [`${DEV}...${sha("1")}`]: ahead() },
      {
        proposals: [
          {
            number: 7,
            title: "P7",
            status: "ready",
            implPr: "https://github.com/acme/site/pull/1",
            implBranch: { label: "origin/b1", repo: "acme/site", branch: "b1" },
          },
          {
            number: 8,
            title: "P8",
            status: "ready",
            implPr: null,
            implBranch: { label: "origin/b1", repo: "acme/site", branch: "b1" },
          },
        ],
      },
    );
    expect(g.nodes[0]!.proposal?.number).toBe(7);
  });
});
