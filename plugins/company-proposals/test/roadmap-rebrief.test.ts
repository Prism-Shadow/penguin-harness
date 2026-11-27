/**
 * The brief of a proposal a roadmap item is linked to, rewritten when the item's changed brief
 * is approved again (ProposalService.rebriefFromRoadmap): while the proposal is open only its
 * brief moves — same number, nothing created, its history kept, recorded under the approver —
 * and its author is told unless it is the item's owner (the roadmap tells that one). A merged or
 * rejected proposal, or none, is left as it is and answered false: the roadmap creates anew.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OrgActor, OrgGateway, OrgView } from "@prismshadow/penguin-server/plugin";
import {
  ProposalService,
  SqliteProposalStore,
  companyDbPath,
  rebriefFromRoadmap,
} from "../src/index.js";
import type { Proposal } from "../src/domain.js";

const PROJECT = "proj";
const ORG = "acme";
const BOSS: OrgActor = { userId: "boss" };
const ITEM = { number: 3, key: "ledger" };

let root: string;
let desks: Array<{ agentId: string; text: string }>;
let service: ProposalService;

const org: OrgView = {
  projectId: PROJECT,
  orgId: ORG,
  name: "Acme",
  status: "active",
  language: "en",
  workspace: "/tmp/acme",
  employees: [
    { agentId: "acme_dev", name: "Dev", title: "Engineer", reportsTo: null },
    { agentId: "acme_web", name: "Web", title: "Engineer", reportsTo: null },
  ],
  userIds: ["boss"],
  machineId: null,
};

const gateway = {
  companyModeEnabled: () => true,
  organization: async () => org,
  principalOf: async (_p: string, _o: string, a: OrgActor) =>
    a.agentId !== undefined ? `agent:${a.agentId}` : `user:${a.userId}`,
  deliverToDesk: async (_p: string, _o: string, agentId: string, text: string) => {
    desks.push({ agentId, text });
    return { sessionId: `desk-${agentId}`, queued: false };
  },
  notifyProject: () => undefined,
} as unknown as OrgGateway;

/** The proposal as the store on disk holds it. */
function stored(number: number): Proposal | null {
  const store = SqliteProposalStore.open(companyDbPath(root, PROJECT, ORG));
  try {
    return store.get(number);
  } finally {
    store.close();
  }
}

function created(brief: string): Promise<number> {
  return service.createFromRoadmap(PROJECT, ORG, {
    author: "acme_dev",
    title: "Roadmap ledger",
    brief,
    delegatedBy: "agent:acme_dev",
    roadmap: ITEM,
  });
}

function rebrief(number: number, brief: string, owner = "acme_dev"): Promise<boolean> {
  return service.rebriefFromRoadmap(PROJECT, ORG, number, {
    owner,
    brief,
    delegatedBy: "user:boss",
    roadmap: ITEM,
  });
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "proposals-rebrief-"));
  desks = [];
  service = new ProposalService({
    gateway,
    agents: {
      pluginVersion: async () => ({ installed: "1", library: "1" }),
      updatePlugin: async () => {},
      removeSkill: async () => undefined,
    },
    root,
    log: { line: () => undefined },
  });
});

afterEach(async () => {
  service.close();
  await fs.rm(root, { recursive: true, force: true });
});

describe("rewriting a roadmap item's proposal brief", () => {
  it("rewrites an open proposal in place — same number, nothing created, its history kept — once", async () => {
    const number = await created("An append-only ledger.");
    expect(await rebrief(number, "  One ledger per organization.  ")).toBe(true);
    const p = stored(number)!;
    expect(p).toMatchObject({
      number,
      status: "drafting",
      author: "acme_dev",
      delegatedBy: "agent:acme_dev",
      brief: "One ledger per organization.",
      roadmap: ITEM,
    });
    expect(p.events.map((e) => [e.kind, e.by])).toEqual([
      ["created", "agent:acme_dev"],
      ["brief_edited", "user:boss"],
    ]);
    expect((await service.list(PROJECT, ORG, BOSS)).proposals).toHaveLength(1);
    // The author is the item's owner: the roadmap tells it, so this plugin does not.
    expect(desks).toEqual([]);
    // An approval retried after a failure in between finds the brief written: nothing again.
    expect(await rebrief(number, "One ledger per organization.")).toBe(true);
    expect(stored(number)!.events).toHaveLength(2);
  });

  it("tells the author when it is not the item's owner", async () => {
    const number = await created("An append-only ledger.");
    expect(await rebrief(number, "One ledger per organization.", "acme_web")).toBe(true);
    expect(desks).toEqual([
      {
        agentId: "acme_dev",
        text: expect.stringContaining(
          `[proposal #${number}] Item [ledger] of roadmap #3 was approved again with a changed brief, so boss rewrote this proposal's brief: One ledger per organization.`,
        ),
      },
    ]);
  });

  it("leaves a rejected proposal, or a number that is none, as it is and answers false", async () => {
    const number = await created("An append-only ledger.");
    await service.reject(PROJECT, ORG, number, "Not now.", BOSS);
    const before = stored(number)!;
    desks = [];
    expect(await rebrief(number, "One ledger per organization.")).toBe(false);
    expect(await rebrief(99, "One ledger per organization.")).toBe(false);
    expect(stored(number)).toEqual(before);
    expect(desks).toEqual([]);
    // The roadmap then creates the item's new proposal from the changed brief.
    expect(await created("One ledger per organization.")).toBe(number + 1);
  });

  it("rewrites by the default rule while open, not once merged or rejected", () => {
    const of = (status: Proposal["status"]) => ({ status }) as Proposal;
    for (const status of ["drafting", "ready", "approved"] as const) {
      expect(rebriefFromRoadmap(of(status))).toBe(true);
    }
    for (const status of ["merged", "rejected"] as const) {
      expect(rebriefFromRoadmap(of(status))).toBe(false);
    }
  });
});
