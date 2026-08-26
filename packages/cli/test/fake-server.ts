/**
 * In-process fake PenguinHarness server for CLI tests: stubs `globalThis.fetch` with a
 * handler covering exactly the endpoints the server-backed commands touch (session
 * create/get/patch, tasks/steer/compact/abort, SSE stream, messages, agents, projects,
 * usage, schedules). Connection resolution is pinned via PENGUIN_API_URL (a loopback
 * URL, so no token gate) and PENGUIN_HOME points at a scratch directory so nothing of
 * the developer's real data root is read.
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

interface Subscriber {
  controller: ReadableStreamDefaultController<Uint8Array>;
  closed: boolean;
}

const encoder = new TextEncoder();

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
      const sessions = [...this.sessions.values()]
        .filter((s) => s.agentId === agentId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
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
    if (m) return this.json(this.schedules);

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
