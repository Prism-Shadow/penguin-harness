/**
 * The default rules (guards.ts), one by one, with the codes the routes answer: revision numbers,
 * terminal states, what an approval covers, one impl per PR and per head, comments frozen once
 * sent, the idempotent creation from a roadmap item, and the rules that still tell a person from
 * an employee. Then the seam: a rule replaced changes what the store lets through, and the
 * history is still only appended to.
 */
import { describe, expect, it } from "vitest";
import type { ProposalComment } from "@prismshadow/penguin-server/api";
import { SqliteProposalStore, defaultRules, type Caller, type Proposal } from "../src/index.js";
import type { ProposalTx } from "../src/ports.js";

const person: Caller = { principal: "user:boss", agentId: null, userId: "boss" };
const authorAgent: Caller = { principal: "agent:acme_dev", agentId: "acme_dev", userId: "boss" };
const other: Caller = { principal: "agent:acme_qa", agentId: "acme_qa", userId: "boss" };

function proposal(fields: Partial<Proposal> = {}): Proposal {
  return {
    number: 7,
    title: "T",
    status: "drafting",
    revision: 1,
    author: "acme_dev",
    implementer: null,
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

const comment = (fields: Partial<ProposalComment>): ProposalComment => ({
  id: "c1",
  sectionId: "s",
  range: { start: 0, end: 1 },
  quote: "x",
  revision: 1,
  text: "t",
  by: "user:boss",
  at: "",
  batchId: null,
  ...fields,
});

function refusal(run: () => unknown): { status: number; code: string } | null {
  try {
    run();
    return null;
  } catch (err) {
    const e = err as { status: number; code: string };
    return { status: e.status, code: e.code };
  }
}

describe("the default rules", () => {
  it("number revisions one after another, and refuse a rejected proposal's", () => {
    expect(refusal(() => defaultRules.revision(proposal({ revision: 2 }), 3))).toBeNull();
    expect(refusal(() => defaultRules.revision(proposal({ revision: 2 }), 4))).toEqual({
      status: 409,
      code: "revision_conflict",
    });
    expect(refusal(() => defaultRules.publish(proposal({ status: "rejected" }), person))).toEqual({
      status: 409,
      code: "proposal_closed",
    });
    expect(refusal(() => defaultRules.publish(proposal(), other))).toEqual({
      status: 403,
      code: "not_author",
    });
  });

  it("let an approval cover one revision: a publish after it is ready again", () => {
    expect(defaultRules.approve(proposal({ status: "ready", revision: 3 }), person)).toEqual({
      approvedRevision: 3,
    });
    expect(
      defaultRules.afterPublish(proposal({ status: "approved", revision: 3, approvedRevision: 3 })),
    ).toEqual({
      status: "ready",
      reason: "revision 4 — approval of revision 3 no longer covers it",
    });
    expect(defaultRules.afterPublish(proposal({ status: "drafting" }))).toEqual({
      status: "drafting",
      reason: null,
    });
  });

  it("keep merged and rejected terminal", () => {
    for (const status of ["merged", "rejected"] as const) {
      expect(refusal(() => defaultRules.reject(proposal({ status })))).toEqual({
        status: 409,
        code: "proposal_status",
      });
      expect(refusal(() => defaultRules.implement(proposal({ status }), person))).toEqual({
        status: 409,
        code: "proposal_status",
      });
      expect(refusal(() => defaultRules.merged(proposal({ status }), person))).toEqual({
        status: 409,
        code: "proposal_status",
      });
    }
  });

  it("give a PR to one proposal, and a head to one proposal that is not rejected", () => {
    const tx = (
      byPr: number[],
      byHead: Array<{ number: number; status: Proposal["status"] }>,
    ): ProposalTx => ({
      implsByPr: () => byPr,
      implsByHead: () => byHead,
    });
    const head = { remote: "acme/site", branch: "feat" };
    const pr = { key: "acme/site#1", label: "acme/site#1" };
    expect(refusal(() => defaultRules.implUnique(7, { head: null, pr }, tx([3], [])))).toEqual({
      status: 409,
      code: "impl_pr_taken",
    });
    expect(refusal(() => defaultRules.implUnique(7, { head: null, pr }, tx([7], [])))).toBeNull();
    expect(
      refusal(() =>
        defaultRules.implUnique(7, { head, pr: null }, tx([], [{ number: 3, status: "ready" }])),
      ),
    ).toEqual({ status: 409, code: "impl_branch_taken" });
    expect(
      refusal(() =>
        defaultRules.implUnique(7, { head, pr: null }, tx([], [{ number: 3, status: "rejected" }])),
      ),
    ).toBeNull();
  });

  it("freeze a comment once it is sent, keep a pending one its writer's, and resolve once", () => {
    const sent = proposal({ comments: [comment({ batchId: "b1" })] });
    expect(refusal(() => defaultRules.editComment(sent, person, "c1"))).toEqual({
      status: 409,
      code: "comment_sent",
    });
    const pending = proposal({ comments: [comment({ by: "user:other" })] });
    expect(refusal(() => defaultRules.deleteComment(pending, person, "c1"))).toEqual({
      status: 403,
      code: "not_commenter",
    });
    const resolved = proposal({
      comments: [comment({ batchId: "b1", resolved: { by: "agent:acme_dev", at: "", text: "" } })],
    });
    expect(refusal(() => defaultRules.resolve(resolved, authorAgent, "c1"))).toEqual({
      status: 409,
      code: "comment_resolved",
    });
  });

  it("key a creation from a roadmap item by its brief", () => {
    expect(defaultRules.createKey("a")).toBe(defaultRules.createKey("a"));
    expect(defaultRules.createKey("a")).not.toBe(defaultRules.createKey("b"));
  });

  it("still tell a person from an employee where they always did", () => {
    expect(refusal(() => defaultRules.create(authorAgent))).toEqual({
      status: 403,
      code: "roadmap_only",
    });
    expect(refusal(() => defaultRules.approve(proposal({ status: "ready" }), authorAgent))).toEqual(
      {
        status: 403,
        code: "person_required",
      },
    );
    expect(refusal(() => defaultRules.comment(authorAgent))).toEqual({
      status: 403,
      code: "person_required",
    });
    expect(refusal(() => defaultRules.discuss(proposal(), authorAgent))).toEqual({
      status: 403,
      code: "person_required",
    });
    // The author answers a batch before its ready; a person need not.
    const asked = proposal({
      openBatches: [{ id: "b1", revision: 1, commentIds: ["c1"] }],
      comments: [comment({ batchId: "b1" })],
    });
    expect(refusal(() => defaultRules.ready(asked, authorAgent))).toEqual({
      status: 409,
      code: "changes_pending",
    });
    expect(refusal(() => defaultRules.ready(asked, person))).toBeNull();
    // Merged on the forge's word for anybody but a person and the implementer.
    const approved = proposal({ status: "approved", implementer: "acme_impl" });
    expect(defaultRules.merged(approved, person)).toEqual({ confirmWithForge: false });
    expect(defaultRules.merged(approved, other)).toEqual({ confirmWithForge: true });
  });
});

describe("a rule replaced", () => {
  it("lets through what the default refused, and the history is still only appended to", () => {
    const store = SqliteProposalStore.open(":memory:");
    const { number } = store.create(() => ({
      title: "T",
      author: "acme_dev",
      delegatedBy: "user:boss",
      brief: "B",
    }));
    const rules = { ...defaultRules, approve: (p: Proposal) => ({ approvedRevision: p.revision }) };
    const approve = (r: typeof defaultRules) =>
      store.setStatus(number, (p) => ({
        status: "approved",
        ...r.approve(p, authorAgent),
        by: authorAgent.principal,
      }));
    expect(refusal(() => approve(defaultRules))).toEqual({ status: 403, code: "person_required" });
    expect(store.get(number)!.events.map((e) => e.kind)).toEqual(["created"]);
    const written = approve(rules);
    expect(written.proposal.status).toBe("approved");
    expect(written.proposal.events.map((e) => [e.kind, e.by])).toEqual([
      ["created", "user:boss"],
      ["approved", "agent:acme_dev"],
    ]);
    expect(() => store.db.prepare(`DELETE FROM proposal_events`).run()).toThrow(
      /history_append_only/,
    );
    store.close();
  });
});
