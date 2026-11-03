/**
 * The command palette's session completion (features/palette/session-completion.ts): the
 * query's first token starting a session id is the trigger; the rows offered are the sidebar's
 * own merged with what the servers answered for the prefix live; each entry shows the title
 * (or the untitled fallback) with the status word beside the session's id; running one
 * navigates to that session's chat page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { S } from "../src/lib/strings";
import {
  COMPLETION_CACHE_MAX,
  cachedCompletionRows,
  rememberCompletionRows,
  resetCompletionCache,
} from "../src/lib/completion-cache";
import {
  MACHINE_SOURCE_TIMEOUT_MS,
  SESSION_COMPLETION_MAX,
  SESSION_DETAIL_ID_MAX,
  askCompletionSources,
  cappedSourceQuery,
  mergeCompletionRows,
  sessionCompletionActions,
  sessionDetailId,
  sessionQueryPrefix,
  sessionStatusWord,
} from "../src/features/palette/session-completion";

const row = (over: Partial<SessionInfo> & { sessionId: string }): SessionInfo =>
  ({
    projectId: "p",
    agentId: "a",
    provider: "custom",
    modelId: "m",
    workspace: "/w",
    approvalMode: "allow-all",
    sandbox: { mode: "danger-full-access", network: "open" },
    source: "user",
    createdAt: "2026-10-18T09:00:00.000Z",
    lastActiveAt: "2026-10-18T09:00:00.000Z",
    status: "idle",
    pendingApprovalCount: 0,
    pendingFollowUpCount: 0,
    hasTrace: false,
    archived: false,
    ...over,
  }) as SessionInfo;

/** Where the entries navigate; the pure core takes the mover like the hook takes the router. */
const paths: string[] = [];
const navigate = (path: string) => paths.push(path);

describe("sessionQueryPrefix", () => {
  it("takes the first token when it starts a session id, and nothing otherwise", () => {
    expect(sessionQueryPrefix("session-")).toBe("session-");
    expect(sessionQueryPrefix("session-2026-10")).toBe("session-2026-10");
    expect(sessionQueryPrefix("  SESSION-2026 ")).toBe("session-2026");
    expect(sessionQueryPrefix("sess")).toBeNull();
    expect(sessionQueryPrefix("history session-2026")).toBeNull();
    expect(sessionQueryPrefix("")).toBeNull();
  });
});

describe("sessionCompletionActions", () => {
  // The store's order (most recent first) is the order the palette shows; the completion
  // never re-sorts it. The last three rows are rows the sidebar does not draw: the archived
  // conversation and the organization's desk belong in an offer (their chat pages open them),
  // the subagent is the one row the offer leaves to its parent's Agent panel.
  const sessions = [
    row({ sessionId: "session-2026-10-01-aaaa", title: "Palette work", status: "running" }),
    row({ sessionId: "session-2026-10-02-bbbb", status: "compacting" }),
    row({ sessionId: "session-2026-10-03-cccc", title: "Old chat", status: "idle" }),
    row({ sessionId: "session-2026-10-04-dddd", title: "Archived", archived: true }),
    row({ sessionId: "session-2026-10-05-eeee", title: "A desk", orgId: "org-1" }),
    row({ sessionId: "session-2026-10-06-ffff", title: "A subagent", source: "subagent" }),
  ];

  it("offers the rows whose id starts the query, with title, status and id — archived and an organization's room included, a subagent left to its panel", () => {
    const actions = sessionCompletionActions(sessions, "session-2026-10-0", navigate);
    expect(actions.map((a) => a.id)).toEqual([
      "session:session-2026-10-01-aaaa",
      "session:session-2026-10-02-bbbb",
      "session:session-2026-10-03-cccc",
      "session:session-2026-10-04-dddd",
      "session:session-2026-10-05-eeee",
    ]);
    expect(actions[0]).toMatchObject({
      label: "Palette work",
      detail: `${S.chat.statusRunning} · session-2026-10-01-aaaa`,
    });
    expect(actions[1]).toMatchObject({
      label: S.chat.defaultSessionTitle,
      detail: `${S.chat.statusCompacting} · session-2026-10-02-bbbb`,
    });
    expect(actions[2]).toMatchObject({
      label: "Old chat",
      detail: `${S.chat.statusIdle} · session-2026-10-03-cccc`,
    });
  });

  it("answers nothing unless the query starts a session id", () => {
    for (const query of ["", "palette", "history session-x", "session"]) {
      expect(sessionCompletionActions(sessions, query, navigate)).toEqual([]);
    }
  });

  it("narrows by the typed prefix, case-insensitively", () => {
    const actions = sessionCompletionActions(sessions, "SESSION-2026-10-02", navigate);
    expect(actions.map((a) => a.id)).toEqual(["session:session-2026-10-02-bbbb"]);
  });

  it("caps the list and keeps the store's order", () => {
    const many = Array.from({ length: SESSION_COMPLETION_MAX + 5 }, (_, i) =>
      row({ sessionId: `session-2026-10-${String(i).padStart(2, "0")}` }),
    );
    const actions = sessionCompletionActions(many, "session-", navigate);
    expect(actions).toHaveLength(SESSION_COMPLETION_MAX);
    expect(actions[0]!.id).toBe("session:session-2026-10-00");
  });

  it("runs the entry by navigating to that session's chat page", () => {
    const actions = sessionCompletionActions(sessions, "session-2026-10-01", navigate);
    expect(actions).toHaveLength(1);
    actions[0]!.run();
    expect(paths).toEqual(["/chat/session-2026-10-01-aaaa"]);
  });

  it("maps every status to its word", () => {
    expect(sessionStatusWord("running")).toBe(S.chat.statusRunning);
    expect(sessionStatusWord("compacting")).toBe(S.chat.statusCompacting);
    expect(sessionStatusWord("idle")).toBe(S.chat.statusIdle);
  });

  it("keeps a short id whole and ellipses a long one's tail in the detail", () => {
    expect(sessionDetailId("session-2026-10-01-aaaa")).toBe("session-2026-10-01-aaaa");
    const long = `session-${"x".repeat(60)}`;
    expect(sessionDetailId(long)).toBe(`${long.slice(0, SESSION_DETAIL_ID_MAX)}…`);
    expect(sessionDetailId(long)).toHaveLength(SESSION_DETAIL_ID_MAX + 1);
  });
});

describe("mergeCompletionRows", () => {
  const loaded = [
    row({ sessionId: "session-2026-10-01-aaaa", lastActiveAt: "2026-10-18T10:00:00.000Z" }),
    row({ sessionId: "session-2026-10-02-bbbb", lastActiveAt: "2026-10-18T09:00:00.000Z" }),
  ];

  it("merges a server answer carrying a session no loaded page has", () => {
    const remote = row({
      sessionId: "session-2026-10-09-remote",
      agentId: "machine_agent",
      lastActiveAt: "2026-10-18T11:00:00.000Z",
    });
    const merged = mergeCompletionRows(loaded, [], [[remote]]);
    expect(merged.map((s) => s.sessionId)).toEqual([
      "session-2026-10-09-remote",
      "session-2026-10-01-aaaa",
      "session-2026-10-02-bbbb",
    ]);
  });

  it("keeps one id once when the loaded rows and a server answer both hold it", () => {
    const duplicated = row({
      sessionId: "session-2026-10-01-aaaa",
      lastActiveAt: "2026-10-18T10:00:00.000Z",
    });
    expect(mergeCompletionRows(loaded, [], [[duplicated]]).map((s) => s.sessionId)).toEqual([
      "session-2026-10-01-aaaa",
      "session-2026-10-02-bbbb",
    ]);
  });

  it("takes the newer activity of a row both sides hold", () => {
    const fresher = row({
      sessionId: "session-2026-10-02-bbbb",
      lastActiveAt: "2026-10-19T09:00:00.000Z",
      title: "Renamed while away",
    });
    const merged = mergeCompletionRows(loaded, [], [[fresher]]);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.sessionId).toBe("session-2026-10-02-bbbb");
    expect(merged[0]!.title).toBe("Renamed while away");
  });

  it("orders the merged rows most recently active first, whatever order the answers came in", () => {
    const a = row({
      sessionId: "session-2026-10-01-aaaa",
      lastActiveAt: "2026-10-18T10:00:00.000Z",
    });
    const b = row({
      sessionId: "session-2026-10-02-bbbb",
      lastActiveAt: "2026-10-18T11:00:00.000Z",
    });
    const c = row({
      sessionId: "session-2026-10-03-cccc",
      lastActiveAt: "2026-10-18T12:00:00.000Z",
    });
    expect(mergeCompletionRows([a, b], [], [[c]]).map((s) => s.sessionId)).toEqual([
      "session-2026-10-03-cccc",
      "session-2026-10-02-bbbb",
      "session-2026-10-01-aaaa",
    ]);
  });

  it("caps the merged list", () => {
    const loaded = Array.from({ length: SESSION_COMPLETION_MAX }, (_, i) =>
      row({ sessionId: `session-2026-10-${String(i).padStart(2, "0")}-load` }),
    );
    const extra = row({ sessionId: "session-2026-10-zz-extra" });
    expect(mergeCompletionRows(loaded, [], [[extra]])).toHaveLength(SESSION_COMPLETION_MAX);
  });

  it("answers with the loaded rows alone when no server answered", () => {
    expect(mergeCompletionRows(loaded, [], []).map((s) => s.sessionId)).toEqual([
      "session-2026-10-01-aaaa",
      "session-2026-10-02-bbbb",
    ]);
  });
});

describe("completion cache", () => {
  // Module state: every test starts from nothing, so a write one test made cannot answer
  // another one's read.
  beforeEach(() => resetCompletionCache());

  const a = row({ sessionId: "session-2026-10-01-aaaa", lastActiveAt: "2026-10-18T10:00:00.000Z" });
  const newer = row({
    sessionId: "session-2026-10-01-aaaa",
    lastActiveAt: "2026-10-18T12:00:00.000Z",
    title: "Moved while away",
  });
  const b = row({ sessionId: "session-2026-10-02-bbbb", lastActiveAt: "2026-10-18T09:00:00.000Z" });

  it("answers from what was remembered, without any fetch", () => {
    rememberCompletionRows("p", null, "agent-1", [a, b]);
    expect(cachedCompletionRows("p", null, "agent-1").map((s) => s.sessionId)).toEqual([
      "session-2026-10-01-aaaa",
      "session-2026-10-02-bbbb",
    ]);
  });

  it("merges a later write in, keeping the newer activity of an id both hold", () => {
    rememberCompletionRows("p", null, "agent-1", [newer]);
    const cached = cachedCompletionRows("p", null, "agent-1");
    expect(cached.map((s) => s.sessionId)).toContain("session-2026-10-01-aaaa");
    expect(cached.find((s) => s.sessionId === "session-2026-10-01-aaaa")?.title).toBe(
      "Moved while away",
    );
  });

  it("keeps one agent's rows apart from another agent's and a machine's", () => {
    const c = row({ sessionId: "session-2026-10-03-cccc" });
    rememberCompletionRows("p", null, "agent-2", [c]);
    expect(cachedCompletionRows("p", null, "agent-2").map((s) => s.sessionId)).toEqual([
      "session-2026-10-03-cccc",
    ]);
    expect(cachedCompletionRows("p", "machine-1", "agent-2")).toEqual([]);
  });

  it("caps one agent's entry at the completion's size", () => {
    rememberCompletionRows(
      "p",
      null,
      "agent-3",
      Array.from({ length: COMPLETION_CACHE_MAX + 10 }, (_, i) =>
        row({
          sessionId: `session-2026-10-${String(i).padStart(2, "0")}-cap`,
          lastActiveAt: new Date(Date.UTC(2026, 9, 18, 8, 0, 0, i)).toISOString(),
        }),
      ),
    );
    expect(cachedCompletionRows("p", null, "agent-3")).toHaveLength(COMPLETION_CACHE_MAX);
  });
});

describe("askCompletionSources", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const localAnswer = [row({ sessionId: "session-2026-10-01-local" })];
  const machineAnswer = [row({ sessionId: "session-2026-10-02-machine" })];

  it("answers from every source that answers and clears the wait when the last settles", async () => {
    const answered: string[] = [];
    let settled = 0;
    const calls: (string | null)[] = [];
    askCompletionSources({
      projectId: "p",
      prefix: "session-",
      agentsBySource: [
        { source: null, agentIds: ["a1"] },
        { source: "machine-1", agentIds: ["a2"] },
      ],
      ask: (_projectId, agentId, _opts, source) => {
        calls.push(source);
        return Promise.resolve({
          sessions: agentId === "a1" ? localAnswer : machineAnswer,
        });
      },
      onAnswer: (_source, agentId, rows) => answered.push(agentId, rows[0]!.sessionId),
      onSettled: () => {
        settled += 1;
      },
    });
    expect(settled).toBe(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(answered).toEqual(["a1", "session-2026-10-01-local", "a2", "session-2026-10-02-machine"]);
    expect(settled).toBe(1);
    // The machine's call is the one capped: it rides a signal, the local read does not.
    expect(calls).toEqual([null, "machine-1"]);
  });

  it("cuts a machine source loose past its cap and clears the wait with the sources that answered", async () => {
    const answered: string[] = [];
    let settled = 0;
    const machineSignals: AbortSignal[] = [];
    askCompletionSources({
      projectId: "p",
      prefix: "session-",
      agentsBySource: [
        { source: null, agentIds: ["a1"] },
        { source: "machine-1", agentIds: ["a2"] },
      ],
      ask: (_projectId, agentId, _opts, source, call) => {
        const promise =
          agentId === "a1"
            ? Promise.resolve({ sessions: localAnswer })
            // A machine that never answers: the run ignores whatever it is told.
            : new Promise<{ sessions: readonly SessionInfo[] }>(() => {});
        if (source !== null && call?.signal !== undefined) machineSignals.push(call.signal);
        return promise;
      },
      onAnswer: (_source, agentId, rows) => answered.push(agentId, rows[0]!.sessionId),
      onSettled: () => {
        settled += 1;
      },
    });
    expect(settled).toBe(0);
    // Past the cap the hung source is dropped on its own: nothing of it answers, and the
    // wait — the palette's Finding sessions — ends with the sources that answered.
    await vi.advanceTimersByTimeAsync(MACHINE_SOURCE_TIMEOUT_MS);
    expect(answered).toEqual(["a1", "session-2026-10-01-local"]);
    expect(settled).toBe(1);
    expect(machineSignals).toHaveLength(1);
    expect(machineSignals[0]!.aborted).toBe(true);
  });

  it("answers nothing when no source has agents, clearing the wait at once", () => {
    let settled = 0;
    askCompletionSources({
      projectId: "p",
      prefix: "session-",
      agentsBySource: [],
      ask: () => Promise.resolve({ sessions: [] }),
      onAnswer: () => {},
      onSettled: () => {
        settled += 1;
      },
    });
    expect(settled).toBe(1);
  });
});

describe("cappedSourceQuery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers with the request when it settles inside the cap", async () => {
    const answer = { sessions: [row({ sessionId: "session-2026-10-01-aaaa" })] };
    const p = cappedSourceQuery(() => Promise.resolve(answer), MACHINE_SOURCE_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(0);
    expect(await p).toBe(answer);
  });

  it("rejects past the cap and aborts the signal it gave the request", async () => {
    const signals: AbortSignal[] = [];
    const p = cappedSourceQuery(
      (signal) => {
        signals.push(signal!);
        return new Promise(() => {});
      },
      MACHINE_SOURCE_TIMEOUT_MS,
    );
    const settled = expect(p).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(MACHINE_SOURCE_TIMEOUT_MS);
    await settled;
    expect(signals[0]!.aborted).toBe(true);
  });
});
