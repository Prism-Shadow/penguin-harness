/**
 * The PR graph's refresh reads over fake ports: change request metadata from a Forge, refs and
 * comparisons from a GitMirror — the delivery repository's open PRs laid out by their declared
 * bases and checked against ancestry, the chain walked from the base branch, forks and the top
 * marked, off-chain PRs listed apart, each node annotated with its proposal and with the other
 * origins' PRs on the same branch, each comparison computed once and stored, a failure left
 * `unread` and listed in `errors`. pr-chain.test.ts covers the chain rules in the pure layout.
 */
import { describe, expect, it } from "vitest";
import {
  PrGraphReader,
  SqliteGraphStore,
  SqliteProposalStore,
  buildGraph,
  pullKey,
  type GraphProposal,
} from "../src/index.js";
import { remotesOf } from "../src/config.js";
import { placeDeployment, type DeploymentReading } from "../src/deployments.js";
import type { Comparison } from "../src/pr-chain.js";
import type { ProposalGraphNode, ProposalGraphResponse } from "@prismshadow/penguin-server/api";
import { FakeForge, FakeMirror, cr, rel } from "./graph-fakes.js";

const sha = (c: string): string => c.repeat(40);
const D0 = sha("0");
/** The official twin of feat/a, a commit behind the fork's. */
const A0 = sha("9");
const A1 = sha("a");
const B1 = sha("b");
const C1 = sha("c");
const E1 = sha("e");
const F1 = sha("f");
const G1 = sha("d");
/** Commits deployments run: X is in the repository (past #12), L only on some machine's local line. */
const X = sha("7");
const L = sha("6");

const pull = (number: number, branch: string, head: string, base: string, repo = "acme/site") => ({
  number,
  title: `PR ${number}`,
  draft: number === 13,
  url: `https://github.com/${repo}/pull/${number}`,
  branch,
  head,
  base,
});

/** The repository as the forge and the mirror know it; `fail` names comparisons the mirror cannot make. */
function fakeRepo(fail: string[] = []) {
  const forge = new FakeForge([
    cr("acme/site", 11, { head: A1, branch: "feat/a", base: "dev" }),
    cr("acme/site", 12, { head: B1, branch: "feat/b", base: "feat/a" }),
    cr("acme/site", 13, { head: C1, branch: "feat/c", base: "feat/a", draft: true }),
    cr("acme/site", 14, { head: E1, branch: "feat/d", base: "feat/b" }),
    cr("acme/site", 15, { head: F1, branch: "feat/e", base: "feat/gone" }),
    cr("acme/site", 16, { head: G1, branch: "feat/g", base: "feat/old" }),
    // feat/gone had no PR; feat/old was #21, closed without merging, on top of feat/a.
    cr("acme/site", 21, {
      head: sha("2"),
      branch: "feat/old",
      base: "feat/a",
      state: "closed",
      closedAt: "2026-09-30T00:00:00Z",
    }),
    cr("acme/site", 99, { head: sha("8"), branch: "feat/z", base: "dev", state: "merged" }),
    cr("up/site", 801, { head: A0, branch: "feat/a", base: "main" }),
    cr("up/site", 802, { head: B1, branch: "feat/b", base: "main" }),
  ]);
  const comparisons = new Map<string, Comparison>([
    [`${D0}...${A1}`, rel("ahead", 2, 0, D0)],
    [`${A1}...${B1}`, rel("ahead", 1, 0, A1)],
    [`${A1}...${C1}`, rel("ahead", 3, 0, A1)],
    // No merge base: the grandparent is not asked (rule 2a).
    [`${B1}...${E1}`, rel("diverged", 2, 5, null)],
    [`${A1}...${A0}`, rel("behind", 0, 4, A0)],
    [`${A1}...${G1}`, rel("ahead", 3, 0, A1)],
    [`${D0}...${X}`, rel("ahead", 9, 0, D0)],
    [`${A1}...${X}`, rel("ahead", 4, 0, A1)],
    [`${B1}...${X}`, rel("ahead", 3, 0, B1)],
    [`${C1}...${X}`, rel("diverged", 4, 3, A1)],
  ]);
  for (const f of fail) comparisons.delete(f);
  const refs = new Map<string, string>([
    ["refs/heads/dev", D0],
    ["refs/pull/11/head", A1],
    ["refs/pull/12/head", B1],
    ["refs/pull/13/head", C1],
    ["refs/pull/14/head", E1],
    ["refs/pull/15/head", F1],
    ["refs/pull/16/head", G1],
    ["refs/pull/21/head", sha("2")],
    ["refs/pull/99/head", sha("8")],
  ]);
  const mirror = new FakeMirror(refs, "main", comparisons);
  // The origin's head and the deployment's commit X arrive with the fetches that bring them.
  mirror.objects.add(A0);
  mirror.objects.add(X);
  const store = new SqliteGraphStore(SqliteProposalStore.open(":memory:").db);
  const reader = new PrGraphReader({ forge, mirror, store });
  return { forge, mirror, store, reader };
}

const proposals: GraphProposal[] = [
  { number: 1, title: "A", status: "ready", implPr: "https://github.com/ACME/site/pull/11" },
  { number: 2, title: "Gone", status: "approved", implPr: "https://github.com/acme/site/pull/99" },
  {
    number: 3,
    title: "Dropped",
    status: "rejected",
    implPr: "https://github.com/acme/site/pull/12",
  },
  { number: 4, title: "Unbuilt", status: "drafting", implPr: null },
];

const project = {
  repo: "acme/site",
  base: "dev",
  origins: [
    { name: "fork", repo: "acme/site" },
    { name: "origin", repo: "up/site" },
  ],
};

/** One refresh's read, written to the store as the refresher writes it; the graph it lays out. */
async function refresh(
  repo: ReturnType<typeof fakeRepo>,
  deployments: DeploymentReading[] = [],
): Promise<ProposalGraphResponse> {
  const got = await repo.reader.collect({
    project,
    proposals,
    refs: repo.mirror.refs,
    deploymentCommits: deployments.flatMap((d) => (d.commit === null ? [] : [d.commit])),
    checkedAt: "1970-01-01T00:00:00.000Z",
    code: "test",
  });
  repo.store.write({
    repo: "acme/site",
    refs: repo.mirror.refs,
    defaultBranch: "main",
    pulls: got.pulls,
    openOf: got.openOf,
    comparisons: got.comparisons,
    used: got.layout.used,
    lineage: got.lineage,
    snapshot: null,
    nextProbeAt: "1970-01-01T00:05:00.000Z",
    unchanged: 0,
  });
  const graph = got.layout.graph;
  const known = new Map(got.comparisons.map((c) => [`${c.from}...${c.to}`, c.cmp]));
  const layers = [
    { key: "", head: graph.base.head },
    ...graph.nodes.map((n) => ({ key: n.key, head: n.head })),
  ];
  return {
    ...graph,
    errors: got.errors,
    deployments: deployments.map((d) =>
      placeDeployment(d, layers, (from, to) => known.get(`${from}...${to}`)),
    ),
  };
}

describe("pullKey", () => {
  it("names one PR the same way whatever the case of its owner and repository", () => {
    expect(pullKey("https://github.com/ACME/Site/pull/11")).toBe("acme/site#11");
    expect(pullKey("https://example.com/x")).toBeNull();
  });
});

describe("PrGraphReader", () => {
  it("lays out the chain from the base branch, marks the fork and leaves the top open, and lists the off-chain PRs apart", async () => {
    const g = await refresh(fakeRepo());
    expect(g.base).toEqual({ branch: "dev", head: D0, fork: false });
    const row = (n: ProposalGraphNode) => [
      n.number,
      n.parent,
      n.relation,
      n.ahead,
      n.onChain,
      n.fork,
    ];
    expect(g.nodes.map(row)).toEqual([
      [11, "", "ahead", 2, true, true],
      [12, "feat/a", "ahead", 1, true, false],
      [13, "feat/a", "ahead", 3, true, false],
      [16, "feat/a", "ahead", 3, true, false],
      [14, "feat/b", "diverged", 2, false, false],
      [15, null, "unknown", null, false, false],
    ]);
    // Three leaves above #11 and none keeps going: the graph marks the fork and names no top.
    expect(g.top).toBeNull();
    const byNumber = new Map(g.nodes.map((n) => [n.number, n]));
    expect(byNumber.get(16)!.via).toEqual([{ number: 21, state: "closed" }]);
    expect(byNumber.get(14)!.off).toEqual({ reason: "old-line", at: null });
    expect(byNumber.get(15)!.off).toEqual({ reason: "no-base", at: null, missing: "feat/gone" });
    expect(g.nodes.find((n) => n.number === 13)?.draft).toBe(true);
    expect(g.errors).toEqual([]);
    expect(g.checkedAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it("names the top when the chain has a single leaf", () => {
    const layers: Record<string, Comparison> = {
      [`${D0}...${A1}`]: { relation: "ahead", ahead: 2, behind: 0, mergeBase: D0, empty: true },
      [`${A1}...${B1}`]: { relation: "ahead", ahead: 1, behind: 0, mergeBase: A1, empty: true },
    };
    const g = buildGraph({
      repo: "acme/site",
      base: { branch: "dev", head: D0 },
      pulls: [pull(11, "feat/a", A1, "dev"), pull(12, "feat/b", B1, "feat/a")],
      origins: [],
      compare: (from, to) => layers[`${from}...${to}`],
      proposals: [],
      deployments: [],
      errors: [],
      checkedAt: "2026-09-30T00:00:00.000Z",
    });
    expect(g.top).toBe("feat/b");
    expect(g.nodes.map((n) => n.fork)).toEqual([false, false]);
  });

  it("annotates each node with its proposal and with the other origins' PR on the same branch", async () => {
    const g = await refresh(fakeRepo());
    const n11 = g.nodes.find((n) => n.number === 11)!;
    const n12 = g.nodes.find((n) => n.number === 12)!;
    expect(n11.proposal).toEqual({ number: 1, title: "A", status: "ready" });
    // A rejected proposal does not claim its PR.
    expect(n12.proposal).toBeNull();
    expect(n11.origins).toEqual([
      {
        origin: "origin",
        number: 801,
        url: "https://github.com/up/site/pull/801",
        draft: false,
        head: A0,
        relation: "behind",
      },
    ]);
    expect(n12.origins.map((o) => [o.number, o.relation])).toEqual([[802, "same"]]);
    expect(g.origins).toEqual(project.origins);
    expect(g.unplaced).toEqual([
      {
        number: 2,
        title: "Gone",
        status: "approved",
        implPr: "https://github.com/acme/site/pull/99",
        branch: null,
        reason: "merged",
        at: null,
        into: "dev",
      },
    ]);
  });

  it("reads the forge in batches and fetches only what the mirror lacks", async () => {
    const repo = fakeRepo();
    await refresh(repo);
    // One open list per repository, one walk round for the bases no open PR has, one batch of impl PRs.
    expect(repo.forge.queries).toEqual([
      { repo: "acme/site", open: true },
      { repo: "acme/site", shutOn: ["feat/gone", "feat/old"] },
      { repo: "acme/site", numbers: [99] },
      { repo: "up/site", open: true },
    ]);
    expect(repo.mirror.fetched).toEqual([
      [
        "refs/heads/dev",
        "refs/pull/11/head",
        "refs/pull/12/head",
        "refs/pull/13/head",
        "refs/pull/14/head",
        "refs/pull/15/head",
        "refs/pull/16/head",
        "refs/pull/99/head",
      ],
    ]);
    // A second refresh has every commit: nothing is fetched, nothing compared again.
    repo.mirror.fetched.length = 0;
    const compared = repo.mirror.compared.length;
    await refresh(repo);
    expect(repo.mirror.fetched).toEqual([]);
    expect(repo.mirror.compared.length).toBe(compared);
  });

  it("computes each comparison once, and leaves a failed one unread in errors, asked again next time", async () => {
    const repo = fakeRepo([`${A1}...${C1}`]);
    const first = await refresh(repo);
    const n13 = first.nodes.find((n) => n.number === 13)!;
    expect(n13.relation).toBe("unknown");
    expect(n13.off).toMatchObject({ reason: "unread" });
    expect(first.errors).toEqual([
      `acme/site: ${A1.slice(0, 9)}...${C1.slice(0, 9)} not compared: no comparison ${A1}...${C1}`,
    ]);
    expect(repo.mirror.compared).toHaveLength(6);
    repo.mirror.compared.length = 0;
    await refresh(repo);
    expect(repo.mirror.compared).toEqual([[A1, C1]]);
  });

  it("places each deployment at the layer its commit is or contains, and lists the rest apart with one reason each", async () => {
    const repo = fakeRepo();
    const reading = (id: string, commit: string | null, error: string | null = null) => ({
      id,
      url: `http://${id}`,
      commit,
      describe: commit === null ? null : `v1-1-g${commit.slice(0, 7)}`,
      error,
    });
    const g = await refresh(repo, [
      reading("here", A1.slice(0, 9)),
      reading("late", X),
      reading("local", L),
      reading("dark", null, "/api/install answered 401"),
    ]);
    expect(g.deployments.map((d) => [d.id, d.at, d.relation, d.ahead, d.error])).toEqual([
      ["here", "feat/a", "same", 0, null],
      ["late", "feat/b", "ahead", 3, null],
      ["local", null, null, null, null],
      ["dark", null, null, null, "/api/install answered 401"],
    ]);
    // A commit that is a layer's head is not compared at all.
    expect(repo.mirror.compared.some(([, to]) => to.startsWith(A1.slice(0, 9)) && to !== A1)).toBe(
      false,
    );
    // The commit the mirror cannot have: one line, not one per layer.
    const lines = g.errors.filter((e) => e.startsWith("deployment "));
    expect(lines).toEqual([
      `deployment commit ${L} not compared with any layer: ${L.slice(0, 9)} not in the mirror`,
    ]);
  });
});

describe("remotesOf", () => {
  it("keeps each GitHub fetch remote once, by name, in git's order", () => {
    const out = [
      "fork\thttps://github.com/Me/site.git (fetch)",
      "fork\thttps://github.com/Me/site.git (push)",
      "origin\thttps://github.com/Acme/site/ (fetch)",
      "ssh\tgit@github.com:acme/tools.git (fetch)",
      "url\tssh://git@github.com/acme/other (fetch)",
      "tok\thttps://x-access-token@github.com/acme/tok.git (fetch)",
      "lab\thttps://gitlab.com/acme/site.git (fetch)",
      "Bad.Name\thttps://github.com/acme/site.git (fetch)",
      "",
    ].join("\n");
    expect(remotesOf(out)).toEqual([
      { name: "fork", repo: "Me/site" },
      { name: "origin", repo: "Acme/site" },
      { name: "ssh", repo: "acme/tools" },
      { name: "url", repo: "acme/other" },
      { name: "tok", repo: "acme/tok" },
    ]);
  });
});
