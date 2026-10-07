/**
 * A graph read runs no git and no `gh`: every runner the service could start is a counting
 * fake, and once a refresh has run, reads of the graph start none — with impl heads declared
 * (their repositories were resolved when they were registered, and are read from the store) and
 * with no delivery repository set (the refresher found it in the workspace's remotes and keeps
 * it; the reads use what it found).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OrgActor, OrgGateway, OrgView } from "@prismshadow/penguin-server/plugin";
import { ProposalService, SqliteProposalStore, companyDbPath } from "../src/index.js";
import type { RunGh } from "../src/pr-status.js";
import type { RunGit } from "../src/workspace-remotes.js";
import { FakeForge, FakeMirror, cr, rel } from "./graph-fakes.js";

const PROJECT = "proj";
const ORG = "acme";
const BOSS: OrgActor = { userId: "boss" };
const DEV: OrgActor = { userId: "boss", agentId: "dev", sessionId: "desk-dev" };
const BASE = "0".repeat(40);
const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);

describe("graph reads spawn nothing", () => {
  let root: string;
  let settings: Record<string, unknown>;
  const git: string[][] = [];
  const gh: string[][] = [];
  let forge: FakeForge;
  let mirror: FakeMirror;
  let service: ProposalService;

  const countingGit: RunGit = async (cwd, args) => {
    git.push([cwd, ...args]);
    return [
      "origin\thttps://github.com/acme/site.git (fetch)",
      "fork\tgit@github.com:me/site.git (fetch)",
    ].join("\n");
  };
  const countingGh: RunGh = async (args) => {
    gh.push([...args]);
    throw new Error("gh is not expected here");
  };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "proposals-read-spawns-"));
    const workspace = path.join(root, "workspace");
    await fs.mkdir(workspace, { recursive: true });
    const org = {
      projectId: PROJECT,
      orgId: ORG,
      name: "Acme",
      status: "active",
      language: "en",
      workspace,
      employees: [{ agentId: "dev", name: "Dev", title: "Engineer", reportsTo: null }],
      userIds: ["boss"],
      machineId: null,
    } as OrgView;
    const gateway = {
      companyModeEnabled: () => true,
      organization: async () => org,
      principalOf: async (_p: string, _o: string, a: OrgActor) =>
        a.agentId !== undefined ? `agent:${a.agentId}` : `user:${a.userId}`,
      notifyProject: () => undefined,
      deliverToDesk: async () => ({ sessionId: "desk", queued: false }),
    } as unknown as OrgGateway;
    git.length = 0;
    gh.length = 0;
    settings = { deliveryBase: "dev" };
    // Two open PRs on dev, from origin's feat/a and feat/b.
    forge = new FakeForge([
      cr("acme/site", 11, { head: HEAD_A, branch: "feat/a" }),
      cr("acme/site", 12, { head: HEAD_B, branch: "feat/b" }),
    ]);
    mirror = new FakeMirror(
      new Map([
        ["refs/heads/dev", BASE],
        ["refs/pull/11/head", HEAD_A],
        ["refs/pull/12/head", HEAD_B],
      ]),
      "dev",
      new Map([
        [`${BASE}...${HEAD_A}`, rel("ahead", 1, 0, BASE)],
        [`${BASE}...${HEAD_B}`, rel("ahead", 1, 0, BASE)],
      ]),
    );
    service = new ProposalService({
      gateway,
      agents: {
        pluginVersion: async () => ({ installed: null, library: null }),
        updatePlugin: async () => {},
        removeSkill: async () => undefined,
      },
      root,
      log: { line: () => undefined },
      pluginConfig: { get: () => settings },
      git: countingGit,
      gh: countingGh,
      forge,
      mirrorFor: () => mirror,
    });
    // Two proposals, each with a declared impl branch, registered through the service: that is
    // where the heads' repositories are resolved (`git remote -v`), once.
    const store = SqliteProposalStore.open(companyDbPath(root, PROJECT, ORG));
    const numbers: number[] = [];
    for (const title of ["A", "B"]) {
      const { number } = store.create(() => ({
        title,
        author: "dev",
        delegatedBy: "user:boss",
        brief: `Brief ${title}`,
      }));
      numbers.push(number);
    }
    store.close();
    await service.setImpl(
      PROJECT,
      ORG,
      numbers[0]!,
      { head: { remote: "origin", branch: "feat/a" }, base: { remote: "origin", branch: "dev" } },
      DEV,
    );
    await service.setImpl(
      PROJECT,
      ORG,
      numbers[1]!,
      { head: { remote: "origin", branch: "feat/b" }, base: { remote: "origin", branch: "dev" } },
      DEV,
    );
    await service.graphSettled(PROJECT, ORG);
  });
  afterEach(async () => {
    service.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  /** Reads the graph a few times, counting what was started meanwhile. */
  async function reads(times = 5) {
    const before = {
      git: git.length,
      gh: gh.length,
      lsRemote: mirror.lsRemoteCalls,
      fetched: mirror.fetched.length,
      compared: mirror.compared.length,
      forge: forge.queries.length,
    };
    let last = await service.graph(PROJECT, ORG, BOSS);
    for (let i = 1; i < times; i++) last = await service.graph(PROJECT, ORG, BOSS);
    return {
      graph: last,
      started: {
        git: git.length - before.git,
        gh: gh.length - before.gh,
        lsRemote: mirror.lsRemoteCalls - before.lsRemote,
        fetched: mirror.fetched.length - before.fetched,
        compared: mirror.compared.length - before.compared,
        forge: forge.queries.length - before.forge,
      },
    };
  }

  const NOTHING = { git: 0, gh: 0, lsRemote: 0, fetched: 0, compared: 0, forge: 0 };

  it("with a delivery repository set and impl heads declared", async () => {
    settings = { deliveryRepo: "acme/site", deliveryBase: "dev" };
    await service.graph(PROJECT, ORG, BOSS, { refresh: true });
    await service.graphSettled(PROJECT, ORG);
    const { graph, started } = await reads();
    expect(started).toEqual(NOTHING);
    expect(graph.repo).toBe("acme/site");
    expect(graph.refreshing).toBe(false);
    // The declared heads place their proposals on the PRs opened from them.
    expect(graph.nodes.map((n) => [n.number, n.proposal?.number ?? null]).sort()).toEqual([
      [11, 1],
      [12, 2],
    ]);
  });

  it("with no delivery repository set: the refresher reads the workspace's remotes, the reads do not", async () => {
    // The registrations' refreshes found the repository in the workspace's remotes — the one
    // git they run for it — and the reads answer what they found.
    expect(git.length).toBeGreaterThan(0);
    for (const c of git) expect(c.slice(1)).toEqual(["remote", "-v"]);
    const { graph, started } = await reads();
    expect(started).toEqual(NOTHING);
    expect(graph.repo).toBe("acme/site");
    expect(graph.origins).toEqual([{ name: "fork", repo: "me/site" }]);
    expect(graph.nodes.map((n) => [n.number, n.proposal?.number ?? null]).sort()).toEqual([
      [11, 1],
      [12, 2],
    ]);
  });

  it("stores the repository a declared side resolved to, and answers the side as declared", async () => {
    const p = await service.get(PROJECT, ORG, 1, BOSS);
    // The API names the side as declared, with its branch page; the repository stays the plugin's.
    expect(p.impl?.head).toEqual({
      remote: "origin",
      branch: "feat/a",
      url: "https://github.com/acme/site/tree/feat/a",
      unresolved: null,
    });
    const store = SqliteProposalStore.open(companyDbPath(root, PROJECT, ORG));
    try {
      expect(store.facts().find((f) => f.number === 1)?.impl?.head).toMatchObject({
        remote: "origin",
        repo: "acme/site",
        branch: "feat/a",
      });
    } finally {
      store.close();
    }
  });
});
