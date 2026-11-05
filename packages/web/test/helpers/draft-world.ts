/**
 * The new-chat page's world (features/chat/draft-view.tsx): a server behind the package's fetch
 * fake ({@link stubFetch}) and the app frame the draft renders in.
 *
 * The server holds one Project with one Agent (`helper`) here, and one connected machine
 * ({@link MACHINE}) holding an Agent of the same id. It creates, lists, reads and deletes
 * Sessions the way the real routes do, each on the server the request reached, and pushes the
 * user events the real server pushes over its `/api/events` stream on the API socket (played by
 * {@link socketWorld}): a create here announces `session_created`, a delete here
 * `session_deleted`, which is how a row reaches, and leaves, every tab's list. A test can refuse
 * the next create or the next task with an error, hold creates or tasks until
 * {@link DraftWorld.release}, and have the next task answer with a self-healed id, as a
 * restarted server does for a Session with no Trace.
 *
 * The frame is the app's own shape at the route level: a memory data router at `/chat/new`
 * whose root holds the Project, machines and Session-list providers around the draft and a
 * probe that prints the listed rows; a conversation page at `/chat/:sessionId` is where a sent
 * draft lands.
 */
import { vi } from "vitest";
import { createElement as h } from "react";
import { Outlet, RouterProvider, createMemoryRouter } from "react-router";
import type {
  MachinesResponse,
  ModelsResponse,
  ServerEvent,
  SessionInfo,
  SessionsBatchRequest,
} from "@prismshadow/penguin-server/api";
import { AuthProvider } from "../../src/state/auth";
import { LocaleProvider } from "../../src/state/locale";
import { ProjectProvider, useProject } from "../../src/state/project";
import { MachinesProvider } from "../../src/state/machines";
import { SessionsProvider, useSessions } from "../../src/state/sessions";
import { DraftView } from "../../src/features/chat/draft-view";
import { ADMIN_ME } from "./admin-settings";
import { socketWorld } from "./api-socket-world";
import { mount } from "./dom";
import { SignedIn } from "./signed-in";
import { apiError, json, stubFetch } from "./fetch";
import type { FakeFetch, FetchRequest } from "./fetch";

export const PROJECT_ID = "proj";
export const AGENT_ID = "helper";
export const MACHINE = "M7kQ2vT9cRb2LmN0";

/** The one model the Project (and the machine) offers. */
export const MODELS: ModelsResponse = {
  providers: {},
  models: [{ provider: "custom", modelId: "m-1", contextWindow: 200_000 }],
  defaultModel: { provider: "custom", modelId: "m-1" },
} as unknown as ModelsResponse;

const machines: MachinesResponse = {
  machines: [
    {
      id: "local",
      alias: "this-box",
      installed: { version: "0.2.16", at: "2026-10-01T00:00:00Z" },
      machineId: "local-machine",
      local: true,
      connection: null,
      socket: null,
      api: null,
      status: null,
      root: "/data",
    },
    {
      id: "ssh:lab",
      alias: "lab",
      installed: { version: "0.2.16", at: "2026-10-01T00:00:00Z" },
      member: true,
      machineId: MACHINE,
      local: false,
      connection: { pid: 4242 },
      socket: null,
      keepConnected: true,
      api: null,
      status: { state: "running", checkedAt: "2026-10-15T00:00:00Z", port: 7371 },
      root: "/home/penguin/.penguin/data",
    },
  ],
  imageVersion: "0.2.16",
  job: null,
  jobs: [],
};

/** A request a test refuses: the answer's status and error code. */
interface Refusal {
  status: number;
  code: string;
}

export interface DraftWorld {
  fetch: FakeFetch;
  /** The Sessions each server holds now, by id: this server's under null. */
  sessionsOn(machine: string | null): string[];
  /** Creates (POST …/sessions), on any server, so far. */
  creates(): FetchRequest[];
  /** Tasks (POST /api/sessions/:id/tasks), on any server, so far. */
  tasks(): FetchRequest[];
  /** Deletes (DELETE /api/sessions/:id), on any server, so far. */
  deletes(): FetchRequest[];
  /** The next create, or the next task, answers this error instead. */
  refuseNext(what: "create" | "task", refusal: Refusal): void;
  /** Creates, or tasks, wait until {@link release}. */
  hold(what: "create" | "task"): void;
  /** Lets every held request go on (and holds no more); the caller settles the page. */
  release(): void;
  /** The next task answers with a new id, the way a Session with no Trace self-heals. */
  healNext(): void;
}

export function draftWorld(): DraftWorld {
  socketWorld.reset();
  /** Every Session by id, with the server that holds it (null = this one). */
  const sessions = new Map<string, { info: SessionInfo; machine: string | null }>();
  let seq = 0;
  const refusals: { create: Refusal | null; task: Refusal | null } = { create: null, task: null };
  const holding = { create: false, task: false };
  let waiting: Array<() => void> = [];
  let heal = false;

  /** A user event, pushed the way the server pushes it: on this server's own stream. */
  const push = (event: ServerEvent) => {
    socketWorld.push("/api/events", event);
  };
  const row = (sessionId: string, workspace: string): SessionInfo =>
    ({
      sessionId,
      projectId: PROJECT_ID,
      agentId: AGENT_ID,
      provider: "custom",
      modelId: "m-1",
      workspace,
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
    }) as SessionInfo;
  const wait = async (what: "create" | "task") => {
    if (holding[what]) await new Promise<void>((resolve) => waiting.push(resolve));
  };
  const refused = (what: "create" | "task") => {
    const refusal = refusals[what];
    refusals[what] = null;
    return refusal === null ? null : apiError(refusal.status, refusal.code);
  };

  const answer = async (request: FetchRequest): Promise<Response> => {
    const { method, path, machine } = request;
    if (path === "/api/me") return json(ADMIN_ME);
    if (path === "/api/me/prefs") return json({ prefs: {} });
    if (path === "/api/projects") {
      return json({
        projects: [
          {
            projectId: PROJECT_ID,
            name: "Project",
            role: "owner",
            ownerUserId: "admin",
            createdAt: "2026-01-01T00:00:00Z",
          },
        ],
      });
    }
    const project = `/api/projects/${PROJECT_ID}`;
    if (path === `${project}/machines`) return json(machines);
    if (path === `${project}/chat-defaults`) return json({});
    if (path === `${project}/models`) return json(MODELS);
    if (path === `${project}/agents` && method === "GET") {
      return json({
        agents: [
          {
            agentId: AGENT_ID,
            name: "Helper",
            createdAt: "2026-01-01T00:00:00Z",
            activeSessionCount: 0,
            sessionCount: 0,
          },
        ],
      });
    }
    if (path === `${project}/agents/${AGENT_ID}/skills`) return json({ skills: [] });
    if (path === `${project}/sessions/batch` && method === "POST") {
      const { requests } = request.body as SessionsBatchRequest;
      const here = [...sessions.values()].filter((s) => s.machine === machine);
      return json({
        results: requests.map((r) => ({
          agentId: r.agentId,
          ok: true,
          sessions: here.filter((s) => s.info.agentId === r.agentId).map((s) => s.info),
        })),
      });
    }
    if (path === `${project}/agents/${AGENT_ID}/sessions` && method === "POST") {
      await wait("create");
      const refusal = refused("create");
      if (refusal !== null) return refusal;
      seq += 1;
      const sessionId = `session-${seq}`;
      const body = request.body as { workspace?: string };
      const info = row(sessionId, body.workspace ?? `/tmp/workspaces/${sessionId}`);
      sessions.set(sessionId, { info, machine });
      if (machine === null) {
        push({
          type: "session_created",
          projectId: PROJECT_ID,
          agentId: AGENT_ID,
          sessionId,
          source: "user",
        });
      }
      return json({ session: info }, 201);
    }
    const one = /^\/api\/sessions\/([^/]+)(\/tasks)?$/.exec(path);
    const held = one === null ? undefined : sessions.get(decodeURIComponent(one[1]!));
    if (one !== null && (held === undefined || held.machine !== machine)) {
      return apiError(404, "session_not_found");
    }
    if (one !== null && held !== undefined && one[2] === "/tasks" && method === "POST") {
      await wait("task");
      const refusal = refused("task");
      if (refusal !== null) return refusal;
      let sessionId = held.info.sessionId;
      if (heal) {
        heal = false;
        sessions.delete(sessionId);
        sessionId = `${sessionId}-healed`;
        sessions.set(sessionId, { info: { ...held.info, sessionId }, machine });
      }
      return json({ sessionId }, 202);
    }
    if (one !== null && held !== undefined && method === "GET") return json({ session: held.info });
    if (one !== null && held !== undefined && method === "DELETE") {
      sessions.delete(held.info.sessionId);
      if (machine === null) {
        push({ type: "session_deleted", sessionId: held.info.sessionId, projectId: PROJECT_ID });
      }
      return new Response(null, { status: 204 });
    }
    return apiError(404, "not_found");
  };

  const fetch = stubFetch(answer);
  const ofKind = (test: (r: FetchRequest) => boolean) => () => fetch.requests.filter(test);
  return {
    fetch,
    sessionsOn: (machine) =>
      [...sessions].filter(([, s]) => s.machine === machine).map(([id]) => id),
    creates: ofKind((r) => r.method === "POST" && r.path.endsWith(`/agents/${AGENT_ID}/sessions`)),
    tasks: ofKind((r) => r.method === "POST" && /^\/api\/sessions\/[^/]+\/tasks$/.test(r.path)),
    deletes: ofKind((r) => r.method === "DELETE" && r.path.startsWith("/api/sessions/")),
    refuseNext: (what, refusal) => {
      refusals[what] = refusal;
    },
    hold: (what) => {
      holding[what] = true;
    },
    release: () => {
      holding.create = false;
      holding.task = false;
      const resume = waiting;
      waiting = [];
      for (const go of resume) go();
    },
    healNext: () => {
      heal = true;
    },
  };
}

/** The Session ids the list shows, in its order. */
function Rows() {
  const { sessions } = useSessions();
  return h(
    "ul",
    { "data-testid": "rows" },
    sessions.map((s) => h("li", { key: s.sessionId }, s.sessionId)),
  );
}

/** The draft, once the Project is known (the chat page renders it the same way). */
function Draft() {
  const { currentProject } = useProject();
  if (currentProject === null) return null;
  return h(DraftView, { projectId: currentProject.projectId, models: MODELS });
}

/** A media query that never matches, and never changes (jsdom has no `matchMedia`). */
const unmatchedQuery = (media: string) => ({
  matches: false,
  media,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
});

/** Mounts the new-chat page at `/chat/new` and returns the router. */
export async function mountDraft() {
  const router = createMemoryRouter(
    [
      {
        element: h(
          SignedIn,
          null,
          h(
            ProjectProvider,
            null,
            h(MachinesProvider, null, h(SessionsProvider, null, h(Rows), h(Outlet))),
          ),
        ),
        children: [
          { path: "/chat/new", element: h(Draft) },
          { path: "/chat/:sessionId", element: h("p", null, "Conversation") },
        ],
      },
    ],
    { initialEntries: ["/chat/new"] },
  );
  vi.stubGlobal("matchMedia", unmatchedQuery);
  await mount(h(LocaleProvider, null, h(AuthProvider, null, h(RouterProvider, { router }))));
  return router;
}

/** The Session ids the list shows. */
export const listedRows = (): string[] =>
  [...document.querySelectorAll('[data-testid="rows"] li')].map((li) => li.textContent ?? "");
