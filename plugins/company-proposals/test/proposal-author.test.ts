/**
 * `proposal.author` (author.ts): the new author must be an employee of the organization as it
 * is now; the write appends an `author` event naming both sides and leaves the approvals,
 * comments and revisions as they were; the default guard lets a person through, and the
 * moderator of the roadmap that created the proposal (asked of the roadmaps plugin through
 * RoadmapModeratorOf), and refuses any other employee; and what only the author is held to
 * afterwards — the ready check of requested changes, the desk line of a rewritten brief —
 * follows the new author.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OrgActor } from "@prismshadow/penguin-server/plugin";
import { SqliteProposalStore, companyDbPath, type RoadmapModeratorOf } from "../src/index.js";
import { actionApp, proposalContributions, type ActionApp } from "./action-harness.js";
import { BOSS, DEV, DOC, IMPL, ORG, PROJECT, QA, fakeOrg } from "./fake-org.js";

describe("proposal.author", () => {
  let org: Awaited<ReturnType<typeof fakeOrg>>;
  let h: ActionApp;
  /** The roadmaps plugin's answers: roadmap number to its moderator. */
  let moderators: Map<number, string>;
  let asked: Array<{ number: number; actor: OrgActor }>;

  beforeEach(async () => {
    org = await fakeOrg();
    moderators = new Map([[3, "acme_qa"]]);
    asked = [];
    const moderatorOf: RoadmapModeratorOf = async (_p, _o, number, actor) => {
      asked.push({ number, actor });
      return moderators.get(number) ?? null;
    };
    org.service.provideRoadmapModerators(moderatorOf);
    h = actionApp({
      gateway: org.gateway,
      root: org.root,
      project: PROJECT,
      org: ORG,
      contributions: proposalContributions(org.service),
      service: org.service,
    });
  });
  afterEach(async () => {
    h.registry.stop();
    await org.cleanup();
  });

  const svc = () => org.service;
  const delegated = async (): Promise<number> =>
    (await svc().create(PROJECT, ORG, { author: "acme_dev", brief: "Batch the notices" }, BOSS))
      .number;
  /** A proposal roadmap #3 created, written by acme_dev. */
  const fromRoadmap = (): Promise<number> =>
    svc().createFromRoadmap(PROJECT, ORG, {
      author: "acme_dev",
      title: "Batch the notices",
      brief: "Batch the notices",
      delegatedBy: "user:boss",
      roadmap: { number: 3, key: "ledger" },
    });
  const author = (n: number, to: unknown, actor: OrgActor = BOSS) =>
    h.run("proposal.author", `proposal:${n}`, to === undefined ? {} : { author: to }, actor);
  const codeOf = (r: { body: Record<string, unknown> }): unknown =>
    (r.body.error as { code?: string } | undefined)?.code;

  it("takes only an employee of the organization as it is now, and another than the author", async () => {
    const n = await delegated();
    for (const [to, status, code] of [
      [undefined, 400, "bad_params"],
      [7, 400, "bad_params"],
      ["", 400, "bad_request"],
      ["stranger", 400, "bad_request"],
      ["acme_dev", 409, "author_unchanged"],
    ] as const) {
      const r = await author(n, to);
      expect([r.status, codeOf(r)], String(to)).toEqual([status, code]);
    }
    // An employee who left the organization is not one any more.
    org.gateway.org = {
      ...org.gateway.org,
      employees: org.gateway.org.employees.filter((e) => e.agentId !== "acme_impl"),
    };
    const left = await author(n, "acme_impl");
    expect([left.status, codeOf(left)]).toEqual([400, "bad_request"]);
    const detail = await svc().get(PROJECT, ORG, n, BOSS);
    expect(detail.author).toBe("acme_dev");
    expect(detail.events.some((e) => e.kind === "author")).toBe(false);
  });

  it("appends an author event naming both sides; approvals, comments and revisions stand", async () => {
    const n = await delegated();
    await svc().publish(PROJECT, ORG, n, DOC, DEV);
    const section = (await svc().get(PROJECT, ORG, n, BOSS)).sections[0]!;
    await svc().comment(
      PROJECT,
      ORG,
      n,
      { sectionId: section.id, start: 0, end: 5, quote: "Batch", text: "Which ones?" },
      BOSS,
    );
    await svc().approve(PROJECT, ORG, n, BOSS);
    const before = await svc().get(PROJECT, ORG, n, BOSS);

    const ran = await author(n, "acme_impl");
    expect(ran.status).toBe(200);
    expect(ran.body.run).toMatchObject({
      contribution: "company-proposals.action.author",
      by: "user:boss",
      outcome: "succeeded",
    });
    const after = await svc().get(PROJECT, ORG, n, BOSS);
    expect(after.author).toBe("acme_impl");
    expect(after.events.at(-1)).toMatchObject({
      kind: "author",
      by: "user:boss",
      text: "acme_dev → acme_impl",
    });
    expect(after.events.slice(0, -1)).toEqual(before.events);
    expect(after).toMatchObject({
      status: "approved",
      approvedRevision: 1,
      revision: 1,
      comments: before.comments,
      sections: before.sections,
    });
    expect((await svc().revisions(PROJECT, ORG, n, BOSS)).revisions).toMatchObject([
      { revision: 1, by: "agent:acme_dev" },
    ]);
    // The header is what every later read and write takes the author from.
    const store = SqliteProposalStore.open(companyDbPath(org.root, PROJECT, ORG));
    try {
      expect(store.get(n)!.author).toBe("acme_impl");
    } finally {
      store.close();
    }
  });

  it("lets a person and the moderator of the roadmap that created it through, no other employee", async () => {
    const n = await fromRoadmap();
    const other = await author(n, "acme_impl", IMPL);
    expect([other.status, codeOf(other)]).toEqual([403, "not_moderator"]);
    // The author itself is no exception.
    const own = await author(n, "acme_impl", DEV);
    expect([own.status, codeOf(own)]).toEqual([403, "not_moderator"]);
    expect((await svc().get(PROJECT, ORG, n, BOSS)).author).toBe("acme_dev");

    const moderator = await author(n, "acme_impl", QA);
    expect(moderator.status).toBe(200);
    expect(moderator.body.run).toMatchObject({ by: "agent:acme_qa", outcome: "succeeded" });
    // The roadmap the proposal records is the one asked, as the caller reads it.
    expect(asked.at(-1)).toEqual({ number: 3, actor: QA });

    // The moderator is asked anew: once the roadmap names another, the first is refused.
    moderators.set(3, "acme_impl");
    const former = await author(n, "acme_dev", QA);
    expect([former.status, codeOf(former)]).toEqual([403, "not_moderator"]);
    expect((await author(n, "acme_dev", BOSS)).status).toBe(200);

    // A proposal no roadmap created has no moderator: only a person changes its author.
    const plain = await delegated();
    const employee = await author(plain, "acme_impl", QA);
    expect([employee.status, codeOf(employee)]).toEqual([403, "not_moderator"]);
    expect((await author(plain, "acme_impl", BOSS)).status).toBe(200);
  });

  it("without the roadmaps plugin, only a person passes", async () => {
    const fresh = await fakeOrg();
    try {
      const a = actionApp({
        gateway: fresh.gateway,
        root: fresh.root,
        project: PROJECT,
        org: ORG,
        contributions: proposalContributions(fresh.service),
        service: fresh.service,
      });
      const n = await fresh.service.createFromRoadmap(PROJECT, ORG, {
        author: "acme_dev",
        title: "T",
        brief: "B",
        delegatedBy: "user:boss",
        roadmap: { number: 3, key: "ledger" },
      });
      const r = await a.run("proposal.author", `proposal:${n}`, { author: "acme_impl" }, QA);
      expect([r.status, codeOf(r)]).toEqual([403, "not_moderator"]);
      a.registry.stop();
    } finally {
      await fresh.cleanup();
    }
    // A withdrawn port leaves no moderator either.
    const n = await fromRoadmap();
    const withdraw = svc().provideRoadmapModerators(async () => "acme_qa");
    expect((await author(n, "acme_impl", QA)).status).toBe(200);
    withdraw();
    const r = await author(n, "acme_dev", QA);
    expect([r.status, codeOf(r)]).toEqual([403, "not_moderator"]);
  });

  it("what only the author is held to follows the new author", async () => {
    const n = await delegated();
    await svc().publish(PROJECT, ORG, n, DOC, DEV);
    await svc().ready(PROJECT, ORG, n, DEV);
    const section = (await svc().get(PROJECT, ORG, n, BOSS)).sections[0]!;
    const commented = await svc().comment(
      PROJECT,
      ORG,
      n,
      { sectionId: section.id, start: 0, end: 5, quote: "Batch", text: "Which ones?" },
      BOSS,
    );
    const commentId = commented.comments[0]!.id;
    await svc().requestChanges(PROJECT, ORG, n, BOSS);
    expect((await author(n, "acme_impl")).status).toBe(200);

    // A rewritten brief reaches the new author's desk, not the former one's.
    const mark = org.gateway.desks.length;
    expect(
      (await h.run("proposal.brief", `proposal:${n}`, { brief: "Batch them all" })).status,
    ).toBe(200);
    expect(org.gateway.desks.slice(mark).map((d) => d.agentId)).toEqual(["acme_impl"]);

    // The new author's ready must answer the requested changes first.
    const early = await h.run("proposal.ready", `proposal:${n}`, {}, IMPL);
    expect([early.status, codeOf(early)]).toEqual([409, "changes_pending"]);
    expect((await h.run("proposal.publish", `proposal:${n}`, { markdown: DOC }, IMPL)).status).toBe(
      200,
    );
    await svc().resolve(PROJECT, ORG, n, commentId, "All of them.", IMPL);
    const ready = await h.run("proposal.ready", `proposal:${n}`, {}, IMPL);
    expect(ready.status).toBe(200);
    expect((ready.body.result as { status: string }).status).toBe("ready");
    expect((await svc().revisions(PROJECT, ORG, n, BOSS)).revisions).toMatchObject([
      { revision: 1, by: "agent:acme_dev" },
      { revision: 2, by: "agent:acme_impl" },
    ]);
  });
});
