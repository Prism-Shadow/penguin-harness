/**
 * Server-backed command wiring, driven through `cli()` in-process against the fake
 * server: run (foreground/background/json/goal exit codes), ls, input (steer vs task),
 * logs, agent ls/create, project ls, cost, schedule ls.
 */
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
    // The fake emits no goal_finished event, which reads as "did not complete".
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
  it("running session -> steer; idle -> task; --no-wait returns right after the 202", async () => {
    const running = server.addSession({
      sessionId: "session-2026-08-25-10-00-00-abcd0001",
      status: "running",
    });
    let code = await cli(["input", "abcd0001", "-m", "note this", "--no-wait"]);
    expect(code).toBe(0);
    expect(running.steers).toHaveLength(1);
    expect(running.tasks).toHaveLength(0);

    const idle = server.addSession({ sessionId: "session-2026-08-25-10-00-00-abcd0002" });
    code = await cli(["input", "abcd0002", "-m", "new turn", "--no-wait"]);
    expect(code).toBe(0);
    expect(idle.tasks).toHaveLength(1);
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
  it("agent ls prints the table; agent create posts id/name/skills", async () => {
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
      "--skills",
      "web-search, pdf",
    ]);
    expect(code).toBe(0);
    const create = server.requests.find((r) => r.method === "POST" && r.path.endsWith("/agents"));
    expect(create?.body).toMatchObject({
      agentId: "helper",
      name: "Helper",
      skills: ["web-search", "pdf"],
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
