/**
 * The latency budget, as a test (bench group). Data at the scale of the largest organization
 * measured (183 proposals, 364 revisions of about 10 KB each, about 1400 events, 145 impl PRs, a
 * PR graph of 190 open PRs) is written to a real `company.db`; then, with the store open in the
 * process, the server-side time of the queue and of one proposal must stay under 20 ms at p95,
 * and the graph's first read in a new process — a snapshot hit — under 100 ms.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OrgActor, OrgGateway, OrgView } from "@prismshadow/penguin-server/plugin";
import {
  ProposalService,
  SqliteGraphStore,
  SqliteProposalStore,
  companyDbPath,
} from "../src/index.js";
import type { ChangeRequest } from "../src/ports.js";
import type { Comparison } from "../src/pr-chain.js";
import { FakeForge, FakeMirror, cr, rel } from "./graph-fakes.js";

const PROJECT = "proj";
const ORG = "penguin";
const BOSS: OrgActor = { userId: "boss" };
const PROPOSALS = 183;
const REVISIONS = 364;
const PULLS = 190;

const org: OrgView = {
  projectId: PROJECT,
  orgId: ORG,
  name: "Penguin",
  status: "active",
  language: "en",
  workspace: "/nonexistent-workspace",
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

/** A section of about 3 KB, so a revision is about 10 KB like the measured ones. */
const section = (id: string, n: number) => ({
  id,
  heading: id,
  paragraphs: Array.from({ length: 6 }, (_, i) => ({
    id: `${id}-${i}`,
    text: `Paragraph ${i} of revision ${n}: ${"the store keeps every revision whole. ".repeat(12)}`,
  })),
});

const sha = (n: number): string => n.toString(16).padStart(40, "0");

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
}

async function time(run: () => Promise<unknown>, times = 40): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < times; i++) {
    const t = performance.now();
    await run();
    out.push(performance.now() - t);
  }
  return out;
}

describe("latency at the scale of the largest organization", () => {
  let root: string;
  const pulls: ChangeRequest[] = [];
  const refs = new Map<string, string>([["refs/heads/dev", sha(1)]]);
  const comparisons = new Map<string, Comparison>();

  const service = () =>
    new ProposalService({
      gateway,
      agents: {
        pluginVersion: async () => ({ installed: null, library: null }),
        updatePlugin: async () => {},
        removeSkill: async () => undefined,
      },
      root,
      log: { line: () => undefined },
      pluginConfig: { get: () => ({ deliveryRepo: "penguin/site", deliveryBase: "dev" }) },
      forge: new FakeForge(pulls),
      mirrorFor: () => new FakeMirror(refs, "dev", comparisons),
    });

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "proposals-latency-"));
    // A chain of open PRs on dev, each one ahead of the one below it.
    let below = sha(1);
    for (let n = 1; n <= PULLS; n++) {
      const head = sha(1000 + n);
      pulls.push(
        cr("penguin/site", n, {
          head,
          branch: `feat/${n}`,
          base: n === 1 ? "dev" : `feat/${n - 1}`,
        }),
      );
      refs.set(`refs/pull/${n}/head`, head);
      comparisons.set(`${below}...${head}`, rel("ahead", 1, 0, below));
      below = head;
    }
    const store = SqliteProposalStore.open(companyDbPath(root, PROJECT, ORG));
    for (let i = 1; i <= PROPOSALS; i++) {
      const { number } = store.create(() => ({
        title: `Proposal ${i}`,
        author: "dev",
        delegatedBy: "user:boss",
        brief: `Brief ${i}`,
      }));
      // 181 proposals with two revisions, two with one: 364.
      const count = i <= REVISIONS - PROPOSALS ? 2 : 1;
      for (let r = 1; r <= count; r++) {
        store.publish(number, (p) => ({
          revision: p.revision + 1,
          title: `Proposal ${i}`,
          root: "",
          scope: [],
          tests: [],
          sections: [section("change", r), section("purpose", r), section("test", r)] as never,
          status: p.status,
          reason: null,
          by: "agent:dev",
        }));
      }
      for (let e = 0; e < 3; e++) {
        store.feedback(number, () => ({ text: `note ${e}`, runtime: false, by: "agent:dev" }));
      }
      store.addMaterial(number, () => ({
        kind: "pr",
        label: `PR #${i}`,
        url: `https://github.com/penguin/site/pull/${i}`,
        by: "agent:dev",
      }));
      if (i <= 145) {
        store.setImpl(number, () => ({
          head: null,
          base: null,
          pr: {
            url: `https://github.com/penguin/site/pull/${i}`,
            label: `penguin/site#${i}`,
            key: `penguin/site#${i}`,
          },
          by: "agent:dev",
        }));
      }
    }
    store.close();
    // One refresh lays the graph out and stores its snapshot, as the running server would.
    const warm = service();
    await warm.graph(PROJECT, ORG, BOSS, { refresh: true });
    warm.close();
    // Seeding is not what is measured, and it shares the machine with the other files' workers —
    // company-workflow.test.ts runs the TypeScript compiler — so it gets more than the default 10 s.
  }, 60_000);
  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("holds the data the budget is measured on", () => {
    const store = SqliteProposalStore.open(companyDbPath(root, PROJECT, ORG));
    const count = (sql: string) => Number((store.db.prepare(sql).get() as { n: number }).n);
    expect(count(`SELECT count(*) AS n FROM proposals`)).toBe(PROPOSALS);
    expect(count(`SELECT count(*) AS n FROM proposal_revisions`)).toBe(REVISIONS);
    expect(count(`SELECT count(*) AS n FROM proposal_events`)).toBeGreaterThanOrEqual(1400);
    expect(new SqliteGraphStore(store.db).openPulls("penguin/site")).toHaveLength(PULLS);
    store.close();
  });

  it("answers the queue and one proposal in under 20 ms at p95", async () => {
    const s = service();
    await s.list(PROJECT, ORG, BOSS);
    const list = p95(await time(() => s.list(PROJECT, ORG, BOSS)));
    const one = p95(await time(() => s.get(PROJECT, ORG, 100, BOSS)));
    s.close();
    console.log(`[latency] list p95 ${list.toFixed(1)} ms, proposal p95 ${one.toFixed(1)} ms`);
    expect(list).toBeLessThan(20);
    expect(one).toBeLessThan(20);
  });

  it("draws the graph from its snapshot on a new process's first read in under 100 ms", async () => {
    const s = service();
    const t = performance.now();
    const graph = await s.graph(PROJECT, ORG, BOSS);
    const cold = performance.now() - t;
    s.close();
    console.log(`[latency] graph cold read ${cold.toFixed(1)} ms`);
    expect(graph.nodes).toHaveLength(PULLS);
    expect(graph.refreshing).toBe(false);
    expect(cold).toBeLessThan(100);
  });
});
