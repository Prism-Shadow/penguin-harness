/**
 * The graph's refresh policy over fake ports that count their calls: a probe that finds nothing
 * moved only moves the schedule (no fetch, no forge, no snapshot); a probe that finds a ref
 * moved fetches only that and compares only the missing pairs; an unchanged input key adds no
 * snapshot; quiet probes double the interval up to 30 minutes and a change resets it; an impl
 * registered, the refresh button and a finished deploy each refresh at once; nobody reading
 * means no remote call at all; the lease keeps a second refresher out until it expires; a
 * failure waits a minute; a read during a refresh answers the stored graph at once; another
 * build of the layout code lays the same inputs out again, the same build answers its snapshot;
 * a PR declared on the base takes its parent from the stored ancestry; a refresher stopped
 * mid-refresh releases its lease before the stores close.
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
import { layoutCodeOf } from "../src/layout-code.js";
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
  /** A refresher over this world's store, as one build of the layout code runs it. */
  const refresherFor = (layoutCode: string) =>
    new GraphRefresher({
      log: () => undefined,
      now: () => now,
      mirrorFor: () => mirror,
      forgeFor: () => forge,
      probe: async () => {
        probed++;
        return { installId: "i", commit, describe: null };
      },
      layoutCode,
    });
  const refresher = refresherFor("build-1");
  const ctx: GraphContext = {
    key: "proj/acme",
    orgDir: "/nowhere",
    store,
    deployments: { list: async () => deployments },
    settings: () => project,
    discover: async () => ({ project, errors: [] }),
    proposals: () => proposals,
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
    refresherFor,
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
      [11, "", true],
      [12, "feat/a", true],
    ]);
    expect(warm.top).toBe("feat/b");
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

  it("lays the same inputs out again for another build of the layout code, and hits for the same build", async () => {
    const w = world();
    await w.refresher.read(w.ctx, { refresh: true });
    const snaps = w.snapshots();
    const first = await w.refresher.read(w.ctx);
    w.advance(MIN);
    // The same build, the same inputs: the stored snapshot, nothing laid out or stored.
    expect((await w.refresher.read(w.ctx)).checkedAt).toBe(first.checkedAt);
    expect(w.snapshots()).toBe(snaps);
    // A new build reads the same store (a deploy): its key differs, so its first read lays the
    // graph out from the stored facts by its own rules and stores that — no git, no forge.
    const next = w.refresherFor("build-2");
    const calls = { ls: w.mirror.lsRemoteCalls, queries: w.forge.queries.length };
    const relaid = await next.read(w.ctx);
    expect(relaid.checkedAt).toBe(new Date(w.now()).toISOString());
    expect(relaid.nodes.map((n) => n.number)).toEqual([11, 12]);
    expect(w.snapshots()).toBe(snaps + 1);
    expect(w.mirror.lsRemoteCalls).toBe(calls.ls);
    expect(w.forge.queries.length).toBe(calls.queries);
    w.advance(MIN);
    expect((await next.read(w.ctx)).checkedAt).toBe(relaid.checkedAt);
    expect(w.snapshots()).toBe(snaps + 1);
  });

  it("answers the new build's layout to the refresh button even when another holder's lease keeps the refresh out", async () => {
    const w = world();
    await w.refresher.read(w.ctx, { refresh: true });
    const old = await w.refresher.read(w.ctx);
    w.advance(MIN);
    // The previous build's refresher still holds the lease (it was stopped mid-refresh).
    w.store.acquire("acme/site", "previous-build", new Date(w.now() + 5 * MIN).toISOString());
    const calls = w.mirror.lsRemoteCalls;
    const g = await w.refresherFor("build-2").read(w.ctx, { refresh: true });
    expect(w.mirror.lsRemoteCalls).toBe(calls);
    expect(g.checkedAt).not.toBe(old.checkedAt);
    expect(g.checkedAt).toBe(new Date(w.now()).toISOString());
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
      expect.objectContaining({ id: "desk", commit: X, at: "feat/b", relation: "ahead", ahead: 1 }),
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

  it("releases its lease when stopped mid-refresh, before the stores close", async () => {
    const w = world();
    // The probe hangs until the refresh is aborted, as a slow ls-remote at a deploy would.
    let probing!: () => void;
    const started = new Promise<void>((r) => {
      probing = r;
    });
    w.mirror.lsRemote = (signal?: AbortSignal) =>
      new Promise<never>((_, reject) => {
        probing();
        signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const kicked = w.refresher.kick(w.ctx);
    await started;
    expect(w.store.refreshState("acme/site").holder).not.toBeNull();
    w.refresher.stop();
    // Released at once: the next instance's forced refresh is not kept out for five minutes.
    expect(w.store.refreshState("acme/site").holder).toBeNull();
    expect(
      w.store.acquire("acme/site", "next-instance", new Date(w.now() + MIN).toISOString()),
    ).toBe(true);
    // The stores close right after (the plugin's dispose); the stopped refresh ends quietly.
    w.db.close();
    await expect(kicked).resolves.toBeUndefined();
  });

  it("takes the parent of a PR declared on the base from the ancestry the refresh stored, and lays it out again without git", async () => {
    const w = world();
    // #12 is stacked on #11 but declared on dev.
    w.forge.pulls[1] = cr("acme/site", 12, { head: B1, branch: "feat/b", base: "dev" });
    w.mirror.parents.set(A1, [D0]);
    w.mirror.parents.set(B1, [A1]);
    const g = await w.refresher.read(w.ctx, { refresh: true });
    expect(g.nodes.map((n) => [n.number, n.base, n.parent, n.onChain])).toEqual([
      [11, "dev", "", true],
      [12, "dev", "feat/a", true],
    ]);
    expect(g.top).toBe("feat/b");
    expect(w.mirror.walks).toBe(1);
    // Another build lays the stored facts out again: the stored ancestry, no git, no forge.
    const calls = { ls: w.mirror.lsRemoteCalls, walks: w.mirror.walks };
    const relaid = await w.refresherFor("build-2").read(w.ctx);
    expect(relaid.nodes.map((n) => [n.number, n.parent])).toEqual([
      [11, ""],
      [12, "feat/a"],
    ]);
    expect([w.mirror.lsRemoteCalls, w.mirror.walks]).toEqual([calls.ls, calls.walks]);
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

describe("layoutCodeOf", () => {
  it("is the loader's stamp on the entry's import URL, else the package version", () => {
    const entry = "file:///data/plugins/company-proposals/dist/index.js";
    expect(layoutCodeOf(`${entry}?v=sha256-0123abcd`, "0.1.0")).toBe("build:sha256-0123abcd");
    expect(layoutCodeOf(`${entry}?v=1759536000000.5`, "0.1.0")).toBe("build:1759536000000.5");
    expect(layoutCodeOf(entry, "0.1.0")).toBe("version:0.1.0");
    expect(layoutCodeOf(`${entry}?v=`, "0.1.0")).toBe("version:0.1.0");
  });
});
