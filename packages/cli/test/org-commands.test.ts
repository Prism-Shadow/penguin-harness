/**
 * `penguin org` wiring, driven through `cli()` in-process against the fake server's
 * organization routes: list / overview / chart rendering, creation, hiring (both forms
 * and the exclusivity rule), the calendar writer, the ticket writes (their bodies, and
 * the caller identity taken from the control environment), the channel family with its
 * membership rules, finance, the --org-id default and --json output.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cli } from "../src/index.js";
import { getMessages } from "../src/i18n.js";
import { FakeServer } from "./fake-server.js";

const t = getMessages("en");

/** The control environment a desk or ticket session carries: every test starts without it and restores what was there. */
const ENV_KEYS = ["PENGUIN_ORG_ID", "PENGUIN_AGENT_ID", "PENGUIN_SESSION_ID", "PENGUIN_PROJECT_ID"];
const saved = new Map<string, string | undefined>();

/** The desk session the CLI is assumed to run inside when PENGUIN_SESSION_ID is set below. */
const DESK_SESSION = "session-2026-09-02-10-00-00-de5c0001";

let server: FakeServer;
let uninstall: () => void;
let stdout: string[];
let stderr: string[];
let outSpy: { mockRestore(): void };
let errSpy: { mockRestore(): void };

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  server = new FakeServer();
  uninstall = server.install();
  server.addOrg({ orgId: "acme", name: "Acme", mission: "Ship the site" });
  process.env.PENGUIN_ORG_ID = "acme";
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
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const out = () => stdout.join("");
const err = () => stderr.join("");
/** The most recent recorded request of `method` whose path ends with `suffix`. */
const lastRequest = (method: string, suffix: string) =>
  server.requests.findLast((r) => r.method === method && r.path.endsWith(suffix));
const org = () => server.orgs.get("acme")!;

describe("penguin org ls / show / chart", () => {
  it("ls lists organizations with counts and spend; --json prints the response", async () => {
    server.addEmployee("acme", {
      agentId: "dev1",
      title: "Developer",
      state: "running",
      spend: { own: 1.5, cumulative: 1.5 },
    });
    server.addTicket("acme", {
      ticketId: "2026-09-02-site",
      title: "Build the site",
      status: "in_progress",
      blocked: "waiting for keys",
    });
    org().spend = { period: "2026-09", cost: 1.5, budget: 50, ratio: 0.03 };
    expect(await cli(["org", "ls"])).toBe(0);
    const text = out();
    expect(text).toContain("acme");
    expect(text).toContain("Acme");
    expect(text).toContain("active");
    expect(text).toContain("$1.5000 / $50.00 (3%)");

    stdout.length = 0;
    expect(await cli(["org", "ls", "--json"])).toBe(0);
    const parsed = JSON.parse(out()) as { organizations: Array<Record<string, unknown>> };
    expect(parsed.organizations[0]).toMatchObject({
      orgId: "acme",
      employeeCount: 2,
      runningCount: 1,
      openTickets: 1,
      blockedTickets: 1,
    });
  });

  it("ls prints the empty line when the project has no organization", async () => {
    server.orgs.clear();
    expect(await cli(["org", "ls"])).toBe(0);
    expect(out()).toBe(`${t.org.empty("default_project")}\n`);
  });

  it("show prints the overview: identity, mission, people, board, spend, pending", async () => {
    server.addEmployee("acme", { agentId: "dev1", title: "Developer", state: "running" });
    server.addTicket("acme", { ticketId: "2026-09-02-site", title: "Site", status: "review" });
    server.addTicket("acme", { ticketId: "2026-09-02-docs", title: "Docs", blocked: "waiting" });
    expect(await cli(["org", "show"])).toBe(0);
    const text = out();
    expect(text).toContain("Acme (acme) — active");
    expect(text).toContain("Mission: Ship the site");
    expect(text).toContain(t.org.showEmployees(2, 1, 0));
    expect(text).toContain("proposed 1, in_progress 0, review 1, done 0, rejected 0 (1 blocked)");
    expect(text).toContain("Spend (2026-09): $0.0000");
    expect(text).toContain(t.org.showPending(0, 1, 0));

    stdout.length = 0;
    expect(await cli(["org", "show", "--json"])).toBe(0);
    expect(JSON.parse(out())).toMatchObject({ orgId: "acme", board: { review: 1, proposed: 1 } });
  });

  it("chart renders the reporting tree indented by depth, with state, spend and budget", async () => {
    server.addEmployee("acme", {
      agentId: "hr",
      title: "HR",
      budget: 20,
      spend: { own: 2, cumulative: 8, ratio: 0.4 },
    });
    server.addEmployee("acme", {
      agentId: "dev1",
      title: "Developer",
      reportsTo: "hr",
      state: "running",
      spend: { own: 6, cumulative: 6 },
    });
    server.addEmployee("acme", {
      agentId: "ghost",
      title: "Contractor",
      reportsTo: "nobody",
      invalid: "missing Agent",
    });
    expect(await cli(["org", "chart"])).toBe(0);
    const lines = out().split("\n");
    const row = (id: string) => lines.find((l) => l.trimStart().startsWith(`${id} `))!;
    expect(row("ceo").startsWith("ceo ")).toBe(true);
    expect(row("hr").startsWith("  hr ")).toBe(true);
    expect(row("dev1").startsWith("    dev1 ")).toBe(true);
    expect(row("hr")).toContain("$2.0000");
    expect(row("hr")).toContain("$8.0000");
    expect(row("hr")).toContain("$20.00 (40%)");
    expect(row("dev1")).toContain("running");
    // An employee whose manager is not in the tree is listed at the root with its reason, not dropped.
    expect(row("ghost").startsWith("ghost ")).toBe(true);
    expect(row("ghost")).toContain("invalid: missing Agent");

    stdout.length = 0;
    expect(await cli(["org", "chart", "--json"])).toBe(0);
    expect(JSON.parse(out())).toMatchObject({ ceoAgentId: "ceo" });
  });
});

describe("penguin org create", () => {
  it("posts the definition and prints the org id with the CEO's desk session id", async () => {
    expect(
      await cli([
        "org",
        "create",
        "--org-id",
        "beta",
        "--mission",
        "Make widgets",
        "--name",
        "Beta Inc",
      ]),
    ).toBe(0);
    // --ceo-budget defaults to 100: the CEO's chart entry is the whole company's budget,
    // so a new organization is capped rather than unbounded.
    expect(lastRequest("POST", "/organizations")?.body).toEqual({
      orgId: "beta",
      mission: "Make widgets",
      name: "Beta Inc",
      ceoBudget: 100,
    });
    const beta = server.orgs.get("beta")!;
    expect(beta.employees.find((e) => e.agentId === "ceo")?.budget).toBe(100);
    expect(beta.ceoDeskSessionId).toBeDefined();
    expect(out()).toBe(`${t.org.created("beta", beta.ceoDeskSessionId)}\n`);

    stdout.length = 0;
    expect(await cli(["org", "create", "--org-id", "gamma", "--mission", "m", "--json"])).toBe(0);
    expect(JSON.parse(out())).toMatchObject({ orgId: "gamma", mission: "m", employeeCount: 1 });
  });

  it("--ceo-budget sets the CEO's budget; a negative amount is refused before any request", async () => {
    expect(
      await cli(["org", "create", "--org-id", "beta", "--mission", "m", "--ceo-budget", "250.5"]),
    ).toBe(0);
    expect(lastRequest("POST", "/organizations")?.body).toMatchObject({ ceoBudget: 250.5 });
    expect(server.orgs.get("beta")!.employees.find((e) => e.agentId === "ceo")?.budget).toBe(250.5);

    stdout.length = 0;
    for (const bad of ["-1", "many"]) {
      expect(
        await cli(["org", "create", "--org-id", "delta", "--mission", "m", "--ceo-budget", bad]),
      ).toBe(1);
      expect(server.orgs.has("delta")).toBe(false);
    }
    expect(err()).toContain(t.org.budgetInvalid("--ceo-budget", "many"));
  });

  it("create's --org-id names the organization to create; PENGUIN_ORG_ID never fills it in", async () => {
    expect(await cli(["org", "create", "--mission", "m"])).toBe(1);
    expect(err()).toContain("--org-id");
    expect(server.requests.some((r) => r.method === "POST")).toBe(false);
  });
});

describe("penguin org hire / employee set / leave", () => {
  it("hire --agent-id employs an existing Agent; the body carries title, manager, workspace, budget and duties", async () => {
    server.agents.push({
      agentId: "dev1",
      name: "Dev One",
      description: "",
      sessionCount: 0,
      activeSessionCount: 0,
      sessionActivity: [],
    });
    expect(
      await cli([
        "org",
        "hire",
        "--agent-id",
        "dev1",
        "--title",
        "Developer",
        "--reports-to",
        "ceo",
        "--workspace",
        "site",
        "--budget",
        "20",
        "--duties",
        "Builds things",
      ]),
    ).toBe(0);
    expect(lastRequest("POST", "/employees")?.body).toEqual({
      agentId: "dev1",
      title: "Developer",
      reportsTo: "ceo",
      workspace: "site",
      budget: 20,
      duties: "Builds things",
    });
    expect(out()).toBe(`${t.org.hired("dev1", "Developer", "ceo")}\n`);
  });

  it("hire --new-agent creates the Agent: name, description and --skills become newAgent.plugins", async () => {
    expect(
      await cli([
        "org",
        "hire",
        "--new-agent",
        "writer",
        "--name",
        "Writer",
        "--description",
        "Writes docs",
        "--skills",
        "agent-company, humanizer",
        "--title",
        "Writer",
        "--reports-to",
        "ceo",
      ]),
    ).toBe(0);
    expect(lastRequest("POST", "/employees")?.body).toEqual({
      newAgent: {
        agentId: "writer",
        name: "Writer",
        description: "Writes docs",
        plugins: ["agent-company", "humanizer"],
      },
      title: "Writer",
      reportsTo: "ceo",
    });
    expect(server.agents.some((a) => a.agentId === "writer")).toBe(true);
    expect(org().employees.some((e) => e.agentId === "writer")).toBe(true);
  });

  it("hire takes exactly one of --agent-id and --new-agent; the new-Agent fields and a bad budget are refused locally", async () => {
    const base = ["org", "hire", "--title", "T", "--reports-to", "ceo"];
    expect(await cli([...base, "--agent-id", "a", "--new-agent", "b"])).toBe(1);
    expect(err()).toContain("--new-agent");
    expect(await cli(base)).toBe(1);
    expect(await cli([...base, "--agent-id", "a", "--skills", "x"])).toBe(1);
    expect(await cli([...base, "--agent-id", "a", "--budget", "-1"])).toBe(1);
    expect(server.requests.some((r) => r.method === "POST")).toBe(false);
  });

  it("employee set PATCHes the given fields (the model as a pair); nothing to set is refused", async () => {
    server.addEmployee("acme", { agentId: "dev1", title: "Developer" });
    expect(
      await cli([
        "org",
        "employee",
        "set",
        "dev1",
        "--title",
        "Senior Developer",
        "--budget",
        "30",
        "--model-id",
        "m1",
        "--provider",
        "p1",
      ]),
    ).toBe(0);
    expect(lastRequest("PATCH", "/employees/dev1")?.body).toEqual({
      title: "Senior Developer",
      budget: 30,
      model: { provider: "p1", modelId: "m1" },
    });
    expect(out()).toBe(`${t.org.employeeUpdated("dev1")}\n`);
    expect(await cli(["org", "employee", "set", "dev1", "--model-id", "m1"])).toBe(1);
    expect(await cli(["org", "employee", "set", "dev1"])).toBe(1);
    expect(err()).toContain(t.org.nothingToSet());
  });

  it("leave DELETEs the employee; the server's refusal for the CEO surfaces verbatim", async () => {
    server.addEmployee("acme", { agentId: "dev1" });
    expect(await cli(["org", "leave", "dev1"])).toBe(0);
    expect(lastRequest("DELETE", "/employees/dev1")).toBeDefined();
    expect(org().employees.some((e) => e.agentId === "dev1")).toBe(false);
    expect(out()).toBe(`${t.org.left("dev1")}\n`);
    expect(await cli(["org", "leave", "ceo"])).toBe(1);
    expect(err()).toContain("409");
  });
});

describe("penguin org desk", () => {
  it("show defaults the employee to PENGUIN_AGENT_ID and opens the desk when there is none; renew POSTs a fresh one", async () => {
    server.addEmployee("acme", { agentId: "dev1" });
    process.env.PENGUIN_AGENT_ID = "dev1";
    expect(await cli(["org", "desk", "show"])).toBe(0);
    expect(lastRequest("GET", "/employees/dev1/desk")).toBeDefined();
    const first = String(org().desks.get("dev1")!.sessionId);
    expect(out()).toContain(first);

    stdout.length = 0;
    expect(await cli(["org", "desk", "renew", "dev1", "--json"])).toBe(0);
    expect(lastRequest("POST", "/employees/dev1/desk")).toBeDefined();
    const renewed = JSON.parse(out()) as { sessionId: string; created: boolean };
    expect(renewed.created).toBe(true);
    expect(renewed.sessionId).not.toBe(first);
  });
});

describe("penguin org calendar", () => {
  beforeEach(() => {
    server.addEmployee("acme", { agentId: "dev1" });
    process.env.PENGUIN_AGENT_ID = "dev1";
  });

  it("add posts the event under the calling employee, enabled, with --start-at now resolved to the current instant", async () => {
    const before = Date.now();
    expect(
      await cli([
        "org",
        "calendar",
        "add",
        "standup",
        "--prompt",
        "check the board",
        "--start-at",
        "now",
        "--period",
        "1d",
        "--title",
        "Standup",
      ]),
    ).toBe(0);
    const body = lastRequest("POST", "/calendar")?.body as { startAt: string };
    expect(body).toMatchObject({
      agentId: "dev1",
      name: "standup",
      enabled: true,
      prompt: "check the board",
      period: "1d",
      title: "Standup",
    });
    const ms = Date.parse(body.startAt);
    expect(ms).toBeGreaterThanOrEqual(before - 1000);
    expect(ms).toBeLessThanOrEqual(Date.now() + 1000);
    expect(out()).toContain("dev1/standup");
  });

  it("--disabled opts out of the enabled default; --agent-id overrides the environment", async () => {
    server.addEmployee("acme", { agentId: "hr" });
    expect(
      await cli([
        "org",
        "calendar",
        "add",
        "weekly",
        "--agent-id",
        "hr",
        "--prompt",
        "p",
        "--start-at",
        "2026-09-08T09:00:00.000Z",
        "--disabled",
      ]),
    ).toBe(0);
    expect(lastRequest("POST", "/calendar")?.body).toMatchObject({ agentId: "hr", enabled: false });
  });

  it("update is read-modify-write, ls lists all or one employee's events, rm deletes", async () => {
    await cli([
      "org",
      "calendar",
      "add",
      "standup",
      "--prompt",
      "original",
      "--start-at",
      "2026-09-08T09:00:00.000Z",
      "--period",
      "1d",
    ]);
    stdout.length = 0;
    expect(
      await cli(["org", "calendar", "update", "standup", "--period", "12h", "--disable"]),
    ).toBe(0);
    expect(lastRequest("PUT", "/calendar/dev1/standup")?.body).toEqual({
      enabled: false,
      prompt: "original",
      startAt: "2026-09-08T09:00:00.000Z",
      period: "12h",
    });
    expect(await cli(["org", "calendar", "update", "standup", "--enable", "--disable"])).toBe(1);

    stdout.length = 0;
    expect(await cli(["org", "calendar", "ls"])).toBe(0);
    expect(out()).toContain("standup");
    expect(out()).toContain(t.schedule.disabled());
    stdout.length = 0;
    expect(await cli(["org", "calendar", "ls", "--agent-id", "ceo"])).toBe(0);
    expect(out()).toBe(`${t.org.calendarEmpty()}\n`);

    expect(await cli(["org", "calendar", "rm", "standup"])).toBe(0);
    expect(lastRequest("DELETE", "/calendar/dev1/standup")).toBeDefined();
    expect(await cli(["org", "calendar", "rm", "standup"])).toBe(1);
    expect(err()).toContain("calendar_event_not_found");
  });
});

describe("penguin org ticket (writes carry the calling session)", () => {
  beforeEach(() => {
    server.addEmployee("acme", { agentId: "dev1", title: "Developer" });
    // The CLI runs inside dev1's desk session: the control environment names it.
    server.addSession({ sessionId: DESK_SESSION, agentId: "dev1" });
    process.env.PENGUIN_SESSION_ID = DESK_SESSION;
    process.env.PENGUIN_AGENT_ID = "dev1";
  });

  it("create posts goal, criteria, owner, parent, notify list, priority and due, attributed to the session", async () => {
    server.addTicket("acme", { ticketId: "2026-09-01-plan", title: "Plan" });
    expect(
      await cli([
        "org",
        "ticket",
        "create",
        "--title",
        "Build the site",
        "--goal",
        "A landing page",
        "--criteria",
        "It renders",
        "--owner",
        "agent:dev1",
        "--parent",
        "2026-09-01-plan",
        "--notify",
        "agent:ceo,user:admin",
        "--priority",
        "P0",
        "--due",
        "2026-09-10",
      ]),
    ).toBe(0);
    expect(lastRequest("POST", "/tickets")?.body).toEqual({
      title: "Build the site",
      goal: "A landing page",
      acceptanceCriteria: "It renders",
      owner: "agent:dev1",
      parent: "2026-09-01-plan",
      notify: ["agent:ceo", "user:admin"],
      priority: "P0",
      due: "2026-09-10",
      sessionId: DESK_SESSION,
    });
    expect(out()).toBe(`${t.org.ticketCreated("2026-09-02-build-the-site", "proposed")}\n`);
    // The file records the session's employee as the initiator, not the token's user.
    expect(org().tickets.get("2026-09-02-build-the-site")).toMatchObject({
      initiator: "agent:dev1",
    });
  });

  it("create takes the whole body from --body-file; --goal with it, --criteria without it and a bad priority are refused", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-org-test-"));
    const file = path.join(dir, "ticket.md");
    fs.writeFileSync(file, "## Goal\nFrom a file\n");
    try {
      expect(await cli(["org", "ticket", "create", "--title", "Docs", "--body-file", file])).toBe(
        0,
      );
      expect(lastRequest("POST", "/tickets")?.body).toMatchObject({
        title: "Docs",
        body: "## Goal\nFrom a file\n",
      });
      const create = ["org", "ticket", "create", "--title", "Docs"];
      expect(await cli([...create, "--goal", "g", "--body-file", file])).toBe(1);
      expect(await cli([...create, "--criteria", "c", "--body-file", file])).toBe(1);
      expect(await cli([...create, "--goal", "g", "--priority", "P9"])).toBe(1);
      expect(await cli([...create, "--body-file", path.join(dir, "missing.md")])).toBe(1);
      expect(server.requests.filter((r) => r.method === "POST")).toHaveLength(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("move / assign / block / unblock / progress send their bodies with the session id", async () => {
    server.addTicket("acme", { ticketId: "2026-09-02-site", title: "Site", owner: "agent:dev1" });
    expect(await cli(["org", "ticket", "move", "2026-09-02-site", "--to", "in_progress"])).toBe(0);
    expect(lastRequest("POST", "/tickets/2026-09-02-site/move")?.body).toEqual({
      status: "in_progress",
      sessionId: DESK_SESSION,
    });
    expect(out()).toBe(`${t.org.ticketMoved("2026-09-02-site", "in_progress")}\n`);
    expect(await cli(["org", "ticket", "move", "2026-09-02-site", "--to", "bogus"])).toBe(1);
    expect(err()).toContain("bogus");
    // Moving into rejected needs a reason: the server's rule, surfacing verbatim.
    expect(await cli(["org", "ticket", "move", "2026-09-02-site", "--to", "rejected"])).toBe(1);
    expect(err()).toContain("reason");

    stdout.length = 0;
    expect(await cli(["org", "ticket", "assign", "2026-09-02-site", "--owner", "agent:ceo"])).toBe(
      0,
    );
    expect(lastRequest("PUT", "/tickets/2026-09-02-site")?.body).toEqual({
      owner: "agent:ceo",
      sessionId: DESK_SESSION,
    });
    expect(out()).toBe(`${t.org.ticketAssigned("2026-09-02-site", "agent:ceo")}\n`);

    stdout.length = 0;
    expect(
      await cli([
        "org",
        "ticket",
        "block",
        "2026-09-02-site",
        "--reason",
        "waiting for keys",
        "--by",
        "user:admin",
      ]),
    ).toBe(0);
    expect(lastRequest("POST", "/tickets/2026-09-02-site/block")?.body).toEqual({
      reason: "waiting for keys",
      by: "user:admin",
      sessionId: DESK_SESSION,
    });
    expect(out()).toBe(`${t.org.ticketBlocked("2026-09-02-site")}\n`);
    expect(org().tickets.get("2026-09-02-site")).toMatchObject({
      blocked: "waiting for keys",
      blockedBy: "user:admin",
    });

    stdout.length = 0;
    expect(await cli(["org", "ticket", "unblock", "2026-09-02-site"])).toBe(0);
    expect(lastRequest("POST", "/tickets/2026-09-02-site/unblock")?.body).toEqual({
      sessionId: DESK_SESSION,
    });
    expect(org().tickets.get("2026-09-02-site")!.blocked).toBeUndefined();
    expect(out()).toBe(`${t.org.ticketUnblocked("2026-09-02-site")}\n`);

    stdout.length = 0;
    expect(await cli(["org", "ticket", "progress", "2026-09-02-site", "-m", "half done"])).toBe(0);
    expect(lastRequest("POST", "/tickets/2026-09-02-site/progress")?.body).toEqual({
      text: "half done",
      sessionId: DESK_SESSION,
    });
    expect(out()).toBe(`${t.org.progressRecorded("2026-09-02-site")}\n`);
    expect(org().tickets.get("2026-09-02-site")!.progress).toEqual([
      expect.objectContaining({ by: "agent:dev1", text: "half done", sessionId: DESK_SESSION }),
    ]);
  });

  it("outside a session the writes carry no session id", async () => {
    delete process.env.PENGUIN_SESSION_ID;
    server.addTicket("acme", { ticketId: "2026-09-02-site", title: "Site" });
    expect(await cli(["org", "ticket", "progress", "2026-09-02-site", "-m", "note"])).toBe(0);
    expect(lastRequest("POST", "/tickets/2026-09-02-site/progress")?.body).toEqual({
      text: "note",
    });
    expect(await cli(["org", "ticket", "unblock", "2026-09-02-site"])).toBe(0);
    expect(lastRequest("POST", "/tickets/2026-09-02-site/unblock")?.body).toEqual({});
  });

  it("start runs the ticket session as PENGUIN_AGENT_ID and prints the bare session id (--json: {sessionId})", async () => {
    server.addTicket("acme", { ticketId: "2026-09-02-site", title: "Site", owner: "agent:ceo" });
    expect(
      await cli([
        "org",
        "ticket",
        "start",
        "2026-09-02-site",
        "-m",
        "start with the header",
        "--workspace",
        "site",
      ]),
    ).toBe(0);
    expect(lastRequest("POST", "/tickets/2026-09-02-site/start")?.body).toEqual({
      agentId: "dev1",
      message: "start with the header",
      workspace: "site",
    });
    const sessions = org().tickets.get("2026-09-02-site")!.sessions as string[];
    expect(sessions).toHaveLength(1);
    expect(out()).toBe(`${sessions[0]}\n`);
    expect(server.sessions.get(sessions[0]!)?.agentId).toBe("dev1");

    // Without PENGUIN_AGENT_ID the body names no employee: the server picks the owner.
    delete process.env.PENGUIN_AGENT_ID;
    stdout.length = 0;
    expect(await cli(["org", "ticket", "start", "2026-09-02-site", "--json"])).toBe(0);
    expect(lastRequest("POST", "/tickets/2026-09-02-site/start")?.body).toEqual({});
    expect(sessions).toHaveLength(2);
    expect(JSON.parse(out())).toEqual({ sessionId: sessions[1] });
    expect(server.sessions.get(sessions[1]!)?.agentId).toBe("ceo");
  });

  it("attach defaults to the calling session, resolves a fragment, and needs one of the two", async () => {
    server.addTicket("acme", { ticketId: "2026-09-02-site", title: "Site" });
    expect(await cli(["org", "ticket", "attach", "2026-09-02-site"])).toBe(0);
    expect(lastRequest("POST", "/tickets/2026-09-02-site/attach")?.body).toEqual({
      sessionId: DESK_SESSION,
    });
    expect(out()).toBe(`${t.org.ticketAttached("2026-09-02-site", DESK_SESSION)}\n`);

    server.addSession({ sessionId: "session-2026-09-02-10-00-00-abcd0002", agentId: "dev1" });
    expect(await cli(["org", "ticket", "attach", "2026-09-02-site", "--session", "abcd0002"])).toBe(
      0,
    );
    expect(lastRequest("POST", "/tickets/2026-09-02-site/attach")?.body).toEqual({
      sessionId: "session-2026-09-02-10-00-00-abcd0002",
    });
    expect(org().tickets.get("2026-09-02-site")!.sessions).toEqual([
      DESK_SESSION,
      "session-2026-09-02-10-00-00-abcd0002",
    ]);

    delete process.env.PENGUIN_SESSION_ID;
    expect(await cli(["org", "ticket", "attach", "2026-09-02-site"])).toBe(1);
    expect(err()).toContain("--session");
  });

  it("ls filters locally by column, owner and blocked state; show prints the figures, then the file", async () => {
    server.addTicket("acme", {
      ticketId: "2026-09-02-site",
      title: "Site",
      status: "in_progress",
      owner: "agent:dev1",
      priority: "P0",
      sessions: [DESK_SESSION],
      running: true,
      cost: 0.12,
      rolledUpCost: 0.3,
    });
    server.addTicket("acme", {
      ticketId: "2026-09-02-docs",
      title: "Docs",
      owner: "agent:ceo",
      blocked: "waiting",
      blockedBy: "user:admin",
    });
    server.addTicket("acme", { ticketId: "2026-09-01-old", title: "Old", status: "done" });
    expect(await cli(["org", "ticket", "ls"])).toBe(0);
    let text = out();
    expect(text).toContain("2026-09-02-site");
    expect(text).toContain("2026-09-02-docs");
    expect(text).toContain("2026-09-01-old");
    expect(text).toContain("blocked");

    stdout.length = 0;
    expect(await cli(["org", "ticket", "ls", "--status", "in_progress"])).toBe(0);
    text = out();
    expect(text).toContain("2026-09-02-site");
    expect(text).not.toContain("2026-09-02-docs");

    stdout.length = 0;
    expect(await cli(["org", "ticket", "ls", "--blocked", "--json"])).toBe(0);
    const parsed = JSON.parse(out()) as { tickets: Array<{ ticketId: string }> };
    expect(parsed.tickets.map((x) => x.ticketId)).toEqual(["2026-09-02-docs"]);

    stdout.length = 0;
    expect(await cli(["org", "ticket", "ls", "--owner", "agent:ceo", "--status", "done"])).toBe(0);
    expect(out()).toBe(`${t.org.ticketsEmpty()}\n`);
    expect(await cli(["org", "ticket", "ls", "--status", "bogus"])).toBe(1);

    stdout.length = 0;
    expect(await cli(["org", "ticket", "show", "2026-09-02-site"])).toBe(0);
    text = out();
    expect(text).toContain(t.org.ticketHead("2026-09-02-site", "in_progress", true, undefined));
    expect(text).toContain(t.org.ticketFigures("$0.1200", "$0.3000", 1, 0));
    expect(text).toContain("# Ticket: Site");
    expect(text).toContain("Owner: agent:dev1");

    stdout.length = 0;
    expect(await cli(["org", "ticket", "show", "2026-09-02-site", "--json"])).toBe(0);
    expect(JSON.parse(out())).toMatchObject({
      ticketId: "2026-09-02-site",
      running: true,
      body: expect.stringContaining("# Ticket: Site") as string,
    });
    expect(await cli(["org", "ticket", "show", "2026-09-02-nope"])).toBe(1);
    expect(err()).toContain("ticket_not_found");
  });
});

describe("penguin org handbook", () => {
  it("list prints the files with the index first; show prints the index or a document", async () => {
    org().handbook.set("decisions/2026-09-02-hire-plan.md", "# Hire plan\n");
    expect(await cli(["org", "handbook", "list"])).toBe(0);
    const lines = out().trimEnd().split("\n");
    expect(lines[0]).toMatch(/^README\.md\t/);
    expect(lines[1]).toMatch(/^decisions\/2026-09-02-hire-plan\.md\t/);

    stdout.length = 0;
    expect(await cli(["org", "handbook", "show"])).toBe(0);
    expect(out()).toBe("# Acme — organization handbook\n");

    stdout.length = 0;
    expect(await cli(["org", "handbook", "show", "decisions/2026-09-02-hire-plan.md"])).toBe(0);
    expect(out()).toBe("# Hire plan\n");
    expect(lastRequest("GET", "/handbook/files/decisions/2026-09-02-hire-plan.md")).toBeTruthy();

    stdout.length = 0;
    expect(await cli(["org", "handbook", "show", "missing.md"])).toBe(1);
    expect(err()).toContain("missing.md is not in the handbook.");
  });

  it("write takes exactly one of -m or --file; rm deletes a document and refuses the index", async () => {
    expect(await cli(["org", "handbook", "write", "conventions.md"])).toBe(1);
    expect(err()).toContain(t.org.handbookOneSource);

    expect(await cli(["org", "handbook", "write", "conventions.md", "-m", "# Conventions"])).toBe(
      0,
    );
    expect(org().handbook.get("conventions.md")).toBe("# Conventions");
    expect(out()).toBe(`${t.org.handbookWritten("conventions.md")}\n`);
    expect(lastRequest("PUT", "/handbook/files/conventions.md")?.body).toEqual({
      content: "# Conventions",
    });

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-handbook-"));
    const file = path.join(dir, "guide.md");
    fs.writeFileSync(file, "# Guide\n");
    stdout.length = 0;
    expect(await cli(["org", "handbook", "write", "roles/dev.md", "--file", file])).toBe(0);
    expect(org().handbook.get("roles/dev.md")).toBe("# Guide\n");
    fs.rmSync(dir, { recursive: true, force: true });

    stdout.length = 0;
    expect(await cli(["org", "handbook", "rm", "conventions.md"])).toBe(0);
    expect(org().handbook.has("conventions.md")).toBe(false);
    expect(out()).toBe(`${t.org.handbookRemoved("conventions.md")}\n`);

    expect(await cli(["org", "handbook", "rm", "README.md"])).toBe(1);
    expect(err()).toContain("cannot be deleted");
  });

  // A `.` / `..` segment survives encodeURIComponent and the URL parser collapses it, so an
  // unchecked path leaves the handbook route entirely: `handbook/files/../../../victim` is
  // the organization `victim`, and `employees/..` is the organization itself.
  it("refuses a dot segment in a handbook path or an employee id before any request", async () => {
    server.addOrg({ orgId: "victim", name: "Victim", mission: "Stay alive" });
    server.requests.length = 0;

    expect(await cli(["org", "handbook", "rm", "../../../victim"])).toBe(1);
    expect(err()).toContain(t.org.pathSegmentInvalid("../../../victim"));
    expect(server.orgs.has("victim")).toBe(true);

    expect(await cli(["org", "handbook", "show", ".."])).toBe(1);
    expect(await cli(["org", "handbook", "write", "../x.md", "-m", "x"])).toBe(1);
    expect(await cli(["org", "leave", ".."])).toBe(1);
    expect(await cli(["org", "employee", "set", "..", "--title", "CEO"])).toBe(1);
    // `channels/site/members/../../..` is the organization too, so the channel arguments
    // that reach a path are guarded the same way.
    expect(await cli(["org", "channel", "show", ".."])).toBe(1);
    expect(await cli(["org", "channel", "remove", "site", "../../.."])).toBe(1);
    expect(await cli(["org", "channel", "tail", "--channel", ".."])).toBe(1);
    expect(server.orgs.has("acme")).toBe(true);
    expect(server.requests).toEqual([]);
  });
});

describe("penguin org channel", () => {
  /** The all-hands channel, created with every organization and the default of `--channel`. */
  const DEFAULT = "default_channel";
  /** The desk session's employee, set up by the tests that run inside a session. */
  const employeeInSession = (agentId: string) => {
    server.addEmployee("acme", { agentId });
    server.addSession({ sessionId: DESK_SESSION, agentId });
    process.env.PENGUIN_SESSION_ID = DESK_SESSION;
  };

  it("ls lists the channels — the all-hands label, member counts, unread and @me; --json passes the response", async () => {
    server.addEmployee("acme", { agentId: "dev1" });
    const site = server.addChannel("acme", "site", {
      name: "Site launch",
      members: ["user:admin", "agent:dev1"],
    });
    site.unread = 3;
    site.mentionsMe = 1;
    server.addChannel("acme", "marketing", { name: "Marketing", archived: true });
    expect(await cli(["org", "channel", "ls"])).toBe(0);
    const lines = out().trimEnd().split("\n");
    // The all-hands channel comes first and under its label, never its stored name.
    expect(lines[1]).toMatch(/^default_channel\s+All hands\s+3\s/);
    expect(lines[1]).not.toContain("All hands (");
    const row = (id: string) => lines.find((l) => l.startsWith(`${id} `))!;
    expect(row("site")).toContain("Site launch");
    expect(row("site")).toMatch(/\s3\s+1$/);
    expect(row("marketing")).toContain("archived");

    stdout.length = 0;
    expect(await cli(["org", "channel", "ls", "--json"])).toBe(0);
    const parsed = JSON.parse(out()) as { channels: Array<{ channelId: string }> };
    // default_channel first, then by name: Marketing before Site launch.
    expect(parsed.channels.map((c) => c.channelId)).toEqual([DEFAULT, "marketing", "site"]);
  });

  it("an employee sees only its own channels, and the read says which employee is asking", async () => {
    employeeInSession("dev1");
    server.addChannel("acme", "site", { members: ["agent:dev1"] });
    server.addChannel("acme", "marketing", { members: ["user:admin"] });
    expect(await cli(["org", "channel", "ls", "--json"])).toBe(0);
    const parsed = JSON.parse(out()) as { channels: Array<{ channelId: string }> };
    expect(parsed.channels.map((c) => c.channelId)).toEqual([DEFAULT, "site"]);
    // The read has no body, so the identity rides the query; without it the server would
    // answer the employee as the signed-in person and list every channel.
    expect(lastRequest("GET", "/channels")?.search).toBe(`?sessionId=${DESK_SESSION}`);

    delete process.env.PENGUIN_SESSION_ID;
    stdout.length = 0;
    expect(await cli(["org", "channel", "ls", "--json"])).toBe(0);
    const asPerson = JSON.parse(out()) as { channels: Array<{ channelId: string }> };
    expect(asPerson.channels.map((c) => c.channelId)).toEqual([DEFAULT, "marketing", "site"]);
    expect(lastRequest("GET", "/channels")?.search).toBe("");
  });

  it("create opens a channel holding only its creator; show prints it with its members", async () => {
    expect(
      await cli([
        "org",
        "channel",
        "create",
        "site",
        "--name",
        "Site launch",
        "--purpose",
        "Ship the site",
      ]),
    ).toBe(0);
    expect(lastRequest("POST", "/channels")?.body).toEqual({
      channelId: "site",
      name: "Site launch",
      purpose: "Ship the site",
    });
    expect(out()).toBe(`${t.org.channelCreated("site")}\n`);
    const site = org().channels.get("site")!;
    expect(site.members).toEqual(["user:admin"]);
    // Creation leaves its own system line in the new channel.
    expect(site.messages.map((m) => m.text)).toEqual(["user:admin created the channel."]);

    stdout.length = 0;
    expect(await cli(["org", "channel", "show", "site"])).toBe(0);
    const text = out();
    expect(text).toContain(t.org.channelHead("Site launch", "site", 1, false));
    expect(text).toContain(t.org.channelPurposeLine("Ship the site"));
    expect(text).toContain(t.org.channelCreatedBy("user:admin", site.createdAt));
    expect(text).toContain("user:admin");

    // The all-hands channel is shown under its label and holds everybody.
    stdout.length = 0;
    expect(await cli(["org", "channel", "show", DEFAULT])).toBe(0);
    expect(out()).toContain(t.org.channelHead(t.org.allHands(), DEFAULT, 2, false));
    expect(out()).toContain("agent:ceo");

    // A taken id is the server's 409, verbatim.
    expect(await cli(["org", "channel", "create", "site"])).toBe(1);
    expect(err()).toContain("channel_exists");
  });

  it("create inside a session makes an agent-owned channel", async () => {
    employeeInSession("dev1");
    expect(await cli(["org", "channel", "create", "site", "--json"])).toBe(0);
    expect(lastRequest("POST", "/channels")?.body).toEqual({
      channelId: "site",
      sessionId: DESK_SESSION,
    });
    expect(JSON.parse(out())).toMatchObject({ channelId: "site", createdBy: "agent:dev1" });
    expect(org().channels.get("site")!.members).toEqual(["agent:dev1"]);
  });

  it("invite posts one principal at a time and prints each; a stranger is refused", async () => {
    server.addEmployee("acme", { agentId: "dev1" });
    server.addEmployee("acme", { agentId: "hr" });
    server.addChannel("acme", "site", { members: ["user:admin"] });
    expect(await cli(["org", "channel", "invite", "site", "agent:dev1", "agent:hr"])).toBe(0);
    expect(
      server.requests.filter(
        (r) => r.method === "POST" && r.path.endsWith("/channels/site/members"),
      ),
    ).toHaveLength(2);
    expect(out()).toBe(
      `${t.org.channelInvited("site", "agent:dev1")}\n${t.org.channelInvited("site", "agent:hr")}\n`,
    );
    expect(org().channels.get("site")!.members).toEqual(["user:admin", "agent:dev1", "agent:hr"]);

    // Only an employee or a Project member can be in a channel.
    expect(await cli(["org", "channel", "invite", "site", "agent:nobody"])).toBe(1);
    expect(err()).toContain("invalid_principal");
    // The all-hands channel already holds everyone.
    expect(await cli(["org", "channel", "invite", DEFAULT, "agent:dev1"])).toBe(1);
    expect(err()).toContain("all_hands_immutable");
  });

  it("join adds the person itself; the principal is always the caller's own", async () => {
    server.addChannel("acme", "site", { members: ["agent:ceo"], createdBy: "agent:ceo" });
    expect(await cli(["org", "channel", "join", "site"])).toBe(0);
    // Outside a session the caller is the signed-in person, whom only the server knows.
    expect(lastRequest("GET", "/api/me")).toBeDefined();
    expect(lastRequest("POST", "/channels/site/members")?.body).toEqual({
      principal: "user:admin",
    });
    expect(org().channels.get("site")!.members).toEqual(["agent:ceo", "user:admin"]);
    expect(out()).toBe(`${t.org.channelJoined("site")}\n`);
  });

  it("an employee's join asks for itself and is refused, whether or not it is already in", async () => {
    employeeInSession("dev1");
    server.addChannel("acme", "marketing", { members: ["agent:ceo"] });
    expect(await cli(["org", "channel", "join", "marketing"])).toBe(1);
    // The body names the employee, never the token's user: joining can never invite someone else.
    expect(lastRequest("POST", "/channels/marketing/members")?.body).toEqual({
      principal: "agent:dev1",
      sessionId: DESK_SESSION,
    });
    expect(err()).toContain("An employee joins a channel only when a member invites it.");
    expect(org().channels.get("marketing")!.members).toEqual(["agent:ceo"]);

    // Already a member changes nothing: an employee is still refused, and the person the
    // token belongs to is not dragged into the channel behind its back.
    server.addChannel("acme", "site", { members: ["agent:dev1"] });
    expect(await cli(["org", "channel", "join", "site"])).toBe(1);
    expect(err()).toContain("An employee joins a channel only when a member invites it.");
    expect(org().channels.get("site")!.members).toEqual(["agent:dev1"]);
  });

  it("leave removes the caller's own principal: the employee's in a session, the person's outside one", async () => {
    employeeInSession("dev1");
    server.addChannel("acme", "site", { members: ["user:admin", "agent:dev1"] });
    expect(await cli(["org", "channel", "leave", "site"])).toBe(0);
    const asEmployee = lastRequest("DELETE", `/members/${encodeURIComponent("agent:dev1")}`);
    expect(asEmployee?.search).toBe(`?sessionId=${DESK_SESSION}`);
    expect(org().channels.get("site")!.members).toEqual(["user:admin"]);
    expect(out()).toBe(`${t.org.channelLeft("site")}\n`);

    delete process.env.PENGUIN_SESSION_ID;
    stdout.length = 0;
    expect(await cli(["org", "channel", "leave", "site"])).toBe(0);
    expect(lastRequest("DELETE", `/members/${encodeURIComponent("user:admin")}`)?.search).toBe("");
    expect(org().channels.get("site")!.members).toEqual([]);

    // Nobody leaves the all-hands channel.
    expect(await cli(["org", "channel", "leave", DEFAULT])).toBe(1);
    expect(err()).toContain("all_hands_immutable");
  });

  it("remove takes another member out; an employee may only remove itself", async () => {
    server.addEmployee("acme", { agentId: "dev1" });
    server.addSession({ sessionId: DESK_SESSION, agentId: "dev1" });
    server.addChannel("acme", "site", { members: ["user:admin", "agent:dev1"] });
    expect(await cli(["org", "channel", "remove", "site", "agent:dev1"])).toBe(0);
    expect(out()).toBe(`${t.org.channelMemberRemoved("site", "agent:dev1")}\n`);
    expect(org().channels.get("site")!.members).toEqual(["user:admin"]);

    server.addChannel("acme", "marketing", { members: ["user:admin", "agent:dev1"] });
    process.env.PENGUIN_SESSION_ID = DESK_SESSION;
    expect(await cli(["org", "channel", "remove", "marketing", "user:admin"])).toBe(1);
    expect(err()).toContain("An employee removes only itself from a channel.");
    expect(org().channels.get("marketing")!.members).toEqual(["user:admin", "agent:dev1"]);
  });

  it("archive makes a channel read-only, unarchive lifts it; the all-hands channel and employees are refused", async () => {
    server.addChannel("acme", "site", { members: ["user:admin"] });
    expect(await cli(["org", "channel", "archive", "site"])).toBe(0);
    expect(lastRequest("PATCH", "/channels/site")?.body).toEqual({ archived: true });
    expect(org().channels.get("site")!.archived).toBe(true);
    expect(out()).toBe(`${t.org.channelArchived("site")}\n`);

    // An archived channel takes no messages until it is unarchived.
    expect(await cli(["org", "channel", "send", "--channel", "site", "-m", "hello"])).toBe(1);
    expect(err()).toContain("channel_archived");

    stdout.length = 0;
    expect(await cli(["org", "channel", "unarchive", "site"])).toBe(0);
    expect(lastRequest("PATCH", "/channels/site")?.body).toEqual({ archived: false });
    expect(org().channels.get("site")!.archived).toBe(false);
    expect(out()).toBe(`${t.org.channelUnarchived("site")}\n`);

    expect(await cli(["org", "channel", "archive", DEFAULT])).toBe(1);
    expect(err()).toContain("all_hands_immutable");

    employeeInSession("dev1");
    expect(await cli(["org", "channel", "archive", "site"])).toBe(1);
    expect(err()).toContain("Only people archive a channel.");
  });

  it("tail prints the day's last messages as `time  sender  text`; -n limits, --date picks the day, --json carries it", async () => {
    for (let i = 1; i <= 3; i++) {
      server.addMessage("acme", {
        sender: "agent:ceo",
        text: `message ${i}`,
        time: `2026-09-02T10:0${i}:00.000Z`,
      });
    }
    server.addMessage("acme", {
      sender: "user:admin",
      text: "yesterday",
      time: "2026-09-01T09:00:00.000Z",
    });
    expect(await cli(["org", "channel", "tail"])).toBe(0);
    expect(out()).toBe(
      [
        "2026-09-02T10:01:00.000Z  agent:ceo  message 1",
        "2026-09-02T10:02:00.000Z  agent:ceo  message 2",
        "2026-09-02T10:03:00.000Z  agent:ceo  message 3",
        "",
      ].join("\n"),
    );

    stdout.length = 0;
    expect(await cli(["org", "channel", "tail", "-n", "1"])).toBe(0);
    expect(out()).toBe("2026-09-02T10:03:00.000Z  agent:ceo  message 3\n");

    stdout.length = 0;
    expect(await cli(["org", "channel", "tail", "--date", "2026-09-01", "--json"])).toBe(0);
    const parsed = JSON.parse(out()) as {
      channelId: string;
      date: string;
      messages: Array<{ text: string }>;
    };
    expect(parsed.channelId).toBe(DEFAULT);
    expect(parsed.date).toBe("2026-09-01");
    expect(parsed.messages.map((m) => m.text)).toEqual(["yesterday"]);

    expect(await cli(["org", "channel", "tail", "-n", "0"])).toBe(1);
    stdout.length = 0;
    expect(await cli(["org", "channel", "tail", "--date", "2026-08-01"])).toBe(0);
    expect(out()).toBe(`${t.org.channelEmpty(DEFAULT, "2026-08-01")}\n`);
  });

  it("tail reads the channel --channel names and names it above the messages; the default one says nothing", async () => {
    server.addChannel("acme", "site", { members: ["user:admin"] });
    server.addMessage("acme", { sender: "user:admin", text: "kickoff" }, "site");
    server.addMessage("acme", { sender: "user:admin", text: "all hands" });
    expect(await cli(["org", "channel", "tail", "--channel", "site"])).toBe(0);
    expect(out()).toContain(t.org.channelHeader("site"));
    expect(out()).toContain("2026-09-02T10:00:00.000Z  user:admin  kickoff");
    expect(out()).not.toContain("all hands");

    stdout.length = 0;
    expect(await cli(["org", "channel", "tail"])).toBe(0);
    expect(out()).toBe("2026-09-02T10:00:00.000Z  user:admin  all hands\n");

    // The empty line names the channel it read.
    stdout.length = 0;
    server.addChannel("acme", "quiet", { members: ["user:admin"] });
    expect(await cli(["org", "channel", "tail", "--channel", "quiet"])).toBe(0);
    expect(out()).toBe(`${t.org.channelEmpty("quiet", "2026-09-02")}\n`);
  });

  it("send posts the text with refs and the calling session; --channel picks the channel", async () => {
    employeeInSession("dev1");
    expect(
      await cli([
        "org",
        "channel",
        "send",
        "-m",
        "@agent:ceo the site is up",
        "--ref-ticket",
        "2026-09-02-site",
      ]),
    ).toBe(0);
    expect(lastRequest("POST", `/channels/${DEFAULT}/messages`)?.body).toEqual({
      text: "@agent:ceo the site is up",
      refs: { ticket: "2026-09-02-site" },
      sessionId: DESK_SESSION,
    });
    const msg = org().channels.get(DEFAULT)!.messages[0]!;
    expect(msg).toMatchObject({ sender: "agent:dev1", mentions: ["agent:ceo"] });
    expect(out()).toBe(`${t.org.messageSent(String(msg.id))}\n`);

    server.addChannel("acme", "site", { members: ["agent:dev1", "agent:ceo"] });
    stdout.length = 0;
    expect(
      await cli(["org", "channel", "send", "--channel", "site", "-m", "@agent:ceo look"]),
    ).toBe(0);
    expect(lastRequest("POST", "/channels/site/messages")?.body).toEqual({
      text: "@agent:ceo look",
      sessionId: DESK_SESSION,
    });
    expect(org().channels.get("site")!.messages).toHaveLength(1);
    expect(org().channels.get(DEFAULT)!.messages).toHaveLength(1);

    delete process.env.PENGUIN_SESSION_ID;
    expect(await cli(["org", "channel", "send", "-m", "plain"])).toBe(0);
    expect(lastRequest("POST", `/channels/${DEFAULT}/messages`)?.body).toEqual({ text: "plain" });
  });

  it("the server's refusals surface verbatim: a mention outside the membership, a channel the caller is not in, an id no channel carries", async () => {
    server.addEmployee("acme", { agentId: "dev1" });
    server.addSession({ sessionId: DESK_SESSION, agentId: "dev1" });
    server.addChannel("acme", "site", { members: ["user:admin"] });

    // A message naming a non-member is refused before anything is written.
    expect(
      await cli(["org", "channel", "send", "--channel", "site", "-m", "@agent:dev1 look"]),
    ).toBe(1);
    expect(err()).toContain("mention_not_member");
    expect(org().channels.get("site")!.messages).toEqual([]);

    // An employee reads and posts only in the channels it belongs to.
    process.env.PENGUIN_SESSION_ID = DESK_SESSION;
    expect(await cli(["org", "channel", "tail", "--channel", "site"])).toBe(1);
    expect(err()).toContain("not_a_member");
    expect(await cli(["org", "channel", "show", "site"])).toBe(1);
    expect(err()).toContain("not_a_member");
    expect(await cli(["org", "channel", "send", "--channel", "site", "-m", "hi"])).toBe(1);
    expect(err()).toContain("not_a_member");
    delete process.env.PENGUIN_SESSION_ID;

    // An unknown channel is a 404, and so is an id no channel could carry.
    expect(await cli(["org", "channel", "show", "nope"])).toBe(1);
    expect(err()).toContain("channel_not_found");
    expect(await cli(["org", "channel", "tail", "--channel", "Bad-Id"])).toBe(1);
    expect(err()).toContain("channel_not_found");

    // A malformed id in a body is the create route's bad_request; the CLI adds no rule of its own.
    expect(await cli(["org", "channel", "create", "Bad-Id"])).toBe(1);
    expect(err()).toContain("Invalid channel id");
  });
});

describe("penguin org finance", () => {
  it("renders employees along the tree, tickets and the total; unpriced usage is noted on stderr", async () => {
    org().employees[0]!.spend = { own: 1, cumulative: 6 };
    server.addEmployee("acme", {
      agentId: "dev1",
      title: "Developer",
      budget: 20,
      spend: { own: 5, cumulative: 5, ratio: 0.25 },
    });
    server.addTicket("acme", {
      ticketId: "2026-09-02-site",
      title: "Site",
      status: "in_progress",
      cost: 4,
      rolledUpCost: 4,
    });
    org().unpriced = true;
    expect(await cli(["org", "finance"])).toBe(0);
    const text = out();
    expect(text).toContain("  dev1");
    expect(text).toContain("$5.0000");
    expect(text).toContain("$20.00 (25%)");
    expect(text).toContain("2026-09-02-site");
    expect(text).toContain(t.org.financeTotal("2026-09", "$6.0000"));
    expect(err()).toContain(t.org.unpriced());

    stdout.length = 0;
    stderr.length = 0;
    expect(await cli(["org", "finance", "--period", "2026-08", "--json"])).toBe(0);
    expect(JSON.parse(out())).toMatchObject({ period: "2026-08", currency: "USD", unpriced: true });
    expect(err()).toBe("");

    expect(await cli(["org", "finance", "--period", "bogus"])).toBe(1);
    expect(err()).toContain("period must be yyyy-mm");
  });
});

describe("--org-id resolution", () => {
  it("defaults to PENGUIN_ORG_ID; with neither, the command fails before any request", async () => {
    delete process.env.PENGUIN_ORG_ID;
    expect(await cli(["org", "show"])).toBe(1);
    expect(err()).toContain("PENGUIN_ORG_ID");
    expect(server.requests).toHaveLength(0);

    expect(await cli(["org", "show", "--org-id", "acme"])).toBe(0);
    expect(lastRequest("GET", "/organizations/acme")).toBeDefined();

    // An unknown organization is the server's 404, verbatim.
    expect(await cli(["org", "show", "--org-id", "nope"])).toBe(1);
    expect(err()).toContain("org_not_found");
  });
});
