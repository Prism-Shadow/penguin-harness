/**
 * Unit tests for the rename_session tool's host seam (`sessionControlFor` in
 * runtime/session-manager.ts): the hosting Session as the default target, an explicit id
 * confined to the hosting Session's Project, the HTTP route's 1–120 title rule, and the
 * `session_title` event a rename sends to the Project's users.
 */
import { describe, expect, it } from "vitest";
import type { SessionRow } from "../src/db/repos/sessions.js";
import { sessionControlFor } from "../src/runtime/session-manager.js";

function fakeSessions(rows: Array<Pick<SessionRow, "sessionId" | "projectId">>) {
  const titles = new Map<string, string>();
  return {
    titles,
    findById: (id: string) => (rows.find((r) => r.sessionId === id) as SessionRow) ?? null,
    updateTitle: (id: string, title: string) => void titles.set(id, title),
  };
}

const ROWS = [
  { sessionId: "s-host", projectId: "p1" },
  { sessionId: "s-sibling", projectId: "p1" },
  { sessionId: "s-other", projectId: "p2" },
];
const CTX = { projectId: "p1", agentId: "a1", sessionId: "s-host" };

function setup() {
  const sessions = fakeSessions(ROWS);
  const events: Array<{ projectId: string; event: unknown }> = [];
  const control = sessionControlFor(sessions, (projectId, event) =>
    events.push({ projectId, event }),
  )(CTX);
  return { sessions, events, control };
}

describe("sessionControlFor", () => {
  it("renames the hosting Session when no session id is given, and notifies the Project", async () => {
    // Given a control bound to s-host / When it renames without an id
    const { sessions, events, control } = setup();
    const result = await control.rename({ title: "  Nightly build watch  " });
    // Then the hosting Session gets the trimmed title and the Project hears about it
    expect(result).toEqual({ ok: true, sessionId: "s-host", title: "Nightly build watch" });
    expect(sessions.titles.get("s-host")).toBe("Nightly build watch");
    expect(events).toEqual([
      {
        projectId: "p1",
        event: { type: "session_title", sessionId: "s-host", title: "Nightly build watch" },
      },
    ]);
  });

  it("renames another Session of the same Project by id", async () => {
    const { sessions, control } = setup();
    const result = await control.rename({ title: "Sibling", sessionId: "s-sibling" });
    expect(result).toEqual({ ok: true, sessionId: "s-sibling", title: "Sibling" });
    expect(sessions.titles.has("s-host")).toBe(false);
  });

  it("refuses a Session of another Project as not found, without renaming it", async () => {
    const { sessions, events, control } = setup();
    const result = await control.rename({ title: "Nope", sessionId: "s-other" });
    expect(result).toEqual({ ok: false, code: "session_not_found" });
    expect(sessions.titles.size).toBe(0);
    expect(events).toEqual([]);
  });

  it("refuses an unknown id as not found", async () => {
    const { control } = setup();
    expect(await control.rename({ title: "x", sessionId: "s-missing" })).toEqual({
      ok: false,
      code: "session_not_found",
    });
  });

  it("refuses a title outside 1–120 characters after trimming", async () => {
    const { sessions, control } = setup();
    for (const title of ["   ", "x".repeat(121)]) {
      const result = await control.rename({ title });
      expect(result).toMatchObject({ ok: false, code: "invalid_title" });
    }
    expect(sessions.titles.size).toBe(0);
    expect(await control.rename({ title: "x".repeat(120) })).toMatchObject({ ok: true });
  });
});
