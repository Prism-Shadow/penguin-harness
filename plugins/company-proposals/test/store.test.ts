/**
 * The proposal store over a real SQLite file: what it guarantees itself — keys, foreign keys,
 * NOT NULL, and a history that is only ever appended to — and what its reads answer, with the
 * query plans of the read paths held to the indexes the schema declares. The process rules are
 * guards.test.ts's.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteProposalStore } from "../src/index.js";
import { READS } from "../src/store.js";

const SECTIONS = [
  {
    id: "change",
    heading: "Change",
    paragraphs: [{ id: "p1", text: "Batch the notices." }],
  },
];

describe("SqliteProposalStore", () => {
  let dir: string;
  let store: SqliteProposalStore;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "proposals-store-"));
    store = SqliteProposalStore.open(path.join(dir, "company.db"), () =>
      Date.parse("2026-10-03T00:00:00Z"),
    );
  });
  afterEach(async () => {
    store.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const create = (brief = "Batch the notices") =>
    store.create(() => ({ title: brief, author: "acme_dev", delegatedBy: "user:boss", brief }));
  const publish = (number: number, revision: number) =>
    store.publish(number, (p) => ({
      revision,
      title: `Revision ${revision}`,
      root: "",
      scope: [],
      tests: [],
      sections: SECTIONS as never,
      status: p.status,
      reason: null,
      by: "agent:acme_dev",
    }));

  it("refuses rows that break a key, a foreign key or NOT NULL", () => {
    const { number } = create();
    const db = store.db;
    expect(() =>
      db
        .prepare(
          `INSERT INTO proposal_revisions (number, revision, by, at, title, scope, sections) VALUES (99, 1, 'x', 'y', 't', '[]', '[]')`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);
    expect(() =>
      db
        .prepare(
          `INSERT INTO proposals (number, status, author, delegated_by, created_at, updated_at, seq, title, brief) VALUES (5, 'drafting', NULL, 'u', 'a', 'a', 1, 't', 'b')`,
        )
        .run(),
    ).toThrow(/NOT NULL/);
    expect(() =>
      db
        .prepare(
          `INSERT INTO proposals (number, status, author, delegated_by, created_at, updated_at, seq, title, brief) VALUES (6, 'lost', 'a', 'u', 'a', 'a', 1, 't', 'b')`,
        )
        .run(),
    ).toThrow(/CHECK/);
    publish(number, 1);
    expect(() => publish(number, 1)).toThrow(/UNIQUE|PRIMARY/);
  });

  it("keeps the history append-only: revisions and events refuse UPDATE and DELETE", () => {
    const { number } = create();
    publish(number, 1);
    for (const sql of [
      `UPDATE proposal_revisions SET title = 'x'`,
      `DELETE FROM proposal_revisions`,
      `UPDATE proposal_events SET text = 'x'`,
      `DELETE FROM proposal_events`,
    ]) {
      expect(() => store.db.prepare(sql).run(), sql).toThrow(/history_append_only/);
    }
    expect(store.revisions(number)).toHaveLength(1);
    expect(store.get(number)!.events.map((e) => e.kind)).toEqual(["created", "revised"]);
  });

  it("answers the queue, a proposal, its revisions and a person's unread count", () => {
    const a = create("First").number;
    const b = create("Second").number;
    publish(a, 1);
    publish(a, 2);
    store.feedback(b, () => ({ text: "note", runtime: false, by: "agent:acme_qa" }));
    const boss = { principal: "user:boss", userId: "boss", person: true };
    let queue = store.list(boss);
    expect(queue.map((q) => [q.number, q.revision, q.unread])).toEqual([
      [b, 0, 1],
      [a, 2, 2],
    ]);
    store.markRead("boss", a, store.get(a)!.seq);
    // Never back: an older position changes nothing.
    store.markRead("boss", a, 1);
    queue = store.list(boss);
    expect(queue.find((q) => q.number === a)!.unread).toBe(0);
    expect(store.readSeq("boss", a)).toBe(store.get(a)!.seq);
    // An employee has no unread count.
    expect(
      store.list({ principal: "agent:acme_dev", userId: "boss", person: false })[0]!.unread,
    ).toBe(0);
    expect(store.revisions(a).map((r) => r.revision)).toEqual([1, 2]);
    expect(store.revision(a, 1)).toMatchObject({ title: "Revision 1", sections: SECTIONS });
    expect(store.revision(a, 3)).toBeNull();
    expect(store.get(a)).toMatchObject({ revision: 2, title: "Revision 2", sections: SECTIONS });
  });

  it("keeps one proposal per roadmap item and brief: the same creation again answers the first", () => {
    const plan = () => ({
      title: "Ledger",
      author: "acme_dev",
      delegatedBy: "agent:acme_ceo",
      brief: "An append-only ledger.",
      roadmap: { number: 3, key: "ledger", createKey: "k1" },
    });
    const first = store.create(plan);
    const again = store.create(plan);
    expect(again).toEqual({ ...first, created: false });
    const other = store.create(() => ({
      ...plan(),
      roadmap: { number: 3, key: "ledger", createKey: "k2" },
    }));
    expect(other.number).toBe(first.number + 1);
  });

  it("reads each path through its index, not by scanning a table", () => {
    const plan = (sql: string): string =>
      (store.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all({}) as Array<{ detail: string }>)
        .map((r) => r.detail)
        .join("\n");
    const anyArgs = (sql: string) => sql.replace(/:me|:user/g, "'x'").replace(/\?/g, "1");
    expect(plan(anyArgs(READS.queuePerson))).toMatch(/proposal_events_by_number/);
    expect(plan(anyArgs(READS.pendingCounts))).toMatch(/proposal_comments_pending/);
    expect(plan(anyArgs(READS.events))).toMatch(/proposal_events_by_number/);
    expect(plan(anyArgs(READS.materials))).toMatch(/proposal_materials_by_number/);
    expect(plan(anyArgs(READS.comments))).toMatch(/proposal_comments_by_number/);
    expect(plan(anyArgs(READS.sessions))).toMatch(/proposal_sessions_by_number/);
    expect(plan(anyArgs(READS.implByPr))).toMatch(/proposal_impls_pr/);
    expect(plan(anyArgs(READS.implByHead))).toMatch(/proposal_impls_head/);
    for (const sql of [READS.headRevision, READS.revisionList, READS.revision]) {
      expect(plan(anyArgs(sql))).toMatch(/USING PRIMARY KEY/);
    }
    for (const sql of Object.values(READS)) {
      // The queues read every proposal on purpose; nothing else scans a table.
      if (sql === READS.queuePerson || sql === READS.queueEmployee) continue;
      expect(plan(anyArgs(sql)), sql).not.toMatch(/^SCAN (proposal_\w+)$/m);
    }
  });
});
