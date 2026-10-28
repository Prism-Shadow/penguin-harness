/**
 * The command palette's session completion (features/palette/session-completion.ts): the
 * query's first token starting a session id is the trigger; the rows offered are the
 * sidebar's own, in the order the session store holds them; each entry shows the title (or
 * the untitled fallback) with the status word beside the session's id; running one navigates
 * to that session's chat page.
 */
import { describe, expect, it } from "vitest";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { S } from "../src/lib/strings";
import {
  SESSION_COMPLETION_MAX,
  SESSION_DETAIL_ID_MAX,
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
  // never re-sorts it. The last three rows are rows the sidebar does not draw.
  const sessions = [
    row({ sessionId: "session-2026-10-01-aaaa", title: "Palette work", status: "running" }),
    row({ sessionId: "session-2026-10-02-bbbb", status: "compacting" }),
    row({ sessionId: "session-2026-10-03-cccc", title: "Old chat", status: "idle" }),
    row({ sessionId: "session-2026-10-04-dddd", title: "Archived", archived: true }),
    row({ sessionId: "session-2026-10-05-eeee", title: "A desk", orgId: "org-1" }),
    row({ sessionId: "session-2026-10-06-ffff", title: "A subagent", source: "subagent" }),
  ];

  it("offers the sidebar rows whose id starts the query, with title, status and id", () => {
    const actions = sessionCompletionActions(sessions, "session-2026-10-0", navigate);
    expect(actions.map((a) => a.id)).toEqual([
      "session:session-2026-10-01-aaaa",
      "session:session-2026-10-02-bbbb",
      "session:session-2026-10-03-cccc",
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
