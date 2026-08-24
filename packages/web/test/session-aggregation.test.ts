/**
 * One Session list across several machines (state/sessions.tsx).
 *
 * A Session lives on the server whose filesystem its workspace is on, so a Project's list is
 * not one server's answer — it is every one of them, merged. Everything that can go wrong
 * here goes wrong QUIETLY, which is why these are pinned:
 *
 * - A machine's rows missing entirely. That is the bug this feature exists to fix: the rows
 *   were there while browsing (add() holds them in memory) and gone after a refresh.
 * - A shared page cursor. Each server pages its own Sessions with its own offsets, so one
 *   cursor across sources asks machine B for rows only machine A had reached, skipping
 *   whatever sat in between — with a list that still looks plausible.
 * - Ownership not recorded. Every later call about a Session is routed by that map; a row
 *   listed without it is asked of THIS server, which does not have it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "@prismshadow/penguin-server/api";

const listSessions = vi.fn();
vi.mock("../src/api/endpoints", () => ({
  listSessions: (...args: unknown[]) => listSessions(...args),
  getPrefs: () => Promise.resolve({ prefs: {} }),
  putPrefs: () => Promise.resolve({}),
  getMachines: () => Promise.resolve({ machines: [] }),
}));

const { createSessionsStore } = await import("../src/state/sessions");
const { machineForSession, forgetSessionMachines } = await import("../src/lib/session-machines");

const REMOTE = "kUkIyqU-1GOfXgKD";

function session(sessionId: string, createdAt: string, workspace = "/w"): SessionInfo {
  return {
    sessionId,
    projectId: "default_project",
    agentId: "default_agent",
    provider: "custom",
    modelId: "deepseek-v4-flash",
    workspace,
    approvalMode: "allow-all",
    createdAt,
    lastActiveAt: createdAt,
    status: "idle",
    hasTrace: true,
  } as SessionInfo;
}

/** A store already pointed at one Agent and one machine, as the Provider would leave it. */
function storeWithMachine() {
  const store = createSessionsStore();
  store.setState({
    projectId: "default_project",
    agentIds: ["default_agent"],
    machineIds: [REMOTE],
  });
  return store;
}

beforeEach(() => {
  listSessions.mockReset();
  forgetSessionMachines();
});

describe("reload across machines", () => {
  it("lists both servers' Sessions, newest first, and remembers where each lives", async () => {
    listSessions.mockImplementation(async (_p: string, _a: string, _o: unknown, source: unknown) =>
      source === REMOTE
        ? {
            sessions: [
              session("remote-new", "2026-08-24T10:00:00.000Z", "/home/k/penguin-harness"),
            ],
            counts: { active: 5, archived: 0, subagent: 0, schedule: 0 },
          }
        : {
            sessions: [
              session("local-newest", "2026-08-24T11:00:00.000Z"),
              session("local-old", "2026-08-24T09:00:00.000Z"),
            ],
            counts: { active: 8, archived: 0, subagent: 0, schedule: 0 },
          },
    );

    const store = storeWithMachine();
    await store.getState().reload();

    // Concatenating two sorted lists does not give a sorted list; the merge has to re-sort.
    expect(store.getState().sessions.map((s) => s.sessionId)).toEqual([
      "local-newest",
      "remote-new",
      "local-old",
    ]);
    // Routing: without this, every later call about the remote row asks this server.
    expect(machineForSession("remote-new")).toBe(REMOTE);
    expect(machineForSession("local-newest")).toBeNull();
    // Counts are SUMMED, or the folder badge would contradict the rows under it.
    expect(store.getState().countsByAgent.get("default_agent")?.active).toBe(13);
  });

  it("keeps this server's Sessions when a machine cannot answer", async () => {
    // An Agent is per-server: a machine that simply does not have this one answers 404, and
    // that is the ordinary case, not a reason to show an empty list.
    listSessions.mockImplementation(
      async (_p: string, _a: string, _o: unknown, source: unknown) => {
        if (source === REMOTE) throw new Error("404");
        return { sessions: [session("local-1", "2026-08-24T11:00:00.000Z")], counts: undefined };
      },
    );
    const store = storeWithMachine();
    await store.getState().reload();
    expect(store.getState().sessions.map((s) => s.sessionId)).toEqual(["local-1"]);
  });
});

describe("paging across machines", () => {
  it("advances each source on its own cursor", async () => {
    // First page: this server returns a full page with more behind it; the machine returns
    // one row and is done.
    listSessions.mockImplementation(async (_p: string, _a: string, opts: any, source: unknown) => {
      if (source === REMOTE) {
        return opts.offset === 0
          ? { sessions: [session("r1", "2026-08-24T10:00:00.000Z")], counts: { active: 1 } }
          : { sessions: [] };
      }
      return opts.offset === 0
        ? {
            sessions: Array.from({ length: 21 }, (_, i) =>
              session(`l${i}`, `2026-08-24T11:${String(59 - i).padStart(2, "0")}:00.000Z`),
            ),
            counts: { active: 40 },
          }
        : { sessions: [session("l-next", "2026-08-24T08:00:00.000Z")] };
    });

    const store = storeWithMachine();
    await store.getState().reload();
    listSessions.mockClear();
    await store.getState().loadMoreFor(["default_agent"], "active");

    // This server is asked from where IT stopped — one page (SIDEBAR_PAGE_SIZE) consumed.
    // The machine had no more and is not asked at all: under a SHARED cursor it would have
    // been asked at this server's offset instead of its own, skipping every row in between.
    const offsets = listSessions.mock.calls.map((c) => [c[3] ?? null, (c[2] as any).offset]);
    expect(offsets).toEqual([[null, 10]]);
    expect(store.getState().sessions.some((s) => s.sessionId === "l-next")).toBe(true);
  });
});
