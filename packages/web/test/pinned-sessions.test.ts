/**
 * Row pins in the sidebar's conversation list (lib/pinned-sessions.ts), kept per Project in
 * localStorage because the server has no pin field.
 *
 * - Given no Project or nothing stored, nothing is pinned, and reading writes nothing.
 * - Toggling, saving and loading round-trips the user's set; Projects keep separate sets.
 * - A malformed stored value reads as nothing pinned, keeping the well-formed ids.
 * - A storage that throws (quota, private mode, a throwing getter) never escapes: saving is a
 *   no-op and loading is empty.
 * - Toggling adds or removes one id without mutating the input; removing an unpinned id
 *   returns the same set, so the caller skips its writes.
 * - The pinned cluster tops a group's active rows, each partition keeping its order; folder
 *   rows ignore pins and a pin of a deleted Session surfaces nothing.
 */
import { describe, expect, it } from "vitest";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import {
  loadPinnedSessions,
  pinnedSessionsKey,
  removePinnedSession,
  savePinnedSessions,
  togglePinnedSession,
} from "../src/lib/pinned-sessions";
import type { PinnedSessionsStorage } from "../src/lib/pinned-sessions";
import { partitionSessions, pinnedFirst } from "../src/lib/session-grouping";
import { blockedStorage, memoryStorage } from "./helpers/storage";

/** Minimal SessionInfo (session-grouping.test.ts convention: only the fields the logic reads matter). */
function session(
  sessionId: string,
  over: { archived?: boolean; source?: "schedule" | "subagent" } = {},
): SessionInfo {
  return {
    sessionId,
    projectId: "proj",
    agentId: "default_agent",
    provider: "custom",
    modelId: "claude-4-8",
    workspace: "/w",
    approvalMode: "allow-all",
    sandbox: { mode: "danger-full-access", network: "open" },
    createdAt: "2026-08-13T00:00:00.000Z",
    lastActiveAt: "2026-08-13T00:00:00.000Z",
    status: "idle",
    pendingApprovalCount: 0,
    pendingFollowUpCount: 0,
    hasTrace: false,
    archived: over.archived ?? false,
    ...(over.source ? { source: over.source } : {}),
  };
}

describe("persisted pins (per-Project localStorage)", () => {
  it("nothing stored — or no Project yet — is the empty set, and reading never writes", () => {
    const s = memoryStorage();
    expect(loadPinnedSessions("p1", s).size).toBe(0);
    expect(loadPinnedSessions(null, s).size).toBe(0);
    expect(s.map.size).toBe(0); // load never writes; save without a Project is a no-op
    savePinnedSessions(null, new Set(["a"]), s);
    expect(s.map.size).toBe(0);
  });

  it("toggle → save → load round-trips the user's set (fresh instance per load)", () => {
    const s = memoryStorage();
    let set = loadPinnedSessions("p1", s);
    set = togglePinnedSession(set, "session-a");
    set = togglePinnedSession(set, "session-b");
    savePinnedSessions("p1", set, s);
    const restored = loadPinnedSessions("p1", s);
    expect(restored).toEqual(new Set(["session-a", "session-b"]));
    expect(restored).not.toBe(set);
  });

  it("Projects are isolated: each key holds its own set", () => {
    const s = memoryStorage();
    savePinnedSessions("p1", new Set(["a"]), s);
    savePinnedSessions("p2", new Set(["b", "c"]), s);
    expect([...loadPinnedSessions("p1", s)]).toEqual(["a"]);
    expect(loadPinnedSessions("p2", s)).toEqual(new Set(["b", "c"]));
    expect(loadPinnedSessions("p3", s).size).toBe(0);
  });

  it("malformed JSON / non-array shapes degrade to empty; junk array elements are dropped", () => {
    const s = memoryStorage();
    for (const raw of ["{not json", '"a"', "42", "null", "{}", ""]) {
      s.map.set(pinnedSessionsKey("p1"), raw);
      expect(loadPinnedSessions("p1", s).size).toBe(0);
    }
    s.map.set(pinnedSessionsKey("p1"), '["a", 7, null, {"x": 1}]');
    expect([...loadPinnedSessions("p1", s)]).toEqual(["a"]);
  });

  it("storage throwing (quota/private mode): save does not throw, load yields empty", () => {
    const broken = blockedStorage();
    expect(() => savePinnedSessions("p1", new Set(["a"]), broken)).not.toThrow();
    expect(loadPinnedSessions("p1", broken).size).toBe(0);
  });

  it("storage whose GETTER throws (blocked site data / partitioned iframe) degrades instead of escaping", () => {
    // These loaders run from useState initializers, so an escaping SecurityError would
    // take the sidebar's first render down — hence localStorage is resolved inside the try.
    const hostile = {
      get getItem(): never {
        throw new Error("SecurityError");
      },
      setItem: () => undefined,
    } as unknown as PinnedSessionsStorage;
    expect(() => loadPinnedSessions("p1", hostile)).not.toThrow();
    expect(loadPinnedSessions("p1", hostile).size).toBe(0);
  });
});

describe("togglePinnedSession / removePinnedSession", () => {
  it("toggle adds an absent id and removes a present one, without mutating the input", () => {
    const initial = new Set(["a"]);
    const withB = togglePinnedSession(initial, "b");
    expect(withB).toEqual(new Set(["a", "b"]));
    expect(initial.has("b")).toBe(false); // input untouched (React state discipline)
    expect(togglePinnedSession(withB, "a")).toEqual(new Set(["b"]));
  });

  it("remove prunes a pinned id and returns the SAME set when it wasn't pinned (delete-path fast exit)", () => {
    const pins: ReadonlySet<string> = new Set(["a", "b"]);
    expect(removePinnedSession(pins, "a")).toEqual(new Set(["b"]));
    expect(removePinnedSession(pins, "zzz")).toBe(pins); // same reference: caller skips state + storage writes
  });
});

describe("pinned ordering composes with the group lists", () => {
  it("the pinned cluster tops a group's active rows, each partition keeping its own order; stale ids are inert", () => {
    const rows = [
      session("s1"),
      session("s2"),
      session("s3"),
      session("s4", { archived: true }),
      session("s5", { source: "subagent" }),
    ];
    // Both grouping modes feed the shared group body the same way: partition first,
    // then pinnedFirst over the ACTIVE rows only (pinning is an active-list priority).
    const parts = partitionSessions(rows);
    const pins = new Set(["s3", "deleted-elsewhere"]);
    const active = pinnedFirst(parts.active, (s) => s.sessionId, pins);
    expect(active.map((s) => s.sessionId)).toEqual(["s3", "s1", "s2"]);
    // Folder rows keep chronological order and membership regardless of pins …
    expect(parts.archived.map((s) => s.sessionId)).toEqual(["s4"]);
    expect(parts.subagent.map((s) => s.sessionId)).toEqual(["s5"]);
    // … and a stored id of a Session deleted elsewhere never surfaces a row.
    expect(active.some((s) => s.sessionId === "deleted-elsewhere")).toBe(false);
  });
});
