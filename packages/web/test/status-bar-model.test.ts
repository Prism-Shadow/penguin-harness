/**
 * The status bar's counting and marking rules (lib/status-bar-model), driven straight:
 * the component only wires them, so every rule is a plain call here.
 *
 * - An opened Session that a poll first reads idle after a running one is marked — once
 *   per transition, only if opened, never re-marked while it still carries the mark.
 * - `viewed` is this browser's own opened set — the second count and the list are the same
 *   bookkeeping, so an x (which removes from the set) is the one thing that lowers it.
 * - The working machine is the machine of the most recently viewed Session the poll still
 *   holds a row for.
 * - The two sets persist under their keys, capped, oldest evicted; an unreadable store
 *   reads as empty and a refused write costs only persistence.
 * - The company a row's Session belongs to is named only when the shell's own organization
 *   list holds it — a row without one, or of a company the shell cannot show, answers null,
 *   and the click keeps its old behaviour: the jump alone.
 */
import { describe, expect, it } from "vitest";
import type { HarnessStatusSession } from "@prismshadow/penguin-server/api";
import {
  CAP,
  IdSet,
  MARKS_KEY,
  OPENED_KEY,
  byLatest,
  companyOfRow,
  gigabytes,
  loadIdSet,
  marksForTransitions,
  reachOfRow,
  saveIdSet,
  viewedCount,
  workingMachineOf,
} from "../src/lib/status-bar-model";
import type { StatusBarStorage } from "../src/lib/status-bar-model";

const row = (
  sessionId: string,
  status: HarnessStatusSession["status"],
  over: Partial<HarnessStatusSession> = {},
): HarnessStatusSession => ({
  sessionId,
  projectId: "p1",
  agentId: "general",
  title: `Session ${sessionId}`,
  workspace: `/tmp/workspaces/${sessionId}`,
  client: "web",
  status,
  lastActiveAt: "2026-10-22T00:00:00.000Z",
  machineId: null,
  orgId: null,
  ...over,
});

/** The poll-to-poll statuses, typed as the transition rule reads them. */
const statuses = (
  pairs: readonly (readonly [string, HarnessStatusSession["status"]])[],
): ReadonlyMap<string, HarnessStatusSession["status"]> => new Map(pairs);

/** A storage that remembers what it was given, as the page's own localStorage would. */
class MemoryStorage {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

describe("status bar bookkeeping sets", () => {
  it("adds, answers and deletes; re-adding moves an id to the end", () => {
    const ids = new IdSet(["a", "b"]);
    expect(ids.has("a")).toBe(true);
    expect(ids.has("c")).toBe(false);
    expect(ids.size).toBe(2);
    ids.add("c");
    ids.add("a"); // a was already there: it keeps one entry, now the newest
    expect(ids.toArray()).toEqual(["b", "c", "a"]);
    ids.delete("c");
    expect(ids.toArray()).toEqual(["b", "a"]);
  });

  it("evicts the oldest beyond the cap (and trims a too-long load)", () => {
    const ids = new IdSet([], 3);
    for (const id of ["a", "b", "c", "d"]) ids.add(id);
    expect(ids.toArray()).toEqual(["b", "c", "d"]);
    expect(new IdSet(["a", "b", "c", "d"], 2).toArray()).toEqual(["c", "d"]);
    expect(new IdSet(["a", "b"], 1).toArray()).toEqual(["b"]);
  });

  it("persists under its key and loads back; a malformed value reads as empty", () => {
    const storage: StatusBarStorage = new MemoryStorage();
    const ids = new IdSet(["x", "y"]);
    saveIdSet(storage, OPENED_KEY, ids);
    expect(loadIdSet(storage, OPENED_KEY).toArray()).toEqual(["x", "y"]);
    // A key the bar never wrote, a value some older page left malformed, an empty array:
    // every one reads as a fresh empty set, never as a crash.
    expect(loadIdSet(storage, MARKS_KEY).toArray()).toEqual([]);
    storage.setItem(MARKS_KEY, "not json");
    expect(loadIdSet(storage, MARKS_KEY).toArray()).toEqual([]);
    storage.setItem(MARKS_KEY, JSON.stringify([1, null, "ok"]));
    expect(loadIdSet(storage, MARKS_KEY).toArray()).toEqual(["ok"]);
  });

  it("no storage at all still works in memory, and a full one only costs persistence", () => {
    expect(loadIdSet(null, OPENED_KEY).toArray()).toEqual([]);
    const refusing: StatusBarStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("full");
      },
    };
    const ids = new IdSet(["a"]);
    expect(() => saveIdSet(refusing, OPENED_KEY, ids)).not.toThrow();
  });

  it("the cap is a bounded number, so the sets cannot grow without end", () => {
    expect(CAP).toBeGreaterThan(0);
    expect(CAP).toBeLessThanOrEqual(500);
  });
});

describe("the idle mark (曾打开的 session 转 idle 时标记一次)", () => {
  const opened = new Set(["opened-running", "opened-compact"]);
  const marked = new Set<string>();

  it("marks an opened Session a poll first reads idle after a running one", () => {
    const prev = statuses([
      ["opened-running", "running"],
      ["opened-compact", "compacting"],
      ["never-opened", "running"],
    ]);
    const newly = marksForTransitions(
      [row("opened-running", "idle"), row("opened-compact", "idle"), row("never-opened", "idle")],
      prev,
      opened,
      marked,
    );
    expect(newly).toEqual(["opened-running", "opened-compact"]);
  });

  it("marks a Session only once per transition, and only one that was opened", () => {
    const prev = statuses([["opened-running", "running"]]);
    const first = marksForTransitions([row("opened-running", "idle")], prev, opened, marked);
    expect(first).toEqual(["opened-running"]);
    // The mark is on: the same idle row is not marked again.
    const second = marksForTransitions(
      [row("opened-running", "idle")],
      prev,
      opened,
      new Set(["opened-running"]),
    );
    expect(second).toEqual([]);
    // A Session nobody opened never gets a mark, however it flipped.
    const unopened = marksForTransitions(
      [row("never-opened", "idle")],
      statuses([["never-opened", "running"]]),
      opened,
      marked,
    );
    expect(unopened).toEqual([]);
  });

  it("a Session idle on its first observation, or still running, is not marked", () => {
    expect(marksForTransitions([row("opened-running", "idle")], new Map(), opened, marked)).toEqual(
      [],
    );
    expect(
      marksForTransitions(
        [row("opened-running", "running")],
        statuses([["opened-running", "running"]]),
        opened,
        marked,
      ),
    ).toEqual([]);
  });
});

describe("the counts and the machine (我查看了多少个 · 最近查看所在 machine)", () => {
  it("viewed is the opened set's own size — the x is the one thing that lowers it", () => {
    const opened = new IdSet(["a", "b", "c"]);
    expect(viewedCount(opened)).toBe(3);
    opened.delete("b"); // the row's x: 移除即关闭，计数减一
    expect(viewedCount(opened)).toBe(2);
    expect(viewedCount(new IdSet())).toBe(0);
  });

  it("the working machine is the newest viewed Session's, falling back over the rest", () => {
    // Newest-first insertion: a was viewed before b, b before c.
    const opened = new IdSet(["a", "b", "c"]);
    const rows = [
      row("a", "idle", { machineId: "m-old" }),
      row("c", "idle", { machineId: "m-company" }),
    ];
    expect(workingMachineOf(opened, rows)).toBe("m-company"); // c, the most recent
    // The most recent one's machine went quiet: the next viewed one answers.
    const withoutC = rows.filter((r) => r.sessionId !== "c");
    expect(workingMachineOf(opened, withoutC)).toBe("m-old");
    // b holds no row at all: it is skipped, not fatal.
    expect(workingMachineOf(new IdSet(["b"]), rows)).toBeNull();
    // Nothing viewed, or nothing answered: this server.
    expect(workingMachineOf(new IdSet(), rows)).toBeNull();
  });

  it("the list is newest first, ids breaking ties the server's own order", () => {
    const rows = [
      row("old", "idle", { lastActiveAt: "2026-10-21T00:00:00.000Z" }),
      row("tie-b", "idle", { lastActiveAt: "2026-10-22T00:00:00.000Z" }),
      row("tie-a", "idle", { lastActiveAt: "2026-10-22T00:00:00.000Z" }),
      row("new", "running", { lastActiveAt: "2026-10-23T00:00:00.000Z" }),
    ];
    expect(byLatest(rows).map((r) => r.sessionId)).toEqual(["new", "tie-b", "tie-a", "old"]);
    expect(byLatest(rows)).not.toBe(rows); // a copy: the poll's answer is never reordered
  });

  it("memory reads in one decimal of GB", () => {
    expect(gigabytes(0)).toBe("0.0");
    expect(gigabytes(1024 ** 3)).toBe("1.0");
    expect(gigabytes(6.2 * 1024 ** 3)).toBe("6.2");
    expect(gigabytes(249 * 1024 ** 3)).toBe("249.0");
  });
});

describe("the company a row belongs to (点击时先到所属 company)", () => {
  const organizations = [
    { projectId: "p1", orgId: "acme" },
    { projectId: "p2", orgId: "acme" },
    { projectId: "p1", orgId: "globex" },
  ];

  it("names the pair when the shell's own list holds it", () => {
    expect(companyOfRow(row("s", "idle", { orgId: "acme" }), organizations)).toEqual({
      projectId: "p1",
      orgId: "acme",
    });
    expect(
      companyOfRow(row("s", "idle", { projectId: "p1", orgId: "globex" }), organizations),
    ).toEqual({ projectId: "p1", orgId: "globex" });
  });

  it("two same-named organizations are different companies: the row answers its own Project's", () => {
    expect(
      companyOfRow(row("s", "idle", { projectId: "p2", orgId: "acme" }), organizations),
    ).toEqual({
      projectId: "p2",
      orgId: "acme",
    });
  });

  it("reads null when the row names none, or one this shell cannot show", () => {
    // A Session no organization holds (a development one), a company of a Project this
    // shell has no page for, and a list that has not loaded yet: each keeps the click's
    // old behaviour — the jump, with no company reached.
    expect(companyOfRow(row("s", "idle", { orgId: null }), organizations)).toBeNull();
    expect(
      companyOfRow(row("s", "idle", { projectId: "p9", orgId: "acme" }), organizations),
    ).toBeNull();
    expect(companyOfRow(row("s", "idle", { orgId: "acme" }), [])).toBeNull();
  });
});

describe("reachOfRow", () => {
  const organizations = [
    { projectId: "p1", orgId: "acme" },
    { projectId: "p2", orgId: "globex" },
  ];

  it("names the company reach for a listed company row from either mode", () => {
    // Wherever the shell stands, the reach is the same pair: the store's setters are no-ops
    // when it already stands there (company mode, that organization).
    for (const mode of ["dev", "company"] as const) {
      expect(reachOfRow(row("s", "idle", { orgId: "acme" }), organizations, mode, true)).toEqual({
        workMode: "company",
        projectId: "p1",
        orgId: "acme",
      });
    }
  });

  it("takes the shell back to development for a normal row while it stands in company mode", () => {
    // The reach this round adds, the company side's mirror image: a row no organization
    // holds is the development list's to locate, and the company sidebar on screen cannot
    // answer for it — so the shell leaves company mode first, and the ask waits out the
    // switch for the development list to mount and answer.
    expect(reachOfRow(row("s", "idle"), organizations, "company", true)).toEqual({
      workMode: "dev",
    });
  });

  it("reaches nothing for a normal row the shell already lists in development", () => {
    expect(reachOfRow(row("s", "idle"), organizations, "dev", true)).toBeNull();
  });

  it("keeps the jump-only degradation for a company the shell cannot show, and when company mode is unavailable", () => {
    // A row of a company the shell's own list does not hold is not a normal Session: it
    // reaches nothing from company mode either — the jump alone, as before this round.
    expect(
      reachOfRow(
        row("s", "idle", { projectId: "p9", orgId: "acme" }),
        organizations,
        "company",
        true,
      ),
    ).toBeNull();
    // Company mode unavailable: no company reach may be made, and the shell stands in
    // development, so neither kind of row reaches anywhere.
    expect(reachOfRow(row("s", "idle", { orgId: "acme" }), organizations, "dev", false)).toBeNull();
    expect(reachOfRow(row("s", "idle"), organizations, "dev", false)).toBeNull();
  });
});
