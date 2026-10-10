/**
 * The Agent settings suites' world: a server behind the package's fetch fake ({@link stubFetch})
 * and the app frame the page and its dialogs render in.
 *
 * The server holds one Project the signed-in admin owns, with one Agent: its config (a PUT
 * merges the update into it and echoes the result, the way the real route does), its vault,
 * its scheduled tasks, its API settings and the Project's models. A test can refuse the next
 * write with {@link AgentServer.refuseNext}, or read back what was written with
 * {@link AgentServer.writes}.
 *
 * The frame is the app's own shape at the route level: a memory data router whose root holds
 * the leave guard (`NavigationGuard`), a sidebar link and the Project and Session-list providers,
 * with the auth provider and the one discard prompt (`UnsavedPrompt`) around it. The Session list
 * opens the user's event stream, which jsdom has no `EventSource` for: a silent one stands in
 * (nothing in these suites is pushed over it). jsdom has no `matchMedia` either, which the Memory
 * tab reads for its layout breakpoint: every query answers "no match".
 */
import { vi } from "vitest";
import { createElement as h } from "react";
import type { ReactElement } from "react";
import { Link, Outlet, RouterProvider, createMemoryRouter } from "react-router";
import type {
  AgentConfigResponse,
  AgentConfigUpdateRequest,
  ScheduleItem,
  VaultEntryInfo,
  VaultUpdateRequest,
} from "@prismshadow/penguin-server/api";
import { AuthProvider } from "../../src/state/auth";
import { LocaleProvider } from "../../src/state/locale";
import { ProjectProvider } from "../../src/state/project";
import { SessionsProvider } from "../../src/state/sessions";
import { NavigationGuard } from "../../src/lib/unsaved/navigation-guard";
import { UnsavedPrompt } from "../../src/lib/unsaved/unsaved-prompt";
import { ADMIN_ME } from "./admin-settings";
import { mount } from "./dom";
import { apiError, json, stubFetch } from "./fetch";
import type { FakeFetch, FetchRequest } from "./fetch";

export const PROJECT_ID = "proj";
export const AGENT_ID = "helper";

const AGENT_PATH = `/api/projects/${PROJECT_ID}/agents/${AGENT_ID}`;

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

export interface AgentServer {
  fetch: FakeFetch;
  /** The Agent's config as the server holds it now. */
  config(): AgentConfigResponse;
  /** The vault keys the server holds now, in order. */
  vaultKeys(): string[];
  /** The scheduled tasks the server holds now. */
  schedules(): ScheduleItem[];
  /**
   * Every write (PUT, POST, DELETE) so far, oldest first — to the path when one is named: a path
   * under the Agent's (`/config`), or a whole API path (`/api/…`).
   */
  writes(path?: string): FetchRequest[];
  /** The next write answers this error instead of storing anything. */
  refuseNext(status: number, code: string, message?: string): void;
  /** Writes wait until {@link AgentServer.release} is called (to see a write in flight). */
  hold(): void;
  release(): void;
}

export function agentServer(initial: AgentConfigResponse = agentConfig()): AgentServer {
  let stored = initial;
  let vault: VaultEntryInfo[] = [{ key: "GITHUB_TOKEN", valueMasked: "gh****" }];
  let schedules: ScheduleItem[] = [];
  let refusal: { status: number; code: string; message: string } | null = null;
  let held: Array<() => void> | null = null;

  /** The refusal a write meets, if one was asked for (it answers one write only). */
  const refused = (): Response | null => {
    if (refusal === null) return null;
    const { status, code, message } = refusal;
    refusal = null;
    return apiError(status, code, message);
  };

  const summaryOf = (agentId: string) => ({
    agentId,
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
  });

  const answer = (request: FetchRequest): Response => {
    const { method, path } = request;
    if (path === "/api/me") return json(ADMIN_ME);
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
    if (path === `/api/projects/${PROJECT_ID}/agents` && method === "GET") {
      return json({ agents: [{ ...summaryOf(AGENT_ID), name: stored.config.name }] });
    }
    if (path === `/api/projects/${PROJECT_ID}/models`) return json({ models: [], providers: {} });
    if (path === `/api/projects/${PROJECT_ID}/machines`) {
      return json({ machines: [], imageVersion: null, job: null });
    }
    if (/^\/api\/projects\/[^/]+\/agents\/[^/]+\/sessions$/.test(path) && method === "GET") {
      return json({ sessions: [] });
    }
    if (method !== "GET") {
      const refusedWrite = refused();
      if (refusedWrite !== null) return refusedWrite;
    }
    if (path === `/api/projects/${PROJECT_ID}/agents` && method === "POST") {
      const body = request.body as { agentId: string; name?: string };
      return json({ agent: { ...summaryOf(body.agentId), name: body.name ?? body.agentId } });
    }
    if (path === `${AGENT_PATH}/config`) {
      if (method === "PUT") stored = applyUpdate(stored, request.body as AgentConfigUpdateRequest);
      return json(stored);
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
    if (path === `${AGENT_PATH}/schedules`) {
      if (method === "POST") {
        const body = request.body as ScheduleItem;
        const item: ScheduleItem = { ...body, status: "active", queued: false };
        schedules = [...schedules, item];
        return json(item);
      }
      return json({ schedules, invalidFiles: [] });
    }
    if (path.startsWith(`${AGENT_PATH}/schedules/`) && method === "PUT") {
      const name = decodeURIComponent(path.slice(`${AGENT_PATH}/schedules/`.length));
      const item: ScheduleItem = {
        ...(request.body as ScheduleItem),
        name,
        status: "active",
        queued: false,
      };
      schedules = schedules.map((s) => (s.name === name ? item : s));
      return json(item);
    }
    if (path === `${AGENT_PATH}/skills`) return json({ skills: [] });
    if (path === `${AGENT_PATH}/memory`) {
      return json({
        enabled: stored.config.memory.enabled,
        templateHasMemory: true,
        memoryDir: `${stored.stateDir}/memory`,
        scopes: [],
      });
    }
    if (path === `${AGENT_PATH}/api`) {
      return json({
        api: { enabled: true, open: false, approvalMode: "read-only", keys: [] },
        serverEnabled: true,
      });
    }
    return apiError(404, "not_found");
  };

  const fetch = stubFetch(async (request) => {
    if (held !== null && request.method !== "GET") {
      await new Promise<void>((resolve) => held!.push(resolve));
    }
    return answer(request);
  });
  return {
    fetch,
    config: () => stored,
    vaultKeys: () => vault.map((v) => v.key),
    schedules: () => schedules,
    writes: (path) =>
      fetch.requests.filter(
        (r) =>
          r.method !== "GET" &&
          (path === undefined ||
            r.path === (path.startsWith("/api/") ? path : `${AGENT_PATH}${path}`)),
      ),
    refuseNext: (status, code, message = code) => {
      refusal = { status, code, message };
    },
    hold: () => {
      held = [];
    },
    release: () => {
      const waiting = held ?? [];
      held = null;
      for (const resume of waiting) resume();
    },
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
          h(ProjectProvider, null, h(SessionsProvider, null, h(Outlet))),
        ),
        children: [
          { path: "/chat", element: h("p", null, "Chat page") },
          { path: "/agents", element: h("p", null, "Agents list") },
          { path: route, element },
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
