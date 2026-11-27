/**
 * The chain rules of the PR graph, without GitHub: buildGraph over plain data walks merged and
 * closed layers through (marking the closed ones), lets an edge whose missing commits carry no
 * content hold, keeps a layer that forked inside the moved-on layer below as stale — and the
 * bottom layer once the base branch moved on, with the stack above it — takes the
 * branch that keeps going at a fork and leaves the record's forks undecided, and says why every
 * other node is off the chain — and why every impl PR that is not on the graph is not. An impl
 * branch no PR is open on is a node of its own, here also read end to end from a temporary
 * repository through the real mirror.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProposalGraphResponse } from "@prismshadow/penguin-server/api";
import {
  LocalGitMirror,
  PrGraphReader,
  SqliteGraphStore,
  SqliteProposalStore,
} from "../src/index.js";
import { FakeForge, cr } from "./graph-fakes.js";
import {
  buildGraph,
  parentsOf,
  type Comparison,
  type GraphInput,
  type GraphProposal,
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

/** A node's key as a PR number, as these tests name nodes: "" (the base branch) is 0. */
const numOf = (g: ProposalGraphResponse, key: string | null): number | null =>
  key === null ? null : key === "" ? 0 : (g.nodes.find((n) => n.key === key)?.number ?? null);
const chainOf = (g: ProposalGraphResponse) => g.nodes.filter((n) => n.onChain).map((n) => n.number);
const offOf = (g: ProposalGraphResponse) =>
  Object.fromEntries(
    g.nodes
      .filter((n) => !n.onChain)
      .map((n) => [n.number, n.off && { reason: n.off.reason, at: numOf(g, n.off.at) }]),
  );
const topOf = (g: ProposalGraphResponse) => numOf(g, g.top);
const topsOf = (g: ProposalGraphResponse) => g.tops.map((k) => numOf(g, k));
/** The heads parentsOf walks, keyed by branch as graph-heads.ts keys open PRs. */
const keyed = (pulls: OpenPull[]) => pulls.map((p) => ({ ...p, key: p.branch }));

describe("parentsOf", () => {
  it("walks a base through merged and closed PRs to an open one, and names a branch not looked up yet", () => {
    const shut = new Map<string, ShutPull | null>([
      ["gone-merged", { number: 7, state: "merged", base: "gone-closed" }],
      ["gone-closed", { number: 8, state: "closed", base: "b1" }],
      ["nothing", null],
    ]);
    const parents = parentsOf(
      keyed([pull(1, "dev"), pull(2, "gone-merged"), pull(3, "nothing"), pull(4, "unknown")]),
      shut,
      "dev",
    );
    expect(parents.get("b1")).toEqual({ parent: "", via: [], missing: null });
    expect(parents.get("b2")).toEqual({
      parent: "b1",
      via: [
        { number: 7, state: "merged" },
        { number: 8, state: "closed" },
      ],
      missing: null,
    });
    expect(parents.get("b3")).toEqual({ parent: null, via: [], missing: null });
    expect(parents.get("b4")).toEqual({ parent: null, via: [], missing: "unknown" });
  });

  it("stops on closed PRs whose bases loop", () => {
    const shut = new Map<string, ShutPull | null>([
      ["x", { number: 7, state: "closed", base: "y" }],
      ["y", { number: 8, state: "closed", base: "x" }],
    ]);
    expect(parentsOf(keyed([pull(1, "x")]), shut, "dev").get("b1")!.parent).toBeNull();
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
    expect(topOf(g)).toBe(3);
    const n2 = g.nodes.find((n) => n.number === 2)!;
    expect([n2.parent, n2.via, n2.ahead]).toEqual(["b1", [{ number: 9, state: "closed" }], 4]);
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

  it("keeps the bottom layer on the chain, stale, when the base moved on after the stack was built (2b)", () => {
    const [h1, h2, h3, m] = [sha("1"), sha("2"), sha("3"), sha("m")];
    const p = [pull(1, "dev", h1), pull(2, "b1", h2), pull(3, "b2", h3)];
    const g = graph(p, {
      // #1 forked at m on dev's history; dev gained four commits since.
      [`${DEV}...${h1}`]: { relation: "diverged", ahead: 2, behind: 4, mergeBase: m, empty: false },
      [`${h1}...${h2}`]: ahead(),
      [`${h2}...${h3}`]: ahead(),
    });
    expect(chainOf(g)).toEqual([1, 2, 3]);
    expect(topOf(g)).toBe(3);
    const n = new Map(g.nodes.map((x) => [x.number, x]));
    expect([n.get(1)!.stacked, n.get(1)!.stale, n.get(1)!.behind]).toEqual([true, true, 4]);
    expect([n.get(2)!.stale, n.get(3)!.stale]).toEqual([false, false]);
  });

  it("puts a bottom layer with no fork point on the base's history on an old line, with the layers on it", () => {
    const [h1, h2] = [sha("1"), sha("2")];
    const p = [pull(1, "dev", h1), pull(2, "b1", h2)];
    const g = graph(p, {
      [`${DEV}...${h1}`]: {
        relation: "diverged",
        ahead: 3,
        behind: 5,
        mergeBase: null,
        empty: false,
      },
      [`${h1}...${h2}`]: ahead(),
    });
    expect(chainOf(g)).toEqual([]);
    expect(offOf(g)).toEqual({
      1: { reason: "old-line", at: null },
      2: { reason: "above", at: 1 },
    });
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
    expect(topOf(leaves)).toBeNull();
    // #2 keeps going (#5 on it), #3 does not: the chain takes #2.
    const one = graph([p[0]!, p[1]!, p[2]!, p[4]!], c);
    expect(chainOf(one)).toEqual([1, 2, 5]);
    expect(topOf(one)).toBe(5);
    expect(one.nodes.find((n) => n.number === 1)!.fork).toBe(true);
    expect(offOf(one)).toEqual({ 3: { reason: "not-taken", at: 1 } });
    // Two branches keep going: the record would decide, so both stay and there is no top.
    const two = graph(p, c);
    expect(chainOf(two).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(topOf(two)).toBeNull();
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
    expect(topOf(g)).toBeNull();
    expect(topsOf(g)).toEqual([3, 5, 7]);
    // A one-layer branch on the base beside stacks that keep going is a stack of its own (3a).
    const p8 = pull(8, "dev", sha("8"));
    const withLeaf = graph([...p, p8], { ...c, [`${DEV}...${p8.head}`]: ahead() });
    expect(offOf(withLeaf)).toEqual({});
    expect(topsOf(withLeaf)).toEqual([3, 5, 7, 8]);
    // One stack: its top is both `top` and the only entry of `tops`.
    const single = graph(p.slice(0, 3), c);
    expect([topOf(single), topsOf(single)]).toEqual([3, [3]]);
  });

  it("takes every line on the base as a stack, never not-taken; a fork inside a stack still is (3, 3a)", () => {
    // A three-layer stack #1→#2→#3 with #4 forking off #1 and going nowhere; #5, #6, #7 alone on dev.
    const p = [
      pull(1, "dev", sha("a")),
      pull(2, "b1", sha("b")),
      pull(3, "b2", sha("c")),
      pull(4, "b1", sha("d")),
      pull(5, "dev", sha("e")),
      pull(6, "dev", sha("f")),
      pull(7, "dev", sha("1")),
    ];
    const c: Record<string, Comparison> = {};
    for (const x of p) {
      const parent = x.base === "dev" ? DEV : p.find((y) => y.branch === x.base)!.head;
      c[`${parent}...${x.head}`] = ahead();
    }
    const g = graph(p, c);
    expect(chainOf(g).sort()).toEqual([1, 2, 3, 5, 6, 7]);
    expect(offOf(g)).toEqual({ 4: { reason: "not-taken", at: 1 } });
    expect(topsOf(g)).toEqual([3, 5, 6, 7]);
    expect([g.base.fork, topOf(g)]).toEqual([true, null]);
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
  it("claims the open PR on its head branch, else is a node of its own, else is listed unread", () => {
    const branch = (label: string, repo: string | null, name: string, base?: string) => ({
      label,
      repo,
      branch: name,
      base: base ?? null,
    });
    const proposals = [
      // Claims PR 1 (branch b1) on acme/site.
      { n: 1, implBranch: branch("origin/b1", "acme/site", "b1") },
      // The same branch name on another repository: not on the delivery repository.
      { n: 2, implBranch: branch("fork/b2", "me/site", "b2") },
      // No open PR on that branch yet: a branch node on PR 2's branch.
      { n: 3, implBranch: branch("origin/later", "acme/site", "later", "b2") },
      // A remote that resolved to no repository.
      { n: 4, implBranch: branch("ghost/b2", null, "b2") },
      // A rejected proposal claims nothing and is not listed.
      { n: 5, implBranch: branch("origin/b9", "acme/site", "b9"), status: "rejected" as const },
      // Its branch is not on the delivery repository (no tip read).
      { n: 6, implBranch: branch("origin/gone", "acme/site", "gone") },
      // A merged proposal's branch is not drawn: it went into its base.
      {
        n: 7,
        implBranch: branch("origin/done", "acme/site", "done", "b1"),
        status: "merged" as const,
      },
    ].map((p) => ({
      number: p.n,
      title: `P${p.n}`,
      status: p.status ?? ("ready" as const),
      implPr: null,
      implBranch: p.implBranch,
    }));
    const L = sha("l");
    const g = graph(
      [pull(1, "dev"), pull(2, "b1")],
      {
        [`${DEV}...${sha("1")}`]: ahead(),
        [`${sha("1")}...${sha("2")}`]: ahead(),
        [`${sha("2")}...${L}`]: ahead(2),
      },
      {
        proposals,
        tips: new Map([
          ["later", L],
          ["b9", sha("9")],
          ["done", sha("d")],
        ]),
      },
    );
    expect(g.nodes.map((n) => [n.key, n.number, n.parent, n.proposal?.number ?? null])).toEqual([
      ["b1", 1, "", 1],
      ["b2", 2, "b1", null],
      ["later", null, "b2", 3],
    ]);
    const later = g.nodes[2]!;
    expect([later.url, later.title, later.head, later.base, later.ahead, later.onChain]).toEqual([
      null,
      "P3",
      L,
      "b2",
      2,
      true,
    ]);
    expect(g.top).toBe("later");
    expect(g.unplaced.map((u) => [u.number, u.reason, u.implPr, u.branch, u.into])).toEqual([
      [2, "unread", null, "fork/b2", null],
      [4, "unread", null, "ghost/b2", null],
      [6, "unread", null, "origin/gone", null],
      [7, "merged", null, "origin/done", "b1"],
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

describe("impl branch nodes, read from a repository", () => {
  let dir: string;
  let origin: string;
  const tip: Record<string, string> = {};

  const git = (cwd: string, ...args: string[]): string =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@example.com",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@example.com",
      },
    }).trim();
  const commit = async (branch: string, file: string): Promise<void> => {
    await fs.writeFile(path.join(origin, file), `${file} ${Date.now()} ${Math.random()}\n`);
    git(origin, "add", "-A");
    git(origin, "commit", "-q", "-m", file);
    tip[branch] = git(origin, "rev-parse", "HEAD");
  };

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "graph-branch-nodes-"));
    origin = path.join(dir, "origin");
    await fs.mkdir(origin);
    git(origin, "init", "-q", "-b", "dev");
    git(origin, "config", "uploadpack.allowFilter", "true");
    await commit("dev", "base.txt");
    // dev ─ impl/one (proposal 1) ─ impl/two (proposal 2) ─ impl/three (proposal 3, PR #30).
    git(origin, "checkout", "-q", "-b", "impl/one");
    await commit("impl/one", "one.txt");
    git(origin, "checkout", "-q", "-b", "impl/two");
    await commit("impl/two", "two.txt");
    git(origin, "checkout", "-q", "-b", "impl/three");
    await commit("impl/three", "three.txt");
    git(origin, "update-ref", "refs/pull/30/head", tip["impl/three"]!);
    // A rejected proposal's branch, on dev.
    git(origin, "checkout", "-q", "-b", "impl/dropped", tip.dev!);
    await commit("impl/dropped", "dropped.txt");
    git(origin, "checkout", "-q", "dev");
  });
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const impl = (n: number, branch: string, base: string, repo = "acme/site"): GraphProposal => ({
    number: n,
    title: `P${n}`,
    status: "drafting",
    implPr: null,
    implBranch: { label: `origin/${branch}`, repo, branch, base },
  });
  const proposals: GraphProposal[] = [
    impl(1, "impl/one", "dev"),
    impl(2, "impl/two", "impl/one"),
    impl(3, "impl/three", "impl/two"),
    // Its head is on another repository.
    impl(4, "impl/elsewhere", "dev", "me/site"),
    { ...impl(5, "impl/dropped", "dev"), status: "rejected" },
  ];
  const project = { repo: "acme/site", base: "dev", origins: [] };

  /** One refresh through the real mirror: ls-remote, fetch, ancestry. */
  async function read() {
    const forge = new FakeForge([
      cr("acme/site", 30, { head: tip["impl/three"]!, branch: "impl/three", base: "impl/two" }),
    ]);
    const mirror = new LocalGitMirror({ dir: path.join(dir, "mirror.git"), url: origin });
    const store = new SqliteGraphStore(SqliteProposalStore.open(":memory:").db);
    const remote = await mirror.lsRemote();
    const got = await new PrGraphReader({ forge, mirror, store }).collect({
      project,
      proposals,
      refs: remote.refs,
      deploymentCommits: [],
      checkedAt: "2026-10-04T00:00:00.000Z",
      code: "test",
    });
    return { graph: got.layout.graph, key: got.inputs.inputKey, errors: got.errors };
  }

  it("draws stacked branch-only impls as nodes, the one with a PR once with its number, and lists the rest", async () => {
    const { graph: g, errors } = await read();
    expect(errors).toEqual([]);
    expect(
      g.nodes.map((n) => [n.key, n.number, n.parent, n.proposal?.number, n.relation, n.onChain]),
    ).toEqual([
      ["impl/one", null, "", 1, "ahead", true],
      ["impl/two", null, "impl/one", 2, "ahead", true],
      ["impl/three", 30, "impl/two", 3, "ahead", true],
    ]);
    expect(g.nodes.map((n) => n.head)).toEqual([
      tip["impl/one"],
      tip["impl/two"],
      tip["impl/three"],
    ]);
    expect(g.top).toBe("impl/three");
    // Not on the delivery repository: unread. Rejected: neither drawn nor listed.
    expect(g.unplaced.map((u) => [u.number, u.reason])).toEqual([[4, "unread"]]);
  });

  it("changes the input key when a branch tip moves, and draws the new tip", async () => {
    const before = await read();
    git(origin, "checkout", "-q", "impl/two");
    await commit("impl/two", "two-more.txt");
    git(origin, "checkout", "-q", "dev");
    const after = await read();
    expect(after.key).not.toBe(before.key);
    const two = after.graph.nodes.find((n) => n.key === "impl/two")!;
    expect([two.head, two.ahead]).toEqual([tip["impl/two"], 2]);
    // impl/three forked inside impl/two's layer, which moved on: stale, still stacked.
    const three = after.graph.nodes.find((n) => n.key === "impl/three")!;
    expect([three.number, three.stacked, three.stale]).toEqual([30, true, true]);
  });
});

describe("the base branch moves on, read from a repository", () => {
  let dir: string;
  let origin: string;
  const tip: Record<string, string> = {};

  const git = (cwd: string, ...args: string[]): string =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@example.com",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@example.com",
      },
    }).trim();
  const commit = async (branch: string, file: string): Promise<void> => {
    await fs.writeFile(path.join(origin, file), `${file} ${Date.now()} ${Math.random()}\n`);
    git(origin, "add", "-A");
    git(origin, "commit", "-q", "-m", file);
    tip[branch] = git(origin, "rev-parse", "HEAD");
  };

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "graph-base-moves-"));
    origin = path.join(dir, "origin");
    await fs.mkdir(origin);
    git(origin, "init", "-q", "-b", "dev");
    git(origin, "config", "uploadpack.allowFilter", "true");
    await commit("dev", "base.txt");
    // dev ─ impl/one ─ impl/two ─ impl/three, built while dev stood still.
    git(origin, "checkout", "-q", "-b", "impl/one");
    await commit("impl/one", "one.txt");
    git(origin, "checkout", "-q", "-b", "impl/two");
    await commit("impl/two", "two.txt");
    git(origin, "checkout", "-q", "-b", "impl/three");
    await commit("impl/three", "three.txt");
    // A line with no fork point on dev's history, declared on dev, and a layer on it.
    git(origin, "checkout", "-q", "--orphan", "impl/apart");
    git(origin, "rm", "-rq", "--cached", ".");
    await commit("impl/apart", "apart.txt");
    git(origin, "checkout", "-q", "-b", "impl/apart-two");
    await commit("impl/apart-two", "apart-two.txt");
    // Then dev moves on by two commits.
    git(origin, "checkout", "-q", "-f", "dev");
    await commit("dev", "dev-1.txt");
    await commit("dev", "dev-2.txt");
  });
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const impl = (n: number, branch: string, base: string): GraphProposal => ({
    number: n,
    title: `P${n}`,
    status: "drafting",
    implPr: null,
    implBranch: { label: `origin/${branch}`, repo: "acme/site", branch, base },
  });

  it("keeps the stack on the chain with its bottom stale by the commits dev gained, and puts a line off dev's history on an old line", async () => {
    const mirror = new LocalGitMirror({ dir: path.join(dir, "mirror.git"), url: origin });
    const store = new SqliteGraphStore(SqliteProposalStore.open(":memory:").db);
    const remote = await mirror.lsRemote();
    const got = await new PrGraphReader({ forge: new FakeForge([]), mirror, store }).collect({
      project: { repo: "acme/site", base: "dev", origins: [] },
      proposals: [
        impl(1, "impl/one", "dev"),
        impl(2, "impl/two", "impl/one"),
        impl(3, "impl/three", "impl/two"),
        impl(4, "impl/apart", "dev"),
        impl(5, "impl/apart-two", "impl/apart"),
      ],
      refs: remote.refs,
      deploymentCommits: [],
      checkedAt: "2026-10-04T00:00:00.000Z",
      code: "test",
    });
    expect(got.errors).toEqual([]);
    const g = got.layout.graph;
    const at = (key: string) => g.nodes.find((n) => n.key === key)!;
    expect(g.nodes.filter((n) => n.onChain).map((n) => n.key)).toEqual([
      "impl/one",
      "impl/two",
      "impl/three",
    ]);
    expect(g.top).toBe("impl/three");
    const one = at("impl/one");
    expect([one.relation, one.stacked, one.stale, one.ahead, one.behind]).toEqual([
      "diverged",
      true,
      true,
      1,
      2,
    ]);
    expect([at("impl/two").stale, at("impl/three").stale]).toEqual([false, false]);
    expect(at("impl/apart").off).toEqual({ reason: "old-line", at: null });
    expect(at("impl/apart-two").off).toEqual({ reason: "above", at: "impl/apart" });
  });
});
