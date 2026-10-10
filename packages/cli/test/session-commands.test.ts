/**
 * `penguin session rename`, and the shape of the `penguin session` group, driven through
 * `cli()` in-process against the fake server. (`session ls`, `session log` and
 * `session input` keep their scenarios in server-commands.test.ts.)
 *
 * - Given an explicit session id, when renamed with `-t`, then that Session gets a PATCH
 *   carrying only the title, and the done line names it.
 * - Given no id and no PENGUIN_SESSION_ID, then the agent's most recent Session is renamed,
 *   a `[latest]` line on stderr names it, and the older one is untouched.
 * - Given PENGUIN_SESSION_ID and no id, then the calling Session is renamed, not the most
 *   recent one, and no `[latest]` line is printed.
 * - Given both an id and PENGUIN_SESSION_ID, then the id wins and the caller is untouched.
 * - Given `--json`, then stdout is `{sessionId, title}` with the title the server stored.
 * - Given a title with runs of whitespace, then the PATCH carries it with single spaces.
 * - Given a title that is empty or too long, then it exits 1 and nothing is requested.
 * - Given no `-t` at all (a lone id, say), then it is a usage error naming the option, and
 *   no Session is renamed — not the id's, not the latest one.
 * - Given no Session at all, then it says so and exits 1.
 * - Given the retired top-level `ls`, `logs` or `input`, then each is an unknown command
 *   and nothing reaches the server.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cli } from "../src/index.js";
import { getMessages } from "../src/i18n.js";
import { SESSION_TITLE_MAX } from "../src/server-session.js";
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
});

const out = () => stdout.join("");
const err = () => stderr.join("");
const patches = () => server.requests.filter((r) => r.method === "PATCH");

describe("penguin session rename", () => {
  it("renames the Session an explicit id names, with a PATCH that carries only the title", async () => {
    const s = server.addSession({ sessionId: "session-2026-08-25-11-00-00-feed0001" });
    const code = await cli(["session", "rename", "feed0001", "-t", "Q3 release prep"]);
    expect(code).toBe(0);
    expect(s.title).toBe("Q3 release prep");
    expect(patches()).toHaveLength(1);
    expect(patches()[0]?.path).toBe("/api/sessions/session-2026-08-25-11-00-00-feed0001");
    expect(patches()[0]?.body).toEqual({ title: "Q3 release prep" });
    expect(out()).toContain(t.session.renamed("feed0001", "Q3 release prep"));
  });

  it("with no session id and no PENGUIN_SESSION_ID, renames the agent's most recent Session", async () => {
    const older = server.addSession({ sessionId: "session-2026-08-25-09-00-00-feed0002" });
    const newer = server.addSession({
      sessionId: "session-2026-08-25-10-00-00-feed0003",
      lastActiveAt: "2026-08-25T11:00:00.000Z",
    });
    expect(await cli(["session", "rename", "--title", "New name"])).toBe(0);
    expect(newer.title).toBe("New name");
    expect(older.patches).toHaveLength(0); // the newest wins, not the first listed
    expect(err()).toContain(t.client.latestSession(newer.sessionId));
  });

  it("PENGUIN_SESSION_ID wins over the latest-session fallback when no id is given", async () => {
    const caller = server.addSession({ sessionId: "session-2026-08-25-09-00-00-feed0004" });
    const newer = server.addSession({
      sessionId: "session-2026-08-25-10-00-00-feed0005",
      lastActiveAt: "2026-08-25T11:00:00.000Z",
    });
    process.env.PENGUIN_SESSION_ID = caller.sessionId;
    expect(await cli(["session", "rename", "-t", "Caller's own title"])).toBe(0);
    expect(caller.title).toBe("Caller's own title");
    expect(newer.patches).toHaveLength(0);
    expect(err()).not.toContain("[latest]");
  });

  it("an explicit id wins over PENGUIN_SESSION_ID", async () => {
    const caller = server.addSession({ sessionId: "session-2026-08-25-09-00-00-feed0006" });
    const other = server.addSession({ sessionId: "session-2026-08-25-10-00-00-feed0007" });
    process.env.PENGUIN_SESSION_ID = caller.sessionId;
    expect(await cli(["session", "rename", "feed0007", "-t", "Explicit target"])).toBe(0);
    expect(other.title).toBe("Explicit target");
    expect(caller.patches).toHaveLength(0);
  });

  it("--json prints the session id and the title as the server stored it", async () => {
    const s = server.addSession({ sessionId: "session-2026-08-25-11-00-00-feed0008" });
    expect(await cli(["session", "rename", "feed0008", "-t", "JSON title", "--json"])).toBe(0);
    expect(JSON.parse(out())).toEqual({ sessionId: s.sessionId, title: "JSON title" });
  });

  it("sends a title's runs of whitespace as single spaces", async () => {
    const s = server.addSession({ sessionId: "session-2026-08-25-11-00-00-feed0009" });
    expect(await cli(["session", "rename", "feed0009", "-t", "  Q3\n\trelease   prep "])).toBe(0);
    expect(patches()[0]?.body).toEqual({ title: "Q3 release prep" });
    expect(s.title).toBe("Q3 release prep");
  });

  it.each([
    ["blank", "  "],
    ["too long", "x".repeat(SESSION_TITLE_MAX + 1)],
  ])("a %s title exits 1 before any request", async (_case, bad) => {
    server.addSession({ sessionId: "session-2026-08-25-11-00-00-feed0010" });
    expect(await cli(["session", "rename", "feed0010", "-t", bad])).toBe(1);
    expect(err()).toContain(t.common.titleInvalid(bad.trim().length, SESSION_TITLE_MAX));
    expect(server.requests).toHaveLength(0);
  });

  it("without -t it is a usage error, and no Session is renamed", async () => {
    const named = server.addSession({ sessionId: "session-2026-08-25-11-00-00-feed0011" });
    expect(await cli(["session", "rename", "feed0011"])).toBe(1);
    expect(err()).toContain(t.usage.missingOption("-t, --title <title>"));
    expect(err()).toContain("penguin session rename");
    expect(named.patches).toHaveLength(0);
    expect(patches()).toHaveLength(0);
  });

  it("with no session at all, it reports none and exits 1", async () => {
    const code = await cli(["session", "rename", "-t", "Any title"]);
    expect(code).toBe(1);
    expect(err()).toContain(t.client.noSessionsYet("default_agent", "default_project"));
    expect(patches()).toHaveLength(0);
  });
});

describe("penguin session (the group)", () => {
  it.each(["ls", "logs", "input"])(
    "the retired top-level `%s` is an unknown command and reaches no server",
    async (name) => {
      server.addSession({});
      expect(await cli([name])).toBe(1);
      expect(err()).toContain(t.usage.unknownCommand(name));
      expect(out()).toBe("");
      expect(server.requests).toHaveLength(0);
    },
  );
});
