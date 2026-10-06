/**
 * The default guards and process rules (guards.ts), one by one, with the codes the Action routes
 * answer: revision numbers, terminal states, what an approval covers, one impl per PR and per
 * head, comments frozen once sent, the idempotent creation from a roadmap item, and who reports a
 * merge on their word. Then the seam: a guard replaced changes what the store lets through, and
 * the history is still only appended to.
 */
import { describe, expect, it } from "vitest";
import type { ProposalComment } from "@prismshadow/penguin-server/api";
import {
  SqliteProposalStore,
  afterPublish,
  batchOf,
  createKey,
  defaultAct,
  mergedOnWord,
  proposalGuards,
  type Caller,
  type Guard,
  type ImplGraphFacts,
  type Proposal,
  type Subject,
} from "../src/index.js";
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

const subjectOf = (text: string): Subject => {
  const at = text.indexOf(":");
  const prefix = text.slice(0, at);
  return {
    kind: (prefix === "pr" ? "change_request" : prefix) as Subject["kind"],
    id: text.slice(at + 1),
    text,
  };
};

/** Asks the default guard of `key`. */
function ask(
  key: string,
  state: Proposal | null,
  caller: Caller,
  opts: { subject?: string; params?: Record<string, unknown>; tx?: ProposalTx } = {},
): void {
  const guard: Guard = proposalGuards[key]!;
  guard({
    caller,
    subject: subjectOf(opts.subject ?? `proposal:${state?.number ?? 7}`),
    state,
    params: opts.params ?? {},
    running: 0,
    ...(opts.tx !== undefined ? { tx: opts.tx } : {}),
  });
}

describe("the default rules", () => {
  it("number revisions one after another, and refuse a rejected proposal's", () => {
    const p = proposal({ revision: 2 });
    expect(
      refusal(() => ask("proposal.publish", p, other, { params: { revision: 3 } })),
    ).toBeNull();
    expect(refusal(() => ask("proposal.publish", p, other, { params: { revision: 4 } }))).toEqual({
      status: 409,
      code: "revision_conflict",
    });
    expect(
      refusal(() => ask("proposal.publish", proposal({ status: "rejected" }), person)),
    ).toEqual({ status: 409, code: "proposal_closed" });
  });

  it("let an approval cover one revision: a publish after it is ready again", () => {
    expect(refusal(() => ask("proposal.approve", proposal({ status: "ready" }), other))).toBeNull();
    expect(refusal(() => ask("proposal.approve", proposal({ revision: 0 }), person))).toEqual({
      status: 409,
      code: "proposal_empty",
    });
    expect(
      afterPublish(proposal({ status: "approved", revision: 3, approvedRevision: 3 })),
    ).toEqual({
      status: "ready",
      reason: "revision 4 — approval of revision 3 no longer covers it",
    });
    expect(afterPublish(proposal({ status: "drafting" }))).toEqual({
      status: "drafting",
      reason: null,
    });
  });

  it("keep merged and rejected terminal", () => {
    for (const status of ["merged", "rejected"] as const) {
      for (const key of [
        "proposal.reject",
        "proposal.implement",
        "proposal.merged",
        "proposal.discuss",
      ]) {
        expect(
          refusal(() => ask(key, proposal({ status }), person)),
          key,
        ).toEqual({
          status: 409,
          code: "proposal_status",
        });
      }
    }
  });

  it("give a PR to one proposal, and a head to one proposal that is not rejected", () => {
    const tx = (
      byPr: number[],
      byHead: Array<{ number: number; status: Proposal["status"] }>,
    ): ProposalTx => ({
      implsByPr: () => byPr,
      implsByHead: () => byHead,
      implsOnBranch: () => [],
    });
    const head = { remote: "acme/site", branch: "feat" };
    const pr = { key: "acme/site#1", label: "acme/site#1" };
    const impl = (planned: unknown, t: ProposalTx) =>
      refusal(() => ask("proposal.impl", proposal(), other, { params: { planned }, tx: t }));
    expect(impl({ head: null, pr }, tx([3], []))).toEqual({ status: 409, code: "impl_pr_taken" });
    expect(impl({ head: null, pr }, tx([7], []))).toBeNull();
    expect(impl({ head, pr: null }, tx([], [{ number: 3, status: "ready" }]))).toEqual({
      status: 409,
      code: "impl_branch_taken",
    });
    expect(impl({ head, pr: null }, tx([], [{ number: 3, status: "rejected" }]))).toBeNull();
    // Before the write there is no transaction to look in: nothing is refused yet.
    expect(
      refusal(() =>
        ask("proposal.impl", proposal(), other, { params: { planned: { head: null, pr } } }),
      ),
    ).toBeNull();
  });

  describe("keep an impl drawable on the PR graph", () => {
    type Impl = { number: number; status: Proposal["status"]; repo: string };
    /** The other impls on each branch, by side. */
    const tx = (heads: Record<string, Impl[]>, bases: Record<string, Impl[]> = {}): ProposalTx => ({
      implsByPr: () => [],
      implsByHead: () => [],
      implsOnBranch: (side, branch) => (side === "head" ? heads : bases)[branch] ?? [],
    });
    const facts = (over: Partial<ImplGraphFacts> = {}): ImplGraphFacts => ({
      baseBranch: "dev",
      repos: ["acme/site", "me/site"],
      openHeads: ["feat/open"],
      declaredBase: true,
      pr: null,
      ...over,
    });
    const head = { remote: "fork", branch: "feat/x" };
    const base = (branch: string, repo = "acme/site") => ({ remote: "origin", repo, branch });
    const register = (
      planned: Record<string, unknown>,
      f: ImplGraphFacts,
      t: ProposalTx,
      state = proposal(),
    ) =>
      refusal(() => ask("proposal.impl", state, other, { params: { planned, facts: f }, tx: t }));
    const live = (number: number, status: Proposal["status"] = "ready"): Impl => ({
      number,
      status,
      repo: "acme/site",
    });

    it("take a base that is the base branch, a live impl head or an open PR's head", () => {
      const pr = null;
      expect(register({ head, base: base("dev"), pr }, facts(), tx({}))).toBeNull();
      expect(
        register({ head, base: base("feat/a"), pr }, facts(), tx({ "feat/a": [live(3)] })),
      ).toBeNull();
      expect(register({ head, base: base("feat/open"), pr }, facts(), tx({}))).toBeNull();
    });

    it("refuse any other base, a merged or rejected impl's head, or one on another repository", () => {
      const pr = null;
      const notOnGraph = { status: 400, code: "base_not_on_graph" };
      expect(register({ head, base: base("gone"), pr }, facts(), tx({}))).toEqual(notOnGraph);
      for (const status of ["merged", "rejected"] as const) {
        expect(
          register(
            { head, base: base("feat/a"), pr },
            facts(),
            tx({ "feat/a": [live(3, status)] }),
          ),
        ).toEqual(notOnGraph);
      }
      // Its own head is not a base it stacks on.
      expect(
        register({ head, base: base("feat/a"), pr }, facts(), tx({ "feat/a": [live(7)] })),
      ).toEqual(notOnGraph);
      expect(register({ head, base: base("dev", "else/where"), pr }, facts(), tx({}))).toEqual(
        notOnGraph,
      );
    });

    it("judge only a base the request names and that changes", () => {
      const pr = null;
      // A base GitHub reported for the PR is the PR's fact.
      expect(
        register({ head, base: base("gone"), pr }, facts({ declaredBase: false }), tx({})),
      ).toBeNull();
      // The base already registered is not judged again.
      const standing = proposal({
        impl: { head: { ...head, repo: "me/site" }, base: base("gone"), pr: null, by: "", at: "" },
      });
      expect(register({ head, base: base("gone"), pr }, facts(), tx({}), standing)).toBeNull();
      // Without the facts (an adoption, a direct use case) the rule is not asked.
      expect(
        refusal(() =>
          ask("proposal.impl", proposal(), other, {
            params: { planned: { head, base: base("gone"), pr } },
            tx: tx({}),
          }),
        ),
      ).toBeNull();
    });

    it("without a graph read yet, judge by the base branch and the impl heads alone", () => {
      const pr = null;
      const unread = facts({ openHeads: null });
      expect(register({ head, base: base("feat/open"), pr }, unread, tx({}))).toEqual({
        status: 400,
        code: "base_not_on_graph",
      });
      expect(register({ head, base: base("dev"), pr }, unread, tx({}))).toBeNull();
      expect(
        register({ head, base: base("feat/a"), pr }, unread, tx({ "feat/a": [live(3)] })),
      ).toBeNull();
    });

    it("refuse a merged PR whose head branch a live proposal still stacks on", () => {
      const pr = { key: "acme/site#20", label: "acme/site#20" };
      const planned = { head, base: base("dev"), pr };
      const merged = facts({ pr: { merged: true, branch: "feat/x" } });
      const bases = { "feat/x": [live(8), live(9, "merged")] };
      expect(register(planned, merged, tx({}, bases))).toEqual({
        status: 409,
        code: "base_in_use",
      });
      // Nobody live stacks on it, the PR is open, or its status or branch is unknown: allowed.
      expect(register(planned, merged, tx({}, { "feat/x": [live(9, "rejected")] }))).toBeNull();
      for (const known of [
        { merged: false, branch: "feat/x" },
        { merged: null, branch: "feat/x" },
        { merged: true, branch: null },
      ]) {
        expect(register(planned, facts({ pr: known }), tx({}, bases))).toBeNull();
      }
    });
  });

  it("freeze a comment once it is sent, keep a pending one its writer's, and resolve once", () => {
    const sent = proposal({ comments: [comment({ batchId: "b1" })] });
    expect(
      refusal(() => ask("proposal.comment.edit", sent, person, { subject: "comment:7/c1" })),
    ).toEqual({ status: 409, code: "comment_sent" });
    const pending = proposal({ comments: [comment({ by: "user:other" })] });
    expect(
      refusal(() => ask("proposal.comment.withdraw", pending, person, { subject: "comment:7/c1" })),
    ).toEqual({ status: 403, code: "not_commenter" });
    const resolved = proposal({
      comments: [comment({ batchId: "b1", resolved: { by: "agent:acme_dev", at: "", text: "" } })],
    });
    expect(
      refusal(() => ask("proposal.resolve", resolved, other, { subject: "comment:7/c1" })),
    ).toEqual({ status: 409, code: "comment_resolved" });
    expect(
      refusal(() => ask("proposal.resolve", proposal(), other, { subject: "comment:7/c1" })),
    ).toEqual({ status: 404, code: "comment_not_found" });
  });

  it("send the caller's pending comments as one batch, and refuse a batch of none", () => {
    const p = proposal({
      status: "ready",
      comments: [comment({}), comment({ id: "c2", by: "agent:acme_qa" })],
    });
    expect(batchOf(p, person)).toEqual({ commentIds: ["c1"], status: "drafting", batchId: "b1" });
    expect(batchOf(p, other).commentIds).toEqual(["c2"]);
    expect(refusal(() => batchOf(proposal(), person))).toEqual({
      status: 400,
      code: "bad_request",
    });
  });

  it("key a creation from a roadmap item by its brief", () => {
    expect(createKey("a")).toBe(createKey("a"));
    expect(createKey("a")).not.toBe(createKey("b"));
  });

  it("ask the author, and only the author, to answer a batch before its ready", () => {
    const asked = proposal({
      openBatches: [{ id: "b1", revision: 1, commentIds: ["c1"] }],
      comments: [comment({ batchId: "b1" })],
    });
    expect(refusal(() => ask("proposal.ready", asked, authorAgent))).toEqual({
      status: 409,
      code: "changes_pending",
    });
    expect(refusal(() => ask("proposal.ready", asked, person))).toBeNull();
    expect(refusal(() => ask("proposal.ready", asked, other))).toBeNull();
  });

  it("take a merge on the word of the implementer and of whoever approved the revision", () => {
    const approved = proposal({
      status: "approved",
      implementer: "acme_impl",
      approvedRevision: 1,
      events: [{ seq: 2, at: "", kind: "approved", by: "agent:acme_qa", revision: 1 }],
    });
    const implementer: Caller = {
      principal: "agent:acme_impl",
      agentId: "acme_impl",
      userId: "boss",
    };
    expect(mergedOnWord(approved, implementer)).toBe(true);
    expect(mergedOnWord(approved, other)).toBe(true);
    expect(mergedOnWord(approved, person)).toBe(false);
    expect(mergedOnWord(approved, authorAgent)).toBe(false);
  });

  it("answer a direct call with the default guard of its key", () => {
    const act = defaultAct("proposal.approve", authorAgent, subjectOf("proposal:7"));
    expect(refusal(() => act.check(proposal({ status: "ready" })))).toBeNull();
    expect(refusal(() => act.check(proposal({ status: "merged" })))).toEqual({
      status: 409,
      code: "proposal_status",
    });
  });
});

describe("a guard replaced", () => {
  it("lets through what the default refused, and the history is still only appended to", () => {
    const store = SqliteProposalStore.open(":memory:");
    const { number } = store.create(() => ({
      title: "T",
      author: "acme_dev",
      delegatedBy: "user:boss",
      brief: "B",
    }));
    // No revision yet: the default refuses the approval; a replacement that allows it does not.
    const approve = (guard: Guard) =>
      store.setStatus(number, (p) => {
        guard({
          caller: authorAgent,
          subject: subjectOf(`proposal:${number}`),
          state: p,
          params: {},
          running: 0,
        });
        return { status: "approved", approvedRevision: p.revision, by: authorAgent.principal };
      });
    expect(refusal(() => approve(proposalGuards["proposal.approve"]!))).toEqual({
      status: 409,
      code: "proposal_empty",
    });
    expect(store.get(number)!.events.map((e) => e.kind)).toEqual(["created"]);
    const written = approve(() => undefined);
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
