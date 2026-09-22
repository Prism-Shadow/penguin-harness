/**
 * The ledger as pure data: lines fold to proposals, a request for changes gathers the
 * pending comments and puts a ready proposal back to drafting, a line about a proposal that
 * was never created is skipped, an unreadable line is skipped — and the same file replays
 * to the same state after a restart.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  Ledger,
  foldLedger,
  ledgerPath,
  parseLedger,
  type LedgerEntry,
  type LedgerLine,
} from "../src/index.js";

const at = "2026-09-21T00:00:00.000Z";

function lines(...entries: LedgerEntry[]): LedgerLine[] {
  return entries.map((e, i) => ({ seq: i + 1, at, ...e }) as LedgerLine);
}

describe("foldLedger", () => {
  it("folds a creation, a revision and status changes into one proposal with its events", () => {
    const state = foldLedger(
      lines(
        {
          kind: "created",
          number: 1,
          title: "Batch notices",
          author: "dev",
          delegatedBy: "boss",
          brief: "Do it",
        },
        {
          kind: "revised",
          number: 1,
          revision: 1,
          title: "Batch the notices",
          scope: [{ file: "a.ts" }],
          sections: [{ id: "s1", heading: "Change", paragraphs: [{ id: "p1", text: "x" }] }],
          by: "agent:dev",
        },
        { kind: "status", number: 1, status: "ready", by: "agent:dev" },
        {
          kind: "implementation",
          number: 1,
          implementer: "impl",
          sessionId: "s-1",
          by: "agent:dev",
        },
        {
          kind: "material",
          number: 1,
          material: { kind: "pr", label: "PR #7", url: "https://x/pull/7" },
          by: "agent:impl",
        },
        { kind: "status", number: 1, status: "approved", by: "user:boss" },
        { kind: "status", number: 1, status: "merged", by: "agent:impl" },
      ),
    );
    const p = state.proposals.get(1)!;
    expect(p).toMatchObject({
      title: "Batch the notices",
      status: "merged",
      revision: 1,
      implementer: "impl",
      sessions: ["s-1"],
      seq: 7,
    });
    expect(p.materials).toEqual([
      { kind: "pr", label: "PR #7", url: "https://x/pull/7", by: "agent:impl", at },
    ]);
    expect(p.events.map((e) => e.kind)).toEqual([
      "created",
      "revised",
      "ready",
      "implementation_started",
      "material_added",
      "approved",
      "merged",
    ]);
    expect(state.lastSeq).toBe(7);
  });

  it("a batch gathers the comments it names, and puts a ready proposal back to drafting", () => {
    const state = foldLedger(
      lines(
        { kind: "created", number: 1, title: "T", author: "dev", delegatedBy: "boss", brief: "b" },
        { kind: "status", number: 1, status: "ready", by: "agent:dev" },
        {
          kind: "comment",
          number: 1,
          id: "c1",
          paragraphId: "p1",
          revision: 1,
          text: "why",
          by: "user:boss",
        },
        {
          kind: "comment",
          number: 1,
          id: "c2",
          paragraphId: "p2",
          revision: 1,
          text: "how",
          by: "user:boss",
        },
        {
          kind: "comment",
          number: 1,
          id: "c3",
          paragraphId: "p2",
          revision: 1,
          text: "later",
          by: "user:boss",
        },
        { kind: "batch", number: 1, id: "b1", commentIds: ["c1", "c2"], by: "user:boss" },
        { kind: "resolved", number: 1, commentId: "c1", text: "added", by: "agent:dev" },
      ),
    );
    const p = state.proposals.get(1)!;
    expect(p.status).toBe("drafting");
    expect(p.comments.map((c) => [c.id, c.batchId, c.resolved?.text ?? null])).toEqual([
      ["c1", "b1", "added"],
      ["c2", "b1", null],
      ["c3", null, null],
    ]);
    const requested = p.events.find((e) => e.kind === "changes_requested");
    expect(requested).toMatchObject({ by: "user:boss", text: "2" });
    // A pending comment is not an event: nobody but its author knows it exists yet.
    expect(p.events.map((e) => e.kind)).toEqual([
      "created",
      "ready",
      "changes_requested",
      "resolved",
    ]);
  });

  it("skips a line about a proposal that does not exist, and keeps counting seq", () => {
    const state = foldLedger(
      lines(
        { kind: "status", number: 9, status: "ready", by: "agent:dev" },
        { kind: "created", number: 1, title: "T", author: "dev", delegatedBy: "boss", brief: "b" },
      ),
    );
    expect([...state.proposals.keys()]).toEqual([1]);
    expect(state.lastSeq).toBe(2);
  });
});

describe("parseLedger", () => {
  it("reads one JSON object per line and skips what is not a ledger line", () => {
    const text = [
      JSON.stringify({
        seq: 1,
        at,
        kind: "created",
        number: 1,
        title: "T",
        author: "a",
        delegatedBy: "u",
        brief: "b",
      }),
      "not json",
      JSON.stringify({ hello: "world" }),
      "",
      JSON.stringify({ seq: 2, at, kind: "status", number: 1, status: "ready", by: "agent:a" }),
    ].join("\n");
    expect(parseLedger(text).map((l) => l.seq)).toEqual([1, 2]);
  });
});

describe("Ledger", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "proposals-ledger-"));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("lives at <root>/<project>/organizations/<org>/proposals.jsonl", () => {
    expect(ledgerPath("/r", "proj", "acme")).toBe(
      path.join("/r", "proj", "organizations", "acme", "proposals.jsonl"),
    );
  });

  it("appends with the next seq, applies once written, and replays to the same state", async () => {
    const file = ledgerPath(root, "proj", "acme");
    let clock = 1_000;
    const ledger = new Ledger(file, () => (clock += 1000));
    await ledger.load();
    expect(ledger.nextNumber()).toBe(1);
    const a = await ledger.append({
      kind: "created",
      number: 1,
      title: "T",
      author: "dev",
      delegatedBy: "boss",
      brief: "b",
    });
    const b = await ledger.append({ kind: "status", number: 1, status: "ready", by: "agent:dev" });
    expect([a.seq, b.seq]).toEqual([1, 2]);
    expect(a.at).toBe(new Date(2000).toISOString());
    expect(ledger.get(1)?.status).toBe("ready");
    expect(ledger.nextNumber()).toBe(2);

    const again = new Ledger(file);
    await again.load();
    expect(again.get(1)).toEqual(ledger.get(1));
    expect(again.lastSeq()).toBe(2);
  });

  it("serializes concurrent appends: every line gets its own seq, in call order", async () => {
    const ledger = new Ledger(ledgerPath(root, "proj", "acme"));
    await ledger.load();
    const written = await Promise.all(
      [1, 2, 3].map((n) =>
        ledger.append({
          kind: "created",
          number: n,
          title: `T${n}`,
          author: "dev",
          delegatedBy: "boss",
          brief: "b",
        }),
      ),
    );
    expect(written.map((l) => l.seq)).toEqual([1, 2, 3]);
    const text = await fs.readFile(ledger.file, "utf8");
    expect(text.trim().split("\n")).toHaveLength(3);
  });
});
