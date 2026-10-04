/**
 * The proposal notices (notify-actions.ts): each write, once it committed, runs its notify Action
 * by key exactly once — as the same caller, `via: "notify"`, its run's id as `runId` — and the
 * built-in one puts the same line as before on the same desks. A company workflow's `action` on
 * the key replaces it: the desk hears nothing and the Activity names the company's contribution.
 * A notice refused by a guard or failing in its replacement never fails the write, which lists it
 * in `hookErrors`; a desk the built-in one cannot reach is recorded `notify_failed` as before.
 * Also: an `action_runs` table from before notices is widened to take their runs.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ACTION_SCHEMA,
  ActionRefusal,
  ActionStore,
  PROPOSAL_NOTICE_IDS,
  noticeKey,
  openCompanyDb,
  type ActionCode,
  type Contributed,
  type GuardCode,
  type ProposalNoticeEvent,
} from "../src/index.js";
import { actionApp, proposalContributions, type ActionApp } from "./action-harness.js";
import { BOSS, DEV, DOC, IMPL, ORG, PROJECT, QA, fakeOrg } from "./fake-org.js";

interface RunView {
  id: string;
  key: string;
  contribution: string;
  subject: string;
  params: Record<string, unknown>;
  by: string;
  via: string;
  outcome: string | null;
  code: string | null;
  result: unknown;
  hookErrors: string[];
}

const NOTICE_PARAMS = { to: "string[]", text: "string", runId: "string" };

describe("proposal notices", () => {
  let org: Awaited<ReturnType<typeof fakeOrg>>;
  let company: Contributed[];
  let h: ActionApp;

  beforeEach(async () => {
    org = await fakeOrg();
    // Each session its own id: an implementation and a discussion are both opened here.
    let opened = 0;
    org.gateway.openEmployeeSession = async () => ({
      sessionId: `session-${++opened}`,
      workspace: org.gateway.org.workspace,
    });
    company = [];
    h = actionApp({
      gateway: org.gateway,
      root: org.root,
      project: PROJECT,
      org: ORG,
      contributions: proposalContributions(org.service),
      service: org.service,
      deps: { company: { contributions: async () => company } },
    });
  });
  afterEach(async () => {
    h.registry.stop();
    await org.cleanup();
  });

  const svc = () => org.service;
  const runsOf = async (key: string): Promise<RunView[]> =>
    (await h.get(`/runs?key=${encodeURIComponent(key)}`)).body.runs as RunView[];
  /** A proposal delegated to acme_dev, written directly (no notices). */
  const delegated = async (): Promise<number> =>
    (await svc().create(PROJECT, ORG, { author: "acme_dev", brief: "Batch the notices" }, BOSS))
      .number;
  const readied = async (): Promise<number> => {
    const n = await delegated();
    await svc().publish(PROJECT, ORG, n, DOC, DEV);
    await svc().ready(PROJECT, ORG, n, DEV);
    return n;
  };

  /**
   * Runs `key` on `subject` and checks it sent exactly one notice of `event`, recorded as the
   * same caller's, and that the desks took exactly `lines` (in order) during it.
   */
  async function expectNotice(
    run: () => Promise<{ status: number; body: Record<string, unknown> }>,
    event: ProposalNoticeEvent,
    lines: Array<{ agentId: string; text: string | RegExp }>,
  ): Promise<RunView> {
    const mark = org.gateway.desks.length;
    const answer = await run();
    expect(answer.status).toBe(200);
    const sender = answer.body.run as RunView;
    expect(sender.hookErrors).toEqual([]);
    const sent = (await runsOf(noticeKey(event))).filter((r) => r.params.runId === sender.id);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      contribution: PROPOSAL_NOTICE_IDS[event],
      by: sender.by,
      via: "notify",
      outcome: "succeeded",
      params: { to: lines.map((l) => l.agentId) },
    });
    expect(org.gateway.desks.slice(mark)).toEqual(
      lines.map((l) => ({
        agentId: l.agentId,
        text: typeof l.text === "string" ? l.text : expect.stringMatching(l.text),
      })),
    );
    return sent[0]!;
  }

  it("each write runs its notify Action once it committed; the built-in one tells the same desks the same line", async () => {
    // created: the author.
    const created = await expectNotice(
      () =>
        h.run("proposal.create", "organization", {
          author: "acme_dev",
          brief: "Batch the notices",
        }),
      "created",
      [
        {
          agentId: "acme_dev",
          text: /^\[proposal #1\] boss asks you to write it: Batch the notices\n/,
        },
      ],
    );
    expect(created.subject).toBe("proposal:1");

    // brief_edited: the author, while drafting.
    await expectNotice(
      () => h.run("proposal.brief", "proposal:1", { brief: "Batch them all" }),
      "brief_edited",
      [{ agentId: "acme_dev", text: /^\[proposal #1\] boss rewrote the brief: Batch them all\n/ }],
    );

    // feedback: the author; runtime feedback the implementer too.
    await expectNotice(
      () => h.run("proposal.feedback", "proposal:1", { text: "Too wide." }, QA),
      "feedback",
      [{ agentId: "acme_dev", text: /^\[proposal #1\] feedback from acme_qa: Too wide\.\n/ }],
    );

    // changes_requested: the author.
    const n = await readied();
    const detail = await svc().get(PROJECT, ORG, n, BOSS);
    const section = detail.sections[0]!;
    await svc().comment(
      PROJECT,
      ORG,
      n,
      { sectionId: section.id, start: 0, end: 5, quote: "Batch", text: "Which ones?" },
      BOSS,
    );
    await expectNotice(
      () => h.run("proposal.requestChanges", `proposal:${n}`),
      "changes_requested",
      [
        {
          agentId: "acme_dev",
          text: /^\[proposal #2\] boss requested changes: a batch of 1 comment /,
        },
      ],
    );

    // approved: the author while nobody builds it.
    const a = await readied();
    await expectNotice(() => h.run("proposal.approve", `proposal:${a}`), "approved", [
      {
        agentId: "acme_dev",
        text: /^\[proposal #3\] approved by boss with nobody building it yet/,
      },
    ]);

    // revised_after_approval: the implementer; rejected: the author and the implementer.
    const r = await readied();
    await svc().implement(PROJECT, ORG, r, { agentId: "acme_impl" }, BOSS);
    await svc().approve(PROJECT, ORG, r, BOSS);
    await expectNotice(
      () => h.run("proposal.publish", `proposal:${r}`, { markdown: DOC }, DEV),
      "revised_after_approval",
      [
        {
          agentId: "acme_impl",
          text: "[proposal #4] revised after approval (revision 1 → 2) — wait for a new approval before merging.",
        },
      ],
    );
    await expectNotice(
      () => h.run("proposal.reject", `proposal:${r}`, { reason: "A duplicate." }),
      "rejected",
      [
        { agentId: "acme_dev", text: /^\[proposal #4\] rejected by boss: A duplicate\. — / },
        { agentId: "acme_impl", text: /^\[proposal #4\] rejected by boss: A duplicate\. — / },
      ],
    );

    // discussion_concluded: the owner, on the discussion — before the conclusion is recorded.
    const d = await delegated();
    const { sessionId } = await svc().discuss(PROJECT, ORG, d, BOSS);
    const concluded = await expectNotice(
      () => h.run("proposal.conclude", `discussion:${d}/${sessionId}`, { text: "Ship it." }),
      "discussion_concluded",
      [
        {
          agentId: "acme_dev",
          text: /^\[proposal #5\] the discussion with boss concluded \(session [^)]+\):\n\nShip it\.\n/,
        },
      ],
    );
    expect(concluded.subject).toBe(`discussion:${d}/${sessionId}`);
    // Eight writes in a row, each with its notice: more than the default 5 s on a loaded machine.
  }, 30_000);

  it("the caller's own employee is never told of its own act, and a write that tells nobody sends no notice", async () => {
    const n = await delegated();
    const mark = org.gateway.desks.length;
    const ran = await h.run("proposal.brief", `proposal:${n}`, { brief: "Mine now" }, DEV);
    expect(ran.status).toBe(200);
    expect(org.gateway.desks.length).toBe(mark);
    expect(await runsOf("notify.proposal.brief_edited")).toEqual([]);
  });

  it("a company workflow's action on the key replaces the built-in one: the desk hears nothing, the Activity names the company's", async () => {
    const seen: Array<Record<string, unknown>> = [];
    company = [
      {
        id: "quiet.approved",
        from: "Workflow",
        workflow: "quiet",
        data: {
          kind: "action",
          key: "notify.proposal.approved",
          subjects: ["proposal"],
          params: NOTICE_PARAMS,
        },
        code: {
          run: async (ctx) => {
            seen.push(ctx.params);
            return { forwarded: true };
          },
        } satisfies ActionCode,
      },
    ];
    const n = await readied();
    const mark = org.gateway.desks.length;
    const approved = await h.run("proposal.approve", `proposal:${n}`);
    expect(approved.status).toBe(200);
    expect(org.gateway.desks.length).toBe(mark);
    const runId = (approved.body.run as RunView).id;
    expect(seen).toEqual([
      { to: ["acme_dev"], text: expect.stringMatching(/^\[proposal #1\] approved by boss/), runId },
    ]);
    expect(await runsOf("notify.proposal.approved")).toMatchObject([
      {
        contribution: "quiet.approved",
        via: "notify",
        outcome: "succeeded",
        result: { forwarded: true },
      },
    ]);
    // The other notices stay built-in.
    await h.run("proposal.reject", `proposal:${n}`, { reason: "Not now." });
    expect(org.gateway.desks.slice(mark).map((x) => x.agentId)).toEqual(["acme_dev"]);
  });

  it("a notice refused by a guard, or failing in its replacement, never fails the write: it is listed in hookErrors", async () => {
    company = [
      {
        id: "quiet.no",
        from: "Workflow",
        workflow: "quiet",
        data: { kind: "guard", key: "notify.proposal.approved" },
        code: (() => () => {
          throw new ActionRefusal(403, "quiet_hours", "Not during quiet hours.");
        }) as GuardCode,
      },
      {
        id: "broken.rejected",
        from: "Workflow",
        workflow: "broken",
        data: {
          kind: "action",
          key: "notify.proposal.rejected",
          subjects: ["proposal"],
          params: NOTICE_PARAMS,
        },
        code: {
          run: async () => {
            throw new Error("the forwarder is down");
          },
        } satisfies ActionCode,
      },
    ];
    const n = await readied();
    const mark = org.gateway.desks.length;
    const approved = await h.run("proposal.approve", `proposal:${n}`);
    expect(approved.status).toBe(200);
    expect(approved.body.run).toMatchObject({
      outcome: "succeeded",
      hookErrors: ["notify.proposal.approved: Not during quiet hours."],
    });
    expect(approved.body.result).toMatchObject({
      status: "approved",
      hints: [expect.stringMatching(/^notify\.proposal\.approved did not run: /)],
    });
    expect(await runsOf("notify.proposal.approved")).toMatchObject([
      { outcome: "refused", code: "quiet_hours" },
    ]);
    const rejected = await h.run("proposal.reject", `proposal:${n}`, { reason: "Not now." });
    expect(rejected.status).toBe(200);
    expect(rejected.body.run).toMatchObject({
      outcome: "succeeded",
      hookErrors: [expect.stringMatching(/^notify\.proposal\.rejected: /)],
    });
    expect((await svc().get(PROJECT, ORG, n, BOSS)).status).toBe("rejected");
    expect(await runsOf("notify.proposal.rejected")).toMatchObject([{ outcome: "failed" }]);
    expect(org.gateway.desks.length).toBe(mark);
  });

  it("a desk the built-in notice cannot reach is recorded notify_failed and answered as a hint; the write and the notice succeed", async () => {
    const n = await delegated();
    org.gateway.deliverToDesk = async (_p, _o, agentId) => {
      throw Object.assign(new Error(`${agentId} is paused by its budget.`), {
        status: 409,
        code: "employee_paused",
      });
    };
    const fed = await h.run("proposal.feedback", `proposal:${n}`, { text: "Narrower." }, QA);
    expect(fed.status).toBe(200);
    expect(fed.body.run).toMatchObject({ outcome: "succeeded", hookErrors: [] });
    expect(fed.body.result).toMatchObject({
      hints: ["agent:acme_dev not notified: acme_dev is paused by its budget."],
    });
    expect(await runsOf("notify.proposal.feedback")).toMatchObject([
      {
        outcome: "succeeded",
        result: {
          delivered: [],
          failed: [
            {
              agentId: "acme_dev",
              error: "acme_dev is paused by its budget.",
              code: "employee_paused",
            },
          ],
        },
      },
    ]);
    expect((await svc().get(PROJECT, ORG, n, BOSS)).events.at(-1)).toMatchObject({
      kind: "notify_failed",
      by: "agent:acme_qa",
      text: "agent:acme_dev not notified: acme_dev is paused by its budget.",
    });
    // A conclusion that did not reach the desk is refused with the desk's code; the discussion stays open.
    org.gateway.deliverToDesk = async () => ({ sessionId: "desk", queued: false });
    const { sessionId } = await svc().discuss(PROJECT, ORG, n, BOSS);
    org.gateway.deliverToDesk = async () => {
      throw Object.assign(new Error("no desk"), { status: 409, code: "desk_unavailable" });
    };
    const refused = await h.run("proposal.conclude", `discussion:${n}/${sessionId}`, {
      text: "Ship it.",
    });
    expect([refused.status, refused.body.error]).toMatchObject([409, { code: "desk_unavailable" }]);
    expect((await svc().get(PROJECT, ORG, n, BOSS)).discussions[0]!.concluded).toBeNull();
  });

  it("a notify Action does not run on its own, and the listing says so", async () => {
    const n = await delegated();
    const mark = org.gateway.desks.length;
    const direct = await h.run(
      "notify.proposal.approved",
      `proposal:${n}`,
      { to: ["acme_dev"], text: "[proposal #1] approved by boss", runId: "x" },
      IMPL,
    );
    expect([direct.status, direct.body.error]).toMatchObject([403, { code: "notify_direct" }]);
    expect(org.gateway.desks.length).toBe(mark);
    const listed = (await h.get(`/?subject=proposal:${n}`)).body.actions as Array<{
      key: string;
      allowed?: boolean;
    }>;
    expect(listed.find((a) => a.key === "notify.proposal.approved")).toMatchObject({
      allowed: false,
    });
  });
});

describe("action_runs from before notices", () => {
  it("is widened once to take a notice's run; its rows, indexes and append-only triggers stay", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "action-runs-widen-"));
    try {
      const file = path.join(dir, "company.db");
      const old = openCompanyDb(file, ACTION_SCHEMA.replace(",'notify'", ""));
      old
        .prepare(
          `INSERT INTO action_runs (id, key, contribution, subject_kind, subject, commit_sha, params, by, via, session_id, request_id, started_at)
           VALUES ('r1', 'proposal.approve', 'c', 'proposal', 'proposal:1', NULL, '{}', 'user:boss', 'web', NULL, NULL, '2026-10-01T00:00:00.000Z')`,
        )
        .run();
      old
        .prepare(
          `INSERT INTO action_run_ends (run_id, outcome, status, ended_at) VALUES ('r1', 'succeeded', 200, '2026-10-01T00:00:01.000Z')`,
        )
        .run();
      expect(() =>
        old
          .prepare(
            `INSERT INTO action_runs (id, key, contribution, subject_kind, subject, params, by, via, started_at)
             VALUES ('r0', 'k', 'c', 'proposal', 'proposal:1', '{}', 'user:boss', 'notify', 'x')`,
          )
          .run(),
      ).toThrow(/CHECK/);
      old.close();

      const store = ActionStore.open(file, "2026-10-01T00:00:00.000Z");
      try {
        expect(store.get("r1")).toMatchObject({ via: "web", end: { outcome: "succeeded" } });
        store.start({
          id: "r2",
          key: "notify.proposal.approved",
          contribution: "company-proposals.notify.approved",
          subjectKind: "proposal",
          subject: "proposal:1",
          commit: null,
          params: { runId: "r1" },
          by: "user:boss",
          via: "notify",
          sessionId: null,
          requestId: null,
          startedAt: "2026-10-01T00:00:02.000Z",
        });
        expect(store.get("r2")).toMatchObject({ via: "notify", end: null });
        expect(() => store.db.exec(`UPDATE action_runs SET by = 'x' WHERE id = 'r1'`)).toThrow(
          /history_append_only/,
        );
        const indexes = store.db
          .prepare(
            `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'action_runs' AND name LIKE 'action_runs_%'`,
          )
          .all()
          .map((r) => (r as { name: string }).name)
          .sort();
        expect(indexes).toEqual([
          "action_runs_by_actor",
          "action_runs_by_key",
          "action_runs_by_subject",
          "action_runs_by_time",
          "action_runs_request",
        ]);
      } finally {
        store.close();
      }
      // Opened again, the widened table is left as it is.
      const again = ActionStore.open(file, "2026-10-01T00:00:00.000Z");
      expect(again.get("r2")).toMatchObject({ via: "notify" });
      again.close();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
