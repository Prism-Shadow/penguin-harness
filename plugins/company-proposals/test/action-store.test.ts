/**
 * ActionStore over a real `company.db`: the two run tables only ever take inserts; a run's start
 * row commits with the write it made, and a write that rolls back leaves neither; a refusal still
 * leaves its run; the Activity pages by time, subject, actor and key over its indexes; a run a
 * past process never ended is recorded `abandoned` when the store opens again.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionStore, openCompanyDb, writeStart, type RunStart } from "../src/index.js";
import { immediate } from "../src/schema.js";

function start(id: string, at: string, over: Partial<RunStart> = {}): RunStart {
  return {
    id,
    key: "proposal.approve",
    contribution: "company-proposals.action.approve",
    subjectKind: "proposal",
    subject: "proposal:1",
    commit: null,
    params: {},
    by: "user:boss",
    via: "web",
    sessionId: null,
    requestId: null,
    startedAt: at,
    ...over,
  };
}

const ended = {
  outcome: "succeeded" as const,
  status: 200,
  code: null,
  message: null,
  result: { ok: true },
  hookErrors: [],
  output: null,
};

describe("ActionStore", () => {
  let dir: string;
  let file: string;
  let store: ActionStore;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "action-store-"));
    file = path.join(dir, "company.db");
    store = ActionStore.open(file, "2000-01-01T00:00:00.000Z");
  });
  afterEach(async () => {
    store.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("refuses to rewrite or delete a run's start or end row", () => {
    store.end(start("r1", "2026-10-03T00:00:01.000Z"), {
      ...ended,
      endedAt: "2026-10-03T00:00:02.000Z",
    });
    for (const sql of [
      `UPDATE action_runs SET by = 'user:x' WHERE id = 'r1'`,
      `DELETE FROM action_runs WHERE id = 'r1'`,
      `UPDATE action_run_ends SET outcome = 'failed' WHERE run_id = 'r1'`,
      `DELETE FROM action_run_ends WHERE run_id = 'r1'`,
    ]) {
      expect(() => store.db.exec(sql)).toThrow(/history_append_only/);
    }
  });

  it("a start row written inside a write commits with it, and rolls back with it", () => {
    const other = openCompanyDb(file, `CREATE TABLE IF NOT EXISTS notes (text TEXT NOT NULL);`);
    try {
      immediate(other, () => {
        other.prepare(`INSERT INTO notes (text) VALUES ('kept')`).run();
        writeStart(other, start("ok", "2026-10-03T00:00:01.000Z"));
      });
      expect(() =>
        immediate(other, () => {
          other.prepare(`INSERT INTO notes (text) VALUES ('lost')`).run();
          writeStart(other, start("gone", "2026-10-03T00:00:02.000Z"));
          throw new Error("the write broke");
        }),
      ).toThrow("the write broke");
      expect(other.prepare(`SELECT text FROM notes`).all()).toEqual([{ text: "kept" }]);
      expect(store.get("ok")).not.toBeNull();
      expect(store.get("gone")).toBeNull();
      // The failed run is recorded on its own afterwards: its start and its end together.
      store.end(start("gone", "2026-10-03T00:00:02.000Z"), {
        ...ended,
        outcome: "failed",
        status: 500,
        code: "internal",
        endedAt: "2026-10-03T00:00:03.000Z",
      });
      expect(store.get("gone")?.end?.outcome).toBe("failed");
    } finally {
      other.close();
    }
  });

  it("pages the Activity newest first by time, subject, actor and key", () => {
    for (let i = 0; i < 7; i++) {
      store.end(
        start(`r${i}`, `2026-10-03T00:00:0${i}.000Z`, {
          subject: i % 2 === 0 ? "proposal:1" : "proposal:2",
          by: i < 3 ? "user:boss" : "agent:acme_dev",
          key: i === 6 ? "proposal.reject" : "proposal.approve",
        }),
        { ...ended, endedAt: `2026-10-03T00:00:0${i}.500Z` },
      );
    }
    const page1 = store.list({ limit: 3 });
    expect(page1.map((r) => r.id)).toEqual(["r6", "r5", "r4"]);
    const cursor = `${page1[2]!.startedAt}|${page1[2]!.id}`;
    expect(store.list({ limit: 3, before: cursor }).map((r) => r.id)).toEqual(["r3", "r2", "r1"]);
    expect(store.list({ limit: 10, subject: "proposal:2" }).map((r) => r.id)).toEqual([
      "r5",
      "r3",
      "r1",
    ]);
    expect(store.list({ limit: 10, by: "user:boss" }).map((r) => r.id)).toEqual(["r2", "r1", "r0"]);
    expect(store.list({ limit: 10, key: "proposal.reject" }).map((r) => r.id)).toEqual(["r6"]);
    // A list leaves the output out; one run carries it.
    expect(store.list({ limit: 1 })[0]!.end?.output).toBeNull();
  });

  it("serves each filter from its index", () => {
    const plan = (where: string, ...args: string[]) =>
      (
        store.db
          .prepare(
            `EXPLAIN QUERY PLAN SELECT r.id FROM action_runs r ${where} ORDER BY r.started_at DESC, r.id DESC LIMIT 10`,
          )
          .all(...args) as Array<{ detail: string }>
      )
        .map((r) => r.detail)
        .join("; ");
    expect(plan("")).toMatch(/action_runs_by_time/);
    expect(plan("WHERE r.subject = ?", "proposal:1")).toMatch(/action_runs_by_subject/);
    expect(plan("WHERE r.by = ?", "user:boss")).toMatch(/action_runs_by_actor/);
    expect(plan("WHERE r.key = ?", "proposal.approve")).toMatch(/action_runs_by_key/);
  });

  it("records `abandoned` for a run a past process started and never ended — not for one started since", () => {
    store.start(start("old", "2026-10-03T00:00:01.000Z"));
    store.start(start("live", "2026-10-03T00:10:00.000Z"));
    store.close();
    store = ActionStore.open(file, "2026-10-03T00:05:00.000Z");
    expect(store.get("old")?.end).toMatchObject({ outcome: "abandoned", code: "abandoned" });
    expect(store.get("live")?.end).toBeNull();
  });

  it("finds a caller's earlier run by its request id", () => {
    store.end(start("first", "2026-10-03T00:00:01.000Z", { requestId: "req-1" }), {
      ...ended,
      endedAt: "2026-10-03T00:00:02.000Z",
    });
    expect(store.byRequest("user:boss", "proposal.approve", "req-1")?.id).toBe("first");
    expect(store.byRequest("agent:acme_dev", "proposal.approve", "req-1")).toBeNull();
    expect(() =>
      writeStart(store.db, start("second", "2026-10-03T00:00:03.000Z", { requestId: "req-1" })),
    ).toThrow();
  });
});
