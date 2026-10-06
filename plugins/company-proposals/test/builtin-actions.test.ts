/**
 * The built-in proposal Actions as the registry runs them: the manifest declares exactly the
 * contributions builtin-actions.ts binds; every default guard answers a person and an employee
 * alike; the defaults hold through the Action routes with their codes; and a guard replaced by a
 * company workflow's contribution lets the same write through while the history stays
 * append-only.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProposalComment, ServerEvent } from "@prismshadow/penguin-server/api";
import type { OrgActor, OrgGateway, OrgView } from "@prismshadow/penguin-server/plugin";
import {
  DEPLOY_REFRESH_ID,
  PROPOSAL_ACTION_IDS,
  ProposalService,
  SUBJECTS_ID,
  SqliteProposalStore,
  companyDbPath,
  proposalCode,
  proposalGuards,
  type Caller,
  type Contributed,
  type GuardCode,
  type Proposal,
  type Subject,
} from "../src/index.js";
import type { ProposalTx } from "../src/ports.js";
import { FakeForge, FakeMirror } from "./graph-fakes.js";
import {
  PLUGIN_DIR,
  actionApp,
  manifestContributions,
  proposalContributions,
  type ActionApp,
} from "./action-harness.js";
import { DOC } from "./fake-org.js";

const PROJECT = "proj";
const ORG = "acme";

describe("the manifest", () => {
  it("declares exactly the contributions the code binds, each under its key", () => {
    const code = proposalCode({} as ProposalService);
    const declared = manifestContributions(PLUGIN_DIR, "CompanyProposalsPlugin", code);
    expect(declared.map((c) => c.id).sort()).toEqual(
      [...Object.values(PROPOSAL_ACTION_IDS), SUBJECTS_ID, DEPLOY_REFRESH_ID].sort(),
    );
    for (const [key, id] of Object.entries(PROPOSAL_ACTION_IDS)) {
      const c = declared.find((x) => x.id === id)!;
      expect(c.data, id).toMatchObject({ kind: "action", key });
      expect(c.code, id).toBeDefined();
      expect(proposalGuards[key], key).toBeDefined();
    }
    expect(declared.find((c) => c.id === DEPLOY_REFRESH_ID)!.data).toMatchObject({
      kind: "hook",
      key: "deploy.*",
      when: "after",
    });
    expect(declared.find((c) => c.id === SUBJECTS_ID)!.data).toMatchObject({ kind: "subject" });
  });
});

const person: Caller = { principal: "user:boss", agentId: null, userId: "boss" };
const employee: Caller = { principal: "agent:acme_qa", agentId: "acme_qa", userId: "boss" };

function proposal(fields: Partial<Proposal> = {}): Proposal {
  return {
    number: 7,
    title: "T",
    status: "drafting",
    revision: 1,
    author: "acme_dev",
    implementer: "acme_impl",
    delegatedBy: "user:boss",
    brief: "B",
    createdAt: "",
    updatedAt: "",
    root: "",
    scope: [],
    tests: [],
    sections: [],
    materials: [],
    impl: null,
    sessions: [],
    discussions: [],
    comments: [],
    events: [],
    openBatches: [],
    approvedRevision: null,
    roadmap: null,
    seq: 1,
    ...fields,
  };
}

/** A comment neither caller wrote: who wrote it is the rule, not what kind of member asks. */
const comment = (fields: Partial<ProposalComment> = {}): ProposalComment => ({
  id: "c1",
  sectionId: "s",
  range: { start: 0, end: 1 },
  quote: "x",
  revision: 1,
  text: "t",
  by: "agent:acme_ceo",
  at: "",
  batchId: null,
  ...fields,
});

const STATES: Proposal[] = [
  proposal({ revision: 0 }),
  proposal(),
  proposal({
    openBatches: [{ id: "b1", revision: 1, commentIds: ["c1"] }],
    comments: [comment({ batchId: "b1" })],
  }),
  proposal({ status: "ready", comments: [comment()] }),
  proposal({
    status: "approved",
    approvedRevision: 1,
    comments: [comment({ batchId: "b1", resolved: { by: "x", at: "", text: "" } })],
  }),
  proposal({ status: "merged" }),
  proposal({ status: "rejected" }),
  proposal({
    discussions: [
      {
        sessionId: "s1",
        agentId: "acme_dev",
        by: "user:boss",
        at: "",
        concluded: null,
      },
      {
        sessionId: "s2",
        agentId: "acme_dev",
        by: "user:boss",
        at: "",
        concluded: { by: "user:boss", at: "", text: "done" },
      },
    ],
  } as Partial<Proposal>),
];

const SUBJECTS: Record<string, string[]> = {
  "proposal.comment.edit": ["comment:7/c1", "comment:7/nope"],
  "proposal.comment.withdraw": ["comment:7/c1"],
  "proposal.resolve": ["comment:7/c1", "comment:7/nope"],
  "proposal.conclude": ["discussion:7/s1", "discussion:7/s2", "discussion:7/s9"],
};

const PARAMS: Array<Record<string, unknown>> = [
  {},
  { revision: 2 },
  { revision: 5 },
  { brief: "B" },
  { brief: "Other" },
];

const subjectOf = (text: string): Subject => {
  const at = text.indexOf(":");
  return { kind: text.slice(0, at) as Subject["kind"], id: text.slice(at + 1), text };
};

function answer(
  key: string,
  caller: Caller,
  state: Proposal,
  subject: string,
  params: Record<string, unknown>,
  tx?: ProposalTx,
): string {
  try {
    proposalGuards[key]!({
      caller,
      subject: subjectOf(subject),
      state,
      params,
      running: 0,
      ...(tx !== undefined ? { tx } : {}),
    });
    return "allowed";
  } catch (err) {
    const e = err as { status: number; code: string };
    return `${e.status} ${e.code}`;
  }
}

describe("the default guards", () => {
  it("answer a person and an employee alike, for every built-in Action", () => {
    const tx: ProposalTx = {
      implsByPr: () => [3],
      implsByHead: () => [{ number: 3, status: "ready" }],
      implsOnBranch: () => [],
    };
    let refusals = 0;
    for (const key of Object.keys(PROPOSAL_ACTION_IDS)) {
      for (const state of STATES) {
        for (const subject of SUBJECTS[key] ?? ["proposal:7"]) {
          for (const params of [
            ...PARAMS,
            { planned: { head: { remote: "o", branch: "b" }, pr: null } },
          ]) {
            const a = answer(key, person, state, subject, params, tx);
            const b = answer(key, employee, state, subject, params, tx);
            expect(
              b,
              `${key} ${state.status}/${state.revision} ${subject} ${JSON.stringify(params)}`,
            ).toBe(a);
            if (a !== "allowed") refusals++;
          }
        }
      }
      // The organization's subject has no proposal: nothing to refuse.
      expect(answer(key, employee, null as unknown as Proposal, "organization", {})).toBe(
        "allowed",
      );
    }
    // The table is not vacuous: the defaults refuse plenty, alike.
    expect(refusals).toBeGreaterThan(50);
  });

  it("keep the rules and their codes", () => {
    const codes = new Set<string>();
    const tx: ProposalTx = {
      implsByPr: () => [3],
      implsByHead: () => [{ number: 3, status: "ready" }],
      implsOnBranch: () => [],
    };
    for (const key of Object.keys(PROPOSAL_ACTION_IDS)) {
      for (const state of STATES) {
        for (const subject of SUBJECTS[key] ?? ["proposal:7"]) {
          for (const params of [
            ...PARAMS,
            { planned: { head: null, pr: { key: "a/b#1", label: "a/b#1" } } },
            { planned: { head: { remote: "o", branch: "b" }, pr: null } },
          ]) {
            const a = answer(key, person, state, subject, params, tx);
            if (a !== "allowed") codes.add(a);
          }
        }
      }
    }
    const author: Caller = { principal: "agent:acme_dev", agentId: "acme_dev", userId: "boss" };
    codes.add(answer("proposal.ready", author, STATES[2]!, "proposal:7", {}));
    codes.add(answer("proposal.author", person, STATES[1]!, "proposal:7", { author: "acme_dev" }));
    // The one default that tells a person from an employee: an author is changed by a person or
    // by the moderator of the roadmap that created the proposal (author.ts).
    codes.add(answer("proposal.author", employee, STATES[1]!, "proposal:7", { moderator: null }));
    expect([...codes].sort()).toEqual(
      [
        "409 revision_conflict",
        "409 proposal_status",
        "409 proposal_closed",
        "409 proposal_empty",
        "409 brief_unchanged",
        "409 author_unchanged",
        "403 not_moderator",
        "409 changes_pending",
        "409 comment_sent",
        "403 not_commenter",
        "404 comment_not_found",
        "409 comment_resolved",
        "409 impl_pr_taken",
        "409 impl_branch_taken",
        "404 discussion_not_found",
        "409 discussion_concluded",
      ].sort(),
    );
    // Only the author is asked to answer the requested changes before its ready.
    expect(answer("proposal.ready", employee, STATES[2]!, "proposal:7", {})).toBe("allowed");
  });
});

class Gateway implements OrgGateway {
  org: OrgView = {
    projectId: PROJECT,
    orgId: ORG,
    name: "Acme",
    status: "active",
    language: "en",
    workspace: "/tmp/acme",
    employees: [
      { agentId: "acme_dev", name: "Dev", title: "Engineer", reportsTo: null },
      { agentId: "acme_qa", name: "QA", title: "Tester", reportsTo: null },
    ],
    userIds: ["boss"],
    machineId: null,
  };
  desks: Array<{ agentId: string; text: string }> = [];
  companyModeEnabled(): boolean {
    return true;
  }
  async organization(): Promise<OrgView> {
    return this.org;
  }
  async principalOf(_p: string, _o: string, actor: OrgActor): Promise<string> {
    return actor.agentId !== undefined ? `agent:${actor.agentId}` : `user:${actor.userId}`;
  }
  async deliverToDesk(_p: string, _o: string, agentId: string, text: string) {
    this.desks.push({ agentId, text });
    return { sessionId: `desk-${agentId}`, queued: false };
  }
  async openEmployeeSession() {
    return { sessionId: "s", workspace: "/tmp/acme" };
  }
  async openRoom(args: { channelId: string }) {
    return { channelId: args.channelId };
  }
  async changeRoomMembers() {
    return { added: [], removed: [] };
  }
  notifyProject(_projectId: string, _event: ServerEvent): void {}
}

describe("through the Action routes", () => {
  let root: string;
  let gateway: Gateway;
  let service: ProposalService;
  const opened: ActionApp[] = [];
  const qa: OrgActor = { userId: "boss", agentId: "acme_qa", sessionId: "desk-qa" };
  const dev: OrgActor = { userId: "boss", agentId: "acme_dev", sessionId: "desk-dev" };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "proposals-builtin-"));
    gateway = new Gateway();
    gateway.org.workspace = root;
    // The file DOC's scope names.
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "notices.ts"), "export {};\n");
    const mirror = new FakeMirror();
    service = new ProposalService({
      gateway,
      agents: {
        pluginVersion: async () => ({ installed: null, library: null }),
        updatePlugin: async () => {},
      },
      root,
      log: { line: () => undefined },
      forge: new FakeForge(),
      mirrorFor: () => mirror,
      git: async () => "",
    });
  });
  afterEach(async () => {
    for (const h of opened.splice(0)) h.registry.stop();
    service.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  const app = (extra: Contributed[] = []): ActionApp => {
    const h = actionApp({
      gateway,
      root,
      project: PROJECT,
      org: ORG,
      contributions: [...proposalContributions(service), ...extra],
      service,
    });
    opened.push(h);
    return h;
  };

  it("lets an employee do what a person does: create, publish, approve", async () => {
    const h = app();
    const created = await h.run(
      "proposal.create",
      "organization",
      { author: "acme_dev", brief: "Batch the notices" },
      qa,
    );
    expect(created.status).toBe(200);
    const number = (created.body.result as { number: number }).number;
    expect(created.body.result).toMatchObject({ delegatedBy: "agent:acme_qa" });
    expect(
      (await h.run("proposal.publish", `proposal:${number}`, { markdown: DOC }, dev)).status,
    ).toBe(200);
    const approved = await h.run("proposal.approve", `proposal:${number}`, {}, qa);
    expect(approved.status).toBe(200);
    expect(approved.body.result).toMatchObject({ status: "approved", approvedRevision: 1 });
    // A default rule still refuses, with its code and the run it recorded.
    const again = await h.run("proposal.approve", `proposal:${number}`, {}, qa);
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: "proposal_status", runId: expect.any(String) });
  });

  it("a replaced guard lets the same write through, and the history stays append-only", async () => {
    // Approving a proposal with no revision: refused by the default …
    const created = await service.create(
      PROJECT,
      ORG,
      { author: "acme_dev", brief: "x" },
      { userId: "boss" },
    );
    const subject = `proposal:${created.number}`;
    const allowEmpty: GuardCode = (defaults) => (input) => {
      const p = input.state as Proposal | null;
      if (p !== null && p.revision === 0) return;
      defaults(input);
    };
    const company: Contributed = {
      id: "acme.guard.approve-empty",
      from: "Workflow",
      data: { kind: "guard", key: "proposal.approve" },
      code: allowEmpty,
      workflow: "acme",
    };
    const refused = await app().run("proposal.approve", subject, {}, qa);
    expect(refused.body.error).toMatchObject({ code: "proposal_empty" });
    // … and let through once a company workflow's guard takes the default's place.
    const approved = await app([company]).run("proposal.approve", subject, {}, qa);
    expect(approved.status).toBe(200);
    expect(approved.body.result).toMatchObject({ status: "approved", approvedRevision: 0 });
    const store = SqliteProposalStore.open(companyDbPath(root, PROJECT, ORG));
    try {
      expect(store.get(created.number)!.events.map((e) => [e.kind, e.by])).toEqual([
        ["created", "user:boss"],
        ["approved", "agent:acme_qa"],
      ]);
      expect(() => store.db.prepare(`UPDATE proposal_events SET by = 'x'`).run()).toThrow(
        /history_append_only/,
      );
    } finally {
      store.close();
    }
  });
});
