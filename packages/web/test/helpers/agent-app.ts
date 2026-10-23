/**
 * The Agent settings suites' world: a server behind the package's fetch fake ({@link stubFetch})
 * and the app frame the page and its dialogs render in.
 *
 * The server holds one Project the signed-in admin owns (and, when asked, a second one with no
 * Agent of that id — {@link OTHER_PROJECT_ID}), with one Agent: its config (a PUT
 * merges the update into it and echoes the result, the way the real route does), its vault,
 * its scheduled tasks, its API settings, its skills and hooks (none installed) and the
 * Project's models. A test can refuse the next write with {@link AgentServer.refuseNext}, or
 * read back what was written with {@link AgentServer.writes}.
 *
 * It answers the plugin library too: this server's (`library`) and each machine's own, and an
 * install on an Agent takes the named plugins' Skills from the library of the server that holds
 * the Agent, refusing a plugin that library does not have ({@link AgentServer.skillsOn}).
 *
 * It can hold machines too ({@link FakeMachine}): connected ones answer through their proxy
 * (`/server/<id>/api/…`) with an Agent list of their own — created and deleted there, never
 * here — and every other Agent request with the same one server's worth of state, the way the
 * gallery's demo does; one being brought back answers nothing, as a real one has nothing to answer.
 * A machine lists its own Sessions to the sidebar ({@link FakeMachine.sessions}), and a test can
 * take it out of reach or bring it back mid-test ({@link AgentServer.setReconnecting}; the page
 * hears of it through `publishMachinesChanged`, as the server's event would tell it). It can be
 * made slow — every answer held until released ({@link AgentServer.hold} with its id) — or have
 * one read fail as an unreachable server does ({@link AgentServer.failNext}); one request, of
 * any server, can be held on its own ({@link AgentServer.holdNext}), and what was answered so far
 * reads back through {@link AgentServer.requests}. This server's own Agents can be deleted too.
 *
 * Each server keeps the messaging bindings of its own conversations (`messaging`): the read
 * answers them masked, and the state switch turns one on or off. This server answers which
 * servers hold a bot (`accountHolders`), the way it would after asking its machines.
 *
 * The frame is the app's own shape at the route level: a memory data router whose root holds
 * the leave guard (`NavigationGuard`), a sidebar link and the Project and Session-list providers,
 * with the auth provider and the one discard prompt (`UnsavedPrompt`) around it. Beside the
 * mounted page, a conversation page at `/chat/:sessionId` is where a hand-off to a new chat
 * lands. The Session list opens the user's event stream, which jsdom has no `EventSource` for:
 * a silent one stands in (nothing in these suites is pushed over it). jsdom has no `matchMedia`
 * either, which the Memory tab reads for its layout breakpoint: every query answers "no match".
 */
import { vi } from "vitest";
import { createElement as h } from "react";
import type { ReactElement } from "react";
import { Link, Outlet, RouterProvider, createMemoryRouter } from "react-router";
import type { MCPServerConfig } from "@prismshadow/penguin-core/interfaces";
import type {
  AgentConfigResponse,
  AgentSummary,
  ChatDefaultsDto,
  MachineInfo,
  MessagingAccountHoldersResponse,
  MessagingChannel,
  MessagingChannelState,
  PluginItem,
  AgentApiSettings,
  ModelsResponse,
  DirListResponse,
  AgentConfigUpdateRequest,
  McpServerTestResponse,
  ScheduleItem,
  SessionInfo,
  SessionsBatchRequest,
  WorkbenchInfo,
  WorkbenchVersion,
  VaultEntryInfo,
  VaultUpdateRequest,
} from "@prismshadow/penguin-server/api";
import { AuthProvider } from "../../src/state/auth";
import { LocaleProvider } from "../../src/state/locale";
import { ProjectProvider } from "../../src/state/project";
import { MachinesProvider } from "../../src/state/machines";
import { SessionsProvider } from "../../src/state/sessions";
import { NavigationGuard } from "../../src/lib/unsaved/navigation-guard";
import { UnsavedPrompt } from "../../src/lib/unsaved/unsaved-prompt";
import { ADMIN_ME } from "./admin-settings";
import { mount } from "./dom";
import { apiError, json, stubFetch } from "./fetch";
import type { FakeFetch, FetchRequest } from "./fetch";

export const PROJECT_ID = "proj";
export const AGENT_ID = "helper";
/** The second Project `agentServer({ otherProject: true })` lists: it has no Agent at all. */
export const OTHER_PROJECT_ID = "other";

const AGENT_PATH = `/api/projects/${PROJECT_ID}/agents/${AGENT_ID}`;

/** The sidebar's one-request read of every Agent's page: a POST that writes nothing. */
const SESSIONS_BATCH_PATH = `/api/projects/${PROJECT_ID}/sessions/batch`;
/** Whether a request only reads: a GET, or the sessions batch read. */
const isRead = (request: FetchRequest): boolean =>
  request.method === "GET" || request.path === SESSIONS_BATCH_PATH;

/** A tool whose schema declares the optional `description` argument (so it has the switch). */
const describedTool = (name: string) => ({
  name,
  description: `${name} tool`,
  parameters: { type: "object", properties: { description: { type: "string" } } },
});

/** The Agent's stored config: every tab's section, with a couple of overrides to edit. */
export function agentConfig(): AgentConfigResponse {
  return {
    agentsMd: "# Helper\n",
    systemConfigYaml: "",
    stateDir: "/data/agents/helper",
    activeSessionCount: 0,
    config: {
      name: "Helper",
      description: "Helps",
      version: 3,
      kernelVersion: "2026-09-01",
      kernelLatest: "2026-09-01",
      kernelOutdated: false,
      systemPrompt: "You are a helper.\n{{SKILLS}}",
      maxTurns: 50,
      model: { maxTokens: 8000, timeoutMs: 120000 },
      compaction: { maxContextLength: 100000, mode: "summarize", prompt: "Summarize." },
      memory: { enabled: true, prompt: "Remember.", workspacePrompt: "Here." },
      vault: {
        enabled: true,
        prompt: "Vault keys: {{VAULT_KEYS}}",
        templateHasPlaceholder: true,
        legacySectionPresent: false,
      },
      skills: {
        enabled: true,
        prompt: "Skills: {{SKILL_METADATA}}",
        templateHasPlaceholder: true,
        legacySectionPresent: false,
      },
      schedules: {
        enabled: true,
        prompt: "Tasks: {{SCHEDULE_LIST}}",
        templateHasPlaceholder: true,
      },
      hooks: { enabled: true },
      toolsBuiltin: [
        { ...describedTool("exec_command"), permission: "rw", timeoutMs: 60000 },
        { ...describedTool("read_file"), permission: "r", call_description: false },
      ],
      mcpServers: [],
    },
  } as AgentConfigResponse;
}

/** The sections a PUT merges into rather than replaces. */
const MERGED = new Set(["model", "compaction", "memory", "vault", "skills", "schedules", "hooks"]);

function applyUpdate(res: AgentConfigResponse, update: AgentConfigUpdateRequest) {
  const config: Record<string, unknown> = { ...res.config };
  for (const [key, value] of Object.entries(update.config ?? {})) {
    config[key] = MERGED.has(key)
      ? { ...(config[key] as object | undefined), ...(value as object) }
      : value;
  }
  return {
    ...res,
    agentsMd: update.agentsMd ?? res.agentsMd,
    config: config as unknown as AgentConfigResponse["config"],
  };
}

/** A machine of the Project, installed and reached through this server's proxy. */
export interface FakeMachine {
  machineId: string;
  /** Its ssh alias: what the pages write after a name. */
  alias: string;
  /** Being brought back: listed, but not connected, so nothing may be asked of it. */
  reconnecting?: boolean;
  /** The ids of its own Agents, in the order its list answers them (and they were created). */
  agents: string[];
  /** Its own plugin library (by default empty): what an Agent created there can start with. */
  library?: PluginItem[];
  /** The Sessions it lists to the sidebar (by default none), per Agent as its batch read asks. */
  sessions?: SessionInfo[];
}

export interface AgentServer {
  fetch: FakeFetch;
  /** The ids of a machine's own Agents now. */
  machineAgents(machineId: string): string[];
  /** The scheduled tasks of the Agent on a machine now (a machine's tasks are its own files). */
  machineSchedules(machineId: string): ScheduleItem[];
  /** The Skills installed on an Agent of this server (null) or of a machine. */
  skillsOn(machineId: string | null, agentId: string): string[];
  /** The Agent's config as the server holds it now. */
  config(): AgentConfigResponse;
  /** The vault keys the server holds now, in order. */
  vaultKeys(): string[];
  /** The scheduled tasks the server holds now. */
  schedules(): ScheduleItem[];
  /**
   * Every write (PUT, POST, DELETE) so far, oldest first — to the path when one is named: a path
   * under the Agent's (`/config`), or a whole API path (`/api/…`). The sidebar's sessions batch
   * is a POST that only reads, and is not one.
   */
  writes(path?: string): FetchRequest[];
  /** The next write answers this error instead of storing anything. */
  refuseNext(status: number, code: string, message?: string): void;
  /** Writes wait until {@link AgentServer.release} is called (to see a write in flight). */
  hold(): void;
  /** Holds every answer of the machine until `release()`: a slow machine. */
  hold(machineId: string): { release(): void };
  release(): void;
  /** The next read matching `path` on that server (null: this one) answers 502 server_unreachable. */
  failNext(machineId: string | null, path: RegExp): void;
  /** Every request answered so far. */
  requests(): ReadonlyArray<{ method: string; path: string; machine: string | null }>;
  /** Holds the next request matching `path` on that server (null: this one) until `release()`. */
  holdNext(machineId: string | null, path: RegExp): { release(): void };
  /** The ids of this server's Agents now (a delete here removes one). */
  localAgents(): string[];
  /** How the MCP connection test answers an entry (by default: connected, no tools). */
  answerMcpTest(answer: (entry: MCPServerConfig) => McpServerTestResponse): void;
  /** Takes a machine out of reach (being brought back), or brings it back. */
  setReconnecting(machineId: string, reconnecting: boolean): void;
  /** A conversation's messaging bindings as the server that runs it (null: this one) holds them now. */
  messagingOn(machineId: string | null, sessionId: string): MessagingChannelState[];
}

export function agentServer(
  initial: AgentConfigResponse = agentConfig(),
  options: {
    models?: ModelsResponse;
    directory?: DirListResponse;
    chatDefaults?: ChatDefaultsDto;
    workbenches?: WorkbenchInfo[];
    workbenchVersions?: WorkbenchVersion[];
    machines?: FakeMachine[];
    /** This server's plugin library (by default empty). */
    library?: PluginItem[];
    /** Scheduled tasks the Agent already has, on a machine when one is named (this server's otherwise). */
    schedules?: Array<{ machineId?: string; item: ScheduleItem }>;
    /** List {@link OTHER_PROJECT_ID} beside the Agent's Project. */
    otherProject?: boolean;
    /** Saved messaging bindings, per conversation, on a machine when one is named. */
    messaging?: Array<{ machineId?: string; sessionId: string; bindings: MessagingChannelState[] }>;
    /** What this server answers about a bot's holders (by default: nobody, every machine asked). */
    accountHolders?: MessagingAccountHoldersResponse;
  } = {},
): AgentServer {
  /** Installed Skill names by `<machine or "">/<agent>`. */
  const installs = new Map<string, string[]>();
  const installKey = (machineId: string | null, agentId: string) => `${machineId ?? ""}/${agentId}`;
  const machines = (options.machines ?? []).map((m) => ({ ...m, agents: [...m.agents] }));
  let apiSettings: AgentApiSettings = {
    enabled: true,
    open: false,
    approvalMode: "read-only",
    keys: [],
    model: null,
    thinkingLevel: null,
    maxConcurrentRuns: 4,
    workspace: null,
  };
  let stored = initial;
  let workbenches = [...(options.workbenches ?? [])];
  let vault: VaultEntryInfo[] = [{ key: "GITHUB_TOKEN", valueMasked: "gh****" }];
  let schedules: ScheduleItem[] = (options.schedules ?? [])
    .filter((s) => s.machineId === undefined)
    .map((s) => s.item);
  /** Each machine's tasks, by machine id: a request through a machine reads and writes these. */
  const machineSchedules = new Map<string, ScheduleItem[]>();
  for (const { machineId, item } of options.schedules ?? []) {
    if (machineId !== undefined) {
      machineSchedules.set(machineId, [...(machineSchedules.get(machineId) ?? []), item]);
    }
  }
  /** The tasks on the server a request reached, and their replacement. */
  const schedulesOn = (machine: string | null) =>
    machine === null ? schedules : (machineSchedules.get(machine) ?? []);
  const setSchedulesOn = (machine: string | null, next: ScheduleItem[]) => {
    if (machine === null) schedules = next;
    else machineSchedules.set(machine, next);
  };
  /** Bindings by `<machine or "">/<session>`: each server keeps its own conversations'. */
  const messagingKey = (machineId: string | null, sessionId: string) =>
    `${machineId ?? ""}/${sessionId}`;
  const messaging = new Map<string, MessagingChannelState[]>(
    (options.messaging ?? []).map((entry) => [
      messagingKey(entry.machineId ?? null, entry.sessionId),
      entry.bindings,
    ]),
  );
  let refusal: { status: number; code: string; message: string } | null = null;
  let held: Array<() => void> | null = null;
  /** Per held machine, the answers waiting for its release. */
  const machineHolds = new Map<string, Array<() => void>>();
  /** Reads to fail once each, oldest first: the server they are on and the path they match. */
  let failures: Array<{ machine: string | null; path: RegExp }> = [];
  /** Requests to hold once each, oldest first, with the answers they wait for. */
  let oneHolds: Array<{ machine: string | null; path: RegExp; waiting: Array<() => void> }> = [];
  /** This server's Agents: the one the suites configure, unless a test deleted it. */
  let localAgentIds = [AGENT_ID];
  const answered: Array<{ method: string; path: string; machine: string | null }> = [];
  let mcpTest: (entry: MCPServerConfig) => McpServerTestResponse = () => ({
    ok: true,
    tools: [],
    latencyMs: 1,
  });

  /** The refusal a write meets, if one was asked for (it answers one write only). */
  const refused = (): Response | null => {
    if (refusal === null) return null;
    const { status, code, message } = refusal;
    refusal = null;
    return apiError(status, code, message);
  };

  const summaryOf = (agentId: string): AgentSummary => ({
    agentId,
    createdAt: "2026-01-01T00:00:00Z",
    activeSessionCount: 0,
    sessionCount: 0,
    sessionActivity: [],
    toolCount: stored.config.toolsBuiltin.length,
    version: 1,
    kernelOutdated: false,
    vaultKeyCount: vault.length,
    scheduleCount: schedules.length,
    skillCount: 0,
    hookCount: 0,
    workbenchCount: workbenches.length,
    memoryCount: 0,
    apiEnabled: false,
    pluginUpdates: [],
  });

  /** The machines list as this server reports it: itself first, then each machine. */
  const machinesList = (): MachineInfo[] => [
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
    ...machines.map((m): MachineInfo => ({
      id: `ssh:${m.alias}`,
      alias: m.alias,
      installed: { version: "0.2.16", at: "2026-10-01T00:00:00Z" },
      member: true,
      machineId: m.machineId,
      local: false,
      connection: m.reconnecting === true ? null : { pid: 4242 },
      socket: null,
      ...(m.reconnecting === true
        ? {
            reconnect: {
              since: "2026-10-15T00:00:00Z",
              attempts: 2,
              maxAttempts: 8,
              nextAt: null,
              lastError: null,
              diagnosis: null,
            },
          }
        : {}),
      keepConnected: true,
      api: null,
      status: { state: "running", checkedAt: "2026-10-15T00:00:00Z", port: 7371 },
      root: "/home/penguin/.penguin/data",
    })),
  ];

  /** What a machine answers itself: its own Agent list; anything else is the shared state below. */
  const machineAnswer = (request: FetchRequest): Response | null => {
    const machine = machines.find((m) => m.machineId === request.machine);
    if (machine === undefined || machine.reconnecting === true) {
      return apiError(503, "not_connected", `No live forward to ${request.machine}`);
    }
    const agentsPath = `/api/projects/${PROJECT_ID}/agents`;
    if (request.path === agentsPath && request.method === "GET") {
      // Created on the machine after everything here, one day apart in list order.
      return json({
        agents: machine.agents.map((id, i) => ({
          ...summaryOf(id),
          name: id,
          createdAt: `2026-10-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
        })),
      });
    }
    if (request.path === agentsPath && request.method === "POST") {
      const body = request.body as { agentId: string; name?: string };
      machine.agents.push(body.agentId);
      return json({ agent: { ...summaryOf(body.agentId), name: body.name ?? body.agentId } });
    }
    if (request.path === "/api/plugins") {
      return json({ groups: [{ id: "all", title: "All", plugins: machine.library ?? [] }] });
    }
    if (request.path === SESSIONS_BATCH_PATH && request.method === "POST") {
      const { requests } = request.body as SessionsBatchRequest;
      return json({
        results: requests.map((r) => ({
          agentId: r.agentId,
          ok: true,
          sessions: (machine.sessions ?? []).filter((s) => s.agentId === r.agentId),
        })),
      });
    }
    if (request.path.startsWith(`${agentsPath}/`) && request.method === "DELETE") {
      const agentId = decodeURIComponent(request.path.slice(agentsPath.length + 1));
      if (!agentId.includes("/")) {
        machine.agents = machine.agents.filter((id) => id !== agentId);
        return new Response(null, { status: 204 });
      }
    }
    return null;
  };

  /** The library of the server a request reached. */
  const libraryOf = (machineId: string | null): PluginItem[] =>
    machineId === null
      ? (options.library ?? [])
      : (machines.find((m) => m.machineId === machineId)?.library ?? []);

  const answer = (request: FetchRequest): Response => {
    const { method, path } = request;
    if (request.machine !== null) {
      const own = machineAnswer(request);
      if (own !== null) return own;
    }
    if (path === "/api/me") return json(ADMIN_ME);
    if (path === "/api/plugins") {
      return json({ groups: [{ id: "all", title: "All", plugins: libraryOf(request.machine) }] });
    }
    if (path === "/api/plugins/registry") return json({ plugins: [], failures: [], pending: [] });
    if (path === `/api/projects/${PROJECT_ID}/plugins/installed` && method === "GET") {
      return json({
        machineId: request.machine ?? "local-machine",
        file: "project.toml",
        restartPending: false,
        shipped: [],
        plugins: [],
      });
    }
    const pluginsPath = /^\/api\/projects\/[^/]+\/agents\/([^/]+)\/plugins$/.exec(path);
    if (pluginsPath !== null) {
      const key = installKey(request.machine, decodeURIComponent(pluginsPath[1]!));
      if (method === "POST") {
        const { names } = request.body as { names: string[] };
        const library = libraryOf(request.machine);
        const missing = names.find((name) => !library.some((p) => p.name === name));
        if (missing !== undefined) return apiError(404, "plugin_not_found", missing);
        const skills = library
          .filter((p) => names.includes(p.name))
          .flatMap((p) => p.skills.map((skill) => skill.name));
        installs.set(key, [...new Set([...(installs.get(key) ?? []), ...skills])]);
      }
      const version = (name: string) =>
        libraryOf(request.machine)
          .flatMap((p) => p.skills)
          .find((skill) => skill.name === name)?.version ?? "";
      return json({
        skills: (installs.get(key) ?? []).map((name) => ({
          name,
          description: "",
          version: version(name),
        })),
        hooks: [],
        mcpServers: [],
        workbenches: [],
      });
    }
    if (path === "/api/projects") {
      const project = (projectId: string, name: string) => ({
        projectId,
        name,
        role: "owner",
        ownerUserId: "admin",
        createdAt: "2026-01-01T00:00:00Z",
      });
      return json({
        projects: [
          project(PROJECT_ID, "Project"),
          ...(options.otherProject ? [project(OTHER_PROJECT_ID, "Other")] : []),
        ],
      });
    }
    if (options.otherProject && path === `/api/projects/${OTHER_PROJECT_ID}/agents`) {
      return json({ agents: [] });
    }
    if (path === `/api/projects/${PROJECT_ID}/agents` && method === "GET") {
      return json({
        agents: localAgentIds.map((id) => ({
          ...summaryOf(id),
          name: id === AGENT_ID ? stored.config.name : id,
        })),
      });
    }
    if (path === `/api/projects/${PROJECT_ID}/chat-defaults`)
      return json(options.chatDefaults ?? {});
    if (path === `/api/projects/${PROJECT_ID}/models`)
      return json(options.models ?? { models: [], providers: {} });
    if (path === `/api/projects/${PROJECT_ID}/machines`) {
      return json({ machines: machinesList(), imageVersion: "0.2.16", job: null, jobs: [] });
    }
    if (path === `/api/projects/${PROJECT_ID}/messaging/account-holders` && method === "GET") {
      return json(options.accountHolders ?? { holders: [], unreachable: [] });
    }
    const messagingPath = /^\/api\/sessions\/([^/]+)\/messaging(?:\/([^/]+)\/state)?$/.exec(path);
    if (messagingPath !== null) {
      const key = messagingKey(request.machine, decodeURIComponent(messagingPath[1]!));
      const bindings = messaging.get(key) ?? [];
      if (messagingPath[2] === undefined) return json({ bindings });
      const channel = messagingPath[2] as MessagingChannel;
      const entry = bindings.find((b) => b.binding.channel === channel);
      if (entry === undefined || method !== "POST") return apiError(404, "not_found");
      const { enabled } = request.body as { enabled: boolean };
      const next: MessagingChannelState = {
        binding: { ...entry.binding, enabled },
        status: { state: enabled ? "connected" : "disconnected" },
      };
      messaging.set(
        key,
        bindings.map((b) => (b === entry ? next : b)),
      );
      return json(next);
    }
    if (/^\/api\/projects\/[^/]+\/agents\/[^/]+\/sessions$/.test(path) && method === "GET") {
      return json({ sessions: [] });
    }
    if (path === SESSIONS_BATCH_PATH && method === "POST") {
      const { requests } = request.body as SessionsBatchRequest;
      return json({
        results: requests.map((r) => ({ agentId: r.agentId, ok: true, sessions: [] })),
      });
    }
    if (method !== "GET") {
      const refusedWrite = refused();
      if (refusedWrite !== null) return refusedWrite;
    }
    const localAgent = /^\/api\/projects\/[^/]+\/agents\/([^/]+)$/.exec(path);
    if (localAgent !== null && method === "DELETE" && request.machine === null) {
      const agentId = decodeURIComponent(localAgent[1]!);
      localAgentIds = localAgentIds.filter((id) => id !== agentId);
      return new Response(null, { status: 204 });
    }
    if (path === `${AGENT_PATH}/workbenches`) return json({ workbenches });
    if (path.startsWith(`${AGENT_PATH}/workbenches/`)) {
      const [id, action] = path.slice(`${AGENT_PATH}/workbenches/`.length).split("/");
      const workbench = workbenches.find((item) => item.id === id);
      if (!workbench) return apiError(404, "workbench_not_found");
      if (method === "DELETE") {
        workbenches = workbenches.filter((item) => item.id !== id);
        return new Response(null, { status: 204 });
      }
      if (action === "history") return json({ versions: options.workbenchVersions ?? [] });
      if (action === "rollback")
        workbench.revision = (request.body as { revision: string }).revision;
      return json({ workbench });
    }
    if (path === `/api/projects/${PROJECT_ID}/agents` && method === "POST") {
      const body = request.body as { agentId: string; name?: string };
      return json({ agent: { ...summaryOf(body.agentId), name: body.name ?? body.agentId } });
    }
    if (path === `${AGENT_PATH}/config`) {
      if (method === "PUT") stored = applyUpdate(stored, request.body as AgentConfigUpdateRequest);
      return json(stored);
    }
    if (path === `${AGENT_PATH}/config/mcp-test` && method === "POST") {
      return json(mcpTest(request.body as MCPServerConfig));
    }
    if (path === `${AGENT_PATH}/vault`) {
      if (method === "PUT") {
        const body = request.body as VaultUpdateRequest;
        vault = body.entries.map((e) => ({
          key: e.key,
          valueMasked:
            e.value === undefined
              ? (vault.find((v) => v.key === e.key)?.valueMasked ?? "")
              : `${e.value.slice(0, 2)}****`,
        }));
      }
      return json({ entries: vault });
    }
    if (path === `/api/projects/${PROJECT_ID}/schedules` && method === "GET") {
      // The Project-wide listing: every task stamped with the Agent whose directory holds it.
      return json({
        schedules: schedulesOn(request.machine).map((s) => ({ ...s, agentId: AGENT_ID })),
        invalidFiles: [],
      });
    }
    if (path === `${AGENT_PATH}/schedules`) {
      if (method === "POST") {
        const body = request.body as ScheduleItem;
        const item: ScheduleItem = { ...body, status: "active", queued: false };
        setSchedulesOn(request.machine, [...schedulesOn(request.machine), item]);
        return json(item);
      }
      return json({ schedules: schedulesOn(request.machine), invalidFiles: [] });
    }
    if (path.startsWith(`${AGENT_PATH}/schedules/`) && method === "PUT") {
      const name = decodeURIComponent(path.slice(`${AGENT_PATH}/schedules/`.length));
      const item: ScheduleItem = {
        ...(request.body as ScheduleItem),
        name,
        status: "active",
        queued: false,
      };
      setSchedulesOn(
        request.machine,
        schedulesOn(request.machine).map((s) => (s.name === name ? item : s)),
      );
      return json(item);
    }
    if (path.startsWith(`${AGENT_PATH}/schedules/`) && method === "DELETE") {
      const name = decodeURIComponent(path.slice(`${AGENT_PATH}/schedules/`.length));
      setSchedulesOn(
        request.machine,
        schedulesOn(request.machine).filter((s) => s.name !== name),
      );
      return new Response(null, { status: 204 });
    }
    if (path === `${AGENT_PATH}/skills`) return json({ skills: [] });
    if (path === `${AGENT_PATH}/hooks`) return json({ hooks: [] });
    if (path === `${AGENT_PATH}/memory`) {
      return json({
        enabled: stored.config.memory.enabled,
        templateHasMemory: true,
        memoryDir: `${stored.stateDir}/memory`,
        scopes: [],
      });
    }
    if (path === `/api/projects/${PROJECT_ID}/dirs` && options.directory)
      return json(options.directory);
    if (path === `${AGENT_PATH}/api`) {
      if (method === "PUT")
        apiSettings = { ...apiSettings, ...(request.body as Partial<AgentApiSettings>) };
      return json({
        api: apiSettings,
        serverEnabled: true,
      });
    }
    return apiError(404, "not_found");
  };

  /** The failure a read meets, if one was asked for its server and path (it answers one read only). */
  const failed = (request: FetchRequest): Response | null => {
    if (!isRead(request)) return null;
    const match = failures.find((f) => f.machine === request.machine && f.path.test(request.path));
    if (match === undefined) return null;
    failures = failures.filter((f) => f !== match);
    return apiError(
      502,
      "server_unreachable",
      `${request.machine ?? "this server"} did not answer`,
    );
  };

  const fetch = stubFetch(async (request) => {
    if (held !== null && !isRead(request)) {
      await new Promise<void>((resolve) => held!.push(resolve));
    }
    const machineHold = request.machine === null ? undefined : machineHolds.get(request.machine);
    if (machineHold !== undefined) await new Promise<void>((resolve) => machineHold.push(resolve));
    const oneHold = oneHolds.find(
      (h) => h.machine === request.machine && h.path.test(request.path),
    );
    if (oneHold !== undefined) {
      oneHolds = oneHolds.filter((h) => h !== oneHold);
      await new Promise<void>((resolve) => oneHold.waiting.push(resolve));
    }
    const response = failed(request) ?? answer(request);
    answered.push({ method: request.method, path: request.path, machine: request.machine });
    return response;
  });
  function hold(): void;
  function hold(machineId: string): { release(): void };
  function hold(machineId?: string): { release(): void } | void {
    if (machineId === undefined) {
      held = [];
      return;
    }
    const waiting = machineHolds.get(machineId) ?? [];
    machineHolds.set(machineId, waiting);
    return {
      release: () => {
        if (machineHolds.get(machineId) === waiting) machineHolds.delete(machineId);
        for (const resume of waiting.splice(0)) resume();
      },
    };
  }
  return {
    fetch,
    machineAgents: (machineId) => machines.find((m) => m.machineId === machineId)?.agents ?? [],
    skillsOn: (machineId, agentId) => installs.get(installKey(machineId, agentId)) ?? [],
    config: () => stored,
    vaultKeys: () => vault.map((v) => v.key),
    schedules: () => schedules,
    machineSchedules: (machineId) => machineSchedules.get(machineId) ?? [],
    writes: (path) =>
      fetch.requests.filter(
        (r) =>
          !isRead(r) &&
          (path === undefined ||
            r.path === (path.startsWith("/api/") ? path : `${AGENT_PATH}${path}`)),
      ),
    refuseNext: (status, code, message = code) => {
      refusal = { status, code, message };
    },
    hold,
    failNext: (machine, path) => {
      failures.push({ machine, path });
    },
    requests: () => [...answered],
    holdNext: (machine, path) => {
      const entry = { machine, path, waiting: [] as Array<() => void> };
      oneHolds.push(entry);
      return {
        release: () => {
          oneHolds = oneHolds.filter((h) => h !== entry);
          for (const resume of entry.waiting.splice(0)) resume();
        },
      };
    },
    localAgents: () => [...localAgentIds],
    release: () => {
      const waiting = held ?? [];
      held = null;
      for (const resume of waiting) resume();
    },
    answerMcpTest: (answer) => {
      mcpTest = answer;
    },
    setReconnecting: (machineId, reconnecting) => {
      const machine = machines.find((m) => m.machineId === machineId);
      if (machine !== undefined) machine.reconnecting = reconnecting;
    },
    messagingOn: (machineId, sessionId) => messaging.get(messagingKey(machineId, sessionId)) ?? [],
  };
}

/**
 * Mounts `element` at `path` in the app frame and returns the router. The frame's sidebar link
 * goes to `/chat`; `/agents` is the list the Back link returns to.
 */
/** An event stream that never delivers anything: jsdom has no `EventSource`. */
class SilentEventSource {
  static readonly CLOSED = 2;
  readyState = 0;
  onmessage: unknown = null;
  onopen: unknown = null;
  onerror: unknown = null;
  addEventListener(): void {}
  close(): void {
    this.readyState = SilentEventSource.CLOSED;
  }
}

/** A media query that never matches, and never changes. */
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

export async function mountAgentApp(
  element: ReactElement,
  { route = "/agents/:agentId", at }: { route?: string; at: string },
) {
  const router = createMemoryRouter(
    [
      {
        element: h(
          "div",
          null,
          h(NavigationGuard),
          h(Link, { to: "/chat" }, "Sidebar chat"),
          h(ProjectProvider, null, h(MachinesProvider, null, h(SessionsProvider, null, h(Outlet)))),
        ),
        children: [
          { path: "/chat", element: h("p", null, "Chat page") },
          { path: "/agents", element: h("p", null, "Agents list") },
          { path: route, element },
          // Where an Agent card or a create lands when the page under test is not that page.
          ...(route === "/agents/:agentId"
            ? []
            : [{ path: "/agents/:agentId", element: h("p", null, "Agent settings") }]),
          // After the page's own route, so a page mounted at a conversation's path still wins.
          { path: "/chat/:sessionId", element: h("p", null, "Conversation") },
        ],
      },
    ],
    { initialEntries: ["/chat", at] },
  );
  vi.stubGlobal("EventSource", SilentEventSource);
  vi.stubGlobal("matchMedia", unmatchedQuery);
  await mount(
    h(LocaleProvider, null, h(AuthProvider, null, h(RouterProvider, { router }), h(UnsavedPrompt))),
  );
  return router;
}

/** Where the router is: path and query. */
export const whereIs = (router: { state: { location: { pathname: string; search: string } } }) =>
  `${router.state.location.pathname}${router.state.location.search}`;

/** The topmost open dialog. */
export function topDialog(): HTMLElement {
  const all = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  const top = all[all.length - 1];
  if (top === undefined) throw new Error("no dialog on screen");
  return top;
}

/** A label's title: the label element's own first text, or its title span's (the wrapped layout). */
function titleOf(label: HTMLLabelElement): string | undefined {
  const holder = label.htmlFor !== "" ? label : (label.querySelector("span") ?? label);
  return holder.firstChild?.textContent?.trim();
}

/**
 * The text field in `scope` whose label's title is exactly `title` (or whose `aria-label` is) —
 * for short titles ("name", "url") that a substring match would find inside other labels' hints.
 */
export function fieldIn(scope: ParentNode, title: string): HTMLInputElement | HTMLTextAreaElement {
  const fields = [
    ...scope.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"),
  ];
  const found = fields.find(
    (f) =>
      f.getAttribute("aria-label") === title ||
      [...(f.labels ?? [])].some((label) => titleOf(label) === title),
  );
  if (found === undefined) throw new Error(`no field titled ${JSON.stringify(title)}`);
  return found;
}

/** The button in `scope` whose text or accessible name is `name`. */
export function buttonIn(scope: ParentNode, name: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === name || b.getAttribute("aria-label") === name,
  );
  if (found === undefined) throw new Error(`no button named ${JSON.stringify(name)}`);
  return found;
}
