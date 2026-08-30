/**
 * Server-backed command wiring, driven through `cli()` in-process against the fake
 * server: run (foreground/background/json/goal exit codes), ls, input (steer vs task),
 * logs, agent ls/create, project ls, cost, schedule ls.
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assistantText, partialText, type OmniMessage } from "@prismshadow/penguin-core";
import { cli } from "../src/index.js";
import { getMessages } from "../src/i18n.js";
import { FakeServer } from "./fake-server.js";

/** What the engine really streams for one text reply: the partial stream, then the complete message. */
function streamedText(text: string): OmniMessage[] {
  return [
    partialText("start"),
    partialText("delta", text),
    partialText("stop"),
    assistantText(text),
  ];
}

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

describe("penguin run", () => {
  it("creates a Session (client:'cli'), posts the task, renders the reply, exits 0", async () => {
    server.onTask = () => streamedText("hello from the model");
    const code = await cli(["run", "-m", "say hi"]);
    expect(code).toBe(0);
    const session = [...server.sessions.values()][0]!;
    expect(session.tasks).toHaveLength(1);
    expect((session.tasks[0]!.input as Array<{ text: string }>)[0]!.text).toBe("say hi");
    const create = server.requests.find((r) => r.method === "POST" && r.path.endsWith("/sessions"));
    expect(create?.body?.client).toBe("cli");
    // The default Workspace is the CLI's cwd, resolved locally.
    expect(create?.body?.workspace).toBe(process.cwd());
    expect(out()).toContain("hello from the model");
  });

  it("--background posts and exits with the session id, no stream", async () => {
    const code = await cli(["run", "-m", "long job", "--background"]);
    expect(code).toBe(0);
    const session = [...server.sessions.values()][0]!;
    expect(out()).toContain(session.sessionId);
    expect(server.requests.some((r) => r.path.endsWith("/stream"))).toBe(false);
    expect(session.tasks).toHaveLength(1);
  });

  it("--json prints {sessionId, status, text} and nothing else on stdout", async () => {
    server.onTask = () => [assistantText("first"), assistantText("second")];
    const code = await cli(["run", "-m", "q", "--json"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(out()) as { sessionId: string; status: string; text: string };
    expect(parsed.status).toBe("completed");
    expect(parsed.text).toBe("first\nsecond");
    expect(parsed.sessionId).toBe([...server.sessions.keys()][0]);
  });

  it("--session reuses an existing Session by fragment and refuses workspace/model overrides", async () => {
    const existing = server.addSession({ sessionId: "session-2026-08-25-10-00-00-feed0001" });
    const code = await cli(["run", "-m", "again", "--session", "feed0001"]);
    expect(code).toBe(0);
    expect(existing.tasks).toHaveLength(1);
    expect(server.sessions.size).toBe(1); // no new Session was created

    const bad = await cli(["run", "-m", "x", "--session", "feed0001", "--workspace", "/tmp"]);
    expect(bad).toBe(1);
    expect(stderr.join("")).toContain("--session");
  });

  it("a goal run exits non-zero unless the goal completed", async () => {
    // The fake emits no goal hook stop event, which reads as "did not complete".
    const code = await cli(["run", "-m", "objective", "--goal", "500k"]);
    expect(code).toBe(1);
    const session = [...server.sessions.values()][0]!;
    expect(session.tasks[0]!.goal).toEqual({ budget: 500_000 });
  });

  it("--thinking rides the task body", async () => {
    await cli(["run", "-m", "q", "--thinking", "high"]);
    const session = [...server.sessions.values()][0]!;
    expect(session.tasks[0]!.thinkingLevel).toBe("high");
  });
});

describe("penguin ls", () => {
  it("lists sessions of every agent with short id / state / workspace tail; -a includes archived", async () => {
    server.addSession({ sessionId: "session-2026-08-25-10-00-00-11110000", title: "First" });
    server.addSession({
      sessionId: "session-2026-08-25-10-00-00-22220000",
      archived: true,
      workspace: "/repos/deep/path",
    });
    const code = await cli(["ls"]);
    expect(code).toBe(0);
    expect(out()).toContain("11110000");
    expect(out()).toContain("First");
    expect(out()).not.toContain("22220000");

    stdout.length = 0;
    await cli(["ls", "-a"]);
    expect(out()).toContain("22220000");
    expect(out()).toContain("path"); // workspace tail, not the whole path column value
  });

  it("--json prints the raw rows", async () => {
    server.addSession({});
    await cli(["ls", "--json"]);
    const rows = JSON.parse(out()) as Array<{ sessionId: string }>;
    expect(rows).toHaveLength(1);
  });
});

describe("penguin input", () => {
  it("running session -> steer; idle -> task; --timeout 0 returns right after delivery", async () => {
    const running = server.addSession({
      sessionId: "session-2026-08-25-10-00-00-abcd0001",
      status: "running",
    });
    let code = await cli(["input", "abcd0001", "-m", "note this", "--timeout", "0"]);
    expect(code).toBe(0);
    expect(running.steers).toHaveLength(1);
    expect(running.tasks).toHaveLength(0);
    expect(out()).toContain("still running"); // the delivered/still-running note
    expect(server.requests.some((r) => r.path.endsWith("/stream"))).toBe(false); // no wait at all

    stdout.length = 0;
    const idle = server.addSession({ sessionId: "session-2026-08-25-10-00-00-abcd0002" });
    code = await cli(["input", "abcd0002", "-m", "new turn", "--timeout", "0s", "--json"]);
    expect(code).toBe(0);
    expect(idle.tasks).toHaveLength(1);
    expect(JSON.parse(out())).toEqual({ sessionId: idle.sessionId, status: "running" });
  });

  it("default waits and renders the turn; steer on an idle session falls back to a task", async () => {
    server.onTask = () => streamedText("turn output");
    const idle = server.addSession({ sessionId: "session-2026-08-25-10-00-00-abcd0003" });
    const code = await cli(["input", "abcd0003", "-m", "hello"]);
    expect(code).toBe(0);
    expect(idle.tasks).toHaveLength(1);
    expect(out()).toContain("turn output");
  });
});

describe("penguin logs", () => {
  it("renders history through the history renderer; --tail keeps the last n entries", async () => {
    server.history = [assistantText("one"), assistantText("two"), assistantText("three")];
    const s = server.addSession({ sessionId: "session-2026-08-25-10-00-00-10990001" });
    await cli(["logs", s.sessionId]);
    expect(out()).toContain("one");
    expect(out()).toContain("three");

    stdout.length = 0;
    await cli(["logs", s.sessionId, "--tail", "1"]);
    expect(out()).not.toContain("one");
    expect(out()).toContain("three");
  });
});

describe("penguin agent / project", () => {
  it("agent ls prints the table; agent create posts id/name/plugins", async () => {
    await cli(["agent", "ls"]);
    expect(out()).toContain("default_agent");

    stdout.length = 0;
    const code = await cli([
      "agent",
      "create",
      "--agent-id",
      "helper",
      "--name",
      "Helper",
      "--plugins",
      "web-design, goal",
    ]);
    expect(code).toBe(0);
    const create = server.requests.find((r) => r.method === "POST" && r.path.endsWith("/agents"));
    expect(create?.body).toMatchObject({
      agentId: "helper",
      name: "Helper",
      plugins: ["web-design", "goal"],
    });
    expect(out()).toContain(t.agent.created("helper", "default_project"));
  });

  it("project ls lists the reachable projects", async () => {
    await cli(["project", "ls"]);
    expect(out()).toContain("default_project");
  });
});

describe("penguin cost", () => {
  it("default prints the summary card (today / last7d / total)", async () => {
    const code = await cli(["cost"]);
    expect(code).toBe(0);
    expect(out()).toContain(t.cost.today());
    expect(out()).toContain(t.cost.last7d());
    expect(out()).toContain(t.cost.total());
    expect(out()).toContain("$2.2500");
    expect(out()).toContain("$4.5000+"); // hasUncosted marks a partial sum
  });

  it("--days sets from/to; --by maps to groupBy and prints the grouped table", async () => {
    server.usage = {
      ...server.usage,
      groups: [
        {
          key: "default_agent",
          cacheRead: 1,
          cacheWrite: 2,
          output: 3,
          total: 2048,
          requests: 4,
          cost: 1.25,
          hasUncosted: false,
        },
      ],
    };
    const code = await cli(["cost", "--days", "7", "--by", "agent"]);
    expect(code).toBe(0);
    const req = server.requests.find((r) => r.path.includes("/usage"));
    expect(req).toBeDefined();
    expect(out()).toContain("default_agent");
    expect(out()).toContain("2k");
    const bad = await cli(["cost", "--by", "bogus"]);
    expect(bad).toBe(1);
  });
});

describe("penguin schedule ls", () => {
  it("lists schedules with target and status markers; invalid files are marked", async () => {
    server.schedules = {
      schedules: [
        {
          name: "daily-report",
          prompt: "p",
          enabled: true,
          startAt: "2026-08-25T09:00:00.000Z",
          period: "1d",
          sessionId: "session-2026-08-25-10-00-00-dead0001",
          status: "active",
          lastFiredAt: "2026-08-25T09:00:00.000Z",
          queued: false,
        },
        {
          name: "expired-once",
          prompt: "p",
          enabled: true,
          startAt: "2026-01-01T00:00:00.000Z",
          status: "missed",
          queued: false,
        },
      ],
      invalidFiles: [{ name: "broken", error: "bad toml" }],
    };
    const code = await cli(["schedule", "ls"]);
    expect(code).toBe(0);
    expect(out()).toContain("daily-report");
    expect(out()).toContain("dead0001");
    expect(out()).toContain(t.schedule.newSession());
    expect(out()).toContain("missed");
    expect(out()).toContain("invalid");
    expect(out()).toContain("broken");
  });
});

describe("caller-context defaults (PENGUIN_SESSION_ID inheritance)", () => {
  it("run inherits workspace/model/approve from the calling session and thinking rides the task", async () => {
    const caller = server.addSession({
      sessionId: "session-2026-08-25-10-00-00-ca11e001",
      workspace: "/callers/workdir",
      modelId: "caller-model",
      provider: "caller-prov",
      approvalMode: "always-ask",
      thinkingLevel: "high",
    });
    process.env.PENGUIN_SESSION_ID = caller.sessionId;
    const code = await cli(["run", "-m", "child job"]);
    expect(code).toBe(0);
    const create = server.requests.find((r) => r.method === "POST" && r.path.endsWith("/sessions"));
    expect(create?.body).toMatchObject({
      workspace: "/callers/workdir",
      modelId: "caller-model",
      provider: "caller-prov",
      approvalMode: "always-ask",
      client: "cli",
    });
    const created = [...server.sessions.values()].find((x) => x.sessionId !== caller.sessionId)!;
    expect(created.tasks[0]!.thinkingLevel).toBe("high");
  });

  it("an explicit flag overrides its own field only (the rest still inherit)", async () => {
    const caller = server.addSession({
      sessionId: "session-2026-08-25-10-00-00-ca11e002",
      workspace: "/callers/workdir",
      modelId: "caller-model",
      provider: "caller-prov",
      approvalMode: "always-ask",
      thinkingLevel: "high",
    });
    process.env.PENGUIN_SESSION_ID = caller.sessionId;
    const code = await cli(["run", "-m", "x", "--workspace", "/elsewhere", "--thinking", "low"]);
    expect(code).toBe(0);
    const create = server.requests.find((r) => r.method === "POST" && r.path.endsWith("/sessions"));
    expect(create?.body).toMatchObject({
      // The flag wins over the caller; the value is path.resolve'd against the CLI's cwd
      // (drive-letter absolute on Windows), so compare the same resolution.
      workspace: path.resolve("/elsewhere"),
      modelId: "caller-model", // still inherited
      provider: "caller-prov",
      approvalMode: "always-ask",
    });
    const created = [...server.sessions.values()].find((x) => x.sessionId !== caller.sessionId)!;
    expect(created.tasks[0]!.thinkingLevel).toBe("low"); // flag wins
  });

  it("a failed caller lookup warns (dim, stderr) and falls back to the plain defaults", async () => {
    process.env.PENGUIN_SESSION_ID = "session-2026-08-25-10-00-00-deadc0de"; // unknown to the server
    const code = await cli(["run", "-m", "x"]);
    expect(code).toBe(0);
    expect(stderr.join("")).toContain("session-2026-08-25-10-00-00-deadc0de");
    const create = server.requests.find((r) => r.method === "POST" && r.path.endsWith("/sessions"));
    expect(create?.body?.workspace).toBe(process.cwd()); // plain default
    expect(create?.body?.modelId).toBeUndefined(); // project default applies
    expect(create?.body?.approvalMode).toBeUndefined();
  });

  it("outside an agent (no PENGUIN_SESSION_ID) nothing changes", async () => {
    await cli(["run", "-m", "x"]);
    const create = server.requests.find((r) => r.method === "POST" && r.path.endsWith("/sessions"));
    expect(create?.body?.workspace).toBe(process.cwd());
    expect(create?.body?.modelId).toBeUndefined();
    expect(create?.body?.approvalMode).toBeUndefined();
  });
});

describe("--timeout soft yield", () => {
  it("run detaches at expiry with the still-running note, exit 0, no abort", async () => {
    server.hangTasks = true;
    server.onTask = () => streamedText("partial answer");
    const code = await cli(["run", "-m", "slow job", "--timeout", "1"]);
    expect(code).toBe(0);
    const session = [...server.sessions.values()][0]!;
    expect(session.aborts).toBe(0); // detach, never abort
    expect(out()).toContain("partial answer"); // what streamed before expiry rendered
    expect(out()).toContain("still running");
  });

  it("run --json reports status running with the collected text", async () => {
    server.hangTasks = true;
    server.onTask = () => streamedText("early text");
    const code = await cli(["run", "-m", "slow job", "--timeout", "1", "--json"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(out()) as { sessionId: string; status: string; text: string };
    expect(parsed.status).toBe("running");
    expect(parsed.text).toBe("early text");
  });

  it("run --timeout 0 returns right after the POST with the still-running shape", async () => {
    server.hangTasks = true;
    const code = await cli(["run", "-m", "fire and check later", "--timeout", "0", "--json"]);
    expect(code).toBe(0);
    const session = [...server.sessions.values()][0]!;
    expect(session.tasks).toHaveLength(1);
    expect(JSON.parse(out())).toEqual({ sessionId: session.sessionId, status: "running" });
    expect(server.requests.some((r) => r.path.endsWith("/stream"))).toBe(false);
  });

  it("rejects --timeout with --background, and junk durations", async () => {
    expect(await cli(["run", "-m", "x", "--background", "--timeout", "5s"])).toBe(1);
    expect(stderr.join("")).toContain("--background");
    stderr.length = 0;
    expect(await cli(["run", "-m", "x", "--timeout", "5d"])).toBe(1);
    expect(stderr.join("")).toContain("5d");
    expect(server.sessions.size).toBe(0); // validated before anything touches the server
  });

  it("input -m detaches at expiry the same way", async () => {
    server.hangTasks = true;
    const idle = server.addSession({ sessionId: "session-2026-08-25-10-00-00-51ee0001" });
    const code = await cli(["input", "51ee0001", "-m", "go", "--timeout", "1"]);
    expect(code).toBe(0);
    expect(idle.tasks).toHaveLength(1);
    expect(idle.aborts).toBe(0);
    expect(out()).toContain("still running");
  });

  it("logs -f stops following at expiry, exit 0", async () => {
    server.history = [assistantText("old line")];
    const s = server.addSession({ sessionId: "session-2026-08-25-10-00-00-10f00001" });
    const code = await cli(["logs", s.sessionId, "-f", "--timeout", "1"]);
    expect(code).toBe(0);
    expect(out()).toContain("old line");
    const bad = await cli(["logs", s.sessionId, "--timeout", "1"]); // no -f: nothing waits
    expect(bad).toBe(1);
  });
});

describe("penguin input (bare poll form)", () => {
  it("idle: prints the most recent complete assistant text (skipping user/nested messages)", async () => {
    server.history = [
      assistantText("first answer"),
      { timestamp: "t", type: "model_msg", payload: { type: "text", role: "user", text: "q2" } },
      assistantText("nested"),
      assistantText("final answer"),
    ];
    // Mark the third entry as a subagent-expanded message: it must be skipped.
    (server.history[2] as { origin?: string[] }).origin = ["session-child"];
    const s = server.addSession({ sessionId: "session-2026-08-25-10-00-00-b0110001" });
    const code = await cli(["input", "b0110001"]);
    expect(code).toBe(0);
    expect(out().trim()).toBe("final answer");
    expect(s.tasks).toHaveLength(0); // nothing queued
    expect(s.steers).toHaveLength(0); // nothing steered
  });

  it("running + --timeout: waits out the window, then prints the latest text plus the still-running note", async () => {
    server.history = [assistantText("latest so far")];
    server.addSession({ sessionId: "session-2026-08-25-10-00-00-b0110002", status: "running" });
    const code = await cli(["input", "b0110002", "--timeout", "1"]);
    expect(code).toBe(0);
    expect(out()).toContain("latest so far");
    expect(out()).toContain("still running");
  });

  it("running + --timeout --json reports status running with the snapshot", async () => {
    server.history = [assistantText("snapshot")];
    server.addSession({ sessionId: "session-2026-08-25-10-00-00-b0110003", status: "running" });
    const code = await cli(["input", "b0110003", "--timeout", "1", "--json"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(out()) as { status: string; text: string };
    expect(parsed.status).toBe("running");
    expect(parsed.text).toBe("snapshot");
  });

  it("no reply yet prints the dim placeholder; --json carries an empty text", async () => {
    server.history = [];
    server.addSession({ sessionId: "session-2026-08-25-10-00-00-b0110004" });
    let code = await cli(["input", "b0110004"]);
    expect(code).toBe(0);
    expect(out()).toContain(t.input.noReplyYet());
    stdout.length = 0;
    code = await cli(["input", "b0110004", "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(out())).toMatchObject({ status: "idle", text: "" });
  });

  it("poll with --timeout 0 snapshots a running session immediately (no subscription)", async () => {
    server.history = [assistantText("instant snapshot")];
    server.addSession({ sessionId: "session-2026-08-25-10-00-00-b0110005", status: "running" });
    const code = await cli(["input", "b0110005", "--timeout", "0"]);
    expect(code).toBe(0);
    expect(out()).toContain("instant snapshot");
    expect(out()).toContain("still running");
    expect(server.requests.some((r) => r.path.endsWith("/stream"))).toBe(false);
  });
});

describe("logs / input without a session id (the agent's most recent)", () => {
  /** Two sessions of the same agent, the second one newer. */
  function twoSessions(): { older: string; newer: string } {
    const older = "session-2026-08-24-09-00-00-1a7e0001";
    const newer = "session-2026-08-25-10-00-00-1a7e0002";
    server.addSession({ sessionId: older, createdAt: "2026-08-24T09:00:00.000Z" });
    server.addSession({ sessionId: newer, createdAt: "2026-08-25T10:00:00.000Z" });
    return { older, newer };
  }

  it("logs renders the newest session and names it in a dim stderr note", async () => {
    server.history = [assistantText("what happened last")];
    const { newer } = twoSessions();
    const code = await cli(["logs"]);
    expect(code).toBe(0);
    expect(out()).toContain("what happened last");
    // The note goes to stderr, so stdout stays exactly what the command renders.
    expect(stderr.join("")).toContain(t.client.latestSession(newer));
    expect(out()).not.toContain(newer);
  });

  it("bare input polls the newest session's last answer, queueing nothing", async () => {
    server.history = [assistantText("the last thing I said")];
    const { newer } = twoSessions();
    const code = await cli(["input"]);
    expect(code).toBe(0);
    expect(out().trim()).toBe("the last thing I said");
    expect(stderr.join("")).toContain(t.client.latestSession(newer));
    const session = server.sessions.get(newer)!;
    expect(session.tasks).toHaveLength(0);
    expect(session.steers).toHaveLength(0);
  });

  it("--json stays parseable: the note never lands on stdout", async () => {
    server.history = [assistantText("snapshot")];
    const { newer } = twoSessions();
    const code = await cli(["input", "--json"]);
    expect(code).toBe(0);
    expect(JSON.parse(out())).toMatchObject({ sessionId: newer, status: "idle" });
  });

  it("--agent-id picks whose most recent session it is", async () => {
    twoSessions();
    server.agents.push({
      agentId: "helper",
      name: "Helper",
      description: "",
      sessionCount: 0,
      activeSessionCount: 0,
      sessionActivity: [],
    });
    const helperSession = server.addSession({
      sessionId: "session-2026-08-20-08-00-00-be1f0001",
      agentId: "helper",
      createdAt: "2026-08-20T08:00:00.000Z",
    });
    const code = await cli(["logs", "--agent-id", "helper"]);
    expect(code).toBe(0);
    expect(stderr.join("")).toContain(t.client.latestSession(helperSession.sessionId));
  });

  it("an explicit session id still wins over the default", async () => {
    server.history = [assistantText("history")];
    const { older } = twoSessions();
    const code = await cli(["logs", "1a7e0001"]);
    expect(code).toBe(0);
    expect(stderr.join("")).not.toContain("[latest]");
    expect(server.requests.some((r) => r.path === `/api/sessions/${older}/messages`)).toBe(true);
  });

  it("no sessions at all: one line pointing at run/chat, non-zero exit, no commander noise", async () => {
    for (const argv of [["logs"], ["input"]]) {
      stderr.length = 0;
      const code = await cli(argv);
      expect(code).toBe(1);
      const errText = stderr.join("");
      expect(errText).toContain(t.client.noSessionsYet("default_agent", "default_project"));
      expect(errText).toContain("penguin chat");
      expect(errText).not.toContain("missing required argument");
      expect(errText).not.toContain("    at "); // no stack trace
    }
  });
});

describe("penguin ls --days", () => {
  it("keeps sessions last active within the trailing calendar window (today = day 1) and combines with -a", async () => {
    const now = new Date();
    const at = (daysAgo: number) =>
      new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, 12).toISOString();
    server.addSession({
      sessionId: "session-2026-08-25-10-00-00-da150001",
      lastActiveAt: at(0), // today
    });
    server.addSession({
      sessionId: "session-2026-08-25-10-00-00-da150002",
      lastActiveAt: at(1), // yesterday: inside --days 2
    });
    server.addSession({
      sessionId: "session-2026-08-25-10-00-00-da150003",
      lastActiveAt: at(2), // two days back: outside --days 2, inside --days 3
    });
    server.addSession({
      sessionId: "session-2026-08-25-10-00-00-da150004",
      lastActiveAt: at(1),
      archived: true, // only visible with -a
    });

    await cli(["ls", "--days", "2"]);
    expect(out()).toContain("da150001");
    expect(out()).toContain("da150002");
    expect(out()).not.toContain("da150003");
    expect(out()).not.toContain("da150004");

    stdout.length = 0;
    await cli(["ls", "--days", "2", "-a", "--json"]);
    const ids = (JSON.parse(out()) as Array<{ sessionId: string }>).map((r) => r.sessionId);
    expect(ids.some((id) => id.endsWith("da150004"))).toBe(true);
    expect(ids.some((id) => id.endsWith("da150003"))).toBe(false);

    stdout.length = 0;
    await cli(["ls", "--days", "3"]);
    expect(out()).toContain("da150003");

    expect(await cli(["ls", "--days", "0"])).toBe(1);
    expect(await cli(["ls", "--days", "x"])).toBe(1);
  });
});

describe("penguin schedule add/update/rm (validated writer over the API)", () => {
  it("add posts the full definition, ENABLED by default (the deliberate divergence); --disabled opts out", async () => {
    const code = await cli([
      "schedule",
      "add",
      "daily-report",
      "--prompt",
      "summarize the day",
      "--start-at",
      "2026-08-27T09:00:00.000Z",
      "--period",
      "1d",
      "--session-id",
      "session-2026-08-25-10-00-00-dead0001",
    ]);
    expect(code).toBe(0);
    const create = server.requests.find(
      (r) => r.method === "POST" && r.path.endsWith("/schedules"),
    );
    expect(create?.body).toMatchObject({
      name: "daily-report",
      enabled: true,
      prompt: "summarize the day",
      startAt: "2026-08-27T09:00:00.000Z",
      period: "1d",
      sessionId: "session-2026-08-25-10-00-00-dead0001",
    });
    expect(out()).toContain("daily-report");

    stdout.length = 0;
    const disabled = await cli([
      "schedule",
      "add",
      "paused-task",
      "--prompt",
      "p",
      "--start-at",
      "2026-08-27T09:00:00.000Z",
      "--disabled",
    ]);
    expect(disabled).toBe(0);
    expect(server.scheduleItems.get("paused-task")).toMatchObject({ enabled: false });
  });

  it("--start-at now resolves to the current instant before the request", async () => {
    const before = Date.now();
    await cli(["schedule", "add", "one-shot", "--prompt", "p", "--start-at", "now"]);
    const stored = server.scheduleItems.get("one-shot") as { startAt: string };
    const ms = Date.parse(stored.startAt);
    expect(ms).toBeGreaterThanOrEqual(before - 1000);
    expect(ms).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("target is --session-id XOR the new-session form; the model pair stays both-or-neither", async () => {
    let code = await cli([
      "schedule",
      "add",
      "bad-target",
      "--prompt",
      "p",
      "--start-at",
      "now",
      "--session-id",
      "session-x",
      "--workspace",
      "/w",
    ]);
    expect(code).toBe(1);
    expect(stderr.join("")).toContain("--session-id");
    stderr.length = 0;
    code = await cli([
      "schedule",
      "add",
      "bad-pair",
      "--prompt",
      "p",
      "--start-at",
      "now",
      "--model-id",
      "m",
    ]);
    expect(code).toBe(1);
    expect(server.scheduleItems.has("bad-target")).toBe(false);
    expect(server.scheduleItems.has("bad-pair")).toBe(false);
  });

  it("update is read-modify-write: unspecified fields keep stored values; --disable flips; switching target clears the other kind", async () => {
    await cli([
      "schedule",
      "add",
      "evolving",
      "--prompt",
      "original prompt",
      "--start-at",
      "2026-08-27T09:00:00.000Z",
      "--period",
      "1d",
      "--workspace",
      "/stored/ws",
      "--model-id",
      "m1",
      "--provider",
      "p1",
    ]);
    stdout.length = 0;
    // Change the period only: prompt/startAt/workspace/model survive.
    let code = await cli(["schedule", "update", "evolving", "--period", "12h", "--disable"]);
    expect(code).toBe(0);
    expect(server.scheduleItems.get("evolving")).toMatchObject({
      prompt: "original prompt",
      startAt: "2026-08-27T09:00:00.000Z",
      period: "12h",
      workspace: "/stored/ws",
      modelId: "m1",
      provider: "p1",
      enabled: false,
    });
    // Switch to a bound session: the new-session fields are cleared, --enable flips back.
    code = await cli([
      "schedule",
      "update",
      "evolving",
      "--session-id",
      "session-2026-08-25-10-00-00-dead0002",
      "--enable",
    ]);
    expect(code).toBe(0);
    const after = server.scheduleItems.get("evolving") as Record<string, unknown>;
    expect(after.sessionId).toBe("session-2026-08-25-10-00-00-dead0002");
    expect(after.enabled).toBe(true);
    expect(after.workspace).toBeUndefined();
    expect(after.modelId).toBeUndefined();
    // --enable with --disable is refused.
    expect(await cli(["schedule", "update", "evolving", "--enable", "--disable"])).toBe(1);
  });

  it("rm deletes without prompting; API errors surface verbatim", async () => {
    await cli(["schedule", "add", "doomed", "--prompt", "p", "--start-at", "now"]);
    stdout.length = 0;
    const code = await cli(["schedule", "rm", "doomed"]);
    expect(code).toBe(0);
    expect(server.scheduleItems.has("doomed")).toBe(false);
    expect(out()).toContain("doomed");
    // A second rm surfaces the server's 404 verbatim.
    stderr.length = 0;
    expect(await cli(["schedule", "rm", "doomed"])).toBe(1);
    expect(stderr.join("")).toContain("schedule_not_found");
  });
});
