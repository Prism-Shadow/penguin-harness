/**
 * Parents by ancestry (rule 1b, the design's 「按祖系认父」): a node declared on the base branch
 * hangs on the nearest other node its head contains, and on the base branch only when there is
 * none. The lineage itself over a plain commit listing, then end to end from a temporary
 * repository through the real mirror: three branches stacked while all declared on the base, a
 * branch straight off the base, and an open PR declared on the base but stacked on another PR.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LocalGitMirror,
  PrGraphReader,
  SqliteGraphStore,
  SqliteProposalStore,
} from "../src/index.js";
import { lineageOf, nearestAncestor } from "../src/graph-lineage.js";
import type { GraphProposal } from "../src/pr-chain.js";
import { FakeForge, cr } from "./graph-fakes.js";

const sha = (c: string): string => c.repeat(40);

describe("lineageOf", () => {
  const [A, B, C, M, X] = ["a", "b", "c", "d", "e"].map(sha) as [
    string,
    string,
    string,
    string,
    string,
  ];
  // Beyond the base: A ← B ← C, and M merging B with a commit X of its own.
  const commits = new Map<string, string[]>([
    [A, [sha("0")]],
    [B, [A]],
    [C, [B]],
    [X, [sha("0")]],
    [M, [B, X]],
  ]);

  it("lists every head a head contains with the commits beyond the base between them", () => {
    const l = lineageOf([A, B, C, M, sha("9")], commits);
    expect(Object.fromEntries(l.get(C)!)).toEqual({ [A]: 2, [B]: 1 });
    expect(Object.fromEntries(l.get(M)!)).toEqual({ [A]: 3, [B]: 2 });
    expect(Object.fromEntries(l.get(A)!)).toEqual({});
    // On the base's history: walked, containing no head beyond the base.
    expect(Object.fromEntries(l.get(sha("9"))!)).toEqual({});
  });

  it("takes the nearest, the first drawn on a tie, never a node on the same commit, and says when a head was not walked", () => {
    const l = lineageOf([A, B, C], commits);
    const heads = [
      { key: "a", head: A },
      { key: "b", head: B },
      { key: "b-twin", head: B },
      { key: "c", head: C },
    ];
    expect(nearestAncestor(heads[3]!, heads, l)).toBe("b");
    expect(nearestAncestor(heads[2]!, heads, l)).toBe("a");
    expect(nearestAncestor(heads[0]!, heads, l)).toBeNull();
    expect(nearestAncestor({ key: "x", head: X }, heads, l)).toBeUndefined();
  });
});

describe("parents by ancestry, read from a repository", () => {
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
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "graph-lineage-"));
    origin = path.join(dir, "origin");
    await fs.mkdir(origin);
    git(origin, "init", "-q", "-b", "dev");
    git(origin, "config", "uploadpack.allowFilter", "true");
    await commit("dev", "base.txt");
    // dev ─ impl/one ─ impl/two (two commits) ─ impl/three: all registered against dev.
    git(origin, "checkout", "-q", "-b", "impl/one");
    await commit("impl/one", "one.txt");
    git(origin, "checkout", "-q", "-b", "impl/two");
    await commit("impl/two", "two.txt");
    await commit("impl/two", "two-more.txt");
    git(origin, "checkout", "-q", "-b", "impl/three");
    await commit("impl/three", "three.txt");
    // A branch straight off dev, registered against dev.
    git(origin, "checkout", "-q", "-b", "impl/side", tip.dev!);
    await commit("impl/side", "side.txt");
    // Two open PRs, both declared on dev, the upper one stacked on the lower.
    git(origin, "checkout", "-q", "-b", "pr/lower", tip.dev!);
    await commit("pr/lower", "lower.txt");
    git(origin, "checkout", "-q", "-b", "pr/upper");
    await commit("pr/upper", "upper.txt");
    git(origin, "update-ref", "refs/pull/40/head", tip["pr/lower"]!);
    git(origin, "update-ref", "refs/pull/41/head", tip["pr/upper"]!);
    git(origin, "checkout", "-q", "dev");
  });
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const impl = (n: number, branch: string): GraphProposal => ({
    number: n,
    title: `P${n}`,
    status: "drafting",
    implPr: null,
    implBranch: { label: `origin/${branch}`, repo: "acme/site", branch, base: "dev" },
  });

  it("hangs each node declared on the base on its nearest ancestor node, else on the base", async () => {
    const mirror = new LocalGitMirror({ dir: path.join(dir, "mirror.git"), url: origin });
    const store = new SqliteGraphStore(SqliteProposalStore.open(":memory:").db);
    const remote = await mirror.lsRemote();
    const got = await new PrGraphReader({
      forge: new FakeForge([
        cr("acme/site", 40, { head: tip["pr/lower"]!, branch: "pr/lower", base: "dev" }),
        cr("acme/site", 41, { head: tip["pr/upper"]!, branch: "pr/upper", base: "dev" }),
      ]),
      mirror,
      store,
    }).collect({
      project: { repo: "acme/site", base: "dev", origins: [] },
      proposals: [
        impl(1, "impl/one"),
        impl(2, "impl/two"),
        impl(3, "impl/three"),
        impl(4, "impl/side"),
      ],
      refs: remote.refs,
      deploymentCommits: [],
      checkedAt: "2026-10-04T00:00:00.000Z",
      code: "test",
    });
    expect(got.errors).toEqual([]);
    const g = got.layout.graph;
    const at = (key: string) => g.nodes.find((n) => n.key === key)!;
    expect(
      Object.fromEntries(g.nodes.map((n) => [n.key, [n.parent, n.relation, n.ahead, n.stacked]])),
    ).toEqual({
      "pr/lower": ["", "ahead", 1, true],
      "pr/upper": ["pr/lower", "ahead", 1, true],
      "impl/one": ["", "ahead", 1, true],
      "impl/two": ["impl/one", "ahead", 2, true],
      "impl/three": ["impl/two", "ahead", 1, true],
      "impl/side": ["", "ahead", 1, true],
    });
    // Every line on dev is a stack of its own: the lone branch off dev too (rule 3a).
    expect([...g.tops].sort()).toEqual(["impl/side", "impl/three", "pr/upper"]);
    expect(at("impl/side").off).toBeNull();
    // The ancestry the walk read is what the refresh stores; the distances are in commits.
    expect(Object.fromEntries(got.lineage.get(tip["impl/three"]!)!)).toEqual({
      [tip["impl/one"]!]: 3,
      [tip["impl/two"]!]: 1,
    });
  });
});
