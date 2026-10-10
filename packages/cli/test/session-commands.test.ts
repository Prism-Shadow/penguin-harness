/**
 * `penguin session` command wiring, driven through `cli()` in-process against the fake
 * server: rename (explicit id, the PENGUIN_SESSION_ID caller default, the latest-session
 * fallback, --json) and its client-side title check.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cli } from "../src/index.js";
import { getMessages } from "../src/i18n.js";
import { FakeServer } from "./fake-server.js";

const t = getMessages("en");

let server: FakeServer;
let uninstall: () => void;
let stdout: string[];
let stderr: string[];
let outSpy: { mockRestore(): void };
let errSpy: { mockRestore(): void };

beforeEach(() => {
  server = new FakeServer();
  uninstall = server.install();
  stdout = [];
  stderr = [];
  outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});
afterEach(() => {
  outSpy.mockRestore();
  errSpy.mockRestore();
  uninstall();
  delete process.env.PENGUIN_SESSION_ID;
});

const out = () => stdout.join("");
const err = () => stderr.join("");

describe("penguin session rename", () => {
  it("renames the Session an explicit id names, with a PATCH that carries only the title", async () => {
    const s = server.addSession({ sessionId: "session-2026-08-25-11-00-00-feed0001" });
    const code = await cli(["session", "rename", "Q3 release prep", "feed0001"]);
    expect(code).toBe(0);
    expect(s.patches).toContainEqual({ title: "Q3 release prep" });
    expect(s.title).toBe("Q3 release prep");
    const patch = server.requests.find((r) => r.method === "PATCH");
    expect(patch?.path).toBe("/api/sessions/session-2026-08-25-11-00-00-feed0001");
    expect(patch?.body).toEqual({ title: "Q3 release prep" });
    expect(out()).toContain(t.session.renamed("feed0001", "Q3 release prep"));
  });

  it("with no session id and no PENGUIN_SESSION_ID, renames the agent's most recent Session", async () => {
    const older = server.addSession({ sessionId: "session-2026-08-25-09-00-00-feed0002" });
    const newer = server.addSession({
      sessionId: "session-2026-08-25-10-00-00-feed0003",
      lastActiveAt: "2026-08-25T11:00:00.000Z",
    });
    expect(await cli(["session", "rename", "New name"])).toBe(0);
    expect(newer.patches).toContainEqual({ title: "New name" });
    expect(older.patches).toHaveLength(0); // the newest wins, not the first listed
    expect(err()).toContain(t.client.latestSession(newer.sessionId));
  });

  it("PENGUIN_SESSION_ID wins over the latest-session fallback when no id is given", async () => {
    const caller = server.addSession({ sessionId: "session-2026-08-25-09-00-00-feed0004" });
    server.addSession({
      sessionId: "session-2026-08-25-10-00-00-feed0005",
      lastActiveAt: "2026-08-25T11:00:00.000Z",
    });
    process.env.PENGUIN_SESSION_ID = caller.sessionId;
    expect(await cli(["session", "rename", "Caller's own title"])).toBe(0);
    expect(caller.patches).toContainEqual({ title: "Caller's own title" });
    expect(err()).not.toContain("[latest]");
  });

  it("an explicit id wins over PENGUIN_SESSION_ID", async () => {
    const caller = server.addSession({ sessionId: "session-2026-08-25-09-00-00-feed0006" });
    const other = server.addSession({ sessionId: "session-2026-08-25-10-00-00-feed0007" });
    process.env.PENGUIN_SESSION_ID = caller.sessionId;
    expect(await cli(["session", "rename", "Explicit target", "feed0007"])).toBe(0);
    expect(other.patches).toContainEqual({ title: "Explicit target" });
    expect(caller.patches).toHaveLength(0);
  });

  it("--json prints the fresh title from the PATCH response instead of the done line", async () => {
    const s = server.addSession({ sessionId: "session-2026-08-25-11-00-00-feed0008" });
    expect(await cli(["session", "rename", "JSON title", "feed0008", "--json"])).toBe(0);
    const parsed = JSON.parse(out());
    expect(parsed).toEqual({ sessionId: s.sessionId, title: "JSON title" });
  });

  it("a title outside 1–120 characters is rejected client-side before any request", async () => {
    for (const bad of ["  ", "x".repeat(121)]) {
      const code = await cli(["session", "rename", bad, "feed0001"]);
      expect(code).toBe(1);
      expect(err()).toContain(t.session.titleInvalid(bad.trim().length));
    }
    expect(server.requests.some((r) => r.method === "PATCH")).toBe(false);
  });

  it("with no session at all, it reports none and exits 1", async () => {
    const code = await cli(["session", "rename", "Any title"]);
    expect(code).toBe(1);
    expect(err()).toContain(t.client.noSessionsYet("default_agent", "default_project"));
  });
});
