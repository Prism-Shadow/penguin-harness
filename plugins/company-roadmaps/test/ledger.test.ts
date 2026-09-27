/**
 * The ledger's fold: what every kind of line does to a roadmap, the lines that are skipped,
 * and the file under concurrent appends.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Ledger, foldLedger, parseLedger, type LedgerLine } from "../src/index.js";
import { tempRoot } from "./fakes.js";

let seq = 0;
const at = "2026-09-27T12:00:00.000Z";
function line(entry: Omit<LedgerLine, "seq" | "at" | "by"> & { by?: string }): LedgerLine {
  seq++;
  return { seq, at, by: "user:boss", ...entry } as LedgerLine;
}

const opened = (number: number, channelId: string | null = "room_a") =>
  line({
    kind: "opened",
    number,
    name: "Queue migration",
    brief: "How the queue moves",
    channelId,
    employees: ["acme_dev", "acme_web"],
    parent: null,
  });

describe("the fold", () => {
  it("opens a roadmap discussing over its room, the first employee listed first", () => {
    const state = foldLedger([opened(1)]);
    expect(state.roadmaps.get(1)).toMatchObject({
      number: 1,
      name: "Queue migration",
      channelId: "room_a",
      employees: ["acme_dev", "acme_web"],
      status: "discussing",
      archived: false,
      record: "",
      body: "",
      items: [],
    });
  });

  it("opens a derived roadmap waiting for its room, and a bound room starts its discussion", () => {
    const state = foldLedger([
      opened(2, null),
      line({ kind: "room", number: 2, channelId: "room_b" }),
    ]);
    expect(state.roadmaps.get(2)).toMatchObject({ status: "discussing", channelId: "room_b" });
    expect(foldLedger([opened(2, null)]).roadmaps.get(2)?.status).toBe("awaiting_room");
  });

  it("keeps each draft field until a later draft names it again", () => {
    const item = {
      key: "a",
      kind: "proposal" as const,
      title: "T",
      brief: "B",
      owner: "acme_dev",
      cites: ["Why"],
    };
    const r = foldLedger([
      opened(1),
      line({ kind: "draft", number: 1, record: "r1", body: "## Why\n", items: [item] }),
      line({ kind: "draft", number: 1, record: "r2" }),
    ]).roadmaps.get(1);
    expect(r).toMatchObject({ record: "r2", body: "## Why\n", items: [item] });
  });

  it("archives on establishment, and a reopening lifts both", () => {
    const established = foldLedger([opened(1), line({ kind: "established", number: 1 })]);
    expect(established.roadmaps.get(1)).toMatchObject({ status: "established", archived: true });
    const reopened = foldLedger([
      opened(1),
      line({ kind: "established", number: 1 }),
      line({ kind: "reopened", number: 1, reason: "missing a migration" }),
    ]);
    expect(reopened.roadmaps.get(1)).toMatchObject({ status: "discussing", archived: false });
    expect(reopened.roadmaps.get(1)?.events.at(-1)).toMatchObject({
      kind: "reopened",
      note: "missing a migration",
    });
  });

  it("records a delegation and the proposal linked to it; a re-delegation to the same owner keeps the link, to another drops it", () => {
    const delegated = (owner: string) =>
      line({
        kind: "delegated",
        number: 1,
        key: "a",
        owner,
        brief: "B",
        base: null,
        child: null,
        delivered: true,
      });
    const lines = [
      opened(1),
      delegated("acme_dev"),
      line({ kind: "linked", number: 1, key: "a", proposal: 58 }),
    ];
    expect(foldLedger(lines).roadmaps.get(1)?.delegations.a).toMatchObject({
      owner: "acme_dev",
      proposal: 58,
    });
    expect(
      foldLedger([...lines, delegated("acme_dev")]).roadmaps.get(1)?.delegations.a?.proposal,
    ).toBe(58);
    expect(
      foldLedger([...lines, delegated("acme_web")]).roadmaps.get(1)?.delegations.a?.proposal,
    ).toBeUndefined();
  });

  it("renames, archives and unarchives", () => {
    const r = foldLedger([
      opened(1),
      line({ kind: "renamed", number: 1, name: "Queue, second pass" }),
      line({ kind: "archived", number: 1 }),
    ]).roadmaps.get(1);
    expect(r).toMatchObject({ name: "Queue, second pass", archived: true });
    expect(
      foldLedger([
        opened(1),
        line({ kind: "archived", number: 1 }),
        line({ kind: "unarchived", number: 1 }),
      ]).roadmaps.get(1)?.archived,
    ).toBe(false);
  });

  it("opens and closes room sessions; a closed one stays in the history", () => {
    const r = foldLedger([
      opened(1),
      line({ kind: "clone", number: 1, agentId: "acme_dev", sessionId: "s1" }),
      line({ kind: "clone", number: 1, agentId: "acme_web", sessionId: "s2" }),
      line({
        kind: "clone_closed",
        number: 1,
        agentId: "acme_dev",
        sessionId: "s1",
        reason: "left the room",
      }),
    ]).roadmaps.get(1);
    expect(r?.clones).toEqual([
      { agentId: "acme_dev", sessionId: "s1", openedAt: at, closedAt: at },
      { agentId: "acme_web", sessionId: "s2", openedAt: at },
    ]);
  });

  it("ignores a line about a roadmap that was never opened", () => {
    const state = foldLedger([line({ kind: "established", number: 9 })]);
    expect(state.roadmaps.size).toBe(0);
    expect(state.lastSeq).toBe(seq);
  });
});

describe("parsing", () => {
  it("skips and counts a line that is not JSON, not a known kind, or has no number", () => {
    const good = JSON.stringify(opened(1));
    const text = [
      good,
      "{not json",
      JSON.stringify({ seq: 99, at, by: "x", kind: "teleported", number: 1 }),
      JSON.stringify({ seq: 100, at, by: "x", kind: "archived" }),
      "",
    ].join("\n");
    const { lines, skipped } = parseLedger(text);
    expect(lines).toHaveLength(1);
    expect(skipped).toBe(3);
  });
});

describe("the file", () => {
  it("appends under a chain — two writes at once get consecutive seqs, both on disk — and replays", async () => {
    const root = await tempRoot();
    const file = path.join(root, "roadmaps.jsonl");
    const ledger = new Ledger(file);
    await ledger.load();
    const [a, b] = await Promise.all([
      ledger.append({
        kind: "opened",
        number: 1,
        name: "A",
        brief: "",
        channelId: "room_a",
        employees: ["acme_dev"],
        parent: null,
        by: "user:boss",
      }),
      ledger.append({ kind: "renamed", number: 1, name: "A2", by: "user:boss" }),
    ]);
    expect([a.seq, b.seq]).toEqual([1, 2]);
    expect((await fs.readFile(file, "utf8")).trim().split("\n")).toHaveLength(2);
    const again = new Ledger(file);
    await again.load();
    expect(again.get(1)?.name).toBe("A2");
    expect(again.nextNumber()).toBe(2);
  });
});
