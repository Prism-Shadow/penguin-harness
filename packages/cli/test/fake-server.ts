/**
 * In-process fake PenguinHarness server for CLI tests: stubs `globalThis.fetch` with a
 * handler covering exactly the endpoints the server-backed commands touch (session
 * create/get/patch, tasks/steer/compact/abort, SSE stream, messages, agents, projects,
 * usage, schedules, organizations). Connection resolution is pinned via PENGUIN_API_URL
 * (a loopback URL, so no token gate) and PENGUIN_HOME points at a scratch directory so
 * nothing of the developer's real data root is read.
 *
 * The SSE stream is real: a ReadableStream whose frames follow the server's wire shape
 * (default-event OmniMessage frames, `event: server_event` control frames, incrementing
 * ids). A task POST synchronously emits `task_state running`, the script's messages,
 * then `task_state idle` — enough for watchTask's full lifecycle.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type Json = Record<string, unknown>;

export interface FakeSessionState {
  sessionId: string;
  projectId: string;
  agentId: string;
  provider: string;
  modelId: string;
  workspace: string;
  approvalMode: string;
  thinkingLevel?: string;
  title?: string;
  archived: boolean;
  status: "idle" | "running" | "compacting";
  createdAt: string;
  lastActiveAt: string;
  /** Bodies of every POST /tasks, in order. */
  tasks: Json[];
  /** Bodies of every POST /steer, in order. */
  steers: Json[];
  /** PATCH bodies, in order. */
  patches: Json[];
  aborts: number;
}

/**
 * One organization of the fake (company mode). Employees, calendar events, tickets and
 * chat messages are kept in the DTO shapes the server projects from its files; a ticket
 * record is the detail shape minus `body`, which is rendered on read the way the server
 * serializes the file.
 */
export interface FakeOrgState {
  orgId: string;
  projectId: string;
  name: string;
  mission: string;
  status: "active" | "paused";
  createdBy: string;
  timezone: string;
  invalid?: string;
  ceoAgentId: string;
  ceoDeskSessionId?: string;
  spend: { period: string; cost: number; budget?: number; ratio?: number };
  employees: Json[];
  /** Calendar events keyed `<agentId>/<name>`. */
  calendar: Map<string, Json>;
  calendarInvalidFiles: Json[];
  /** Ticket records keyed by ticket id, in creation order. */
  tickets: Map<string, Json>;
  ticketInvalidFiles: Json[];
  chat: Json[];
  /** Desk sessions keyed by employee. */
  desks: Map<string, Json>;
  /** The `unpriced` flag of the finance response. */
  unpriced: boolean;
}

interface Subscriber {
  controller: ReadableStreamDefaultController<Uint8Array>;
  closed: boolean;
}

const encoder = new TextEncoder();

/** The fake's fixed clock for company mode (the day file, the period, minted ids). */
const ORG_NOW = "2026-09-02T10:00:00.000Z";
const ORG_TODAY = "2026-09-02";
const ORG_PERIOD = "2026-09";
const TICKET_COLUMNS = ["proposed", "in_progress", "review", "done", "rejected"] as const;
const OPEN_COLUMNS: readonly string[] = ["proposed", "in_progress", "review"];
/** The server's TICKET_ID_PATTERN. */
const TICKET_ID_RE = /^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]{0,63}$/;
/** The keys of an OrgTicketItem (the list shape) within a ticket record. */
const TICKET_ITEM_KEYS = [
  "ticketId",
  "title",
  "status",
  "initiator",
  "owner",
  "parent",
  "notify",
  "priority",
  "due",
  "blocked",
  "blockedBy",
  "sessions",
  "running",
  "cost",
  "invalid",
] as const;

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The principals a chat text mentions (`@all`, `@agent:<id>`, `@user:<id>`). */
function mentionsOf(text: string): string[] {
  return [...text.matchAll(/@(all|agent:[A-Za-z0-9_]+|user:[A-Za-z0-9_]+)/g)].map((m) => m[1]!);
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value !== "";

export class FakeServer {
  readonly requests: Array<{ method: string; path: string; body?: Json }> = [];
  readonly sessions = new Map<string, FakeSessionState>();
  agents: Array<Json> = [
    {
      agentId: "default_agent",
      name: "Default Agent",
      description: "",
      sessionCount: 0,
      activeSessionCount: 0,
      sessionActivity: [],
    },
  ];
  projects: Array<Json> = [
    { projectId: "default_project", name: "Default", role: "owner", ownerUserId: "admin" },
  ];
  /** Messages a task emits between running and idle (default: one assistant echo). */
  onTask: (session: FakeSessionState, body: Json) => unknown[] = () => [];
  /** Messages GET /messages returns. */
  history: unknown[] = [];
  /** POST /compact behavior: "reject" -> 409 nothing_to_compact; a function emits its messages like a task. */
  compact: "reject" | ((session: FakeSessionState) => unknown[]) = "reject";
  /** POST /steer behavior: accept (202) or reject (409 not_running). */
  steerMode: "accept" | "reject" = "accept";
  /** When true, a task POST emits `running` + the script's messages but never `idle` — the turn hangs (soft-yield timeout tests). */
  hangTasks = false;
  usage: Json = {
    summary: {
      today: { total: 1000, requests: 2, cost: 0.5, hasUncosted: false },
      last7d: { total: 5000, requests: 9, cost: 2.25, hasUncosted: false },
      total: { total: 9000, requests: 15, cost: 4.5, hasUncosted: true },
    },
    groupBy: "date",
    groups: [],
    granularity: "day",
    series: [],
    byAgentSeries: [],
    byModelSeries: [],
    errors: { total: 0, unexpected: 0, topCode: null, recent: [] },
    agentIds: [],
    models: [],
  };
  schedules: Json = { schedules: [], invalidFiles: [] };
  /** Named schedule store behind add/update/rm: name -> the stored item (single-agent tests). */
  readonly scheduleItems = new Map<string, Json>();
  /** Company mode: organizations keyed by org id. */
  readonly orgs = new Map<string, FakeOrgState>();

  private nextSessionOrdinal = 1;
  private nextEventId = 1;
  private readonly subscribers = new Map<string, Subscriber[]>();
  private savedFetch: typeof globalThis.fetch | null = null;
  private savedEnv = new Map<string, string | undefined>();
  private scratch: string | null = null;

  /** A session id in core's shape whose 8-hex tail is unique per ordinal. */
  private mintSessionId(): string {
    const n = this.nextSessionOrdinal++;
    return `session-2026-08-25-10-00-00-${n.toString(16).padStart(8, "0")}`;
  }

  addSession(overrides: Partial<FakeSessionState> = {}): FakeSessionState {
    const sessionId = overrides.sessionId ?? this.mintSessionId();
    const now = "2026-08-25T10:00:00.000Z";
    const state: FakeSessionState = {
      sessionId,
      projectId: "default_project",
      agentId: "default_agent",
      provider: "prov-default",
      modelId: "model-default",
      workspace: "/ws",
      approvalMode: "allow-all",
      archived: false,
      status: "idle",
      createdAt: now,
      lastActiveAt: now,
      tasks: [],
      steers: [],
      patches: [],
      aborts: 0,
      ...overrides,
    };
    this.sessions.set(state.sessionId, state);
    return state;
  }

  /** Installs the fetch stub and env pinning; returns the uninstaller. */
  install(): () => void {
    this.savedFetch = globalThis.fetch;
    for (const key of [
      "PENGUIN_API_URL",
      "PENGUIN_API_TOKEN",
      "PENGUIN_HOME",
      "PENGUIN_SESSION_ID",
      "PENGUIN_PROJECT_ID",
      "PENGUIN_AGENT_ID",
      "PENGUIN_ORG_ID",
    ]) {
      this.savedEnv.set(key, process.env[key]);
    }
    this.scratch = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-cli-test-"));
    process.env.PENGUIN_HOME = this.scratch;
    process.env.PENGUIN_API_URL = "http://127.0.0.1:7399";
    delete process.env.PENGUIN_API_TOKEN;
    delete process.env.PENGUIN_SESSION_ID;
    delete process.env.PENGUIN_PROJECT_ID;
    delete process.env.PENGUIN_AGENT_ID;
    delete process.env.PENGUIN_ORG_ID;
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
      this.handle(input, init)) as typeof globalThis.fetch;
    return () => this.uninstall();
  }

  uninstall(): void {
    if (this.savedFetch) globalThis.fetch = this.savedFetch;
    for (const [key, value] of this.savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (this.scratch) fs.rmSync(this.scratch, { recursive: true, force: true });
    for (const subs of this.subscribers.values()) {
      for (const sub of subs) {
        if (!sub.closed) {
          sub.closed = true;
          try {
            sub.controller.close();
          } catch {
            /* already closed */
          }
        }
      }
    }
  }

  sessionInfo(s: FakeSessionState): Json {
    return {
      sessionId: s.sessionId,
      projectId: s.projectId,
      agentId: s.agentId,
      provider: s.provider,
      modelId: s.modelId,
      workspace: s.workspace,
      approvalMode: s.approvalMode,
      ...(s.thinkingLevel !== undefined ? { thinkingLevel: s.thinkingLevel } : {}),
      ...(s.title !== undefined ? { title: s.title } : {}),
      createdAt: s.createdAt,
      lastActiveAt: s.lastActiveAt,
      status: s.status,
      pendingApprovalCount: 0,
      pendingFollowUpCount: 0,
      hasTrace: s.tasks.length > 0,
      archived: s.archived,
    };
  }

  /** Emits one SSE frame to every subscriber of the session. */
  emit(sessionId: string, data: unknown, event?: string): void {
    const id = this.nextEventId++;
    const text =
      `id: ${id}\n` +
      (event !== undefined ? `event: ${event}\n` : "") +
      `data: ${JSON.stringify(data)}\n\n`;
    for (const sub of this.subscribers.get(sessionId) ?? []) {
      if (!sub.closed) sub.controller.enqueue(encoder.encode(text));
    }
  }

  emitServerEvent(sessionId: string, ev: Json): void {
    this.emit(sessionId, ev, "server_event");
  }

  /** Runs one scripted turn: running -> messages -> idle. */
  private runTurn(session: FakeSessionState, messages: unknown[]): void {
    session.status = "running";
    this.emitServerEvent(session.sessionId, { type: "task_state", state: "running" });
    for (const msg of messages) this.emit(session.sessionId, msg);
    session.status = "idle";
    this.emitServerEvent(session.sessionId, { type: "task_state", state: "idle" });
  }

  private json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  private error(status: number, code: string, message: string): Response {
    return this.json({ error: { code, message } }, status);
  }

  private badRequest(message: string): Response {
    return this.error(400, "bad_request", message);
  }

  // ---- company mode: state ----

  /** Adds an organization whose CEO (`ceoAgentId`, default `ceo`) is its first employee; `overrides` win. */
  addOrg(overrides: Partial<FakeOrgState> & { orgId: string }): FakeOrgState {
    const org: FakeOrgState = {
      projectId: "default_project",
      name: overrides.orgId,
      mission: "",
      status: "active",
      createdBy: "user:admin",
      timezone: "UTC",
      ceoAgentId: "ceo",
      spend: { period: ORG_PERIOD, cost: 0 },
      employees: [],
      calendar: new Map(),
      calendarInvalidFiles: [],
      tickets: new Map(),
      ticketInvalidFiles: [],
      chat: [],
      desks: new Map(),
      unpriced: false,
      ...overrides,
    };
    this.orgs.set(org.orgId, org);
    if (!org.employees.some((e) => e.agentId === org.ceoAgentId)) {
      this.addEmployee(org.orgId, { agentId: org.ceoAgentId, title: "CEO", reportsTo: null });
    }
    return org;
  }

  /**
   * Adds an employee (OrgEmployeeItem shape; `reportsTo` defaults to the CEO). An employee
   * is an Agent, so one is listed under /agents as well when it is not already.
   */
  addEmployee(orgId: string, item: Json & { agentId: string }): Json {
    const org = this.orgs.get(orgId)!;
    if (!this.agents.some((a) => a.agentId === item.agentId)) {
      this.agents.push({
        agentId: item.agentId,
        name: String(item.name ?? item.agentId),
        description: "",
        sessionCount: 0,
        activeSessionCount: 0,
        sessionActivity: [],
      });
    }
    const employee: Json = {
      name: item.agentId,
      title: "Employee",
      reportsTo: item.agentId === org.ceoAgentId ? null : org.ceoAgentId,
      workspace: ".",
      resolvedWorkspace: `/shared/${item.agentId}`,
      state: "idle",
      spend: { own: 0, cumulative: 0 },
      ...item,
    };
    org.employees.push(employee);
    return employee;
  }

  /** Adds a ticket record (the detail shape minus `body`; a `rawBody` stands in for a body supplied whole). */
  addTicket(orgId: string, item: Json & { ticketId: string }): Json {
    const org = this.orgs.get(orgId)!;
    const ticket: Json = {
      title: item.ticketId,
      status: "proposed",
      initiator: "user:admin",
      notify: ["user:admin"],
      priority: "P1",
      sessions: [],
      running: false,
      cost: 0,
      goal: "",
      acceptanceCriteria: "",
      progress: [],
      result: "",
      rolledUpCost: 0,
      ...item,
    };
    org.tickets.set(item.ticketId, ticket);
    return ticket;
  }

  /** Appends a chat message (OrgChatMessage shape) at the fake's clock unless `time` is given. */
  addChat(orgId: string, msg: Json & { sender: string; text: string }): Json {
    const org = this.orgs.get(orgId)!;
    const message: Json = {
      id: `msg-2026-09-02-10-00-00-${(org.chat.length + 1).toString(16).padStart(8, "0")}`,
      time: ORG_NOW,
      hop: 0,
      mentions: mentionsOf(msg.text),
      ...msg,
    };
    org.chat.push(message);
    return message;
  }

  private orgSummary(org: FakeOrgState): Json {
    const tickets = [...org.tickets.values()];
    const inState = (state: string): number =>
      org.employees.filter((e) => e.state === state).length;
    return {
      projectId: org.projectId,
      orgId: org.orgId,
      name: org.name,
      mission: org.mission,
      status: org.status,
      employeeCount: org.employees.length,
      runningCount: inState("running"),
      pausedCount: inState("paused"),
      openTickets: tickets.filter((x) => OPEN_COLUMNS.includes(String(x.status))).length,
      blockedTickets: tickets.filter((x) => isNonEmptyString(x.blocked)).length,
      createdBy: org.createdBy,
      spend: org.spend,
      ...(org.invalid !== undefined ? { invalid: org.invalid } : {}),
    };
  }

  private orgDetail(org: FakeOrgState): Json {
    const tickets = [...org.tickets.values()];
    return {
      ...this.orgSummary(org),
      settings: {
        name: org.name,
        mission: org.mission,
        status: org.status,
        timezone: org.timezone,
        approvalMode: "allow-all",
        mentionChainLimit: 3,
        budgetWarnRatio: 0.8,
        budgetPauseRatio: 1,
        createdBy: org.createdBy,
      },
      board: Object.fromEntries(
        TICKET_COLUMNS.map((column) => [column, tickets.filter((x) => x.status === column).length]),
      ),
      today: [],
      pending: {
        mentions: 0,
        reviewTickets: tickets.filter((x) => x.status === "review").map((x) => this.ticketItem(x)),
        blockedByMe: [],
      },
      recentChat: org.chat.slice(-5),
      alerts: [],
      ...(org.ceoDeskSessionId !== undefined ? { ceoDeskSessionId: org.ceoDeskSessionId } : {}),
    };
  }

  private ticketItem(rec: Json): Json {
    return Object.fromEntries(
      TICKET_ITEM_KEYS.filter((key) => rec[key] !== undefined).map((key) => [key, rec[key]]),
    );
  }

  private ticketDetail(org: FakeOrgState, rec: Json): Json {
    return {
      ...this.ticketItem(rec),
      goal: rec.goal,
      acceptanceCriteria: rec.acceptanceCriteria,
      progress: rec.progress,
      result: rec.result,
      body: this.ticketBody(rec),
      children: [...org.tickets.values()]
        .filter((x) => x.parent === rec.ticketId)
        .map((x) => x.ticketId),
      rolledUpCost: rec.rolledUpCost,
      sessionItems: (rec.sessions as string[]).map((sessionId) => {
        const s = this.sessions.get(sessionId);
        return { sessionId, agentId: s?.agentId ?? "", status: s?.status ?? "idle" };
      }),
    };
  }

  /** The ticket file as the server writes it: title line, header block, sections (or the supplied body under the generated header). */
  private ticketBody(rec: Json): string {
    const header = [
      `Status: ${rec.status}`,
      `Initiator: ${rec.initiator}`,
      `Owner: ${rec.owner ?? ""}`,
      ...(rec.parent !== undefined ? [`Parent: ${rec.parent}`] : []),
      `Notify: ${(rec.notify as string[]).join(", ")}`,
      `Priority: ${rec.priority}`,
      ...(rec.due !== undefined ? [`Due: ${rec.due}`] : []),
      ...(isNonEmptyString(rec.blocked) ? [`Blocked: ${rec.blocked}`] : []),
      ...(isNonEmptyString(rec.blockedBy) ? [`Blocked-by: ${rec.blockedBy}`] : []),
      `Sessions: ${(rec.sessions as string[]).join(", ")}`,
    ].join("\n");
    const sections =
      typeof rec.rawBody === "string"
        ? rec.rawBody.trimEnd()
        : [
            `## Goal\n${rec.goal}`,
            `## Acceptance criteria\n${rec.acceptanceCriteria}`,
            `## Progress\n${(rec.progress as Json[]).map((p) => `- ${p.time} ${p.by} ${p.text}`).join("\n")}`,
            `## Result\n${rec.result}`,
          ].join("\n\n");
    return `# Ticket: ${rec.title}\n\n${header}\n\n${sections}\n`;
  }

  /**
   * Who a write is attributed to: the calling session's Agent when the body names one (an
   * unknown session is a 404, never a silent fallback), else the token's user.
   */
  private actorOf(
    body: Json | undefined,
  ): { ok: true; principal: string; sessionId?: string } | { ok: false; res: Response } {
    const sessionId = body?.sessionId;
    if (sessionId === undefined) return { ok: true, principal: "user:admin" };
    if (!isNonEmptyString(sessionId))
      return { ok: false, res: this.badRequest("sessionId must be a string.") };
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        ok: false,
        res: this.error(404, "session_not_found", `Session does not exist: ${sessionId}`),
      };
    }
    return { ok: true, principal: `agent:${session.agentId}`, sessionId };
  }

  /** A calendar body's validated fields (POST and PUT share them), or the 400. */
  private calendarFields(
    body: Json | undefined,
  ): { ok: true; value: Json } | { ok: false; res: Response } {
    if (typeof body?.enabled !== "boolean")
      return { ok: false, res: this.badRequest("enabled must be a boolean.") };
    if (!isNonEmptyString(body.prompt))
      return { ok: false, res: this.badRequest("prompt is required.") };
    if (!isNonEmptyString(body.startAt))
      return { ok: false, res: this.badRequest("startAt is required.") };
    const value: Json = { prompt: body.prompt, enabled: body.enabled, startAt: body.startAt };
    for (const key of ["title", "period", "endAt"]) {
      if (isNonEmptyString(body[key])) value[key] = body[key];
    }
    return { ok: true, value };
  }

  private openDesk(org: FakeOrgState, employee: Json, created: boolean): Json {
    const s = this.addSession({ agentId: String(employee.agentId) });
    const desk = {
      sessionId: s.sessionId,
      workspace: String(employee.resolvedWorkspace ?? "/shared"),
      openedAt: ORG_NOW,
    };
    org.desks.set(String(employee.agentId), desk);
    return { agentId: employee.agentId, ...desk, created };
  }

  // ---- company mode: routes (the contract of the server's organizations.ts) ----

  private handleOrganizations(
    method: string,
    projectId: string,
    rest: string,
    url: URL,
    body: Json | undefined,
  ): Response {
    if (rest === "") {
      if (method === "POST") {
        const orgId = body?.orgId;
        if (!isNonEmptyString(orgId) || orgId.length < 2)
          return this.badRequest("orgId is required.");
        if (!isNonEmptyString(body?.mission)) return this.badRequest("mission is required.");
        if (this.orgs.has(orgId)) {
          return this.error(409, "org_exists", `Organization id is already taken: ${orgId}`);
        }
        const org = this.addOrg({
          orgId,
          projectId,
          mission: body.mission,
          ...(isNonEmptyString(body.name) ? { name: body.name } : {}),
        });
        // Creation opens the CEO's desk and starts the initialization run.
        const ceo = org.employees.find((e) => e.agentId === org.ceoAgentId)!;
        org.ceoDeskSessionId = String(this.openDesk(org, ceo, true).sessionId);
        return this.json(this.orgDetail(org), 201);
      }
      const organizations = [...this.orgs.values()]
        .filter((o) => o.projectId === projectId)
        .map((o) => this.orgSummary(o));
      return this.json({ organizations });
    }

    const segments = rest.split("/").map(decodeURIComponent);
    const orgId = segments[0]!;
    const org = this.orgs.get(orgId);
    if (!org || org.projectId !== projectId) {
      return this.error(404, "org_not_found", `Organization does not exist: ${orgId}`);
    }
    const [, a, b, c] = segments;

    if (a === undefined) {
      if (method === "GET") return this.json(this.orgDetail(org));
      if (method === "PATCH") {
        for (const key of ["name", "mission", "timezone"] as const) {
          if (isNonEmptyString(body?.[key])) org[key] = body[key];
        }
        if (body?.status === "active" || body?.status === "paused") org.status = body.status;
        return this.json(this.orgDetail(org).settings);
      }
      if (method === "DELETE") {
        this.orgs.delete(orgId);
        return new Response(null, { status: 204 });
      }
    }

    if (a === "chart" && b === undefined && method === "GET") {
      return this.json({ ceoAgentId: org.ceoAgentId, employees: org.employees });
    }

    if (a === "employees") {
      if (b === undefined) {
        if (method !== "POST")
          return this.error(404, "not_found", `No fake route for ${method} ${url.pathname}`);
        const agentId = body?.agentId;
        const newAgent = body?.newAgent as Json | undefined;
        if ((agentId === undefined) === (newAgent === undefined)) {
          return this.badRequest("Pass exactly one of agentId and newAgent.");
        }
        if (!isNonEmptyString(body?.title)) return this.badRequest("title is required.");
        if (!isNonEmptyString(body?.reportsTo)) return this.badRequest("reportsTo is required.");
        const id = agentId !== undefined ? agentId : newAgent?.agentId;
        if (!isNonEmptyString(id) || id.length < 2) return this.badRequest("agentId is required.");
        if (org.employees.some((e) => e.agentId === id)) {
          return this.error(409, "employee_exists", `${id} is already an employee.`);
        }
        if (agentId !== undefined && !this.agents.some((x) => x.agentId === id)) {
          return this.error(404, "agent_not_found", `Agent does not exist: ${id}`);
        }
        if (!org.employees.some((e) => e.agentId === body?.reportsTo)) {
          return this.badRequest(
            `Invalid employee tree: ${String(body?.reportsTo)} is not an employee.`,
          );
        }
        const employee = this.addEmployee(orgId, {
          agentId: id,
          ...(isNonEmptyString(newAgent?.name) ? { name: newAgent.name } : {}),
          title: body.title,
          reportsTo: body.reportsTo,
          ...(isNonEmptyString(body.workspace) ? { workspace: body.workspace } : {}),
          ...(typeof body.budget === "number" ? { budget: body.budget } : {}),
          ...(typeof body.duties === "string" ? { duties: body.duties } : {}),
          ...(body.model !== undefined && body.model !== null ? { model: body.model } : {}),
        });
        return this.json(employee, 201);
      }
      const employee = org.employees.find((e) => e.agentId === b);
      if (!employee) return this.error(404, "employee_not_found", `${b} is not an employee.`);
      if (c === undefined && method === "PATCH") {
        for (const key of ["title", "reportsTo", "workspace", "duties"]) {
          if (typeof body?.[key] === "string") employee[key] = body[key];
        }
        if (body?.budget === null) delete employee.budget;
        else if (typeof body?.budget === "number") employee.budget = body.budget;
        if (body?.model === null) delete employee.model;
        else if (body?.model !== undefined) employee.model = body.model;
        return this.json(employee);
      }
      if (c === undefined && method === "DELETE") {
        if (b === org.ceoAgentId)
          return this.error(409, "ceo_cannot_leave", "The CEO cannot leave.");
        org.employees.splice(org.employees.indexOf(employee), 1);
        return new Response(null, { status: 204 });
      }
      if (c === "desk" && method === "GET") {
        const existing = org.desks.get(String(b));
        if (existing) return this.json({ agentId: b, ...existing, created: false });
        return this.json(this.openDesk(org, employee, true));
      }
      if (c === "desk" && method === "POST")
        return this.json(this.openDesk(org, employee, true), 201);
    }

    if (a === "calendar") {
      if (b === undefined) {
        if (method === "POST") {
          const agentId = body?.agentId;
          const name = body?.name;
          if (!isNonEmptyString(agentId) || !isNonEmptyString(name)) {
            return this.badRequest("agentId and name are required.");
          }
          if (!org.employees.some((e) => e.agentId === agentId)) {
            return this.error(404, "employee_not_found", `${agentId} is not an employee.`);
          }
          const fields = this.calendarFields(body);
          if (!fields.ok) return fields.res;
          const key = `${agentId}/${name}`;
          if (org.calendar.has(key)) {
            return this.error(
              409,
              "calendar_event_exists",
              `Calendar event already exists: ${key}`,
            );
          }
          const item = this.calendarItem(org, agentId, name, fields.value);
          org.calendar.set(key, item);
          return this.json(item, 201);
        }
        return this.json({
          events: [...org.calendar.values()],
          invalidFiles: org.calendarInvalidFiles,
        });
      }
      if (c !== undefined) {
        const key = `${b}/${c}`;
        const stored = org.calendar.get(key);
        if (!stored) {
          return this.error(
            404,
            "calendar_event_not_found",
            `Calendar event does not exist: ${key}`,
          );
        }
        if (method === "GET") return this.json(stored);
        if (method === "PUT") {
          const fields = this.calendarFields(body);
          if (!fields.ok) return fields.res;
          const item = this.calendarItem(org, b!, c, fields.value);
          org.calendar.set(key, item);
          return this.json(item);
        }
        if (method === "DELETE") {
          org.calendar.delete(key);
          return new Response(null, { status: 204 });
        }
      }
    }

    if (a === "tickets") {
      if (b === undefined) {
        if (method === "POST") return this.createTicket(org, body ?? {});
        const columns = Object.fromEntries(
          TICKET_COLUMNS.map((column) => [
            column,
            [...org.tickets.values()]
              .filter((x) => x.status === column)
              .map((x) => this.ticketItem(x)),
          ]),
        );
        return this.json({ columns, invalidFiles: org.ticketInvalidFiles });
      }
      if (!TICKET_ID_RE.test(b)) return this.badRequest("Invalid ticket id.");
      const rec = org.tickets.get(b);
      if (!rec) return this.error(404, "ticket_not_found", `Ticket does not exist: ${b}`);
      if (c === undefined && method === "GET") return this.json(this.ticketDetail(org, rec));
      if (c === undefined && method === "PUT") {
        const actor = this.actorOf(body);
        if (!actor.ok) return actor.res;
        for (const key of ["title", "notify", "priority", "goal", "acceptanceCriteria", "result"]) {
          if (body?.[key] !== undefined) rec[key] = body[key];
        }
        for (const key of ["owner", "parent", "due"]) {
          if (body?.[key] === null) delete rec[key];
          else if (typeof body?.[key] === "string") rec[key] = body[key];
        }
        return this.json(this.ticketDetail(org, rec));
      }
      if (c !== undefined && method === "POST") return this.ticketAction(org, rec, c, body);
    }

    if (a === "chat" && b === undefined) {
      if (method === "POST") {
        if (!isNonEmptyString(body?.text)) return this.badRequest("text is required.");
        const actor = this.actorOf(body);
        if (!actor.ok) return actor.res;
        const msg = this.addChat(orgId, {
          sender: actor.principal,
          text: body.text,
          ...(body.refs !== undefined ? { refs: body.refs } : {}),
        });
        return this.json(msg, 201);
      }
      const date = url.searchParams.get("date") ?? ORG_TODAY;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return this.badRequest("date must be yyyy-mm-dd.");
      const days = [...new Set(org.chat.map((m) => String(m.time).slice(0, 10)))].sort().reverse();
      const messages = org.chat.filter((m) => String(m.time).startsWith(date));
      return this.json({ date, days, messages, unread: 0, mentionsMe: 0 });
    }

    if (a === "finance" && b === undefined && method === "GET") {
      const period = url.searchParams.get("period") ?? ORG_PERIOD;
      if (!/^\d{4}-\d{2}$/.test(period)) return this.badRequest("period must be yyyy-mm.");
      const employees = org.employees.map((e) => {
        const spend = e.spend as { own: number; cumulative: number; ratio?: number };
        return {
          agentId: e.agentId,
          name: e.name,
          title: e.title,
          reportsTo: e.reportsTo,
          own: spend.own,
          cumulative: spend.cumulative,
          ...(e.budget !== undefined ? { budget: e.budget } : {}),
          ...(spend.ratio !== undefined ? { ratio: spend.ratio } : {}),
          warned: false,
          paused: e.state === "paused",
        };
      });
      const tickets = [...org.tickets.values()].map((x) => ({
        ticketId: x.ticketId,
        title: x.title,
        status: x.status,
        ...(x.parent !== undefined ? { parent: x.parent } : {}),
        cost: x.cost,
        rolledUp: x.rolledUpCost,
      }));
      return this.json({
        period,
        currency: "USD",
        employees,
        tickets,
        daily: [],
        alerts: [],
        total: employees.reduce((sum, e) => sum + e.own, 0),
        unpriced: org.unpriced,
      });
    }

    return this.error(404, "not_found", `No fake route for ${method} ${url.pathname}`);
  }

  private calendarItem(org: FakeOrgState, agentId: string, name: string, fields: Json): Json {
    return {
      agentId,
      name,
      ...fields,
      status: fields.enabled === true ? "active" : "disabled",
      paused: org.status === "paused",
      ...(fields.enabled === true ? { nextFireAt: fields.startAt } : {}),
    };
  }

  private createTicket(org: FakeOrgState, body: Json): Response {
    if (!isNonEmptyString(body.title)) return this.badRequest("title is required.");
    const actor = this.actorOf(body);
    if (!actor.ok) return actor.res;
    if (body.priority !== undefined && !["P0", "P1", "P2"].includes(String(body.priority))) {
      return this.badRequest("priority must be P0, P1 or P2.");
    }
    if (body.parent !== undefined && !TICKET_ID_RE.test(String(body.parent))) {
      return this.badRequest("parent must be a ticket id.");
    }
    const slug = typeof body.slug === "string" ? body.slug : slugify(body.title);
    const ticketId = `${ORG_TODAY}-${slug || "ticket"}`;
    if (org.tickets.has(ticketId))
      return this.error(409, "ticket_exists", `Ticket already exists: ${ticketId}`);
    const rec = this.addTicket(org.orgId, {
      ticketId,
      title: body.title,
      initiator: actor.principal,
      notify: Array.isArray(body.notify) ? body.notify : [actor.principal],
      ...(typeof body.owner === "string" ? { owner: body.owner } : {}),
      ...(typeof body.parent === "string" ? { parent: body.parent } : {}),
      ...(typeof body.priority === "string" ? { priority: body.priority } : {}),
      ...(typeof body.due === "string" ? { due: body.due } : {}),
      goal: typeof body.goal === "string" ? body.goal : "",
      acceptanceCriteria:
        typeof body.acceptanceCriteria === "string" ? body.acceptanceCriteria : "",
      ...(typeof body.body === "string" ? { rawBody: body.body } : {}),
    });
    return this.json(this.ticketDetail(org, rec), 201);
  }

  /** POST …/tickets/:id/(move|block|unblock|progress|start|attach). */
  private ticketAction(
    org: FakeOrgState,
    rec: Json,
    action: string,
    body: Json | undefined,
  ): Response {
    const sessions = rec.sessions as string[];
    switch (action) {
      case "move": {
        const status = String(body?.status ?? "");
        if (!(TICKET_COLUMNS as readonly string[]).includes(status)) {
          return this.badRequest("status must be a column.");
        }
        if (status === "rejected" && !isNonEmptyString(body?.reason)) {
          return this.badRequest("reason is required when moving into rejected.");
        }
        const actor = this.actorOf(body);
        if (!actor.ok) return actor.res;
        rec.status = status;
        if (typeof body?.reason === "string") rec.result = body.reason;
        return this.json(this.ticketDetail(org, rec));
      }
      case "block": {
        if (!isNonEmptyString(body?.reason)) return this.badRequest("reason is required.");
        const actor = this.actorOf(body);
        if (!actor.ok) return actor.res;
        rec.blocked = body.reason;
        if (isNonEmptyString(body.by)) rec.blockedBy = body.by;
        else delete rec.blockedBy;
        return this.json(this.ticketDetail(org, rec));
      }
      case "unblock": {
        const actor = this.actorOf(body);
        if (!actor.ok) return actor.res;
        delete rec.blocked;
        delete rec.blockedBy;
        return this.json(this.ticketDetail(org, rec));
      }
      case "progress": {
        if (!isNonEmptyString(body?.text)) return this.badRequest("text is required.");
        const actor = this.actorOf(body);
        if (!actor.ok) return actor.res;
        (rec.progress as Json[]).push({
          time: ORG_NOW,
          by: actor.principal,
          text: body.text,
          ...(actor.sessionId !== undefined ? { sessionId: actor.sessionId } : {}),
        });
        return this.json(this.ticketDetail(org, rec));
      }
      case "start": {
        const owner =
          typeof rec.owner === "string" && rec.owner.startsWith("agent:")
            ? rec.owner.slice(6)
            : undefined;
        const agentId = isNonEmptyString(body?.agentId) ? body.agentId : owner;
        if (agentId === undefined)
          return this.badRequest("The ticket has no employee owner; pass agentId.");
        const employee = org.employees.find((e) => e.agentId === agentId);
        if (!employee)
          return this.error(404, "employee_not_found", `${agentId} is not an employee.`);
        const s = this.addSession({
          agentId,
          workspace: isNonEmptyString(body?.workspace)
            ? body.workspace
            : String(employee.resolvedWorkspace ?? "/shared"),
        });
        sessions.push(s.sessionId);
        rec.running = true;
        return this.json({ sessionId: s.sessionId }, 202);
      }
      case "attach": {
        if (!isNonEmptyString(body?.sessionId)) return this.badRequest("sessionId is required.");
        const actor = this.actorOf(body);
        if (!actor.ok) return actor.res;
        if (!sessions.includes(body.sessionId)) sessions.push(body.sessionId);
        return this.json(this.ticketDetail(org, rec));
      }
      default:
        return this.error(404, "not_found", `No fake route for POST tickets/${action}`);
    }
  }

  private async handle(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const method = (init?.method ?? "GET").toUpperCase();
    const apiPath = url.pathname;
    let body: Json | undefined;
    if (typeof init?.body === "string" && init.body.length > 0) {
      body = JSON.parse(init.body) as Json;
    }
    this.requests.push({ method, path: apiPath, ...(body !== undefined ? { body } : {}) });

    // Session create
    let m = /^\/api\/projects\/([^/]+)\/agents\/([^/]+)\/sessions$/.exec(apiPath);
    if (m) {
      if (method === "POST") {
        const s = this.addSession({
          projectId: decodeURIComponent(m[1]!),
          agentId: decodeURIComponent(m[2]!),
          ...(typeof body?.workspace === "string" ? { workspace: body.workspace } : {}),
          ...(typeof body?.modelId === "string" ? { modelId: body.modelId } : {}),
          ...(typeof body?.provider === "string" ? { provider: body.provider } : {}),
          ...(typeof body?.approvalMode === "string" ? { approvalMode: body.approvalMode } : {}),
        });
        return this.json({ session: this.sessionInfo(s) }, 201);
      }
      const agentId = decodeURIComponent(m[2]!);
      // Newest first, session id breaking ties — the server's own
      // `ORDER BY created_at DESC, session_id DESC`, which is what makes [0] "the latest".
      const sessions = [...this.sessions.values()]
        .filter((s) => s.agentId === agentId)
        .sort(
          (a, b) =>
            b.createdAt.localeCompare(a.createdAt) || b.sessionId.localeCompare(a.sessionId),
        )
        .map((s) => this.sessionInfo(s));
      return this.json({ sessions });
    }

    m = /^\/api\/projects\/([^/]+)\/agents$/.exec(apiPath);
    if (m) {
      if (method === "POST") {
        const agent = {
          agentId: String(body?.agentId ?? ""),
          name: String(body?.name ?? body?.agentId ?? ""),
          description: String(body?.description ?? ""),
          sessionCount: 0,
          activeSessionCount: 0,
          sessionActivity: [],
        };
        this.agents.push(agent);
        return this.json({ agent }, 201);
      }
      return this.json({ agents: this.agents });
    }

    if (apiPath === "/api/projects" && method === "GET") {
      return this.json({ projects: this.projects });
    }

    m = /^\/api\/projects\/([^/]+)\/usage$/.exec(apiPath);
    if (m) {
      const groupBy = url.searchParams.get("groupBy") ?? "date";
      return this.json({ ...this.usage, groupBy });
    }

    m = /^\/api\/projects\/([^/]+)\/agents\/([^/]+)\/schedules$/.exec(apiPath);
    if (m) {
      if (method === "POST") {
        const name = String(body?.name ?? "");
        if (this.scheduleItems.has(name)) {
          return this.error(409, "schedule_exists", `Schedule already exists: ${name}`);
        }
        if (typeof body?.enabled !== "boolean") {
          return this.error(400, "bad_request", "enabled must be a boolean.");
        }
        const item = { ...body, status: body.enabled ? "active" : "disabled", queued: false };
        delete (item as { name?: unknown }).name;
        const stored = { name, ...item };
        this.scheduleItems.set(name, stored);
        return this.json(stored, 201);
      }
      return this.json(this.schedules);
    }

    m = /^\/api\/projects\/([^/]+)\/agents\/([^/]+)\/schedules\/([^/]+)$/.exec(apiPath);
    if (m) {
      const name = decodeURIComponent(m[3]!);
      const stored = this.scheduleItems.get(name);
      if (!stored) return this.error(404, "schedule_not_found", `Schedule does not exist: ${name}`);
      if (method === "GET") return this.json(stored);
      if (method === "PUT") {
        if (typeof body?.enabled !== "boolean") {
          return this.error(400, "bad_request", "enabled must be a boolean.");
        }
        const next = {
          name,
          ...body,
          status: body.enabled ? "active" : "disabled",
          queued: false,
        };
        this.scheduleItems.set(name, next);
        return this.json(next);
      }
      if (method === "DELETE") {
        this.scheduleItems.delete(name);
        return new Response(null, { status: 204 });
      }
    }

    // Company mode, nested under a Project
    m = /^\/api\/projects\/([^/]+)\/organizations(?:\/(.*))?$/.exec(apiPath);
    if (m)
      return this.handleOrganizations(method, decodeURIComponent(m[1]!), m[2] ?? "", url, body);

    // Session-level endpoints
    m = /^\/api\/sessions\/([^/]+)(\/.*)?$/.exec(apiPath);
    if (m) {
      const sessionId = decodeURIComponent(m[1]!);
      const rest = m[2] ?? "";
      const session = this.sessions.get(sessionId);
      if (!session) return this.error(404, "session_not_found", "Session does not exist.");
      if (rest === "" && method === "GET") return this.json({ session: this.sessionInfo(session) });
      if (rest === "" && method === "PATCH") {
        session.patches.push(body ?? {});
        if (typeof body?.thinkingLevel === "string") session.thinkingLevel = body.thinkingLevel;
        if (typeof body?.approvalMode === "string") session.approvalMode = body.approvalMode;
        return this.json({ session: this.sessionInfo(session) });
      }
      if (rest === "/messages" && method === "GET") return this.json({ messages: this.history });
      if (rest === "/stream" && method === "GET") {
        const subs = this.subscribers.get(sessionId) ?? [];
        this.subscribers.set(sessionId, subs);
        const state = session;
        const server = this;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const sub: Subscriber = { controller, closed: false };
            subs.push(sub);
            const id = server.nextEventId++;
            controller.enqueue(
              encoder.encode(
                `id: ${id}\nevent: server_event\ndata: ${JSON.stringify({
                  type: "task_state",
                  state: state.status,
                })}\n\n`,
              ),
            );
          },
          cancel() {
            for (const sub of subs) sub.closed = true;
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      if (rest === "/tasks" && method === "POST") {
        session.tasks.push(body ?? {});
        if (this.hangTasks) {
          session.status = "running";
          this.emitServerEvent(session.sessionId, { type: "task_state", state: "running" });
          for (const msg of this.onTask(session, body ?? {})) this.emit(session.sessionId, msg);
        } else {
          this.runTurn(session, this.onTask(session, body ?? {}));
        }
        return this.json({ sessionId: session.sessionId }, 202);
      }
      if (rest === "/steer" && method === "POST") {
        if (this.steerMode === "reject") {
          return this.error(409, "not_running", "No task in progress.");
        }
        session.steers.push(body ?? {});
        return new Response(null, { status: 202 });
      }
      if (rest === "/compact" && method === "POST") {
        if (this.compact === "reject") {
          return this.error(409, "nothing_to_compact", "Nothing to compact.");
        }
        this.runTurn(session, this.compact(session));
        return this.json({ sessionId: session.sessionId }, 202);
      }
      if (rest === "/abort" && method === "POST") {
        session.aborts += 1;
        return new Response(null, { status: 202 });
      }
      if (/^\/approvals\//.test(rest) && method === "POST") {
        return new Response(null, { status: 204 });
      }
    }

    return this.error(404, "not_found", `No fake route for ${method} ${apiPath}`);
  }
}
