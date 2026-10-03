/**
 * The roadmap store over a real SQLite file: the history it keeps only appends — drafts,
 * approvals, events — and an approval is kept with the hash of the brief it was given on, so a
 * changed brief leaves the old approvals in the table, no longer counted. The channel claim's
 * question is answered from the index the schema declares.
 */
import { describe, expect, it } from "vitest";
import { SqliteRoadmapStore, briefSha, type DraftItem } from "../src/index.js";

const ITEMS: DraftItem[] = [
  {
    key: "ledger",
    kind: "proposal",
    title: "Ledger",
    brief: "An append-only ledger.",
    owner: "dev",
    cites: ["Why"],
  },
  {
    key: "page",
    kind: "proposal",
    title: "Page",
    brief: "A page.",
    owner: "web",
    cites: ["Why"],
    stackedOn: null,
  },
  {
    key: "child",
    kind: "roadmap",
    title: "Child",
    brief: "More.",
    employees: ["dev"],
    cites: ["Why"],
  },
];

function opened(): SqliteRoadmapStore {
  const store = SqliteRoadmapStore.open(":memory:");
  store.write({
    kind: "opened",
    number: 1,
    name: "Queue",
    brief: "",
    channelId: "room_a",
    employees: ["dev", "web"],
    parent: null,
    by: "user:boss",
  });
  store.write({ kind: "draft", number: 1, body: "## Why\n", items: ITEMS, by: "agent:dev" });
  store.write({ kind: "established", number: 1, by: "agent:dev" });
  store.write({
    kind: "briefed",
    number: 1,
    key: "ledger",
    owner: "dev",
    brief: "An append-only ledger.",
    base: null,
    by: "agent:dev",
  });
  return store;
}

describe("SqliteRoadmapStore", () => {
  it("keeps the items in order, with how each is stacked", () => {
    const store = opened();
    expect(store.get(1)!.items).toEqual(ITEMS);
    expect(store.list({ status: "established" }).map((r) => r.number)).toEqual([1]);
    expect(store.list({ channel: "room_b" })).toEqual([]);
    store.close();
  });

  it("appends an approval with its brief's hash; a changed brief leaves it in the table, not counted", () => {
    const store = opened();
    store.write({
      kind: "approved",
      number: 1,
      key: "ledger",
      role: "person",
      brief: "An append-only ledger.",
      by: "user:boss",
    });
    expect(store.get(1)!.delegations.ledger!.approvals).toEqual({
      person: { by: "user:boss", at: expect.any(String) },
    });
    // The same role on the same brief is one row: a second is refused by the key.
    expect(() =>
      store.write({
        kind: "approved",
        number: 1,
        key: "ledger",
        role: "person",
        brief: "An append-only ledger.",
        by: "user:other",
      }),
    ).toThrow(/UNIQUE|PRIMARY/);
    store.write({
      kind: "briefed",
      number: 1,
      key: "ledger",
      owner: "dev",
      brief: "A ledger, then a page.",
      base: null,
      by: "user:boss",
    });
    expect(store.get(1)!.delegations.ledger!.approvals).toEqual({});
    const rows = store.db
      .prepare(`SELECT brief_sha, role FROM roadmap_approvals WHERE number = 1 AND key = 'ledger'`)
      .all();
    expect(rows).toEqual([{ brief_sha: briefSha("An append-only ledger."), role: "person" }]);
    store.close();
  });

  it("refuses to rewrite or delete history: drafts, approvals, events", () => {
    const store = opened();
    store.write({
      kind: "approved",
      number: 1,
      key: "ledger",
      role: "person",
      brief: "An append-only ledger.",
      by: "user:boss",
    });
    for (const table of ["roadmap_drafts", "roadmap_approvals", "roadmap_events"]) {
      expect(() => store.db.prepare(`DELETE FROM ${table}`).run(), table).toThrow(
        /history_append_only/,
      );
      expect(() => store.db.prepare(`UPDATE ${table} SET by = 'x'`).run(), table).toThrow(
        /history_append_only/,
      );
    }
    store.close();
  });

  it("answers the claim's question from roadmaps_by_channel", () => {
    const store = opened();
    store.write({ kind: "reopened", number: 1, reason: "more", by: "user:boss" });
    expect(store.discussingIn("room_a")).toBe(1);
    expect(store.discussingIn("room_b")).toBeNull();
    const plan = (
      store.db
        .prepare(
          `EXPLAIN QUERY PLAN SELECT number FROM roadmaps WHERE channel_id = 'room_a' AND status = 'discussing' ORDER BY number LIMIT 1`,
        )
        .all() as Array<{ detail: string }>
    )
      .map((r) => r.detail)
      .join("\n");
    expect(plan).toMatch(/roadmaps_by_channel/);
    store.close();
  });

  it("calls a scoped view's sink inside each write transaction, and never for one the check refuses", () => {
    const store = opened();
    store.db.exec("CREATE TABLE sink_rows (n INTEGER)");
    let calls = 0;
    const view = store.scoped((db) => {
      calls++;
      db.prepare("INSERT INTO sink_rows (n) VALUES (?)").run(calls);
    });
    view.write({ kind: "renamed", number: 1, name: "Queue, again", by: "user:boss" });
    expect(() =>
      view.write({ kind: "renamed", number: 1, name: "Refused", by: "user:boss" }, () => {
        throw new Error("refused");
      }),
    ).toThrow("refused");
    // The refused write rolled back before its sink: one row, from the write that stood.
    expect(store.db.prepare("SELECT n FROM sink_rows").all()).toEqual([{ n: 1 }]);
    expect(store.get(1)?.name).toBe("Queue, again");
    // The store itself, unscoped, calls no sink.
    store.write({ kind: "renamed", number: 1, name: "Plain", by: "user:boss" });
    expect(calls).toBe(1);
    store.close();
  });
});
