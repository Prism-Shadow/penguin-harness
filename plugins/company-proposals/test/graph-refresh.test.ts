/**
 * The graph's refresh policy over fake ports that count their calls: a probe that finds nothing
 * moved only moves the schedule (no fetch, no forge, no snapshot); a probe that finds a ref
 * moved fetches only that and compares only the missing pairs; an unchanged input key adds no
 * snapshot; quiet probes double the interval up to 30 minutes and a change resets it; an impl
 * registered, the refresh button and a finished deploy each refresh at once; nobody reading
 * means no remote call at all; the lease keeps a second refresher out until it expires; a
 * failure waits a minute; a read during a refresh answers the stored graph at once.
 */
import { describe, expect, it } from "vitest";
import {
  GraphRefresher,
  SqliteGraphStore,
  SqliteProposalStore,
  intervalAfter,
  type Project,
} from "../src/index.js";
import type { GraphContext } from "../src/graph-refresh.js";
import type { GraphProposal } from "../src/pr-chain.js";
import type { RegisteredDeployment } from "../src/domain.js";
import { FakeForge, FakeMirror, cr, rel } from "./graph-fakes.js";

const sha = (c: string): string => c.repeat(40);
const D0 = sha("0");
const A1 = sha("a");
const B1 = sha("b");
const B2 = sha("c");
const X = sha("7");
const MIN = 60_000;

function world() {
  let now = Date.parse("2026-10-03T00:00:00Z");
  const forge = new FakeForge([
    cr("acme/site", 11, { head: A1, branch: "feat/a", base: "dev" }),
    cr("acme/site", 12, { head: B1, branch: "feat/b", base: "feat/a" }),
  ]);
  const mirror = new FakeMirror(
    new Map([
      ["refs/heads/dev", D0],
      ["refs/pull/11/head", A1],
      ["refs/pull/12/head", B1],
    ]),
    "dev",
    new Map([
      [`${D0}...${A1}`, rel("ahead", 2, 0, D0)],
      [`${A1}...${B1}`, rel("ahead", 1, 0, A1)],
      [`${A1}...${B2}`, rel("ahead", 2, 0, A1)],
      [`${D0}...${X}`, rel("ahead", 4, 0, D0)],
      [`${A1}...${X}`, rel("ahead", 2, 0, A1)],
      [`${B1}...${X}`, rel("ahead", 1, 0, B1)],
    ]),
  );
  const db = SqliteProposalStore.open(":memory:").db;
  const store = new SqliteGraphStore(db, () => now);
  const project: Project = {
    repo: "acme/site",
    base: "dev",
    baseDeclared: true,
    origins: [],
    forge: "github",
  };
  const proposals: GraphProposal[] = [
    { number: 1, title: "A", status: "ready", implPr: "https://github.com/acme/site/pull/11" },
  ];
  const deployments: RegisteredDeployment[] = [];
  let probed = 0;
  let commit: string | null = null;
  const refresher = new GraphRefresher({
    log: () => undefined,
    now: () => now,
    mirrorFor: () => mirror,
    forgeFor: () => forge,
    probe: async () => {
      probed++;
      return { installId: "i", commit, describe: null };
    },
  });
  const ctx: GraphContext = {
    key: "proj/acme",
    orgDir: "/nowhere",
    store,
    deployments: { list: async () => deployments },
    inputs: async () => ({ project, proposals, errors: [] }),
  };
  const settle = async () => {
    while (refresher.refreshing(ctx.key)) await new Promise((r) => setTimeout(r, 1));
  };
  const snapshots = () =>
    Number((db.prepare(`SELECT count(*) AS n FROM graph_snapshots`).get() as { n: number }).n);
  return {
    forge,
    mirror,
    store,
    db,
    refresher,
    ctx,
    settle,
    snapshots,
    proposals,
    deployments,
    advance: (ms: number) => {
      now += ms;
    },
    now: () => now,
    setCommit: (c: string | null) => {
      commit = c;
    },
    probed: () => probed,
  };
}

describe("GraphRefresher", () => {
  it("draws the stored graph at once on a cold read, and the refreshed one after", async () => {
    const w = world();
    const cold = await w.refresher.read(w.ctx);
    expect(cold.nodes).toEqual([]);
    expect(cold.refreshing).toBe(true);
    await w.settle();
    const warm = await w.refresher.read(w.ctx);
    expect(warm.nodes.map((n) => [n.number, n.parent, n.onChain])).toEqual([
      [11, 0, true],
      [12, 11, true],
    ]);
    expect(warm.top).toBe(12);
    expect(warm.refreshing).toBe(false);
  });

  it("only moves the schedule when the probe finds nothing moved: no fetch, no forge, no snapshot", async () => {
    const w = world();
    await w.refresher.read(w.ctx, { refresh: true });
    const before = {
      queries: w.forge.queries.length,
      fetched: w.mirror.fetched.length,
      snaps: w.snapshots(),
    };
    const checked = (await w.refresher.read(w.ctx)).checkedAt;
    w.advance(5 * MIN);
    await w.refresher.read(w.ctx);
    await w.settle();
    expect(w.mirror.lsRemoteCalls).toBe(2);
    expect(w.forge.queries.length).toBe(before.queries);
    expect(w.mirror.fetched.length).toBe(before.fetched);
    expect(w.snapshots()).toBe(before.snaps);
    const after = await w.refresher.read(w.ctx);
    expect(Date.parse(after.checkedAt)).toBeGreaterThan(Date.parse(checked));
    expect(w.store.refreshState("acme/site")).toMatchObject({ unchanged: 1 });
  });

  it("fetches only the ref that moved and compares only the missing pair", async () => {
    const w = world();
    await w.refresher.read(w.ctx, { refresh: true });
    w.mirror.refs.set("refs/pull/12/head", B2);
    w.forge.pulls[1] = cr("acme/site", 12, { head: B2, branch: "feat/b", base: "feat/a" });
    w.mirror.fetched.length = 0;
    w.mirror.compared.length = 0;
    w.advance(5 * MIN);
    await w.refresher.read(w.ctx);
    await w.settle();
    expect(w.mirror.fetched).toEqual([["refs/pull/12/head"]]);
    expect(w.mirror.compared).toEqual([[A1, B2]]);
    expect(w.store.refreshState("acme/site")).toMatchObject({ unchanged: 0 });
    const g = await w.refresher.read(w.ctx);
    expect(g.nodes.find((n) => n.number === 12)).toMatchObject({ head: B2, ahead: 2 });
  });

  it("adds no snapshot when a refresh finds the same input", async () => {
    const w = world();
    await w.refresher.read(w.ctx, { refresh: true });
    const snaps = w.snapshots();
    await w.refresher.read(w.ctx, { refresh: true });
    await w.refresher.read(w.ctx, { refresh: true });
    expect(w.snapshots()).toBe(snaps);
    // The proposals changing changes the input: one more, laid out from the stored facts.
    w.proposals[0] = { ...w.proposals[0]!, status: "approved" };
    const queries = w.forge.queries.length;
    const g = await w.refresher.read(w.ctx);
    expect(g.nodes[0]!.proposal).toMatchObject({ status: "approved" });
    expect(w.snapshots()).toBe(snaps + 1);
    expect(w.forge.queries.length).toBe(queries);
  });

  it("doubles the interval with each quiet probe up to 30 minutes, and resets it on a change", async () => {
    expect([0, 1, 2, 3, 4].map((u) => intervalAfter(5 * MIN, u) / MIN)).toEqual([
      5, 10, 20, 30, 30,
    ]);
    const w = world();
    await w.refresher.read(w.ctx, { refresh: true });
    const next = () => (Date.parse(w.store.refreshState("acme/site").nextProbeAt!) - w.now()) / MIN;
    expect(next()).toBe(5);
    for (const expected of [10, 20, 30, 30]) {
      w.advance(30 * MIN);
      await w.refresher.read(w.ctx);
      await w.settle();
      expect(next()).toBe(expected);
    }
    w.mirror.refs.set("refs/heads/dev", sha("1"));
    w.advance(30 * MIN);
    await w.refresher.read(w.ctx);
    await w.settle();
    expect(next()).toBe(5);
  });

  it("does not probe before the window, and makes no remote call while nobody reads", async () => {
    const w = world();
    await w.refresher.read(w.ctx, { refresh: true });
    const calls = w.mirror.lsRemoteCalls;
    w.advance(4 * MIN);
    await w.refresher.read(w.ctx);
    await w.settle();
    expect(w.mirror.lsRemoteCalls).toBe(calls);
    // A day passes with nobody reading: there is no timer.
    w.advance(24 * 60 * MIN);
    await new Promise((r) => setTimeout(r, 20));
    expect(w.mirror.lsRemoteCalls).toBe(calls);
  });

  it("refreshes at once for an impl registered, the button, and a finished deploy", async () => {
    const w = world();
    await w.refresher.read(w.ctx, { refresh: true });
    const queries = w.forge.queries.length;
    // An impl registered: the forge is read even though no ref moved.
    await w.refresher.kick(w.ctx);
    expect(w.forge.queries.length).toBeGreaterThan(queries);
    // The button waits for its refresh.
    const calls = w.mirror.lsRemoteCalls;
    await w.refresher.read(w.ctx, { refresh: true });
    expect(w.mirror.lsRemoteCalls).toBe(calls + 1);
    // A deploy run ended: the deployment's server is probed again and its commit placed.
    w.deployments.push({ id: "desk", url: "http://desk", installId: "i", at: "", by: "user:boss" });
    w.setCommit(X);
    w.mirror.reachable.add(X);
    const probed = w.probed();
    await w.refresher.kick(w.ctx, false);
    expect(w.probed()).toBe(probed + 1);
    const g = await w.refresher.read(w.ctx);
    expect(g.deployments).toEqual([
      expect.objectContaining({ id: "desk", commit: X, at: 12, relation: "ahead", ahead: 1 }),
    ]);
  });

  it("runs one refresher per repository: a held lease keeps it out until it expires", async () => {
    const w = world();
    expect(w.store.acquire("acme/site", "other", new Date(w.now() + 5 * MIN).toISOString())).toBe(
      true,
    );
    await w.refresher.kick(w.ctx);
    expect(w.mirror.lsRemoteCalls).toBe(0);
    w.advance(5 * MIN + 1);
    await w.refresher.kick(w.ctx);
    expect(w.mirror.lsRemoteCalls).toBe(1);
    // Released after it ran.
    expect(w.store.refreshState("acme/site").holder).toBeNull();
  });

  it("waits a minute after a failure, and keeps answering the stored graph with the reason", async () => {
    const w = world();
    await w.refresher.read(w.ctx, { refresh: true });
    w.mirror.failWith = "network unreachable";
    w.advance(5 * MIN);
    await w.refresher.read(w.ctx);
    await w.settle();
    const failed = await w.refresher.read(w.ctx);
    expect(failed.nodes).toHaveLength(2);
    expect(failed.errors).toEqual(["acme/site: last refresh failed: network unreachable"]);
    const calls = w.mirror.lsRemoteCalls;
    w.advance(MIN - 1);
    await w.refresher.read(w.ctx);
    expect(w.mirror.lsRemoteCalls).toBe(calls);
    w.mirror.failWith = null;
    w.advance(1);
    await w.refresher.read(w.ctx);
    await w.settle();
    expect(w.mirror.lsRemoteCalls).toBe(calls + 1);
    expect((await w.refresher.read(w.ctx)).errors).toEqual([]);
  });

  it("answers the stored graph at once while a refresh runs", async () => {
    const w = world();
    await w.refresher.read(w.ctx, { refresh: true });
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const ls = w.mirror.lsRemote.bind(w.mirror);
    w.mirror.lsRemote = async () => {
      await gate;
      return ls();
    };
    w.advance(5 * MIN);
    await w.refresher.read(w.ctx);
    const during = await w.refresher.read(w.ctx);
    expect(during.refreshing).toBe(true);
    expect(during.nodes).toHaveLength(2);
    release();
    await w.settle();
  });
});
