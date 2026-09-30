/**
 * The PR graph over a fake `gh`: the delivery repository's open PRs laid out by their
 * declared bases and checked against ancestry, the chain walked from the base branch, forks
 * and the top marked, off-chain PRs listed apart, each node annotated with its proposal and
 * with the other origins' PRs on the same branch — and GitHub asked once per comparison.
 * pr-chain.test.ts covers the handbook's chain rules and the reasons in the pure layout.
 */
import { describe, expect, it } from "vitest";
import { PrGraphReader, buildGraph, pullKey, type GraphProposal } from "../src/index.js";
import { remotesOf } from "../src/config.js";
import type { Comparison } from "../src/pr-chain.js";
import type { ProposalGraphNode } from "@prismshadow/penguin-server/api";
import type { RunGh } from "../src/pr-status.js";

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
/** Commits servers run: X is on GitHub (past #12), L only on some machine's local line. */
const X = sha("7");
const L = sha("6");

const pull = (number: number, branch: string, head: string, base: string, repo = "acme/site") => ({
  number,
  title: `PR ${number}`,
  draft: number === 13 ? true : null,
  url: `https://github.com/${repo}/pull/${number}`,
  branch,
  head,
  base,
});

/** GitHub as the graph asks it; every call recorded, a compare listed in `fail` refused. */
function fakeGitHub(fail: string[] = []): { gh: RunGh; calls: string[] } {
  const calls: string[] = [];
  const compares: Record<string, { status: string; ahead_by: number; behind_by: number }> = {
    [`${D0}...${A1}`]: { status: "ahead", ahead_by: 2, behind_by: 0 },
    [`${A1}...${B1}`]: { status: "ahead", ahead_by: 1, behind_by: 0 },
    [`${A1}...${C1}`]: { status: "ahead", ahead_by: 3, behind_by: 0 },
    [`${B1}...${E1}`]: { status: "diverged", ahead_by: 2, behind_by: 5 },
    [`${A1}...${A0}`]: { status: "behind", ahead_by: 0, behind_by: 4 },
    // #16 stacks on feat/a through the closed #21: its layer carries #21's commits.
    [`${A1}...${G1}`]: { status: "ahead", ahead_by: 3, behind_by: 0 },
    // A server's commit X, three past #12's head and further past the layers below it.
    [`${D0}...${X}`]: { status: "ahead", ahead_by: 9, behind_by: 0 },
    [`${A1}...${X}`]: { status: "ahead", ahead_by: 4, behind_by: 0 },
    [`${B1}...${X}`]: { status: "ahead", ahead_by: 3, behind_by: 0 },
    [`${C1}...${X}`]: { status: "diverged", ahead_by: 4, behind_by: 3 },
  };
  const gh: RunGh = async (args) => {
    const path = args[1]!;
    calls.push(path);
    if (path.startsWith("repos/acme/site/pulls?state=closed")) {
      // feat/gone had no PR; feat/old was #21, closed without merging, on top of feat/a.
      return JSON.stringify(
        path.endsWith(encodeURIComponent("acme:feat/old"))
          ? [{ number: 21, merged: false, at: "2026-09-30T00:00:00Z", base: "feat/a" }]
          : [],
      );
    }
    if (path === "repos/acme/site/pulls/99") {
      return JSON.stringify({
        merged: true,
        state: "closed",
        branch: "feat/z",
        head: sha("7"),
        base: "dev",
      });
    }
    if (path.startsWith("repos/acme/site/pulls?")) {
      return JSON.stringify(
        path.endsWith("page=1")
          ? [
              pull(11, "feat/a", A1, "dev"),
              pull(12, "feat/b", B1, "feat/a"),
              pull(13, "feat/c", C1, "feat/a"),
              pull(14, "feat/d", E1, "feat/b"),
              pull(15, "feat/e", F1, "feat/gone"),
              pull(16, "feat/g", G1, "feat/old"),
            ]
          : [],
      );
    }
    if (path.startsWith("repos/up/site/pulls?")) {
      return JSON.stringify([
        pull(801, "feat/a", A0, "main", "up/site"),
        pull(802, "feat/b", B1, "main", "up/site"),
      ]);
    }
    if (path === "repos/acme/site/branches/dev") return JSON.stringify(D0);
    const m = /^repos\/acme\/site\/compare\/(.+)$/.exec(path);
    if (m !== null) {
      if (fail.includes(m[1]!)) throw new Error("HTTP 404");
      const body = compares[m[1]!];
      if (body === undefined) throw new Error(`no fake compare for ${m[1]}`);
      return JSON.stringify(body);
    }
    throw new Error(`no fake route for ${path}`);
  };
  return { gh, calls };
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

const config = {
  repo: "acme/site",
  base: "dev",
  origins: [
    { name: "fork", repo: "acme/site" },
    { name: "origin", repo: "up/site" },
  ],
  proposals,
};

describe("pullKey", () => {
  it("names one PR the same way whatever the case of its owner and repository", () => {
    expect(pullKey("https://github.com/ACME/Site/pull/11")).toBe("acme/site#11");
    expect(pullKey("https://example.com/x")).toBeNull();
  });
});

describe("PrGraphReader", () => {
  it("lays out the chain from the base branch, marks the fork and leaves the top open, and lists the off-chain PRs apart", async () => {
    const { gh } = fakeGitHub();
    const g = await new PrGraphReader({ gh, now: () => 0 }).read(config);
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
      [11, 0, "ahead", 2, true, true],
      [12, 11, "ahead", 1, true, false],
      [13, 11, "ahead", 3, true, false],
      [16, 11, "ahead", 3, true, false],
      [14, 12, "diverged", 2, false, false],
      [15, null, "unknown", null, false, false],
    ]);
    // Three leaves above #11 and none keeps going: the graph marks the fork and names no top.
    expect(g.top).toBeNull();
    const byNumber = new Map(g.nodes.map((n) => [n.number, n]));
    expect(byNumber.get(16)!.via).toEqual([{ number: 21, state: "closed" }]);
    expect(byNumber.get(14)!.off).toEqual({ reason: "old-line", at: null });
    expect(byNumber.get(15)!.off).toEqual({ reason: "no-base", at: null });
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
      pulls: [pull(11, "feat/a", A1, "dev"), pull(12, "feat/b", B1, "feat/a")].map((p) => ({
        ...p,
        draft: false,
      })),
      origins: [],
      compare: (from, to) => layers[`${from}...${to}`],
      proposals: [],
      servers: [],
      errors: [],
      checkedAt: "2026-09-30T00:00:00.000Z",
    });
    expect(g.top).toBe(12);
    expect(g.nodes.map((n) => n.fork)).toEqual([false, false]);
  });

  it("annotates each node with its proposal and with the other origins' PR on the same branch", async () => {
    const { gh } = fakeGitHub();
    const g = await new PrGraphReader({ gh }).read(config);
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
    expect(g.origins).toEqual(config.origins);
    expect(g.unplaced).toEqual([
      {
        number: 2,
        title: "Gone",
        status: "approved",
        implPr: "https://github.com/acme/site/pull/99",
        reason: "merged",
        at: null,
        into: "dev",
      },
    ]);
  });

  it("compares two commits once, reads the lists again after a minute, and leaves a failed comparison unknown", async () => {
    const { gh, calls } = fakeGitHub([`${A1}...${C1}`]);
    let now = 0;
    const reader = new PrGraphReader({ gh, now: () => now });
    const first = await reader.read(config);
    expect(first.nodes.find((n) => n.number === 13)?.relation).toBe("unknown");
    expect(first.errors).toEqual([
      `acme/site: ${A1.slice(0, 9)}...${C1.slice(0, 9)} not compared: HTTP 404`,
    ]);
    const compares = calls.filter((c) => c.includes("/compare/")).length;
    expect(compares).toBe(6);
    calls.length = 0;
    await reader.read(config);
    // Within the minute: nothing but the failed comparison is asked again.
    expect(calls).toEqual([`repos/acme/site/compare/${A1}...${C1}`]);
    calls.length = 0;
    now = 61_000;
    await reader.read(config);
    expect(calls.filter((c) => c.includes("/pulls?state=open")).length).toBe(2);
    expect(calls.filter((c) => c.includes("/pulls?state=closed")).length).toBe(2);
    expect(calls.filter((c) => c.endsWith("/pulls/99")).length).toBe(1);
    expect(calls.filter((c) => c.includes("/compare/")).length).toBe(1);
  });

  it("places each server at the layer its commit is or contains, and lists the rest apart with one reason each", async () => {
    const { gh, calls } = fakeGitHub();
    const reading = (name: string, commit: string | null, error: string | null = null) => ({
      name,
      url: name === "this" ? null : `http://${name}`,
      self: name === "this",
      commit,
      describe: commit === null ? null : `v1-1-g${commit.slice(0, 7)}`,
      error,
    });
    const g = await new PrGraphReader({ gh, now: () => 0 }).read({
      ...config,
      servers: [
        reading("this", A1.slice(0, 9)),
        reading("late", X),
        reading("local", L),
        reading("dark", null, "/api/install answered 401"),
      ],
    });
    expect(g.servers.map((s) => [s.name, s.at, s.relation, s.ahead, s.error])).toEqual([
      ["this", 11, "same", 0, null],
      ["late", 12, "ahead", 3, null],
      ["local", null, null, null, null],
      ["dark", null, null, null, "/api/install answered 401"],
    ]);
    // A commit that is a layer's head is not compared at all.
    expect(calls.some((c) => c.includes(`...${A1.slice(0, 9)}`))).toBe(false);
    // The commit GitHub does not have: one line, not one per layer.
    const lines = g.errors.filter((e) => e.startsWith("server "));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      new RegExp(
        `^server local: commit ${L} not compared with any layer: no fake compare for [0-9a-f]{40}\\.\\.\\.${L}$`,
      ),
    );
  });

  it("does not ask gh about a repository name GitHub would not accept", async () => {
    const { gh, calls } = fakeGitHub();
    const g = await new PrGraphReader({ gh }).read({
      ...config,
      repo: "acme/site; rm",
      origins: [],
    });
    expect(calls).toEqual([]);
    expect(g.nodes).toEqual([]);
    expect(g.errors[0]).toContain("not a GitHub repository name");
  });

  it("draws the base branch alone, unread, when there is no repository, and says why", async () => {
    const { gh, calls } = fakeGitHub();
    const g = await new PrGraphReader({ gh }).read({
      ...config,
      repo: "",
      errors: ["no delivery repository"],
    });
    expect(calls).toEqual([]);
    expect(g.base).toMatchObject({ branch: "dev", head: null });
    expect(g.nodes).toEqual([]);
    expect(g.errors).toEqual(["no delivery repository"]);
  });

  it("reads a repository's default branch once a minute and reports a failed read", async () => {
    let now = 0;
    const calls: string[] = [];
    const gh: RunGh = async (args) => {
      calls.push(args[1]!);
      if (args[1] === "repos/acme/site") return JSON.stringify("main");
      throw new Error("HTTP 404");
    };
    const reader = new PrGraphReader({ gh, now: () => now });
    const errors: string[] = [];
    expect(await reader.defaultBranch("acme/site", errors)).toBe("main");
    expect(await reader.defaultBranch("acme/site", errors)).toBe("main");
    expect(calls).toEqual(["repos/acme/site"]);
    now = 61_000;
    await reader.defaultBranch("acme/site", errors);
    expect(calls.length).toBe(2);
    expect(await reader.defaultBranch("acme/gone", errors)).toBeNull();
    expect(errors).toEqual(["acme/gone: default branch not read: HTTP 404"]);
    expect(await reader.defaultBranch("acme/site; rm", errors)).toBeNull();
    expect(calls.length).toBe(3);
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
