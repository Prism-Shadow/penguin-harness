/**
 * Opening a Claude Code session by its id: the record and the registry it reads, and the link
 * end to end against the queue on fakes of the harness — enter the run that holds the session,
 * else queue a resume run (argv, working directory, employee), never a second program on one
 * session, and a clear refusal for a session that is not there.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import type { OrgActor, OrgView } from "@prismshadow/penguin-server/plugin";
import {
  ClaudeCodeQueue,
  ClaudeCodeSurface,
  PAGE_PREFIX,
  claudeArgv,
  findSessionRecord,
  liveSession,
  openRoutes,
  pageRoutes,
  type ProcProbe,
  type QueueConfig,
  type RowLike,
} from "../src/index.js";

const ID = "0b5e4c1a-7d2f-4e8a-9c3b-1f6d2a8e4b70";

let root: string;
let claude: string;
let workspace: string;
let env: NodeJS.ProcessEnv;
let config: QueueConfig;
let orgs: Map<string, OrgView>;
let rows: Map<string, RowLike>;
let created: Array<{ agentId: string; workspace?: string }>;
let opened: Array<{ sessionId: string; owner: string; options: Record<string, unknown> }>;
let resumed: Array<[string, string]>;
/** Live processes the fake probe answers for: pid → what /proc would say. */
let procs: Map<number, { start: string; tty: string | null; pane: string | null }>;

const probe: ProcProbe = {
  alive: (pid) => procs.has(pid),
  startTime: (pid) => procs.get(pid)?.start ?? null,
  tty: (pid) => procs.get(pid)?.tty ?? null,
  tmux: (pid) => {
    const pane = procs.get(pid)?.pane ?? null;
    return pane === null ? null : { socket: "/tmp/tmux-1/default", pane };
  },
};

function org(orgId: string, extra: Partial<OrgView> = {}): OrgView {
  return {
    projectId: "p",
    orgId,
    name: orgId,
    status: "active",
    language: "en",
    workspace: path.join(root, "shared", orgId),
    employees: [{ agentId: "dev", name: "Dev", title: "Developer", reportsTo: null }],
    userIds: ["admin"],
    machineId: null,
    ...extra,
  };
}

// A trimmed copy of queue.test.ts's harness: that file's fakes live in its module state, and
// these cases need only the create → open path, plus what was asked of the surface.
function queue(): ClaudeCodeQueue {
  let n = 0;
  const alive = new Set<string>();
  return new ClaudeCodeQueue({
    gateway: {
      companyModeEnabled: () => true,
      organization: async (_p, o) => orgs.get(o) ?? null,
      principalOf: async (_p, _o, actor: OrgActor) =>
        actor.agentId !== undefined ? `agent:${actor.agentId}` : `user:${actor.userId}`,
    },
    sessionService: {
      createSession: async (args) => {
        const sessionId = `cc-${++n}`;
        created.push({ agentId: args.agentId, workspace: args.workspace });
        rows.set(sessionId, { sessionId, workspace: args.workspace ?? "", surface: args.surface });
        return { sessionId };
      },
    },
    sessions: { findById: (id) => rows.get(id) ?? null, updateTitleIfNull: () => {} },
    surfaces: {
      open: async (row: never, owner, options) => {
        const { sessionId } = row as RowLike;
        opened.push({ sessionId, owner, options: { ...options } });
        alive.add(sessionId);
        return { alive: true };
      },
      describe: (row: never) => ({ alive: alive.has((row as RowLike).sessionId) }),
      close: (sessionId) => alive.delete(sessionId),
    },
    resume: (sessionId, claudeSessionId) => resumed.push([sessionId, claudeSessionId]),
    activity: () => "idle",
    screen: () => null,
    write: () => false,
    root,
    config: () => config,
    surfaceKind: "claude-code",
  });
}

/** The page routes behind a stand-in cookie gate, as the plugin mounts them. */
function app(q: ClaudeCodeQueue, userId = "admin") {
  const outer = new Hono();
  outer.use("*", async (c, next) => {
    c.set("user" as never, { userId } as never);
    c.set("sessionVia" as never, "password" as never);
    await next();
  });
  outer.route(PAGE_PREFIX, pageRoutes(openRoutes({ queue: q, root, env, probe })));
  return outer;
}

const link = (id = ID, extra = "") => `/api/claude-code/open/${id}?org=acme&agent=dev${extra}`;

async function writeRecord(id: string, lines: unknown[]): Promise<string> {
  const dir = path.join(claude, "projects", workspace.replace(/[^A-Za-z0-9-]/g, "-"));
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${id}.jsonl`);
  await fs.writeFile(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return file;
}

async function register(pid: number, sessionId: string, procStart: string): Promise<void> {
  await fs.mkdir(path.join(claude, "sessions"), { recursive: true });
  await fs.writeFile(
    path.join(claude, "sessions", `${pid}.json`),
    JSON.stringify({ pid, sessionId, cwd: workspace, procStart, kind: "interactive" }),
  );
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "claude-code-open-"));
  claude = path.join(root, "claude-home");
  workspace = path.join(root, "work", "repo");
  await fs.mkdir(workspace, { recursive: true });
  await fs.mkdir(path.join(root, "data", "p", "organizations", "acme"), { recursive: true });
  env = { CLAUDE_CONFIG_DIR: claude };
  config = { capacity: 2, idleMinutes: 30 };
  orgs = new Map([["acme", org("acme")]]);
  rows = new Map();
  created = [];
  opened = [];
  resumed = [];
  procs = new Map();
  await writeRecord(ID, [
    { type: "mode", mode: "normal", sessionId: ID },
    { type: "user", isMeta: true, cwd: workspace, sessionId: ID },
    { type: "user", cwd: "/elsewhere", sessionId: ID },
  ]);
  // The data root the routes search for the organization's Project.
  root = path.join(root, "data");
});

afterEach(async () => {
  await fs.rm(path.dirname(root), { recursive: true, force: true });
});

describe("the session's record", () => {
  it("names the working directory of the first user line", async () => {
    expect(await findSessionRecord(ID, env)).toMatchObject({ cwd: workspace });
  });

  it("answers 404 with the reason for an unknown id, a record without a directory, and a directory that is gone", async () => {
    await expect(findSessionRecord("nope", env)).rejects.toMatchObject({
      status: 404,
      code: "session_not_found",
    });
    await writeRecord("bare", [{ type: "mode" }, "not json"]);
    await expect(findSessionRecord("bare", env)).rejects.toMatchObject({
      status: 404,
      code: "record_without_cwd",
    });
    await writeRecord("moved", [{ type: "user", cwd: path.join(workspace, "gone") }]);
    await expect(findSessionRecord("moved", env)).rejects.toMatchObject({
      status: 404,
      code: "cwd_gone",
      message: expect.stringContaining(path.join(workspace, "gone")),
    });
  });

  it("answers 404 for a record that cannot be read", async () => {
    if (process.getuid?.() === 0) return; // root reads through any mode bits.
    if (process.platform === "win32") return; // chmod there cannot make a file unreadable.
    const file = await writeRecord("locked", [{ type: "user", cwd: workspace }]);
    await fs.chmod(file, 0o000);
    await expect(findSessionRecord("locked", env)).rejects.toMatchObject({
      status: 404,
      code: "record_unreadable",
    });
  });
});

describe("the registry of live programs", () => {
  it("finds the live program holding the session, and passes over a dead pid or a reused one", async () => {
    await register(101, ID, "500");
    await register(102, ID, "700");
    await register(103, "another", "900");
    expect(await liveSession(ID, env, probe)).toBeNull();
    procs.set(101, { start: "999", tty: "/dev/pts/1", pane: null }); // pid reused since
    procs.set(103, { start: "900", tty: "/dev/pts/2", pane: null }); // another session
    expect(await liveSession(ID, env, probe)).toBeNull();
    procs.set(102, { start: "700", tty: "/dev/pts/7", pane: "%3" });
    expect(await liveSession(ID, env, probe)).toEqual({
      pid: 102,
      cwd: workspace,
      tty: "/dev/pts/7",
      tmux: { socket: "/tmp/tmux-1/default", pane: "%3" },
    });
  });
});

describe("the link", () => {
  it("queues a resume run of the named employee in the session's directory, and enters its Session once started", async () => {
    const q = queue();
    const res = await app(q).request(link());
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/chat/cc-1");
    // A Session of the employee's Agent: what the employee's credential is issued for.
    expect(created).toEqual([{ agentId: "dev", workspace }]);
    expect(resumed).toEqual([["cc-1", ID]]);
    // Opened as the organization's: its program's control environment names it.
    expect(opened).toEqual([{ sessionId: "cc-1", owner: "admin", options: { orgId: "acme" } }]);
    const [run] = (await q.list("p", "acme", { userId: "admin" })).runs;
    expect(run).toMatchObject({
      agentId: "dev",
      by: "user:admin",
      prompt: "",
      claudeSessionId: ID,
      keepIdle: true,
      status: "running",
    });
    await q.stop();
  });

  it("enters the run that already holds the session instead of starting another, naming the machine it was asked for", async () => {
    const q = queue();
    const a = app(q);
    await a.request(link());
    // The queue's own program registers itself like any other; the run is found first.
    await register(4242, ID, "1");
    procs.set(4242, { start: "1", tty: "/dev/pts/9", pane: null });
    const again = await a.request(link(ID, "&machine=box"));
    expect(again.headers.get("location")).toBe("/chat/cc-1?machine=box");
    expect(created).toHaveLength(1);
    await q.stop();
  });

  it("with a prompt, queues a run that starts a turn with it and is not kept while idle", async () => {
    const q = queue();
    const res = await app(q).request(link(ID, `&prompt=${encodeURIComponent("review #4")}`));
    expect(res.headers.get("location")).toBe("/chat/cc-1");
    expect(opened).toEqual([
      { sessionId: "cc-1", owner: "admin", options: { prompt: "review #4", orgId: "acme" } },
    ]);
    const [run] = (await q.list("p", "acme", { userId: "admin" })).runs;
    expect(run).toMatchObject({ prompt: "review #4", claudeSessionId: ID, status: "running" });
    expect(run!.keepIdle).toBeUndefined();
    // The session is running: a second prompt starts nothing, in either form.
    const again = await app(q).request(link(ID, "&prompt=more"), {
      headers: { accept: "application/json" },
    });
    expect(await again.json()).toMatchObject({ state: "running", sessionId: "cc-1" });
    expect(opened).toHaveLength(1);
    await q.stop();
  });

  it("lands on the console with the run picked out while it waits for a slot", async () => {
    config = { capacity: 0, idleMinutes: 30 };
    const q = queue();
    const res = await app(q).request(link(ID, "&project=p"));
    expect(res.headers.get("location")).toBe("/org/p/acme/claude-code?run=1");
    expect(opened).toEqual([]);
    // A second click finds the queued run: still one run.
    await app(q).request(link());
    expect((await q.list("p", "acme", { userId: "admin" })).runs).toHaveLength(1);
    await q.stop();
  });

  it("never starts a second program on a session a terminal outside the queue holds, and says where", async () => {
    await register(4242, ID, "77");
    procs.set(4242, { start: "77", tty: "/dev/pts/7", pane: "%3" });
    const q = queue();
    const res = await app(q).request(link());
    expect(res.status).toBe(409);
    const page = await res.text();
    expect(page).toContain("process 4242");
    expect(page).toContain("/dev/pts/7");
    expect(page).toContain("tmux pane %3");
    expect(created).toEqual([]);
    expect((await q.list("p", "acme", { userId: "admin" })).runs).toEqual([]);
    await q.stop();
  });

  it("answers an unknown or malformed session id with 404 and the reason", async () => {
    const q = queue();
    const unknown = await app(q).request(link("0000-unknown"));
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toContain("No Claude Code session 0000-unknown");
    expect((await app(q).request(link("..%2F..%2Fetc"))).status).toBe(404);
    expect(created).toEqual([]);
    await q.stop();
  });

  it("is for the Project's people, for a named employee", async () => {
    const q = queue();
    expect((await app(q, "stranger").request(link())).status).toBe(403);
    expect((await app(q).request(`/api/claude-code/open/${ID}?org=acme`)).status).toBe(400);
    expect((await app(q).request(`/api/claude-code/open/${ID}?org=nope&agent=dev`)).status).toBe(
      404,
    );
    expect(created).toEqual([]);
    await q.stop();
  });

  it("sends an organization on another machine there, with the machine riding along", async () => {
    orgs.set("acme", org("acme", { machineId: "box" }));
    const q = queue();
    const res = await app(q).request(link());
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get("location")!, "http://x");
    expect(to.pathname).toBe(`/server/box/api/claude-code/open/${ID}`);
    expect(Object.fromEntries(to.searchParams)).toEqual({
      org: "acme",
      agent: "dev",
      project: "p",
      machine: "box",
    });
    await q.stop();
  });
});

describe("the link by roadmap", () => {
  /** The organization's mapping, as the board's script writes it. */
  const mapping = (text: string) =>
    fs.writeFile(path.join(root, "p", "organizations", "acme", "claude-sessions.json"), text);
  const byRoadmap = (n: string | number, extra = "") =>
    `/api/claude-code/open?org=acme&roadmap=${n}${extra}`;

  it("opens the session the mapping names for the roadmap, as the employee it names", async () => {
    await mapping(JSON.stringify({ roadmaps: { "3": { sessionId: ID, agentId: "dev" } } }));
    const q = queue();
    const res = await app(q).request(byRoadmap(3));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/chat/cc-1");
    expect(created).toEqual([{ agentId: "dev", workspace }]);
    expect(resumed).toEqual([["cc-1", ID]]);
    // The same session by its id: the run already holds it.
    const again = await app(q).request(link());
    expect(again.headers.get("location")).toBe("/chat/cc-1");
    expect(created).toHaveLength(1);
    await q.stop();
  });

  it("answers 404 with the reason for a roadmap the mapping does not name, and for no mapping", async () => {
    const q = queue();
    const none = await app(q).request(byRoadmap(3));
    expect(none.status).toBe(404);
    expect(await none.text()).toContain(
      "Roadmap #3 of organization acme has no Claude Code session",
    );
    await mapping(JSON.stringify({ roadmaps: { "4": { sessionId: ID, agentId: "dev" } } }));
    expect((await app(q).request(byRoadmap(3))).status).toBe(404);
    expect(created).toEqual([]);
    await q.stop();
  });

  it("reads an invalid mapping as none", async () => {
    const q = queue();
    for (const text of [
      "not json",
      JSON.stringify({ roadmaps: { "3": { sessionId: "../../etc", agentId: "dev" } } }),
      JSON.stringify({ roadmaps: { "3": { sessionId: ID, agentId: "dev", extra: 1 } } }),
      JSON.stringify({ roadmaps: { "03": { sessionId: ID, agentId: "dev" } } }),
      JSON.stringify({ roadmaps: { "3": { sessionId: ID, agentId: "dev" } }, other: {} }),
      JSON.stringify([]),
    ]) {
      await mapping(text);
      expect((await app(q).request(byRoadmap(3))).status, text).toBe(404);
    }
    expect(created).toEqual([]);
    await q.stop();
  });

  it("asks for a roadmap number, and is for the Project's people", async () => {
    await mapping(JSON.stringify({ roadmaps: { "3": { sessionId: ID, agentId: "dev" } } }));
    const q = queue();
    expect((await app(q).request(byRoadmap("x"))).status).toBe(400);
    expect((await app(q).request("/api/claude-code/open?org=acme")).status).toBe(400);
    expect((await app(q, "stranger").request(byRoadmap(3))).status).toBe(403);
    expect(created).toEqual([]);
    await q.stop();
  });

  it("sends an organization on another machine there, which reads its own mapping", async () => {
    orgs.set("acme", org("acme", { machineId: "box" }));
    const q = queue();
    const res = await app(q).request(byRoadmap(3));
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get("location")!, "http://x");
    expect(to.pathname).toBe("/server/box/api/claude-code/open");
    expect(Object.fromEntries(to.searchParams)).toEqual({
      org: "acme",
      roadmap: "3",
      project: "p",
      machine: "box",
    });
    await q.stop();
  });
});

describe("the surface", () => {
  it("starts claude --resume, with the prompt when there is one, for a Session planned as a resume", async () => {
    expect(claudeArgv(undefined, { PENGUIN_CLAUDE_BIN: "c" }, ID)).toEqual(["c", "--resume", ID]);
    const commands: unknown[] = [];
    const terminal = {
      id: "t1",
      alive: true,
      capture: () => ({ lines: [], totalLines: 0 }),
      onOutput: () => () => {},
      onExit: () => () => {},
      kill: () => {},
    };
    const surface = new ClaudeCodeSurface(
      {
        create: async (request: { command: unknown }) => {
          commands.push(request.command);
          return terminal;
        },
        get: () => terminal,
      } as never,
      { PENGUIN_CLAUDE_BIN: "c", CLAUDE_CONFIG_DIR: claude },
    );
    const ref = {
      sessionId: "s1",
      projectId: "p",
      agentId: "dev",
      workspace,
      ownerUserId: "admin",
      env: { PENGUIN_SESSION_ID: "s1" },
    };
    surface.planResume("s1", ID);
    await surface.open(ref, {}, () => {});
    surface.close("s1");
    // The plan is spent: the next program of that Session is a new conversation.
    await surface.open(ref, {}, () => {});
    surface.close("s1");
    // An event's resume: continued, and told at once.
    surface.planResume("s1", ID);
    await surface.open(ref, { prompt: "go" }, () => {});
    surface.close("s1");
    expect(commands).toEqual([["c", "--resume", ID], ["c"], ["c", "--resume", ID, "go"]]);
  });
});
