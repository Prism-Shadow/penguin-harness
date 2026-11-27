/**
 * Comments on targets: a section's passage as before, a scope entry, a test entry, a changed
 * file and a range of a changed file's lines. A diff target records the head and base it was
 * written at and keeps the lines it was on; once a branch moves the comment stays, outdated, and
 * a new comment at the old commits is refused, as is any target the revision or the diff does
 * not have. Targeted comments go into the request-changes batch and take edit, withdraw and
 * resolve like any other. A `company.db` whose comments table predates the target columns gains
 * them when opened, its comments reading as before. The impl's `+N/−M` comes with the detail:
 * computing first, then the totals, announced by an `impl_stat` event.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sqlite from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProposalDetail } from "@prismshadow/penguin-server/api";
import { ProposalService, companyDbPath, sectionSource } from "../src/index.js";
import { targetParam } from "../src/comment-targets.js";
import type { DiffMirror } from "../src/ports.js";
import type { RunGh } from "../src/pr-status.js";
import { BOSS, DEV, FakeOrgGateway, ORG, PROJECT } from "./fake-org.js";
import { FakeForge, FakeMirror } from "./graph-fakes.js";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);
const D = "d".repeat(40);

const DOC = `---
title: Batch the notices
scope:
  - file: src/notices.ts
tests:
  - kind: new
    file: test/notices.test.ts
    group: unit
    description: one line per sweep
---

## Change

Batch them in \`notifyTicket\`.

## Purpose

Fewer lines.

## Test

"one line per sweep".
`;

const PATCH = "@@ -1,2 +1,3 @@\n export {};\n-old\n+new\n+more";

let root: string;
let gateway: FakeOrgGateway;
let service: ProposalService;
/** The branch tips GitHub reports; a test moves them. */
let tips: Record<string, string>;
let ghDown: boolean;

const gh: RunGh = async (args) => {
  if (ghDown) throw new Error("HTTP 503: GitHub is down");
  const p = args[1]!;
  const branch = /^repos\/([^/]+\/[^/]+)\/branches\/(.+)$/.exec(p);
  if (branch !== null) {
    const sha = tips[`${branch[1]}:${decodeURIComponent(branch[2]!)}`];
    if (sha === undefined) throw new Error(`HTTP 404: ${p}`);
    return JSON.stringify(sha);
  }
  if (p === "repos/acme/site/compare/main...me:feat/x") {
    return JSON.stringify({
      merge_base: C,
      ahead: 1,
      behind: 0,
      url: "https://github.com/acme/site/compare/main...me:feat/x",
      files: [
        {
          filename: "src/notices.ts",
          status: "modified",
          additions: 2,
          deletions: 1,
          patch: PATCH,
        },
      ],
    });
  }
  throw new Error(`HTTP 404: ${p}`);
};

function open(): ProposalService {
  return new ProposalService({
    gateway,
    agents: {
      pluginVersion: async () => ({ installed: null, library: null }),
      updatePlugin: async () => undefined,
      removeSkill: async () => undefined,
    },
    root,
    log: { line: () => undefined },
    forge: new FakeForge(),
    mirrorFor: () => new FakeMirror(),
    // No mirror built: the diff is GitHub's comparison, the path a fresh organization takes.
    diffMirrorFor: () => ({ exists: () => false }) as unknown as DiffMirror,
    gh,
    // The graph stacks on main, the impl base registered below (impl-on-graph.ts).
    pluginConfig: { get: () => ({ deliveryBase: "main" }) },
    git: async () =>
      [
        "origin\thttps://github.com/acme/site.git (fetch)",
        "fork\tgit@github.com:me/site.git (fetch)",
      ].join("\n"),
  });
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "comment-targets-"));
  const workspace = path.join(root, "workspace");
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  await fs.writeFile(path.join(workspace, "src", "notices.ts"), "export {};\n");
  gateway = new FakeOrgGateway(workspace);
  tips = { "me/site:feat/x": A, "acme/site:main": B };
  ghDown = false;
  service = open();
});

afterEach(async () => {
  service.close();
  await fs.rm(root, { recursive: true, force: true });
});

/** A published proposal with an impl branch pair registered. */
async function proposal(): Promise<number> {
  const created = await service.create(
    PROJECT,
    ORG,
    { author: "acme_dev", brief: "Batch the notices" },
    BOSS,
  );
  const n = created.number;
  await service.publish(PROJECT, ORG, n, DOC, DEV);
  await service.ready(PROJECT, ORG, n, DEV);
  await service.setImpl(
    PROJECT,
    ORG,
    n,
    { head: { remote: "fork", branch: "feat/x" }, base: { remote: "origin", branch: "main" } },
    DEV,
  );
  return n;
}

const lines = (over: Record<string, unknown> = {}) => ({
  kind: "change-lines" as const,
  path: "src/notices.ts",
  side: "new" as const,
  start: 2,
  end: 3,
  headSha: A,
  baseSha: B,
  ...over,
});

async function refusal(run: () => Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await run();
  } catch (err) {
    const e = err as { status: number; code: string };
    return { status: e.status, code: e.code };
  }
  throw new Error("not refused");
}

/** The detail once its `+N/−M` stopped computing. */
async function settled(n: number): Promise<ProposalDetail> {
  for (let i = 0; i < 50; i++) {
    const d = await service.get(PROJECT, ORG, n, BOSS);
    if (d.implStat?.state !== "computing") return d;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("still computing");
}

describe("comment targets", () => {
  it("lands a comment on a passage, a scope entry, a test entry, a changed file and changed lines", async () => {
    const n = await proposal();
    const change = (await service.get(PROJECT, ORG, n, BOSS)).sections[0]!;
    const start = sectionSource(change).indexOf("notifyTicket");
    await service.comment(
      PROJECT,
      ORG,
      n,
      { sectionId: change.id, start, end: start + 12, quote: "notifyTicket", text: "passage" },
      BOSS,
    );
    const say = (target: Parameters<typeof targetParam>[0], text: string) =>
      service.comment(PROJECT, ORG, n, { target: targetParam(target), text }, BOSS);
    await say({ kind: "scope", file: "src/notices.ts", scopeKind: "edit" }, "scope");
    await say({ kind: "test", file: "test/notices.test.ts" }, "test");
    await say({ kind: "change-file", path: "src/notices.ts", headSha: A, baseSha: B }, "file");
    const detail = await say(lines(), "lines");

    const byText = new Map(detail.comments.map((c) => [c.text, c]));
    expect(byText.get("passage")!.target).toBeUndefined();
    expect(byText.get("passage")!).toMatchObject({ sectionId: change.id, quote: "notifyTicket" });
    expect(byText.get("scope")!).toMatchObject({
      target: { kind: "scope", file: "src/notices.ts", scopeKind: "edit" },
      sectionId: "",
      quote: "src/notices.ts",
      revision: 1,
    });
    expect(byText.get("test")!.target).toEqual({ kind: "test", file: "test/notices.test.ts" });
    expect(byText.get("file")!).toMatchObject({
      target: { kind: "change-file", path: "src/notices.ts", headSha: A, baseSha: B },
      quote: "src/notices.ts",
    });
    // A line range keeps the lines it is on, read from the diff, not from the caller.
    expect(byText.get("lines")!).toMatchObject({ target: lines(), quote: "new\nmore" });

    // An agent reads each with its target named, and a line comment with its lines.
    const { text } = await service.comments(PROJECT, ORG, n, { pending: false }, BOSS);
    expect(text).toContain("(on scope edit src/notices.ts)");
    expect(text).toContain("(on tests test/notices.test.ts)");
    expect(text).toContain("(on changed file src/notices.ts at aaaaaaa)");
    expect(text).toContain(
      "(on lines 2–3 (new) of src/notices.ts at aaaaaaa): lines\n    | new\n    | more",
    );
    // The old side reads the old lines.
    const old = await say(lines({ side: "old", start: 2, end: 2 }), "old side");
    expect(old.comments.find((c) => c.text === "old side")!.quote).toBe("old");

    // A new service over the same store reads every target back.
    service.close();
    service = open();
    const again = await service.get(PROJECT, ORG, n, BOSS);
    expect(again.comments.map((c) => c.target ?? null)).toEqual(
      detail.comments
        .map((c) => c.target ?? null)
        .concat([lines({ side: "old", start: 2, end: 2 })]),
    );
  });

  it("keeps a line comment once the branch moves, and refuses one at the old commits", async () => {
    const n = await proposal();
    await service.comment(PROJECT, ORG, n, { target: lines(), text: "before" }, BOSS);
    tips["me/site:feat/x"] = D;
    const moved = await refusal(() =>
      service.comment(PROJECT, ORG, n, { target: lines(), text: "late" }, BOSS),
    );
    expect(moved).toEqual({ status: 400, code: "comment_target" });
    const detail = await settled(n);
    // The detail's totals are at the new head; the comment still names the old one and its lines.
    expect(detail.implStat).toMatchObject({ state: "ready", headSha: D, baseSha: B });
    expect(detail.comments).toHaveLength(1);
    expect(detail.comments[0]).toMatchObject({ target: { headSha: A }, quote: "new\nmore" });
    // At the new commits it is taken again.
    const now = await service.comment(
      PROJECT,
      ORG,
      n,
      { target: lines({ headSha: D }), text: "after" },
      BOSS,
    );
    expect(now.comments).toHaveLength(2);
  });

  it("refuses a target the revision or the diff does not have, and a malformed one", async () => {
    const n = await proposal();
    const refused = (target: Parameters<typeof targetParam>[0]) =>
      refusal(() =>
        service.comment(PROJECT, ORG, n, { target: targetParam(target), text: "x" }, BOSS),
      );
    const bad = { status: 400, code: "comment_target" };
    expect(await refused({ kind: "scope", file: "src/other.ts", scopeKind: "edit" })).toEqual(bad);
    expect(await refused({ kind: "scope", file: "src/notices.ts", scopeKind: "new" })).toEqual(bad);
    expect(await refused({ kind: "test", file: "test/other.test.ts" })).toEqual(bad);
    expect(
      await refused({ kind: "change-file", path: "src/other.ts", headSha: A, baseSha: B }),
    ).toEqual(bad);
    // Line 9 is not in any hunk; the old side has no line 3.
    expect(await refused(lines({ start: 2, end: 9 }))).toEqual(bad);
    expect(await refused(lines({ side: "old", start: 3, end: 3 }))).toEqual(bad);

    // The param itself: strict, field by field.
    expect(() => targetParam({ kind: "file", path: "a" })).toThrow(/target.kind/);
    expect(() => targetParam({ kind: "test", file: "a", extra: 1 })).toThrow(/target.extra/);
    expect(() => targetParam({ kind: "test", file: "" })).toThrow(/target.file/);
    expect(() => targetParam(lines({ headSha: "abc" }))).toThrow(/target.headSha/);
    expect(() => targetParam(lines({ start: 3, end: 2 }))).toThrow(/target.end/);
    expect(() => targetParam(lines({ start: 0 }))).toThrow(/target.start/);
    expect(() => targetParam(lines({ side: "both" }))).toThrow(/target.side/);
    expect(() => targetParam(lines({ start: 1, end: 401 }))).toThrow(/at most 400 lines/);
    expect(() => targetParam([])).toThrow(/object/);
    const comments = (await service.get(PROJECT, ORG, n, BOSS)).comments;
    expect(comments).toEqual([]);
  });

  it("sends targeted comments in the request-changes batch, and edits, withdraws and resolves them as before", async () => {
    const n = await proposal();
    const scope = { kind: "scope" as const, file: "src/notices.ts", scopeKind: "edit" as const };
    await service.comment(PROJECT, ORG, n, { target: scope, text: "scope" }, BOSS);
    await service.comment(PROJECT, ORG, n, { target: lines(), text: "lines" }, BOSS);
    const third = await service.comment(
      PROJECT,
      ORG,
      n,
      { target: { kind: "test", file: "test/notices.test.ts" }, text: "drop me" },
      BOSS,
    );
    const id = (text: string) => third.comments.find((c) => c.text === text)!.id;
    await service.editComment(PROJECT, ORG, n, id("lines"), "lines, reworded", BOSS);
    await service.deleteComment(PROJECT, ORG, n, id("drop me"), BOSS);
    // Pending comments are the writer's own: the author sees none yet.
    expect((await service.get(PROJECT, ORG, n, DEV)).comments).toEqual([]);
    const sent = await service.requestChanges(PROJECT, ORG, n, BOSS);
    const batches = new Set(sent.comments.map((c) => c.batchId));
    expect(batches.size).toBe(1);
    expect([...batches][0]).not.toBeNull();
    expect(sent.comments.map((c) => c.id).sort()).toEqual([id("scope"), id("lines")].sort());
    const { text } = await service.comments(PROJECT, ORG, n, { pending: true }, DEV);
    expect(text).toContain("lines, reworded");
    const resolved = await service.resolve(PROJECT, ORG, n, id("scope"), "Kept as is.", DEV);
    expect(resolved.comments.find((c) => c.id === id("scope"))!.resolved).toMatchObject({
      text: "Kept as is.",
    });
  });

  it("keeps a scope comment on a revision that still lists the entry, and on its own revision once dropped", async () => {
    const n = await proposal();
    const scope = { kind: "scope" as const, file: "src/notices.ts", scopeKind: "edit" as const };
    await service.comment(PROJECT, ORG, n, { target: scope, text: "scope" }, BOSS);
    await service.comment(PROJECT, ORG, n, { target: lines(), text: "lines" }, BOSS);
    await service.publish(
      PROJECT,
      ORG,
      n,
      DOC.replace("Fewer lines.", "Fewer lines, really."),
      DEV,
    );
    let comments = (await service.get(PROJECT, ORG, n, BOSS)).comments;
    expect(comments.map((c) => c.revision)).toEqual([2, 2]);
    await service.publish(
      PROJECT,
      ORG,
      n,
      DOC.replace("  - file: src/notices.ts\n", "  - file: src/notices.ts\n    kind: delete\n"),
      DEV,
    );
    comments = (await service.get(PROJECT, ORG, n, BOSS)).comments;
    // The edit entry is gone: its comment stays on revision 2; the diff comment moves on.
    expect(comments.map((c) => [c.text, c.revision])).toEqual([
      ["scope", 2],
      ["lines", 3],
    ]);
  });

  it("adds the target columns to an older comments table, its comments reading as before", async () => {
    const n = await proposal();
    const change = (await service.get(PROJECT, ORG, n, BOSS)).sections[0]!;
    const start = sectionSource(change).indexOf("notifyTicket");
    const before = await service.comment(
      PROJECT,
      ORG,
      n,
      { sectionId: change.id, start, end: start + 12, quote: "notifyTicket", text: "old" },
      BOSS,
    );
    service.close();
    // The table as an older build left it: no target columns.
    const file = companyDbPath(root, PROJECT, ORG);
    const db = new sqlite.DatabaseSync(file);
    const columns = () =>
      (db.prepare(`PRAGMA table_info(proposal_comments)`).all() as Array<{ name: string }>)
        .map((c) => c.name)
        .filter((name) => name.startsWith("target_"));
    for (const name of columns()) db.exec(`ALTER TABLE proposal_comments DROP COLUMN ${name}`);
    expect(columns()).toEqual([]);
    service = open();
    const after = await service.get(PROJECT, ORG, n, BOSS);
    expect(after.comments).toEqual(before.comments);
    expect(columns()).toEqual([
      "target_kind",
      "target_path",
      "target_scope_kind",
      "target_side",
      "target_start",
      "target_end",
      "target_head",
      "target_base",
    ]);
    db.close();
    // And the table takes a targeted comment.
    const added = await service.comment(PROJECT, ORG, n, { target: lines(), text: "new" }, BOSS);
    expect(added.comments.at(-1)).toMatchObject({ target: lines(), quote: "new\nmore" });
  });
});

describe("the impl's +N/−M on the detail", () => {
  it("is computing on the first read, then the totals at the commits, announced by an event", async () => {
    const n = await proposal();
    const first = await service.get(PROJECT, ORG, n, BOSS);
    expect(first.implStat).toEqual({ state: "computing" });
    const detail = await settled(n);
    expect(detail.implStat).toEqual({
      state: "ready",
      head: { remote: "fork", repo: "me/site", branch: "feat/x" },
      base: { remote: "origin", repo: "acme/site", branch: "main" },
      headSha: A,
      baseSha: B,
      files: 1,
      additions: 2,
      deletions: 1,
      compareUrl: "https://github.com/acme/site/compare/main...me:feat/x",
    });
    const events = gateway.events.filter(
      (e) => e.type === "plugin" && (e.data as { kind: string }).kind === "impl_stat",
    );
    expect(events).toHaveLength(1);
    // No impl, no totals.
    const bare = await service.create(PROJECT, ORG, { author: "acme_dev", brief: "x" }, BOSS);
    expect((await service.get(PROJECT, ORG, bare.number, BOSS)).implStat).toBeUndefined();
  });

  it("says why when the totals cannot be read", async () => {
    const n = await proposal();
    ghDown = true;
    const detail = await settled(n);
    expect(detail.implStat).toMatchObject({ state: "unavailable" });
    expect((detail.implStat as { reason: string }).reason).toMatch(/GitHub is down|503/);
  });
});
